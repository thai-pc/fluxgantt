// Opt-in grid columns (spec-grid-columns.md; PR G1: the columns, the SVG painter and the CSV report).
//
//   const gantt = withGrid(withRender(createGantt({ tasks })), { columns: [...] });
//
// The pinned label column becomes N sub-columns and `labelColumnWidth` becomes their sum, so the
// viewport math, RTL, the zoom anchor and the PNG export (which all key on that one number) need no
// change. Same shape as `edit-hooks/mixin.ts`: wired from the public `renderer:selected` event (so
// application order vs `withRender`/`withInteraction` is irrelevant) and imports nothing from
// `interaction/`. The paint hook is registered at COMPOSITION time (`internal.paints`), so it sees
// every mount's paint and `withRtl`'s mirror still runs after it in any composition order.
//
// The width is applied after the first paint (the renderer reads its options at construction and the
// facade passes none for the width), so a mount paints twice; the first paint is skipped by the hook.
import type { GanttInstance } from '../gantt.js';
import { getInternal } from '../gantt-internal.js';
import { resolveColumns, publicColumn, type Column } from './columns.js';
import { gridCsv } from './csv.js';
import { createGridPaint, type GridView } from './svg-grid.js';
import type { GridCapability, GridColumnInput, GridOptions } from './types.js';
import { createGridValues } from './values.js';

const HYSTERESIS_PX = 16;

const viewOf = (cols: readonly Column[]): GridView => {
  let width = 0;
  const offs = cols.map((c) => {
    const off = width;
    width += c.width;
    return off;
  });
  return { cols, offs, width };
};

/**
 * Replaces the pinned label column with configurable columns (SVG renderer). Apply it before the
 * first `mount()`.
 *
 * @beta
 */
export function withGrid<T extends GanttInstance>(
  instance: T,
  options: GridOptions = {},
): T & GridCapability {
  const internal = getInternal(instance);
  const unit = options.durationUnit === 'hours' ? 'hours' : 'days';
  const below = Number.isFinite(options.collapseBelow) ? Math.max(0, options.collapseBelow!) : 480;
  let all = resolveColumns(options.columns); // throws at composition time on a bad definition
  let collapsed = false;
  let view = viewOf(all);
  const values = createGridValues(internal, () => unit);

  (internal.paints ??= []).push(createGridPaint(internal, () => view, values));

  /** Pushes the pinned width to the live SVG renderer; that is also the repaint. */
  const apply = (): void => {
    const handle = internal.mountOf()?.handle;
    if (handle && 'paintHooks' in handle) {
      handle.fixedLabelWidth = true;
      handle.setOptions({ labelColumnWidth: view.width });
    }
  };
  const rebuild = (): void => {
    view = viewOf(collapsed ? all.slice(0, 1) : all);
  };

  instance.on('renderer:selected', () => {
    const handle = internal.mountOf()?.handle; // a listener before this one may have unmounted
    if (!handle) return;
    if (!('paintHooks' in handle)) {
      console.warn('@fluxgantt/core: withGrid paints on the SVG renderer only; this chart shows no grid.');
      return;
    }
    // Decide from the container's width right away (0 = not laid out yet: keep all columns), so a
    // narrow container paints the name column once instead of all columns and then the name column.
    const watch = below > 0 && typeof ResizeObserver === 'function';
    const w0 = handle.container.clientWidth;
    collapsed = watch && w0 > 0 && w0 < below;
    rebuild();
    apply();
    if (watch) {
      const ro = new ResizeObserver(() => {
        const w = handle.container.clientWidth;
        if (w === 0) return; // hidden: nothing to measure
        const next = collapsed ? w < below + HYSTERESIS_PX : w < below;
        if (next !== collapsed) {
          collapsed = next;
          rebuild();
          apply();
        }
      });
      ro.observe(handle.container);
      const inner = handle.destroy;
      handle.destroy = (): void => {
        ro.disconnect();
        inner.call(handle);
      };
    }
  });

  const capability: GridCapability = {
    getGridColumns: () => all.map(publicColumn),
    setGridColumns(columns: readonly GridColumnInput[]): void {
      internal.alive('setGridColumns');
      all = resolveColumns(columns); // throws before anything changes
      rebuild();
      apply();
    },
    exportGridCsv(): string {
      internal.alive('exportGridCsv');
      return gridCsv(internal.tasks.all(), all, values);
    },
  };
  return Object.assign(instance, capability);
}
