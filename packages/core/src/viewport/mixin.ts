// Opt-in viewport capability mixin (spec-viewport-api.md; spec §7.6 `scrollToTask`,
// `scrollToDate`, `setDensity`).
//
//   import { createGantt } from '@fluxgantt/core';
//   import { withRender } from '@fluxgantt/core/render';
//   import { withViewport } from '@fluxgantt/core/viewport';
//   const gantt = withViewport(withRender(createGantt({ tasks })));
//   gantt.mount(el);
//   gantt.scrollToTask(id);
//
// WHY A MIXIN: scrolling needs a mounted DOM container, and class prototype methods never
// tree-shake, so putting these on the base facade would bill every headless consumer for them.
// Everything here reaches the live chart through `internal.mountOf()` and the renderer
// handle's existing public members; neither renderer changes.
//
// Scroll never moves focus and never changes selection: the typical caller is a host search box
// or toast, and stealing focus from it would be hostile. `select(id)` + `scrollToTask(id)` is
// the recipe for "go to and announce".
import type { GanttInstance } from '../gantt.js';
import { getInternal } from '../gantt-internal.js';
import { layoutRows, ROW_HEIGHT } from '../render/renderer-base.js';
import type { DateInput, Density, TaskId } from '../types.js';

/** Both renderers pin a 32px header band. Duplicated on purpose (module isolation — each
 *  renderer keeps its own copy and this module must not import either); a unit test pins it to
 *  the rendered geometry. */
const HEADER_HEIGHT = 32;

/** Milestone square side as a fraction of the row height — duplicated from `layoutTaskBar` in
 *  renderer-base.ts for the same isolation reason. */
const MILESTONE_SIDE_RATIO = 0.6;

export type ScrollAlign = 'nearest' | 'start' | 'center' | 'end';
/** Named `...Option` so it never shadows the DOM lib's global `ScrollBehavior`. */
export type ScrollBehaviorOption = 'auto' | 'smooth';

export interface ScrollToTaskOptions {
  /** Both axes, `scrollIntoView` semantics. Default `'nearest'`: scroll the minimum amount, and
   *  not at all if the row AND bar are already fully visible. */
  readonly align?: ScrollAlign;
  /** Default `'auto'` = instant. `'smooth'` animates, except under `prefers-reduced-motion:
   *  reduce`, where it is instant. */
  readonly behavior?: ScrollBehaviorOption;
  /** Default `true`: expand collapsed ancestors so the row exists. `false`: no-op, returns
   *  `false`. */
  readonly expand?: boolean;
}

export interface ScrollToDateOptions {
  /** Horizontal only. Default `'center'`. */
  readonly align?: 'start' | 'center' | 'end';
  readonly behavior?: ScrollBehaviorOption;
}

/**
 * Scroll and density capability.
 *
 * **Precondition (SVG mode):** the mount container IS the scroll viewport. Give it a bounded
 * height and `overflow: auto` (e.g. `style="height: 420px; overflow: auto"`) and lay it out as a
 * block or grid, not flex (the pinned header is a floated `position: sticky` sibling: a flex row
 * places it beside the chart and an auto-height flex column collapses to ~32px) with no
 * `padding-top` (sticky pins at the padding edge). The SVG renderer does not make its container scrollable (Canvas mode sets `overflow-y: auto` itself); on a
 * non-scrollable container the browser ignores the offsets, yet the methods still return `true`
 * because the return value reports that the target exists and an offset was written, not that the
 * container moved.
 */
export interface ViewportCapability {
  /** Scrolls the task's row and bar into view. Returns `true` when the task's row exists and a
   *  scroll was applied (including "already visible"); `false` when the chart is not mounted
   *  (headless, or Canvas still loading — wait for `renderer:selected`) or the row is hidden and
   *  `expand: false`. Throws on an unknown id. Does not move focus or selection. */
  scrollToTask(id: TaskId, options?: ScrollToTaskOptions): boolean;
  /** Scrolls horizontally to a date. Returns `false` when unmounted or the date lies outside the
   *  chart's time range (it still scrolls as far as the browser allows). Throws on an invalid
   *  date. Does not emit `viewport:changed`. */
  scrollToDate(date: DateInput, options?: ScrollToDateOptions): boolean;
  /** Changes row density at runtime, keeping the top visible row in place, and emits
   *  `viewport:changed` `{ viewMode, density }`. Takes density ownership: `withResponsive` keeps
   *  adapting the label column and touch gestures but stops switching density. */
  setDensity(density: Density): void;
}

/** Target scroll offset for one axis. The result is clamped at 0; the browser clamps the upper
 *  bound. */
function resolveAxis(
  itemStart: number,
  itemEnd: number,
  viewStart: number,
  viewSize: number,
  align: string,
): number {
  const size = itemEnd - itemStart;
  let target: number;
  if (align === 'start') target = itemStart;
  else if (align === 'end') target = itemEnd - viewSize;
  else if (align === 'center') target = itemStart + size / 2 - viewSize / 2;
  else if (itemStart >= viewStart && itemEnd <= viewStart + viewSize) target = viewStart;
  else if (itemStart <= viewStart && itemEnd >= viewStart + viewSize) target = viewStart; // already covers the viewport
  else if (size >= viewSize || itemStart < viewStart) target = itemStart;
  else target = itemEnd - viewSize;
  return Math.max(0, target);
}

function applyScroll(
  container: HTMLElement,
  left: number | undefined,
  top: number | undefined,
  behavior: string | undefined,
): void {
  // Never write a non-finite value into the DOM (an axis that is NaN/Infinity is skipped).
  const x = left !== undefined && Number.isFinite(left) ? left : undefined;
  const y = top !== undefined && Number.isFinite(top) ? top : undefined;
  if (
    behavior === 'smooth' &&
    typeof container.scrollTo === 'function' &&
    !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  ) {
    container.scrollTo({
      ...(x !== undefined ? { left: x } : {}),
      ...(y !== undefined ? { top: y } : {}),
      behavior: 'smooth',
    });
    return;
  }
  if (x !== undefined) container.scrollLeft = x;
  if (y !== undefined) container.scrollTop = y;
}

export function withViewport<T extends GanttInstance>(instance: T): T & ViewportCapability {
  const internal = getInternal(instance);
  const currentDensity = (): Density => internal.density ?? internal.config.density ?? 'default';

  const capability: ViewportCapability = {
    scrollToTask(id, options = {}) {
      internal.alive('scrollToTask');
      const task = internal.need(id, 'scrollToTask');
      let mount = internal.mountOf();
      if (!mount) return false;

      const density = currentDensity();
      const layout = (): ReturnType<typeof layoutRows> =>
        layoutRows(internal.tasks.all(), density, new Set(internal.fold.all()));
      let row = layout().find((r) => r.task.id === id);
      if (!row) {
        if (options.expand === false) return false;
        // Walk the parent chain (bounded, so a malformed cycle cannot loop) and un-collapse it.
        const next = new Set(internal.fold.all());
        let parent = task.parent;
        for (let i = internal.tasks.size; parent !== undefined && i > 0; i--) {
          next.delete(parent);
          parent = internal.tasks.get(parent)?.parent;
        }
        if (internal.fold.replace([...next])) {
          internal.emit('collapse:changed', internal.fold.all());
        }
        row = layout().find((r) => r.task.id === id);
        if (!row) return false;
        // The expand repaint may have replaced the mount state; read the live one.
        mount = internal.mountOf();
        if (!mount) return false;
      }

      const handle = mount.handle;
      const { container } = handle;
      const labelW = handle.getLabelColumnWidth();
      const scale = handle.getTimeScale();
      // Both renderers pin the header, so `scrollTop = row.y` parks that row directly under it
      // and the visible row band is the container minus the header.
      const itemTop = row.y;
      const viewH = container.clientHeight - HEADER_HEIGHT;
      let x0 = labelW + scale.dateToX(task.start);
      let x1 = Math.max(x0, labelW + scale.dateToX(task.end));
      if (task.type === 'milestone') {
        // A milestone is a point in time but is painted as a rotated square (side = rowHeight *
        // 0.6, see layoutTaskBar), so its visible half-extent is the half-diagonal. Using the
        // zero-width point would park the glyph's centre on the viewport edge.
        const half = (ROW_HEIGHT[density] * MILESTONE_SIDE_RATIO) / Math.SQRT2;
        x0 -= half;
        x1 += half;
      }
      const align = options.align ?? 'nearest';
      const top =
        viewH > 0
          ? resolveAxis(itemTop, itemTop + ROW_HEIGHT[density], container.scrollTop, viewH, align)
          : undefined;
      const left =
        container.clientWidth > 0
          ? resolveAxis(x0, x1, container.scrollLeft, container.clientWidth, align)
          : undefined;
      applyScroll(container, left, top, options.behavior);
      return true;
    },

    scrollToDate(date, options = {}) {
      internal.alive('scrollToDate');
      const mount = internal.mountOf();
      if (!mount) return false;
      const handle = mount.handle;
      const { container } = handle;
      const scale = handle.getTimeScale();
      const rel = scale.dateToX(date); // throws on an unparseable date
      if (!Number.isFinite(rel)) throw new Error('gantt.scrollToDate: invalid date');
      const x = handle.getLabelColumnWidth() + rel;
      const left =
        container.clientWidth > 0
          ? resolveAxis(x, x, container.scrollLeft, container.clientWidth, options.align ?? 'center')
          : undefined;
      applyScroll(container, left, undefined, options.behavior);
      return rel >= 0 && rel <= scale.totalWidth;
    },

    setDensity(density) {
      internal.alive('setDensity');
      if (typeof density !== 'string' || !Object.hasOwn(ROW_HEIGHT, density)) {
        throw new Error(
          `gantt.setDensity: invalid density "${String(density)}" — must be one of ${Object.keys(ROW_HEIGHT).join(', ')}`,
        );
      }
      const prev = currentDensity();
      internal.densityPinned = true; // the host has taken ownership, even on an equal call
      if (density === prev) return;

      const mount = internal.mountOf();
      if (!mount) {
        internal.density = density; // picked up by render/mixin.ts at mount
      } else {
        const { container } = mount.handle;
        const oldTop = container.scrollTop;
        const firstRow = oldTop / ROW_HEIGHT[prev];
        const before = internal.density;
        internal.density = density;
        try {
          mount.handle.setOptions({ density });
        } catch (e) {
          // Canvas rolls itself back atomically; keep our slot in agreement and rethrow.
          if (before === undefined) delete internal.density;
          else internal.density = before;
          throw e;
        }
        if (oldTop > 0 && Number.isFinite(firstRow)) {
          container.scrollTop = firstRow * ROW_HEIGHT[density];
        }
      }
      internal.emit('viewport:changed', { viewMode: internal.viewMode.peek(), density });
    },
  };

  return Object.assign(instance, capability);
}
