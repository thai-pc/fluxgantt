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
// `core/index.ts` (spec §0): only the drag recognizers and `interaction/mixin.ts` import this module,
// keeping the public surface small (coding-conventions.md).
import type { InteractiveRendererHandle } from '../render/interactive-renderer-handle.js';
import type { TimeScale } from '../render/renderer-base.js';
import type { Task } from '../types.js';

export interface PointerGestureContext<TState> {
  /** Opaque, owned by the claiming recognizer (built once at `claim()`, passed by
   *  reference to every `move`/`commit`/`cancel` call). */
  readonly state: TState;
  /** The matched `.fg-task[data-task-id]` element. */
  readonly grp: Element;
  /** `event.target` at `pointerdown` — used to pair `setPointerCapture`/
   *  `releasePointerCapture`; may be a child of `grp` (e.g. `.fg-task__bar`). */
  readonly cap: Element;
  readonly pointerId: number;
  readonly x0: number;
  readonly y0: number;
  /** Captured ONCE per gesture attempt (at `pointerdown`) — not re-read on every
   *  `pointermove`, so a `setOptions()` mid-gesture doesn't change the meaning of the
   *  accumulating delta. */
  readonly ts: TimeScale;
}

export interface PointerGestureRecognizer<TState> {
  /** Class the coordinator puts on the gesture's task group for the lifetime of a STARTED drag
   *  (`start` .. commit/cancel), e.g. `fg-task--dragging`. */
  readonly cls: string;
  /** `document.body.style.cursor` while a STARTED drag is open. */
  readonly cursor: string;
  /**
   * Ascending = tried first. No meaning is assigned by `pointer-drag.ts` itself — callers
   * pick their own convention. `drag-resize.ts` uses a lower number than `drag-move.ts` so
   * an edge-zone claim always wins over a whole-bar claim on the same `pointerdown`.
   * Ties broken by registration order (stable sort).
   */
  readonly priority: number;
  /** Per-recognizer, NOT a controller-level option — preserves each `enableDragXxx`'s own
   *  configurable default. */
  readonly slop: number;
  /**
   * Synchronous, called at most once per `pointerdown`, in ascending-priority order, until
   * one recognizer returns non-null/non-undefined — that recognizer claims the ENTIRE
   * gesture (no other recognizer's `claim` runs for this `pointerdown`). Return
   * `null`/`undefined` to decline. MUST be cheap, MUST NOT mutate DOM.
   */
  claim(event: PointerEvent, groupEl: Element): TState | null | undefined;
  /** Called exactly once, the FIRST `pointermove` that exceeds `slop` — after
   *  the coordinator's own `event.preventDefault()` (blocks text-selection, unconditional,
   *  recognizer-agnostic) and after it applied `cls`/`cursor`. Add any further drag
   *  chrome here. */
  start?(ctx: PointerGestureContext<TState>): void;
  /** Called on every valid `pointermove` AFTER the threshold (including the one that
   *  crossed it, right after `start`). `dxPixels` = `event.clientX -
   *  ctx.x0` (client-coordinate delta, unsnapped — snapping is the recognizer's
   *  own concern via `snapDeltaToDay`). */
  move(ctx: PointerGestureContext<TState>, dxPixels: number, event: PointerEvent): void;
  /** Called once on the `pointerup` that ends a past-threshold gesture. This is the ONLY
   *  commit point. The coordinator has already removed `cls` and reset the cursor, so a
   *  throw from a host callback can never leave them stuck. */
  commit(ctx: PointerGestureContext<TState>, dxPixels: number, event: PointerEvent): void;
  /** Called on cancellation: Escape, `pointercancel`, disposer-mid-drag, a garbage-coord
   *  `pointerup`, or the gesture's own recognizer being unregistered mid-drag. Called ONLY
   *  for a gesture that had actually STARTED (exceeded `slop`, i.e. `start`
   *  ran) — a pre-threshold cancel added no chrome, so `cancel` is skipped rather than
   *  clobbering host-owned state (e.g. `document.body.style.cursor`). The coordinator has
   *  already removed `cls` and reset the cursor; this reverts the recognizer's own DOM
   *  mutations made in `start`/`move`. */
  cancel(ctx: PointerGestureContext<TState>): void;
}

export interface PointerDragController {
  /** Registers one recognizer. Returns a disposer: unregisters it, and — if a gesture this
   *  recognizer currently owns is open — cancels it first (`cancel`, no commit), same as
   *  `enableDragMove`'s existing disposer-mid-drag contract. Idempotent (calling twice is a
   *  safe no-op). When the LAST registered recognizer unregisters, the controller detaches
   *  its `pointerdown` listener from `handle.svg` and restores the original (unwrapped)
   *  `handle.destroy` — fully symmetric teardown, no leaked listeners regardless of how many
   *  recognizers were ever registered on this handle. */
  register<TState>(recognizer: PointerGestureRecognizer<TState>): () => void;
}

// Canonical home is `internal/drag-math.ts` (shared with the Canvas recognizers); re-exported so existing
// import paths keep resolving.
export { DEFAULT_DRAG_THRESHOLD_PX, MAX_DRAG_DAYS, snapDeltaToDay } from '../internal/drag-math.js';

/** The task a `.fg-task[data-task-id]` group stands for (`undefined` on a DOM/data race). */
export function findGroupTask(groupEl: Element, getTasks: () => readonly Task[]): Task | undefined {
  const id = groupEl.getAttribute('data-task-id');
  return getTasks().find((t) => t.id === id);
}

/** Client-px per user-unit of the chart `<svg>` along each axis (1 when the viewBox is missing,
 *  malformed or the box is not laid out, e.g. jsdom) plus its client-space origin. */
export function readClientScale(svg: SVGSVGElement): { left: number; top: number; scaleX: number; scaleY: number } {
  const rect = svg.getBoundingClientRect();
  const [, , vbWidth = NaN, vbHeight = NaN] = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  return {
    left: rect.left,
    top: rect.top,
    scaleX: rect.width > 0 && vbWidth > 0 ? rect.width / vbWidth || 1 : 1,
    scaleY: rect.height > 0 && vbHeight > 0 ? rect.height / vbHeight || 1 : 1,
  };
}

interface OpenGesture {
  readonly rec: PointerGestureRecognizer<unknown>;
  /** Built once, passed by reference to every `move`/`commit`/`cancel` call —
   *  recognizers must treat it as readonly. */
  readonly ctx: PointerGestureContext<unknown>;
  moved: boolean;
}

/** What the coordinator needs from a renderer: SVG and Canvas handles both satisfy it. `hitTestBar`
 *  is present only on Canvas and doubles as the discriminator (no per-bar DOM to `closest()`). */
type DragSurface = Pick<InteractiveRendererHandle, 'pointerEventTarget' | 'hitTestBar' | 'mirrorX'> & {
  destroy(): void;
  getTimeScale(): TimeScale;
};

const controllers = new WeakMap<DragSurface, PointerDragController>();

/**
 * One controller per renderer handle (SVG or Canvas), created lazily, found via a `WeakMap` (no manual
 * cleanup needed).
 */
export function getPointerDragController(handle: DragSurface): PointerDragController {
  let controller = controllers.get(handle);
  if (!controller) {
    controller = createController(handle);
    controllers.set(handle, controller);
  }
  return controller;
}

function createController(handle: DragSurface): PointerDragController {
  const recognizers: PointerGestureRecognizer<unknown>[] = [];
  let state: OpenGesture | null = null;
  let attached = false;
  // Assigned by `ensureAttached()`, consumed/reset by `detach()` — mirrors
  // `enableDragMove`'s original `originalDestroy`/`destroyWithDrag` wrap, now refcounted
  // across recognizers instead of being one-shot per `enableDragMove` call.
  let originalDestroy: (() => void) | undefined;
  let wrappedDestroy: (() => void) | undefined;

  // Layout-space dx: a mirrored chart (`withRtl`) paints later dates further left, so the pointer
  // delta flips sign here, once, for every recognizer.
  const dxOf = (e: PointerEvent, s: OpenGesture): number => (handle.mirrorX ? -1 : 1) * (e.clientX - s.ctx.x0);

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
      if (state?.rec === erased) cancelActiveGesture();
      const idx = recognizers.indexOf(erased);
      if (idx !== -1) recognizers.splice(idx, 1);
      if (recognizers.length === 0) detach();
    };
  }

  function ensureAttached(): void {
    if (attached) return;
    attached = true;
    // `Element.addEventListener` only knows `ElementEventMap`, which has no `pointerdown`.
    handle.pointerEventTarget.addEventListener('pointerdown', onPointerDown as EventListener);

    // B1 (High, inherited from drag-move.ts): `register()` and the renderer handle are two
    // independent lifecycles. If the host calls `handle.destroy()` while a gesture is open,
    // `destroy()` only removes the <svg> — the 4 `window` listeners added at pointerdown
    // would leak (and keep the detached DOM alive) until some later pointerup/cancel
    // happens to fire. Link them: wrap `destroy` so tearing down the renderer also disposes
    // every registered recognizer's open gesture + detaches the coordinator.
    // Close over a STABLE local `original` (captured at wrap time), not the mutable
    // `originalDestroy` module var — `detach()` clears that var (so a LATER `ensureAttached()`
    // on the same handle doesn't chain onto a stale reference), and if a third party has
    // wrapped `handle.destroy` on top of ours and later calls through, re-reading the nulled
    // var would throw. The local reference stays valid for the lifetime of this wrapper (C4).
    const original = handle.destroy;
    originalDestroy = original;
    wrappedDestroy = (): void => {
      detach();
      original.call(handle);
    };
    handle.destroy = wrappedDestroy;
  }

  function detach(): void {
    if (!attached) return;
    attached = false;
    handle.pointerEventTarget.removeEventListener('pointerdown', onPointerDown as EventListener);
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
    const groupEl = handle.hitTestBar ? handle.pointerEventTarget : event.target.closest('.fg-task[data-task-id]');
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
      const candidateState = recognizer.claim(event, groupEl);
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
      grp: groupEl,
      cap: captureEl,
      pointerId: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      ts: timeScale,
    };
    state = { rec: claimedRecognizer, ctx, moved: false };

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
    if (!s.ctx.grp.isConnected) {
      cancelActiveGesture();
      return;
    }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      // Garbage coordinates mid-gesture — ignore this event, keep the state.
      return;
    }

    const dxRaw = dxOf(event, s);
    const dyRaw = event.clientY - s.ctx.y0;

    if (!s.moved) {
      // RADIAL threshold (both axes): the horizontal-only `Math.abs(dxRaw)` gate never fired
      // for a purely VERTICAL gesture — which is the natural motion for drag-create-dependency
      // (link a task to the one directly below it, same column, dx≈0). Euclidean distance
      // starts the gesture regardless of direction; horizontal gestures (move/resize) still
      // cross it exactly as before, and a stationary press still can't start one.
      if (Math.hypot(dxRaw, dyRaw) < s.rec.slop) return; // potential click, do nothing yet
      s.moved = true;
      // Block text-selection while dragging with a mouse — only once this is confirmed a
      // drag. Unconditional, coordinator-owned (not per-recognizer).
      event.preventDefault();
      s.ctx.grp.classList.add(s.rec.cls);
      document.body.style.cursor = s.rec.cursor;
      s.rec.start?.(s.ctx);
    }

    s.rec.move(s.ctx, dxRaw, event);
  }

  function onPointerUp(event: PointerEvent): void {
    const s = state;
    if (!s || event.pointerId !== s.ctx.pointerId) return;
    teardownListeners(s);
    state = null;

    if (!s.moved) return; // plain click — no commit, no cancel

    // Reset the drag chrome BEFORE the recognizer commits/cancels (B2): a throw from a host
    // callback must not leave `grabbing`/`fg-task--dragging` stuck.
    clearChrome(s);
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      // Garbage coordinates on the final release event — don't commit data from corrupt
      // coords, cancel instead.
      s.rec.cancel(s.ctx);
      return;
    }

    const dxRaw = dxOf(event, s);
    s.rec.commit(s.ctx, dxRaw, event);
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
   *  `cancel`, do NOT commit. Shared by pointercancel/Escape/disposer-mid-drag/destroy. */
  function cancelActiveGesture(): void {
    const s = state;
    if (!s) return;
    teardownListeners(s);
    state = null;
    // Only revert chrome for a gesture that actually STARTED. A pre-threshold cancel (a touch
    // that turns into a scroll → `pointercancel`, or Escape without moving) never ran
    // `start`/`move`, so calling `cancel` here would clobber host-owned state such
    // as `document.body.style.cursor` that this gesture never set (regression B1).
    if (s.moved) {
      clearChrome(s);
      s.rec.cancel(s.ctx);
    }
  }

  function clearChrome(s: OpenGesture): void {
    s.ctx.grp.classList.remove(s.rec.cls);
    document.body.style.cursor = '';
  }

  function teardownListeners(s: OpenGesture): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown);
    try {
      s.ctx.cap.releasePointerCapture?.(s.ctx.pointerId);
    } catch {
      // Best-effort, see the note at setPointerCapture.
    }
  }
}
