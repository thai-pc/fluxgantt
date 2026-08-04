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
//
// REFACTORED onto `pointer-drag.ts` (spec-drag-resize.md §1.4/§1.5) — the shared
// pointerdown-delegation/window-listener/threshold/B1-B2-B3 mechanics now live in the
// coordinator; this file only builds ONE `PointerGestureRecognizer<MoveState>` and registers
// it. BEHAVIOR-PRESERVING: `tests/unit/drag-move.test.ts` passes unedited.
import { normalizeDate } from '../compute/working-calendar.js';
import type { SvgRendererHandle, TimeScale } from '../render/index.js';
import type { DateInput, Task, TaskId } from '../types.js';
import { toTaskId } from '../types.js';
import type { Temporal } from '@js-temporal/polyfill';
import { getPointerDragController, DEFAULT_DRAG_THRESHOLD_PX, snapDeltaToDay } from './pointer-drag.js';
import type { PointerGestureRecognizer } from './pointer-drag.js';

// Canonical home is now `pointer-drag.ts` — re-exported here (pure re-export, zero behavior
// change) so `tests/unit/drag-move.test.ts`'s existing
// `import { ... snapDeltaToDay } from '../../src/interaction/drag-move.js'` keeps resolving.
export { snapDeltaToDay } from './pointer-drag.js';

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

const MOVE_PRIORITY = 10;
const DRAGGING_CLASS = 'fg-task--dragging';

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

interface MoveState {
  readonly taskId: TaskId;
  readonly originalStart: DateInput;
  readonly originalEnd: DateInput;
}

/**
 * Attaches drag-move to a mounted `SvgRendererHandle` — via the shared `pointer-drag.ts`
 * coordinator (`getPointerDragController(handle).register(...)`), so it can coexist with
 * `enableDragResize` registered on the same handle (edge-zone claims win, see
 * `drag-resize.ts`'s `RESIZE_PRIORITY < MOVE_PRIORITY`).
 *
 * Returns a disposer — unregisters this recognizer. Calling the disposer mid-drag cancels
 * that drag (no commit), equivalent to Escape. Calling the disposer multiple times is a safe
 * no-op.
 */
export function enableDragMove(
  handle: SvgRendererHandle,
  getTasks: () => readonly Task[],
  options: DragMoveOptions,
): () => void {
  const dragThresholdPx = options.dragThresholdPx ?? DEFAULT_DRAG_THRESHOLD_PX;

  const recognizer: PointerGestureRecognizer<MoveState> = {
    name: 'drag-move',
    priority: MOVE_PRIORITY,
    dragThresholdPx,
    hitTest(event, groupEl) {
      const taskIdAttr = groupEl.getAttribute('data-task-id');
      if (taskIdAttr === null) return null;
      const taskId = toTaskId(taskIdAttr);
      const task = getTasks().find((t) => t.id === taskId);
      // Race between the rendered DOM and the latest `tasks` — skip, don't throw.
      if (!task) return null;
      return { taskId, originalStart: task.start, originalEnd: task.end };
    },
    onDragStart(ctx) {
      ctx.groupEl.classList.add(DRAGGING_CLASS);
      document.body.style.cursor = 'grabbing';
    },
    onMove(ctx, dxPixels) {
      const deltaDays = snapDeltaToDay(dxPixels, ctx.timeScale);
      const pixelDx = deltaDays * ctx.timeScale.pixelsPerDay;
      // Visual feedback during the drag: only shift the transform, do NOT call
      // handle.update()/taskStore.update() per frame (performance — renderer full-repaints).
      ctx.groupEl.setAttribute('transform', `translate(${pixelDx} 0)`);
      if (options.onDragging) {
        const { newStart, newEnd } = computeDraggedDates(
          ctx.timeScale,
          ctx.state.originalStart,
          ctx.state.originalEnd,
          deltaDays,
        );
        options.onDragging(ctx.state.taskId, newStart, newEnd);
      }
    },
    onCommit(ctx, dxPixels) {
      // Reset drag chrome (class + cursor) BEFORE computing/committing (B2): the commit path
      // is clamped and cannot throw, but resetting first also means a throw from the host's
      // `onTaskMoved` callback can't leave `grabbing`/`fg-task--dragging` stuck.
      // The transform is intentionally kept — the bar holds its dragged position until the
      // caller re-renders with the updated task.
      ctx.groupEl.classList.remove(DRAGGING_CLASS);
      document.body.style.cursor = '';
      const deltaDays = snapDeltaToDay(dxPixels, ctx.timeScale);
      const { newStart, newEnd } = computeDraggedDates(
        ctx.timeScale,
        ctx.state.originalStart,
        ctx.state.originalEnd,
        deltaDays,
      );
      options.onTaskMoved(ctx.state.taskId, newStart, newEnd);
    },
    onCancel(ctx) {
      // `removeAttribute`/`classList.remove` are already no-ops when nothing was set — safe
      // to call unconditionally (matches every existing cancellation-path test).
      ctx.groupEl.removeAttribute('transform');
      ctx.groupEl.classList.remove(DRAGGING_CLASS);
      document.body.style.cursor = '';
    },
  };

  return getPointerDragController(handle).register(recognizer);
}
