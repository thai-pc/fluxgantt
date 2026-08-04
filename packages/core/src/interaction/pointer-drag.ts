// Interaction layer — shared pointer-gesture lifecycle/dispatcher (spec-drag-resize.md §1).
//
// Coordinates MULTIPLE `PointerGestureRecognizer`s (drag-move, drag-resize, later
// drag-create-dependency) sharing ONE delegated `pointerdown` listener per
// `SvgRendererHandle` — required because two independent listeners on the same
// `handle.svg` would race on which one claims a given pointerdown (plan-drag-resize.md §6
// resolution #8: "edge takes priority over move, decided at a single coordination point").
// A `WeakMap<SvgRendererHandle, PointerDragController>` singleton, lazily created on the
// first `register()` for a given handle, lets `enableDragMove`/`enableDragResize` each call
// `getPointerDragController(handle).register(...)` independently while still resolving to
// the SAME underlying `pointerdown` listener — no manual cleanup needed (released together
// with the handle once nothing references either).
//
// TOUCHES THE DOM (raw Pointer Events) — this is the only layer in `@fluxgantt/core` allowed
// to, per architecture.md "Interaction". Still does NOT import react/vue/svelte.
//
// Internal coordination primitive — NOT exported from `interaction/index.ts` or
// `core/index.ts` (spec §0): only `drag-move.ts`/`drag-resize.ts` import this module,
// keeping the public surface small (coding-conventions.md).
import type { SvgRendererHandle, TimeScale } from '../render/index.js';

export interface PointerGestureContext<TState> {
  /** Opaque, owned by the claiming recognizer (built once at `hitTest()`, passed by
   *  reference to every `onMove`/`onCommit`/`onCancel` call). */
  readonly state: TState;
  /** The matched `.fg-task[data-task-id]` element. */
  readonly groupEl: Element;
  /** `event.target` at `pointerdown` — used to pair `setPointerCapture`/
   *  `releasePointerCapture`; may be a child of `groupEl` (e.g. `.fg-task__bar`). */
  readonly captureEl: Element;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  /** Captured ONCE per gesture attempt (at `pointerdown`) — not re-read on every
   *  `pointermove`, so a `setOptions()` mid-gesture doesn't change the meaning of the
   *  accumulating delta. */
  readonly timeScale: TimeScale;
}

export interface PointerGestureRecognizer<TState> {
  /** Debug/error messages only. */
  readonly name: string;
  /**
   * Ascending = tried first. No meaning is assigned by `pointer-drag.ts` itself — callers
   * pick their own convention. `drag-resize.ts` uses a lower number than `drag-move.ts` so
   * an edge-zone claim always wins over a whole-bar claim on the same `pointerdown`.
   * Ties broken by registration order (stable sort).
   */
  readonly priority: number;
  /** Per-recognizer, NOT a controller-level option — preserves each `enableDragXxx`'s own
   *  configurable default. */
  readonly dragThresholdPx: number;
  /**
   * Synchronous, called at most once per `pointerdown`, in ascending-priority order, until
   * one recognizer returns non-null/non-undefined — that recognizer claims the ENTIRE
   * gesture (no other recognizer's `hitTest` runs for this `pointerdown`). Return
   * `null`/`undefined` to decline. MUST be cheap, MUST NOT mutate DOM.
   */
  hitTest(event: PointerEvent, groupEl: Element): TState | null | undefined;
  /** Called exactly once, the FIRST `pointermove` that exceeds `dragThresholdPx` — after
   *  the coordinator's own `event.preventDefault()` (blocks text-selection, unconditional,
   *  recognizer-agnostic). Add drag chrome (CSS class, cursor) here. */
  onDragStart?(ctx: PointerGestureContext<TState>): void;
  /** Called on every valid `pointermove` AFTER the threshold (including the one that
   *  crossed it, right after `onDragStart`). `dxPixels` = `event.clientX -
   *  ctx.startClientX` (client-coordinate delta, unsnapped — snapping is the recognizer's
   *  own concern via `snapDeltaToDay`). */
  onMove(ctx: PointerGestureContext<TState>, dxPixels: number, event: PointerEvent): void;
  /** Called once on the `pointerup` that ends a past-threshold gesture. This is the ONLY
   *  commit point. */
  onCommit(ctx: PointerGestureContext<TState>, dxPixels: number, event: PointerEvent): void;
  /** Called on cancellation: Escape, `pointercancel`, disposer-mid-drag, a garbage-coord
   *  `pointerup`, or the gesture's own recognizer being unregistered mid-drag. Called
   *  UNCONDITIONALLY on every cancellation path (even if the threshold was never exceeded)
   *  — implementations must be idempotent/harmless no-ops in that case. */
  onCancel(ctx: PointerGestureContext<TState>): void;
}

export interface PointerDragController {
  /** Registers one recognizer. Returns a disposer: unregisters it, and — if a gesture this
   *  recognizer currently owns is open — cancels it first (`onCancel`, no commit), same as
   *  `enableDragMove`'s existing disposer-mid-drag contract. Idempotent (calling twice is a
   *  safe no-op). When the LAST registered recognizer unregisters, the controller detaches
   *  its `pointerdown` listener from `handle.svg` and restores the original (unwrapped)
   *  `handle.destroy` — fully symmetric teardown, no leaked listeners regardless of how many
   *  recognizers were ever registered on this handle. */
  register<TState>(recognizer: PointerGestureRecognizer<TState>): () => void;
}

export const DEFAULT_DRAG_THRESHOLD_PX = 4;

/**
 * Clamp for the snapped day-delta (review B2, drag-move.ts's original comment, kept
 * verbatim). `Number.isFinite` alone lets a finite but absurd `clientX` (e.g. 1e8) through,
 * and `ZonedDateTime.add({ days: 1e8 })` throws a `RangeError` (Temporal's
 * representable-instant limit) — which would escape a pointer handler and leave the drag UI
 * wedged. ±366,000 days ≈ 1,000 years: far beyond any real drag, always inside Temporal's
 * range regardless of the task's base date.
 */
export const MAX_DRAG_DAYS = 366_000;

/**
 * Snap a pixel delta to the nearest whole day (by `timeScale.pixelsPerDay`). Returns the
 * NUMBER OF DAYS (N), not pixels. Canonical home (moved verbatim from `drag-move.ts` —
 * `drag-move.ts` re-exports this same function so its existing test's import path keeps
 * resolving unedited).
 */
export function snapDeltaToDay(dxPixels: number, timeScale: TimeScale): number {
  if (!Number.isFinite(dxPixels) || !Number.isFinite(timeScale.pixelsPerDay) || timeScale.pixelsPerDay === 0) {
    return 0;
  }
  const n = Math.round(dxPixels / timeScale.pixelsPerDay);
  // Clamp a finite-but-absurd delta so a recognizer's `.add({ days: n })` commit path can
  // never throw a Temporal RangeError (review B2).
  return Math.max(-MAX_DRAG_DAYS, Math.min(MAX_DRAG_DAYS, n));
}

interface OpenGesture {
  readonly recognizer: PointerGestureRecognizer<unknown>;
  /** Built once, passed by reference to every `onMove`/`onCommit`/`onCancel` call —
   *  recognizers must treat it as readonly. */
  readonly ctx: PointerGestureContext<unknown>;
  exceededThreshold: boolean;
}

const controllers = new WeakMap<SvgRendererHandle, PointerDragController>();

/**
 * One controller per `SvgRendererHandle`, created lazily, found via a `WeakMap` (no manual
 * cleanup needed).
 */
export function getPointerDragController(handle: SvgRendererHandle): PointerDragController {
  let controller = controllers.get(handle);
  if (!controller) {
    controller = createController(handle);
    controllers.set(handle, controller);
  }
  return controller;
}

function createController(handle: SvgRendererHandle): PointerDragController {
  const recognizers: PointerGestureRecognizer<unknown>[] = [];
  let state: OpenGesture | null = null;
  let attached = false;
  // Assigned by `ensureAttached()`, consumed/reset by `detach()` — mirrors
  // `enableDragMove`'s original `originalDestroy`/`destroyWithDrag` wrap, now refcounted
  // across recognizers instead of being one-shot per `enableDragMove` call.
  let originalDestroy: (() => void) | undefined;
  let wrappedDestroy: (() => void) | undefined;

  return { register };

  function register<TState>(recognizer: PointerGestureRecognizer<TState>): () => void {
    const erased = recognizer as unknown as PointerGestureRecognizer<unknown>;
    recognizers.push(erased);
    ensureAttached();
    let unregistered = false;
    return () => {
      if (unregistered) return;
      unregistered = true;
      // Don't orphan an open gesture this recognizer currently owns.
      if (state?.recognizer === erased) cancelActiveGesture();
      const idx = recognizers.indexOf(erased);
      if (idx !== -1) recognizers.splice(idx, 1);
      if (recognizers.length === 0) detach();
    };
  }

  function ensureAttached(): void {
    if (attached) return;
    attached = true;
    handle.svg.addEventListener('pointerdown', onPointerDown);

    // B1 (High, inherited from drag-move.ts): `register()` and the renderer handle are two
    // independent lifecycles. If the host calls `handle.destroy()` while a gesture is open,
    // `destroy()` only removes the <svg> — the 4 `window` listeners added at pointerdown
    // would leak (and keep the detached DOM alive) until some later pointerup/cancel
    // happens to fire. Link them: wrap `destroy` so tearing down the renderer also disposes
    // every registered recognizer's open gesture + detaches the coordinator.
    originalDestroy = handle.destroy;
    wrappedDestroy = (): void => {
      // Capture before `detach()` clears `originalDestroy` (it must be cleared so a LATER
      // `ensureAttached()` on the same handle doesn't chain onto a stale reference).
      const original = originalDestroy;
      detach();
      original!.call(handle);
    };
    handle.destroy = wrappedDestroy;
  }

  function detach(): void {
    if (!attached) return;
    attached = false;
    handle.svg.removeEventListener('pointerdown', onPointerDown);
    if (handle.destroy === wrappedDestroy && originalDestroy) {
      handle.destroy = originalDestroy;
    }
    originalDestroy = undefined;
    wrappedDestroy = undefined;
    // Defensive — should already be none by the time the last recognizer unregisters
    // cleanly, but a mid-gesture `handle.destroy()` reaches here with an open gesture.
    cancelActiveGesture();
  }

  function onPointerDown(event: PointerEvent): void {
    // B3: ignore a second concurrent pointerdown (e.g. a 2nd finger on a touch screen)
    // while a gesture is already open, ACROSS ALL recognizers — overwriting `state` would
    // orphan the first gesture.
    if (state) return;
    if (!(event.target instanceof Element)) return;
    // Not a drag on a task bar — return early, do NOT preventDefault/stopPropagation
    // (don't block future click/selection on grid/header/empty space).
    const groupEl = event.target.closest('.fg-task[data-task-id]');
    if (!groupEl) return;

    // Pointer coordinates are untrusted numeric input — bail at pointerdown if already
    // corrupt; don't start a gesture on garbage data.
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;

    const timeScale = handle.getTimeScale();
    // Ascending priority, stable (Array.prototype.sort is stable per ES2019+) — ties break
    // by registration order.
    const sorted = [...recognizers].sort((a, b) => a.priority - b.priority);
    let claimedRecognizer: PointerGestureRecognizer<unknown> | undefined;
    let claimedState: unknown;
    for (const recognizer of sorted) {
      const candidateState = recognizer.hitTest(event, groupEl);
      if (candidateState !== null && candidateState !== undefined) {
        claimedRecognizer = recognizer;
        claimedState = candidateState;
        break;
      }
    }
    if (!claimedRecognizer) return; // no recognizer claimed this pointerdown

    const captureEl = event.target;
    try {
      captureEl.setPointerCapture?.(event.pointerId);
    } catch {
      // Best-effort — jsdom and some environments don't implement real pointer capture.
      // Never let this error break the main gesture flow.
    }

    const ctx: PointerGestureContext<unknown> = {
      state: claimedState,
      groupEl,
      captureEl,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      timeScale,
    };
    state = { recognizer: claimedRecognizer, ctx, exceededThreshold: false };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
  }

  function onPointerMove(event: PointerEvent): void {
    const s = state;
    if (!s || event.pointerId !== s.ctx.pointerId) return;
    // Defensive (B1): if the claimed group was detached (renderer removed/repainted
    // without going through the wrapped destroy), abort the gesture rather than keep
    // mutating an orphaned node / holding window listeners.
    if (!s.ctx.groupEl.isConnected) {
      cancelActiveGesture();
      return;
    }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      // Garbage coordinates mid-gesture — ignore this event, keep the state.
      return;
    }

    const dxRaw = event.clientX - s.ctx.startClientX;

    if (!s.exceededThreshold) {
      if (Math.abs(dxRaw) < s.recognizer.dragThresholdPx) return; // potential click, do nothing yet
      s.exceededThreshold = true;
      // Block text-selection while dragging with a mouse — only once this is confirmed a
      // drag. Unconditional, coordinator-owned (not per-recognizer).
      event.preventDefault();
      s.recognizer.onDragStart?.(s.ctx);
    }

    s.recognizer.onMove(s.ctx, dxRaw, event);
  }

  function onPointerUp(event: PointerEvent): void {
    const s = state;
    if (!s || event.pointerId !== s.ctx.pointerId) return;
    teardownListeners(s);
    state = null;

    if (!s.exceededThreshold) return; // plain click — no commit, no cancel

    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      // Garbage coordinates on the final release event — don't commit data from corrupt
      // coords, cancel instead.
      s.recognizer.onCancel(s.ctx);
      return;
    }

    const dxRaw = event.clientX - s.ctx.startClientX;
    s.recognizer.onCommit(s.ctx, dxRaw, event);
  }

  function onPointerCancel(event: PointerEvent): void {
    const s = state;
    if (!s || event.pointerId !== s.ctx.pointerId) return;
    cancelActiveGesture();
  }

  function onKeyDown(event: KeyboardEvent): void {
    const s = state;
    if (!s) return;
    if (event.key !== 'Escape') return;
    cancelActiveGesture();
  }

  /** Cancel an in-progress gesture: remove listeners, call the claiming recognizer's
   *  `onCancel`, do NOT commit. Shared by pointercancel/Escape/disposer-mid-drag/destroy. */
  function cancelActiveGesture(): void {
    const s = state;
    if (!s) return;
    teardownListeners(s);
    state = null;
    s.recognizer.onCancel(s.ctx);
  }

  function teardownListeners(s: OpenGesture): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown);
    try {
      s.ctx.captureEl.releasePointerCapture?.(s.ctx.pointerId);
    } catch {
      // Best-effort, see the note at setPointerCapture.
    }
  }
}
