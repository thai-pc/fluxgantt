// Interaction layer — drag-resize (spec-drag-resize.md §2). Drag a task bar's RIGHT edge
// with Pointer Events to change ONE task's `end` (keeping `start`), committing once on drop
// via the `onTaskResized` callback. Right-edge only in v1 (resolution #1) — left-edge resize
// is a follow-up. Milestones are never resizable (resolution #4). Does NOT import TaskStore
// — takes `getTasks()` duck-typed, mirrors `drag-move.ts` (spec §1).
//
// TOUCHES THE DOM (raw Pointer Events) — this is the only layer in core allowed to, per
// architecture.md "Interaction". `@fluxgantt/core` still does NOT import react/vue/svelte.
//
// Hit-zone (spec §2.2, Resolutions "Flag 1 → ACCEPT"): reads the already-rendered `x`/
// `width` attributes off the task's `.fg-task__bar` element, plus ONE
// `handle.svg.getBoundingClientRect().left` to translate into client-coordinate space — NOT
// `layoutTaskBar`/`handle.getTimeScale()` alone (which don't know the renderer's private
// `LABEL_COLUMN_WIDTH` offset baked into the rendered `x`) and NOT a per-bar
// `getBoundingClientRect()` (jsdom has no layout engine — always returns an all-zero
// `DOMRect`, making a per-bar hit-test untestable). No `render/` change.
//
// Registers through the shared `pointer-drag.ts` coordinator with `RESIZE_PRIORITY <
// MOVE_PRIORITY` so an edge-zone claim always wins over `drag-move.ts`'s whole-bar claim on
// the same `pointerdown` (resolution #8).
import { normalizeDate } from '../compute/working-calendar.js';
import { getTemporal } from '../internal/temporal.js';
import type { SvgRendererHandle, TimeScale } from '../render/index.js';
import type { DateInput, Task, TaskId } from '../types.js';
import { toTaskId } from '../types.js';
import type { Temporal } from '@js-temporal/polyfill';
import { getPointerDragController, DEFAULT_DRAG_THRESHOLD_PX, snapDeltaToDay } from './pointer-drag.js';
import type { PointerGestureRecognizer } from './pointer-drag.js';

export interface DragResizeOptions {
  /** Called EXACTLY ONCE on a past-threshold `pointerup` that started in the right-edge
   *  hit-zone. Delivers ONLY the snapped new END — calendar-free, mirrors `onTaskMoved`'s
   *  posture (resolution #7). `enableDragResize` never writes to a store itself. */
  onTaskResized(taskId: TaskId, newEnd: Temporal.ZonedDateTime): void;

  /** Movement threshold (px, client coords) before a pointerdown-in-the-edge-zone is treated
   *  as a resize rather than a click. Default 4 (same default as drag-move). */
  dragThresholdPx?: number;

  /** Width (px, client coords) of the right-edge hit-zone, measured inward from the bar's
   *  rendered right edge. Default 8. */
  edgeHitZonePx?: number;

  /** Called on each valid pointermove after the threshold, with the TENTATIVE (not
   *  committed) new end — optional, for live UI. Mirrors `DragMoveOptions.onDragging`. */
  onResizing?(taskId: TaskId, tentativeEnd: Temporal.ZonedDateTime): void;
}

const DEFAULT_EDGE_HIT_ZONE_PX = 8;
const RESIZE_PRIORITY = 0; // lower than MOVE_PRIORITY (10) — edge wins (resolution #8)
const RESIZING_CLASS = 'fg-task--resizing';

/**
 * Mirrors `computeDraggedDates`' shape/spirit but resize-specific: only `end` moves, floored
 * at `start + 1 calendar day` (resolution #3 — matches the day-snap granularity). Pure,
 * Temporal-only, headless-testable without DOM — same posture as `computeDraggedDates`.
 */
export function computeClampedResizedEnd(
  timeScale: TimeScale,
  originalStart: DateInput,
  originalEnd: DateInput,
  deltaDays: number,
): Temporal.ZonedDateTime {
  const timezone = timeScale.range.start.timeZoneId;
  const start = normalizeDate(originalStart, timezone);
  const end = normalizeDate(originalEnd, timezone);
  const tentativeEnd = end.add({ days: deltaDays });
  const minEnd = start.add({ days: 1 });
  return getTemporal().ZonedDateTime.compare(tentativeEnd, minEnd) < 0 ? minEnd : tentativeEnd;
}

interface ResizeState {
  readonly taskId: TaskId;
  /** The `.fg-task__bar` element — `width` is written live during the gesture, `x` is
   *  NEVER written (resolution #1 — "keep `start`"). */
  readonly barEl: Element;
  readonly originalStart: DateInput;
  readonly originalEnd: DateInput;
  readonly originalWidth: number;
}

/**
 * Attaches drag-resize to a mounted `SvgRendererHandle` — via the shared `pointer-drag.ts`
 * coordinator (`getPointerDragController(handle).register(...)`), so it can coexist with
 * `enableDragMove` registered on the same handle.
 *
 * Returns a disposer — unregisters this recognizer. Calling the disposer mid-resize cancels
 * that resize (no commit, width attribute reverted), equivalent to Escape. Calling the
 * disposer multiple times is a safe no-op.
 */
export function enableDragResize(
  handle: SvgRendererHandle,
  getTasks: () => readonly Task[],
  options: DragResizeOptions,
): () => void {
  const dragThresholdPx = options.dragThresholdPx ?? DEFAULT_DRAG_THRESHOLD_PX;
  const edgeHitZonePx = options.edgeHitZonePx ?? DEFAULT_EDGE_HIT_ZONE_PX;

  const recognizer: PointerGestureRecognizer<ResizeState> = {
    name: 'drag-resize',
    priority: RESIZE_PRIORITY,
    dragThresholdPx,
    hitTest(event, groupEl) {
      const taskIdAttr = groupEl.getAttribute('data-task-id');
      if (taskIdAttr === null) return null;
      const taskId = toTaskId(taskIdAttr);
      const task = getTasks().find((t) => t.id === taskId);
      // Race between the rendered DOM and the latest `tasks` — skip, don't throw (mirrors
      // drag-move's own posture).
      if (!task) return null;
      if (task.type === 'milestone') return null; // never resizable (resolution #4)

      const barEl = groupEl.querySelector('.fg-task__bar');
      if (!barEl) return null;
      const barX = Number(barEl.getAttribute('x'));
      const barWidth = Number(barEl.getAttribute('width'));
      if (!Number.isFinite(barX) || !Number.isFinite(barWidth)) return null;
      // Narrow-bar fallback: a bar rendered thinner than the hit-zone never claims — move
      // always wins for very thin/near-zero-width bars (never unmovable).
      if (barWidth < edgeHitZonePx) return null;

      // 0 under jsdom by construction (no layout engine) — the only real (non-jsdom-blank)
      // `getBoundingClientRect()` call this design makes, used only to translate the
      // already-known DOM-attribute-sourced `x`/`width` into client space.
      const svgLeft = handle.svg.getBoundingClientRect().left;
      const rightEdgeX = svgLeft + barX + barWidth;
      // Defensive upper bound only: in production `closest()` already guarantees the
      // pointerdown landed on `barEl`, so `event.clientX` is already within
      // `[barX, barX + barWidth]` translated to screen space.
      if (event.clientX < rightEdgeX - edgeHitZonePx || event.clientX > rightEdgeX + edgeHitZonePx) return null;

      return {
        taskId,
        barEl,
        originalStart: task.start,
        originalEnd: task.end,
        originalWidth: barWidth,
      };
    },
    onDragStart(ctx) {
      ctx.groupEl.classList.add(RESIZING_CLASS);
      // Active-gesture chrome, NOT the deferred hover affordance (resolution #5 — out of
      // scope v1).
      document.body.style.cursor = 'ew-resize';
    },
    onMove(ctx, dxPixels) {
      const deltaDays = snapDeltaToDay(dxPixels, ctx.timeScale);
      const tentativeEnd = computeClampedResizedEnd(
        ctx.timeScale,
        ctx.state.originalStart,
        ctx.state.originalEnd,
        deltaDays,
      );
      // Live pixel width derived from the SAME clamp via the already-captured `TimeScale`
      // (`dateToX`) — single source of truth, avoids "two clamp implementations that must
      // agree". MUST be computed entirely in offset-free `dateToX` space: the bar's rendered
      // `x` ATTRIBUTE bakes in the renderer's private `LABEL_COLUMN_WIDTH` offset (svg-
      // renderer.ts), whereas `dateToX` does not — subtracting the two coordinate systems
      // (the earlier `dateToX(end) - originalX`) under-sized the live bar by exactly
      // `LABEL_COLUMN_WIDTH` (collapsing sub-160px bars to 0 mid-drag). `end - start` in one
      // space is offset-independent and correct.
      const newWidth = Math.max(
        0,
        ctx.timeScale.dateToX(tentativeEnd) - ctx.timeScale.dateToX(ctx.state.originalStart),
      );
      ctx.state.barEl.setAttribute('width', String(newWidth));
      options.onResizing?.(ctx.state.taskId, tentativeEnd);
    },
    onCommit(ctx, dxPixels) {
      ctx.groupEl.classList.remove(RESIZING_CLASS);
      document.body.style.cursor = '';
      const deltaDays = snapDeltaToDay(dxPixels, ctx.timeScale);
      const newEnd = computeClampedResizedEnd(
        ctx.timeScale,
        ctx.state.originalStart,
        ctx.state.originalEnd,
        deltaDays,
      );
      options.onTaskResized(ctx.state.taskId, newEnd);
    },
    onCancel(ctx) {
      // Exact restore — width was mutated live during the gesture, `x` was never touched.
      ctx.state.barEl.setAttribute('width', String(ctx.state.originalWidth));
      ctx.groupEl.classList.remove(RESIZING_CLASS);
      document.body.style.cursor = '';
    },
  };

  return getPointerDragController(handle).register(recognizer);
}
