// Interaction layer — click-select (spec-selection.md §5). Independent, lightweight
// pointerdown/pointerup tracking — NOT registered through `pointer-drag.ts`'s
// `getPointerDragController` (that coordinator explicitly treats a below-threshold
// press-release as a no-op — exactly the gesture click-select needs to act on). Owns its
// own `pointerdown` listener on `handle.svg` and its own `pointerup`/`pointercancel`
// listeners on `window` (mirrors `pointer-drag.ts`'s own window-level pattern so a release
// outside the SVG bounds is still caught).
//
// TOUCHES THE DOM (raw Pointer Events) — this is the only layer in `@fluxgantt/core`
// allowed to, per architecture.md "Interaction". Still does NOT import react/vue/svelte.
import type { SvgRendererHandle } from '../render/index.js';
import type { Task, TaskId } from '../types.js';
import { toTaskId } from '../types.js';
import { DEFAULT_DRAG_THRESHOLD_PX } from './pointer-drag.js';

export interface SelectionOptions {
  /** Plain click (no modifier): replace the selection with this one task (facade expands
   *  descendants). */
  onSelect(taskId: TaskId): void;
  /** Ctrl/Cmd+click: toggle this task's expanded group in/out of the current selection. */
  onToggle(taskId: TaskId): void;
  /** Shift+click WITH a prior anchor in this gesture stream: replace the selection with
   *  every raw task id whose rendered row falls between the anchor and this task
   *  (inclusive), in DOM/row order — facade expands descendants of any parent in the range. */
  onRangeSelect(taskIds: readonly TaskId[]): void;
  /** Click inside the chart (`handle.svg`) that did not resolve to any task row — clears
   *  the selection. */
  onClear(): void;
  /** Movement threshold (px, client coords, radial like `pointer-drag.ts`) before a
   *  pointerdown→pointerup pair stops counting as a click. Default = `DEFAULT_DRAG_THRESHOLD_PX`
   *  (4) — same default the drag recognizers use, for consistency. */
  dragThresholdPx?: number;
}

/** Resolves the TaskId (and its row index, for Shift-range) for a click ANYWHERE inside a
 *  task's row — the bar (`.fg-task`) OR its label (`.fg-timeline__row-label`, a SIBLING of
 *  `.fg-task` under the same `.fg-timeline__row`, not a descendant — see svg-renderer.ts
 *  renderRows()). Returns undefined for a click that resolves to neither (grid/header/margin
 *  = empty space, per Q1). */
function resolveRowHit(target: Element): { taskId: TaskId; rowIndex: number } | undefined {
  const rowEl = target.closest('.fg-timeline__row');
  if (!rowEl) return undefined;
  const taskEl = rowEl.querySelector('.fg-task[data-task-id]');
  const idAttr = taskEl?.getAttribute('data-task-id');
  const rowIndexAttr = rowEl.getAttribute('data-row-index');
  if (idAttr === null || idAttr === undefined || rowIndexAttr === null) return undefined;
  return { taskId: toTaskId(idAttr), rowIndex: Number(rowIndexAttr) };
}

interface DownState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly downTarget: Element;
}

/**
 * Attaches click-select to a mounted `SvgRendererHandle`. Returns a disposer.
 *
 * `getTasks` is duck-typed (same convention as `enableDragMove`) but not actually consulted
 * for hit-testing — task identity for a click comes straight off the already-rendered
 * `data-task-id` attribute (§5.2), matching exactly what's on screen. It is accepted for API
 * symmetry with the other `enableDragXxx` functions and to leave room for a future
 * resilience check without a signature change.
 */
export function enableClickSelect(
  handle: SvgRendererHandle,
  getTasks: () => readonly Task[],
  options: SelectionOptions,
): () => void {
  const dragThresholdPx = options.dragThresholdPx ?? DEFAULT_DRAG_THRESHOLD_PX;

  let down: DownState | null = null;
  let anchorTaskId: TaskId | undefined;
  let anchorRowIndex: number | undefined;
  let disposed = false;

  handle.svg.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);

  return dispose;

  function onPointerDown(event: PointerEvent): void {
    if (disposed) return;
    // B3-style guard: ignore a second concurrent pointerdown while a gesture is already open.
    if (down) return;
    if (event.button !== 0) return; // left-button/primary-contact only
    if (!(event.target instanceof Element)) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;

    down = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      downTarget: event.target,
    };
  }

  function onPointerUp(event: PointerEvent): void {
    if (disposed) return;
    const s = down;
    if (!s || event.pointerId !== s.pointerId) return;
    down = null;

    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;

    const dx = event.clientX - s.startClientX;
    const dy = event.clientY - s.startClientY;
    if (Math.hypot(dx, dy) >= dragThresholdPx) return; // a completed drag, not a click

    handleClick(s, event);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (disposed) return;
    const s = down;
    if (!s || event.pointerId !== s.pointerId) return;
    down = null; // cancelled — no callback
  }

  function handleClick(s: DownState, event: PointerEvent): void {
    const hit = resolveRowHit(s.downTarget);

    if (!hit) {
      // Empty space inside the chart (grid/header/row-margin) — clear the selection.
      options.onClear();
      anchorTaskId = undefined;
      anchorRowIndex = undefined;
      return;
    }

    if (event.shiftKey && anchorTaskId !== undefined && anchorRowIndex !== undefined) {
      const lo = Math.min(anchorRowIndex, hit.rowIndex);
      const hi = Math.max(anchorRowIndex, hit.rowIndex);
      const ids = collectRowRange(handle, lo, hi);
      options.onRangeSelect(ids);
      // Anchor is NOT moved by a Shift-click (spreadsheet/file-explorer convention).
      return;
    }

    if (event.shiftKey) {
      // Shift held, no local anchor yet (Q2 fallback) — plain single-select + set anchor.
      options.onSelect(hit.taskId);
      anchorTaskId = hit.taskId;
      anchorRowIndex = hit.rowIndex;
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      options.onToggle(hit.taskId);
      anchorTaskId = hit.taskId;
      anchorRowIndex = hit.rowIndex;
      return;
    }

    options.onSelect(hit.taskId);
    anchorTaskId = hit.taskId;
    anchorRowIndex = hit.rowIndex;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    down = null;
    handle.svg.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }
}

/** Collects every rendered row's task id whose `data-row-index` falls within
 *  `[lo, hi]` inclusive, in DOM/row order — used by the Shift-range branch. */
function collectRowRange(handle: SvgRendererHandle, lo: number, hi: number): TaskId[] {
  const ids: TaskId[] = [];
  const rowEls = handle.svg.querySelectorAll('.fg-timeline__row');
  for (const rowEl of rowEls) {
    const rowIndexAttr = rowEl.getAttribute('data-row-index');
    if (rowIndexAttr === null) continue;
    const rowIndex = Number(rowIndexAttr);
    if (rowIndex < lo || rowIndex > hi) continue;
    const taskEl = rowEl.querySelector('.fg-task[data-task-id]');
    const idAttr = taskEl?.getAttribute('data-task-id');
    if (idAttr === null || idAttr === undefined) continue;
    ids.push(toTaskId(idAttr));
  }
  return ids;
}
