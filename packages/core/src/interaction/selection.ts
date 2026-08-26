// Interaction layer — click-select (spec-selection.md §5, generalized in
// spec-canvas-renderer-ticket2.md §7 to also support Canvas mode). Independent, lightweight
// pointerdown/pointerup tracking — NOT registered through `pointer-drag.ts`'s
// `getPointerDragController` (that coordinator explicitly treats a below-threshold
// press-release as a no-op — exactly the gesture click-select needs to act on). Owns its
// own `pointerdown` listener on `handle.pointerEventTarget` and its own `pointerup`/
// `pointercancel` listeners on `window` (mirrors `pointer-drag.ts`'s own window-level
// pattern so a release outside the rendered surface is still caught).
//
// TOUCHES THE DOM (raw Pointer Events) — this is the only layer in `@fluxgantt/core`
// allowed to, per architecture.md "Interaction". Still does NOT import react/vue/svelte.
import type { InteractiveRendererHandle } from '../render/index.js';
import { layoutRows } from '../render/renderer-base.js';
import type { Density, Task, TaskId } from '../types.js';
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
  /** Row density — needed to compute the Shift-click range via `layoutRows()` (same
   *  DOM-independent source of truth `enableKeyboardNav`/`#commitKeyboardRangeSelect` already
   *  use), rather than walking the (possibly windowed, Canvas-mode) a11y layer's DOM. */
  density: Density;
}

/** Resolves the TaskId (and its row index, for Shift-range) for a click ANYWHERE inside a
 *  task's row — the bar (`.fg-task`) OR its label (`.fg-timeline__row-label`, a SIBLING of
 *  `.fg-task` under the same `.fg-timeline__row`, not a descendant — see svg-renderer.ts
 *  renderRows()). Returns undefined for a click that resolves to neither (grid/header/margin
 *  = empty space, per Q1). SVG-only path — Canvas mode resolves hits via pixel-space
 *  `handle.hitTestRow()` instead (spec-canvas-renderer-ticket2.md §7.2), since a real click on
 *  the visible `<canvas>` bitmap never lands on a DOM descendant of `.fg-timeline__row`. */
function resolveRowHitDom(target: Element): { taskId: TaskId; rowIndex: number } | undefined {
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
 * Attaches click-select to a mounted renderer handle (SVG or Canvas — anything satisfying
 * `InteractiveRendererHandle`). Returns a disposer.
 *
 * `getTasks` is duck-typed (same convention as `enableDragMove`) but not actually consulted
 * for hit-testing — task identity for a click comes straight off the already-rendered
 * `data-task-id` attribute (SVG path, §5.2) or `handle.hitTestRow()`'s pixel-space lookup
 * (Canvas path), matching exactly what's on screen. It is accepted for API symmetry with the
 * other `enableDragXxx` functions and to leave room for a future resilience check without a
 * signature change.
 */
export function enableClickSelect(
  handle: InteractiveRendererHandle,
  getTasks: () => readonly Task[],
  options: SelectionOptions,
): () => void {
  const dragThresholdPx = options.dragThresholdPx ?? DEFAULT_DRAG_THRESHOLD_PX;
  // Real pointer events land here — for SVG this is the same node as `interactionRoot` (the
  // visible `<svg>`); for Canvas it is the visible `<canvas>`, a DIFFERENT node than
  // `interactionRoot` (the hidden ARIA layer, spec-canvas-renderer-ticket2.md §5/§7).
  const listenerTarget = handle.pointerEventTarget;

  let down: DownState | null = null;
  let anchorTaskId: TaskId | undefined;
  let anchorRowIndex: number | undefined;
  let disposed = false;

  listenerTarget.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);

  return dispose;

  /** Branches on `handle.hitTestRow`'s presence — the Canvas/SVG discriminator
   *  (spec-canvas-renderer-ticket2.md §7.3). */
  function resolveHit(event: PointerEvent, target: Element): { taskId: TaskId; rowIndex: number } | undefined {
    if (handle.hitTestRow) {
      return handle.hitTestRow(event.clientX, event.clientY);
    }
    return resolveRowHitDom(target);
  }

  function onPointerDown(rawEvent: Event): void {
    // `handle.pointerEventTarget` is typed as the base `Element` (shared by SVG's `<svg>` and
    // Canvas's visible `<canvas>`, spec-canvas-renderer-ticket2.md §3.3) — `Element`'s
    // `addEventListener` only recognizes `ElementEventMap` (no `pointerdown`), so the listener
    // is typed to accept a plain `Event` and narrows once here. Always safe: this function is
    // only ever registered for the literal `'pointerdown'` event type below.
    const event = rawEvent as PointerEvent;
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
    const hit = resolveHit(event, s.downTarget);

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
      const ids = collectRowRange(getTasks, options.density, lo, hi);
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
    listenerTarget.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }
}

/** Collects every task id whose *computed* row (via `layoutRows()`) falls within `[lo, hi]`
 *  inclusive, in row order — used by the Shift-range branch. Deliberately DOM-free: this used
 *  to query `handle.interactionRoot.querySelectorAll('[data-row-index]')` directly, which
 *  depended on every row in range having a real DOM node in the a11y layer — a windowed a11y
 *  layer (Canvas mode, spec-canvas-renderer-a11y-windowing.md) only builds DOM nodes for rows
 *  near the focused one, so that DOM-walk would silently drop rows outside the window from the
 *  range. Mirrors the precedent already set by `gantt.ts`'s `#commitKeyboardRangeSelect`, which
 *  computes the keyboard Shift+Arrow range the same way, from the same pure `layoutRows()`
 *  source of truth `enableKeyboardNav` already uses — identical behavior in SVG mode (whose DOM
 *  already reflects `layoutRows()` 1:1), and now also correct in windowed-Canvas mode. */
function collectRowRange(
  getTasks: () => readonly Task[],
  density: Density,
  lo: number,
  hi: number,
): TaskId[] {
  return layoutRows(getTasks(), density)
    .filter((r) => r.rowIndex >= lo && r.rowIndex <= hi)
    .map((r) => r.task.id);
}
