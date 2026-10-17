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
// `handle.svg.getBoundingClientRect()` (`.left` + `.width`, the latter divided by the
// viewBox width to recover the client-vs-user-unit scale under a CSS-scaled <svg>) to
// translate into client-coordinate space — NOT `layoutTaskBar`/`handle.getTimeScale()` alone
// (which don't know the renderer's private `LABEL_COLUMN_WIDTH` offset baked into the
// rendered `x`) and NOT a per-bar `getBoundingClientRect()` (jsdom has no layout engine —
// always returns an all-zero `DOMRect`, making a per-bar hit-test untestable). No `render/`
// change.
//
// Registers through the shared `pointer-drag.ts` coordinator with `RESIZE_PRIORITY <
// MOVE_PRIORITY` so an edge-zone claim always wins over `drag-move.ts`'s whole-bar claim on
// the same `pointerdown` (resolution #8).
import type { SvgRendererHandle } from '../render/index.js';
import type { DateInput, Task, TaskId } from '../types.js';
import type { Temporal } from '@js-temporal/polyfill';
import {
  COARSE_EDGE_HIT_ZONE_PX,
  DEFAULT_DRAG_THRESHOLD_PX,
  EDGE_HIT_ZONE_PX as DEFAULT_EDGE_HIT_ZONE_PX,
  computeClampedResizedEnd,
  snapDeltaToDay,
} from '../internal/drag-math.js';
import { getPointerDragController, findGroupTask, readClientScale } from './pointer-drag.js';
import type { PointerGestureRecognizer } from './pointer-drag.js';

export { computeClampedResizedEnd } from '../internal/drag-math.js';

export interface DragResizeOptions {
  /** Called EXACTLY ONCE on a past-threshold `pointerup` that started in the right-edge
   *  hit-zone. Delivers ONLY the snapped new END — calendar-free, mirrors `onTaskMoved`'s
   *  posture (resolution #7). `enableDragResize` never writes to a store itself. */
  onTaskResized(taskId: TaskId, newEnd: Temporal.ZonedDateTime): void;

  /** Movement threshold (px, client coords) before a pointerdown-in-the-edge-zone is treated
   *  as a resize rather than a click. Default 4 (same default as drag-move). */
  dragThresholdPx?: number;

  /** Width (px, client coords) of the right-edge hit-zone, measured inward from the bar's
   *  rendered right edge. Default 8 under a fine pointer, 24 under a coarse one — see
   *  `DEFAULT_EDGE_HIT_ZONE_PX`/`COARSE_EDGE_HIT_ZONE_PX`. An explicit value always wins over
   *  both, including on a touch device. */
  edgeHitZonePx?: number;

  /** Called on each valid pointermove after the threshold, with the TENTATIVE (not
   *  committed) new end — optional, for live UI. Mirrors `DragMoveOptions.onDragging`. */
  onResizing?(taskId: TaskId, tentativeEnd: Temporal.ZonedDateTime): void;
}

const RESIZE_PRIORITY = 0; // lower than MOVE_PRIORITY (10) — edge wins (resolution #8)
const RESIZING_CLASS = 'fg-task--resizing';

interface ResizeState {
  readonly taskId: TaskId;
  /** The `.fg-task__bar` element — `width` is written live during the gesture, `x` is
   *  NEVER written (resolution #1 — "keep `start`"). */
  readonly bar: Element;
  /** The `.fg-task__progress` rect, when the bar has one (absent at `progress === 0`, and on a
   *  milestone — which never reaches here anyway). Its `width` is scaled live alongside `barEl`
   *  so the completed fraction stays proportional throughout the gesture instead of overflowing
   *  a shrinking bar. */
  readonly fill: Element | null;
  /** The fill's share of the bar, captured at gesture start. Progress is a fraction OF THE BAR,
   *  so tracking the live width by ratio is what keeps it correct — re-deriving from
   *  `task.progress` would duplicate the renderer's own clamp here. */
  readonly ratio: number;
  readonly s0: DateInput;
  readonly e0: DateInput;
  readonly w0: number;
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
  // Resolved ONCE, here, rather than per hit-test: `matchMedia` is a layout-adjacent read and
  // `claim` runs on every `pointerdown`. A device that gains a mouse mid-session therefore
  // keeps the zone it was enabled with — acceptable, since the coarse zone is a strict superset
  // of the fine one (it only makes the target easier to hit, never harder).
  const edgeHitZonePx =
    options.edgeHitZonePx ??
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
      ? COARSE_EDGE_HIT_ZONE_PX
      : DEFAULT_EDGE_HIT_ZONE_PX);

  const recognizer: PointerGestureRecognizer<ResizeState> = {
    cls: RESIZING_CLASS,
    cursor: 'ew-resize',
    priority: RESIZE_PRIORITY,
    slop: dragThresholdPx,
    claim(event, groupEl) {
      // Same gate as drag-move: a rolled-up bar has no authored edge under the cursor
      // (spec-summary-rollup.md Ticket B2). Declining here also frees the edge zone, so a
      // rolled-up bar is inert rather than resize-only.
      if (groupEl.getAttribute('data-rolled-up') !== null) return null;
      const task = findGroupTask(groupEl, getTasks);
      // Race between the rendered DOM and the latest `tasks` — skip, don't throw (mirrors
      // drag-move's own posture).
      if (!task) return null;
      if (task.type === 'milestone') return null; // never resizable (resolution #4)

      const barEl = groupEl.querySelector('.fg-task__bar');
      if (!barEl) return null;
      const barX = Number(barEl.getAttribute('x'));
      const barWidth = Number(barEl.getAttribute('width'));
      if (!Number.isFinite(barX) || !Number.isFinite(barWidth)) return null;

      // `barX`/`barWidth` are SVG USER units (read off the rendered attributes). The renderer
      // sets a `viewBox` (svg-renderer.ts), so under any host CSS that scales the <svg> (e.g.
      // `width: 100%`, a constraining container, browser zoom) one user unit != one client px.
      // Derive the horizontal scale from the rendered box width vs the viewBox width and
      // translate the edge into client space before comparing against `event.clientX` (review
      // E1/E2). jsdom has no layout engine (`getBoundingClientRect()` → all-zero), so the
      // scale falls back to 1 — preserving the 1:1 behavior the DOM-attribute tests assume.
      const { left, scaleX } = readClientScale(handle.svg);

      // Narrow-bar fallback in CLIENT px (a bar thinner ON SCREEN than the hit-zone never
      // claims — move always wins for very thin bars, never unmovable).
      if (barWidth * scaleX < edgeHitZonePx) return null;

      const endX = barX + barWidth;
      const rightEdgeX = left + (handle.mirrorX?.(endX) ?? endX) * scaleX;
      // Defensive bound only: in production `closest()` already guarantees the pointerdown
      // landed on `barEl`, so `event.clientX` is already within the bar's client-space span.
      if (event.clientX < rightEdgeX - edgeHitZonePx || event.clientX > rightEdgeX + edgeHitZonePx) return null;

      const progressEl = groupEl.querySelector('.fg-task__progress');
      const progressWidth = progressEl ? Number(progressEl.getAttribute('width')) : NaN;
      // Guarded to 0 on a missing or malformed attribute — a NaN ratio would write `NaN` widths
      // into the DOM for the rest of the gesture.
      const progressRatio = barWidth > 0 && Number.isFinite(progressWidth) ? progressWidth / barWidth : 0;

      return {
        taskId: task.id,
        bar: barEl,
        fill: progressEl,
        ratio: progressRatio,
        s0: task.start,
        e0: task.end,
        w0: barWidth,
      };
    },
    move(ctx, dxPixels) {
      const deltaDays = snapDeltaToDay(dxPixels, ctx.ts);
      const tentativeEnd = computeClampedResizedEnd(
        ctx.ts,
        ctx.state.s0,
        ctx.state.e0,
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
        ctx.ts.dateToX(tentativeEnd) - ctx.ts.dateToX(ctx.state.s0),
      );
      ctx.state.bar.setAttribute('width', String(newWidth));
      if (ctx.state.fill) {
        ctx.state.fill.setAttribute('width', String(newWidth * ctx.state.ratio));
      }
      options.onResizing?.(ctx.state.taskId, tentativeEnd);
    },
    commit(ctx, dxPixels) {
      const deltaDays = snapDeltaToDay(dxPixels, ctx.ts);
      const newEnd = computeClampedResizedEnd(
        ctx.ts,
        ctx.state.s0,
        ctx.state.e0,
        deltaDays,
      );
      options.onTaskResized(ctx.state.taskId, newEnd);
    },
    cancel(ctx) {
      // Exact restore — width was mutated live during the gesture, `x` was never touched.
      ctx.state.bar.setAttribute('width', String(ctx.state.w0));
      if (ctx.state.fill) {
        ctx.state.fill.setAttribute('width', String(ctx.state.w0 * ctx.state.ratio));
      }
    },
  };

  return getPointerDragController(handle).register(recognizer);
}
