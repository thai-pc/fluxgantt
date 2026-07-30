// Interaction layer — drag-move (spec-drag-move.md, plan-drag-move.md). Drag a task bar
// with Pointer Events to change ONE task's `start`/`end`, committing once on drop via the
// `onTaskMoved` callback. No cascade, no resize, no create-dependency, no keyboard-nav
// (v1, plan §5). Does NOT import TaskStore — takes `getTasks()` duck-typed to avoid coupling
// to a specific state layer (spec §1).
//
// TOUCHES THE DOM (raw Pointer Events) — this is the only layer in core allowed to, per
// architecture.md "Interaction". `@fluxgantt/core` still does NOT import react/vue/svelte.
//
// DECISION Q4 (main session, spec §10 — overrides the original §4.3): the commit uses
// calendar arithmetic (`normalizeDate(...).add({ days: N })`), NOT `timeScale.xToDate`/
// elapsed-nanoseconds — the old way drifts the time-of-day by ~1h when dragging across a DST
// boundary. `.add({days})` preserves the wall-clock time-of-day + duration, DST-safe (see the
// DST test below).
import { normalizeDate } from '../compute/working-calendar.js';
import type { SvgRendererHandle, TimeScale } from '../render/index.js';
import type { DateInput, Task, TaskId } from '../types.js';
import { toTaskId } from '../types.js';
import type { Temporal } from '@js-temporal/polyfill';

export interface DragMoveOptions {
  /**
   * Called EXACTLY ONCE when a drag that exceeded the threshold (`dragThresholdPx`) is
   * released (`pointerup`) — NOT for a plain click (below threshold) or a cancelled drag
   * (Escape/`pointercancel`/disposer mid-drag). This is the ONLY commit mechanism —
   * `enableDragMove` does NOT write to `TaskStore` or any store itself. To update
   * `TaskStore`, call `taskStore.update(taskId, { start: newStart, end: newEnd })` inside
   * this callback.
   */
  onTaskMoved(taskId: TaskId, newStart: Temporal.ZonedDateTime, newEnd: Temporal.ZonedDateTime): void;

  /**
   * Movement threshold (px, client coordinates) before a pointerdown is treated as a drag
   * rather than a click. Default 4.
   */
  dragThresholdPx?: number;

  /**
   * Called on EACH valid `pointermove` after the threshold is exceeded, with the TENTATIVE
   * start/end (not committed) — optional, for live UI (e.g. a tooltip showing the date under
   * the cursor). Never used to commit — only `onTaskMoved` commits.
   */
  onDragging?(
    taskId: TaskId,
    tentativeStart: Temporal.ZonedDateTime,
    tentativeEnd: Temporal.ZonedDateTime,
  ): void;
}

const DEFAULT_DRAG_THRESHOLD_PX = 4;
const DRAGGING_CLASS = 'fg-task--dragging';

/**
 * Clamp for the snapped day-delta (review B2). `Number.isFinite` alone lets a finite but
 * absurd `clientX` (e.g. 1e8) through, and `ZonedDateTime.add({ days: 1e8 })` throws a
 * `RangeError` (Temporal's representable-instant limit) — which would escape a pointer
 * handler and leave the drag UI wedged. ±366,000 days ≈ 1,000 years: far beyond any real
 * drag, always inside Temporal's range regardless of the task's base date.
 */
const MAX_DRAG_DAYS = 366_000;

interface DragState {
  readonly taskId: TaskId;
  readonly groupEl: SVGGElement;
  /** The actual element that received pointerdown (may be a child of `groupEl`, e.g.
   *  `.fg-task__bar`) — used to call `releasePointerCapture` paired with the original
   *  `setPointerCapture`. */
  readonly captureEl: Element;
  readonly originalStart: DateInput;
  readonly originalEnd: DateInput;
  readonly startClientX: number;
  readonly pointerId: number;
  /** Captured ONCE at pointerdown (Q5) — not re-read from `handle.getTimeScale()` on every
   *  pointermove, so a `setOptions()` mid-drag doesn't change the meaning of the accumulating
   *  delta. */
  readonly timeScale: TimeScale;
  exceededThreshold: boolean;
}

/**
 * Snap a pixel delta to the nearest whole day (by `timeScale.pixelsPerDay`) — matches the
 * "snap minimally to the day boundary, not to the working-calendar" requirement (plan §5).
 * Returns the NUMBER OF DAYS (N), not pixels — decision Q4.
 */
export function snapDeltaToDay(dxPixels: number, timeScale: TimeScale): number {
  if (!Number.isFinite(dxPixels) || !Number.isFinite(timeScale.pixelsPerDay) || timeScale.pixelsPerDay === 0) {
    return 0;
  }
  const n = Math.round(dxPixels / timeScale.pixelsPerDay);
  // Clamp a finite-but-absurd delta so the commit path (`.add({ days: n })`) can never
  // throw a Temporal RangeError (review B2).
  return Math.max(-MAX_DRAG_DAYS, Math.min(MAX_DRAG_DAYS, n));
}

/**
 * Computes the new start/end with calendar arithmetic — decision Q4 (main session §10): add
 * `deltaDays` CALENDAR DAYS to `originalStart`/`originalEnd` normalized to the `timeScale`'s
 * timezone (`timeScale.range.start.timeZoneId` — the same timezone the renderer used to build
 * this scale, so no separate `WorkingCalendar` needs to be passed). Preserves the wall-clock
 * time-of-day + duration, DST-safe across a boundary — does NOT use
 * `timeScale.xToDate`/elapsed-nanoseconds (that drifts ~1h across DST, see spec §4.3 —
 * overridden by §10 Q4).
 */
export function computeDraggedDates(
  timeScale: TimeScale,
  originalStart: DateInput,
  originalEnd: DateInput,
  deltaDays: number,
): { newStart: Temporal.ZonedDateTime; newEnd: Temporal.ZonedDateTime } {
  const timezone = timeScale.range.start.timeZoneId;
  const newStart = normalizeDate(originalStart, timezone).add({ days: deltaDays });
  const newEnd = normalizeDate(originalEnd, timezone).add({ days: deltaDays });
  return { newStart, newEnd };
}

/**
 * Attaches drag-move to a mounted `SvgRendererHandle`. Event delegation: a SINGLE
 * `pointerdown` listener on `handle.svg` (not on each `.fg-task`) — required because
 * `update()` full-repaints, removing/rebuilding every `.fg-task` on each call; a listener
 * attached directly to a task-bar would be lost after the first repaint.
 * `pointermove`/`pointerup`/`pointercancel`/`keydown` are attached TEMPORARILY to `window`
 * for the duration of an active drag (added on pointerdown, removed on
 * pointerup/cancel/Escape/disposer) — never accumulating unbounded across drags (security.md
 * "no leaked listeners").
 *
 * Returns a disposer — removes all listeners. Calling the disposer mid-drag cancels that drag
 * (no commit), equivalent to Escape. Calling the disposer multiple times is a safe no-op.
 */
export function enableDragMove(
  handle: SvgRendererHandle,
  getTasks: () => readonly Task[],
  options: DragMoveOptions,
): () => void {
  const dragThresholdPx = options.dragThresholdPx ?? DEFAULT_DRAG_THRESHOLD_PX;
  let state: DragState | null = null;
  let disposed = false;

  handle.svg.addEventListener('pointerdown', onPointerDown);

  // B1 (High): `enableDragMove` and the renderer handle are two independent lifecycles.
  // If the host calls `handle.destroy()` while a drag gesture is open, `destroy()` only
  // removes the <svg> — the 4 `window` listeners added at pointerdown would leak (and keep
  // the detached DOM alive) until some later pointerup/cancel happens to fire. Link them:
  // wrap `destroy` so tearing down the renderer also disposes drag-move. The disposer
  // restores the original, so a normal `dispose()` → `destroy()` sequence stays clean.
  const originalDestroy = handle.destroy;
  const destroyWithDrag = (): void => {
    disposeDragMove();
    originalDestroy.call(handle);
  };
  handle.destroy = destroyWithDrag;

  return disposeDragMove;

  function disposeDragMove(): void {
    if (disposed) return;
    disposed = true;
    handle.svg.removeEventListener('pointerdown', onPointerDown);
    if (handle.destroy === destroyWithDrag) handle.destroy = originalDestroy;
    if (state) cancelDrag(state);
  }

  function onPointerDown(event: PointerEvent): void {
    // B3: ignore a second concurrent pointerdown (e.g. a 2nd finger on a touch screen)
    // while a gesture is already open — overwriting `state` would orphan the first gesture
    // (its window listeners persist but its pointerId no longer matches any handler).
    if (disposed || state) return;
    if (!(event.target instanceof Element)) return;
    // Not a drag on a task bar — return early, do NOT preventDefault/stopPropagation
    // (spec §6 — don't block future click/selection on grid/header/empty space).
    const groupEl = event.target.closest('.fg-task[data-task-id]');
    if (!groupEl) return;

    const taskIdAttr = groupEl.getAttribute('data-task-id');
    if (taskIdAttr === null) return;
    const taskId = toTaskId(taskIdAttr);
    const task = getTasks().find((t) => t.id === taskId);
    // Race between the rendered DOM and the latest `tasks` — skip, don't throw (spec §7).
    if (!task) return;

    // Pointer coordinates are untrusted numeric input (security.md/spec §7) — bail at
    // pointerdown if already corrupt; don't start a drag gesture on garbage data.
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;

    const captureEl = event.target;
    state = {
      taskId,
      groupEl: groupEl as unknown as SVGGElement,
      captureEl,
      originalStart: task.start,
      originalEnd: task.end,
      startClientX: event.clientX,
      pointerId: event.pointerId,
      timeScale: handle.getTimeScale(),
      exceededThreshold: false,
    };

    try {
      captureEl.setPointerCapture?.(event.pointerId);
    } catch {
      // Best-effort — jsdom and some environments don't implement real pointer capture
      // (spec §7/§9). Never let this error break the main drag flow.
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
  }

  function onPointerMove(event: PointerEvent): void {
    const s = state;
    if (!s || event.pointerId !== s.pointerId) return;
    // Defensive (B1): if the dragged group was detached (renderer removed/repainted
    // without going through the wrapped destroy), abort the gesture and clean up rather
    // than keep mutating an orphaned node / holding window listeners.
    if (!s.groupEl.isConnected) {
      cancelDrag(s);
      return;
    }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      // Garbage coordinates mid-drag — ignore this event, keep the state (spec §7).
      return;
    }

    const dxRaw = event.clientX - s.startClientX;

    if (!s.exceededThreshold) {
      if (Math.abs(dxRaw) < dragThresholdPx) return; // potential click, do nothing yet
      s.exceededThreshold = true;
      s.groupEl.classList.add(DRAGGING_CLASS);
      document.body.style.cursor = 'grabbing';
      // Block text-selection while dragging with a mouse — only once this is confirmed a drag.
      event.preventDefault();
    }

    const deltaDays = snapDeltaToDay(dxRaw, s.timeScale);
    const pixelDx = deltaDays * s.timeScale.pixelsPerDay;
    // Visual feedback during the drag: only shift the transform, do NOT call handle.update()/
    // taskStore.update() per frame (performance, plan §3 — renderer full-repaints).
    s.groupEl.setAttribute('transform', `translate(${pixelDx} 0)`);

    if (options.onDragging) {
      const { newStart, newEnd } = computeDraggedDates(s.timeScale, s.originalStart, s.originalEnd, deltaDays);
      options.onDragging(s.taskId, newStart, newEnd);
    }
  }

  function onPointerUp(event: PointerEvent): void {
    const s = state;
    if (!s || event.pointerId !== s.pointerId) return;
    teardown(s);
    state = null;

    if (!s.exceededThreshold) return; // plain click — no commit, transform was never set

    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      // Garbage coordinates on the final release event — don't commit data from corrupt coords.
      revertVisual(s);
      return;
    }

    // Reset drag chrome (class + cursor) BEFORE computing/committing (B2): the commit path
    // is now clamped and cannot throw, but resetting first also means a throw from the
    // host's `onTaskMoved` callback can't leave `grabbing`/`fg-task--dragging` stuck.
    // The transform is intentionally kept — the bar holds its dragged position until the
    // caller re-renders with the updated task (spec §4.1).
    s.groupEl.classList.remove(DRAGGING_CLASS);
    document.body.style.cursor = '';

    const dxRaw = event.clientX - s.startClientX;
    const deltaDays = snapDeltaToDay(dxRaw, s.timeScale);
    const { newStart, newEnd } = computeDraggedDates(s.timeScale, s.originalStart, s.originalEnd, deltaDays);
    options.onTaskMoved(s.taskId, newStart, newEnd);
  }

  function onPointerCancel(event: PointerEvent): void {
    const s = state;
    if (!s || event.pointerId !== s.pointerId) return;
    cancelDrag(s);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const s = state;
    if (!s) return;
    if (event.key !== 'Escape') return;
    cancelDrag(s);
  }

  /** Cancel an in-progress drag: remove listeners, revert the transform, do NOT commit. Shared
   *  by pointercancel/Escape/disposer-mid-drag. */
  function cancelDrag(s: DragState): void {
    teardown(s);
    state = null;
    revertVisual(s);
  }

  function teardown(s: DragState): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown);
    try {
      s.captureEl.releasePointerCapture?.(s.pointerId);
    } catch {
      // Best-effort, see the note at setPointerCapture.
    }
  }

  function revertVisual(s: DragState): void {
    if (!s.exceededThreshold) return; // transform/class were never set — nothing to undo
    s.groupEl.removeAttribute('transform');
    s.groupEl.classList.remove(DRAGGING_CLASS);
    document.body.style.cursor = '';
  }
}
