// Opt-in grid columns (spec-grid-columns.md; G1: the columns, the SVG painter and the CSV report; G2: the
// Canvas painter, loaded lazily from `canvas-grid.ts`).
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
// On a Canvas mount (2000+ tasks) the painter chunk is fetched first, so the first Canvas paint may show
// the plain label column for the moment the chunk takes to arrive.
import type { GanttInstance } from '../gantt.js';
import type { CanvasGridPainter } from '../render/canvas-renderer.js';
import { getInternal } from '../gantt-internal.js';
import { resolveColumns, publicColumn, type Column } from './columns.js';
import { gridCsv } from './csv.js';
import type { GridView } from './fit.js';
import { createGridPaint } from './svg-grid.js';
import type { GridCapability, GridColumnInput, GridOptions } from './types.js';
import { createGridValues } from './values.js';

const HYSTERESIS_PX = 16;
/** Instances `withGrid` has been applied to (a second application would paint a second grid). */
const composed = new WeakSet<object>();

const viewOf = (all: readonly Column[], cols: readonly Column[]): GridView => {
  let width = 0;
  const offs = cols.map((c) => {
    const off = width;
    width += c.width;
    return off;
  });
  return { all, cols, offs, width };
};

/**
 * Replaces the pinned label column with configurable columns, on the SVG renderer and on the Canvas
 * renderer (2000+ tasks). Apply it ONCE, before the first `mount()` (a second application throws).
 *
 * - The chart's text is pinned to 12px system-ui (the width estimate that decides where text is cut is
 *   calibrated for it); a host CSS rule on the row labels can invalidate that and text may then spill
 *   into the next column. The estimate, not `measureText`, cuts the text in both renderers and in every
 *   export, so a cell reads the same everywhere.
 * - On Canvas the grid is painted on the pinned label canvas (header band, cells, dividers) and the hidden
 *   a11y layer carries the real `columnheader` row and `gridcell`s with `aria-colindex`, `aria-colcount`
 *   and `aria-rowcount` (header included). The painter is a separate lazy chunk fetched on the first
 *   Canvas mount, so the first Canvas paint may show the plain label column for the moment it takes to
 *   arrive, and a Canvas `exportSvg()` made before then has no grid. `exportPng()`, `exportSvg()` and `exportGridCsv()` include the grid in both modes, and
 *   `hitTestRow` reports the `columnId` under a pointer in the pinned zone.
 * - The duration column shows an AUTHORED `task.duration` (or a summary's rolled-up duration) when there
 *   is one, exactly as the critical path reads it, and otherwise the working hours between start and end.
 *   It can therefore disagree with the bar when a host's `duration` disagrees with its dates.
 * - `collapseBelow` hides every column but `name` in a narrow container, for assistive technology too;
 *   a container that shrinks to fit its content may not re-expand.
 * - Known cost: with `config.rollup` set, the provider runs twice per data revision (once for the
 *   renderer, once for the grid's summary rows). The grid never alters the host's config.
 *
 * @beta
 */
export function withGrid<T extends GanttInstance>(
  instance: T,
  options: GridOptions = {},
): T & GridCapability {
  const internal = getInternal(instance);
  if (composed.has(internal)) throw new Error('@fluxgantt/core: withGrid is already applied to this instance.');
  composed.add(internal);
  const unit = options.durationUnit === 'hours' ? 'hours' : 'days';
  const below = Number.isFinite(options.collapseBelow) ? Math.max(0, options.collapseBelow!) : 480;
  let all = resolveColumns(options.columns); // throws at composition time on a bad definition
  let collapsed = false;
  let painter: CanvasGridPainter | undefined; // the Canvas painter, once its chunk has loaded
  let loading: Promise<void> | undefined;
  let view = viewOf(all, all);
  const values = createGridValues(internal, () => unit);

  (internal.paints ??= []).push(createGridPaint(internal, () => view, values));

  /** Pushes the pinned width (and, on Canvas, the painter) to the live renderer; that is also the repaint. */
  const apply = (): void => {
    const handle = internal.mountOf()?.handle;
    if (!handle) return;
    if ('paintHooks' in handle) {
      handle.fixedLabelWidth = true;
      handle.setOptions({ labelColumnWidth: view.width });
    } else if (painter) {
      // Only with a painter: without one (chunk pending or failed) the chart has no grid, so the width is not ours.
      handle.fixedLabelWidth = true;
      handle.setOptions({ grid: painter, labelColumnWidth: view.width });
    }
  };
  let warnedApply = false;
  /** `apply()` for the async Canvas path: an error there must not become an unhandled rejection. */
  const applyLater = (handle: object): void => {
    try {
      if (internal.mountOf()?.handle === handle) apply();
    } catch (e) {
      if (!warnedApply) console.warn('@fluxgantt/core: withGrid could not paint its Canvas grid.', e);
      warnedApply = true;
    }
  };
  /** Fetches the Canvas painter once (a failure is reported once and retried on the next mount). */
  const loadPainter = (): Promise<void> =>
    (loading ??= import('./canvas-grid.js').then(
      (m) => {
        painter = m.createCanvasGrid(internal, () => view, values);
      },
      (e: unknown) => {
        loading = undefined;
        console.warn('@fluxgantt/core: withGrid could not load its Canvas painter; this chart shows no grid.', e);
      },
    ));
  const rebuild = (): void => {
    view = viewOf(all, collapsed ? all.slice(0, 1) : all);
  };

  instance.on('renderer:selected', () => {
    const handle = internal.mountOf()?.handle; // a listener before this one may have unmounted
    if (!handle) return;
    // Decide from the container's width right away (0 = not laid out yet: keep all columns), so a
    // narrow container paints the name column once instead of all columns and then the name column.
    const watch = below > 0 && typeof ResizeObserver === 'function';
    const w0 = handle.container.clientWidth;
    collapsed = watch && w0 > 0 && w0 < below;
    rebuild();
    if ('paintHooks' in handle) apply();
    else void loadPainter().then(() => applyLater(handle));
    if (watch) {
      // The repaint is deferred to the next frame: it can change the container's own size (a
      // shrink-to-fit host), and doing that inside the callback raises "ResizeObserver loop completed
      // with undelivered notifications".
      let frame = 0;
      const ro = new ResizeObserver(() => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const w = handle.container.clientWidth;
          if (w === 0) return; // hidden: nothing to measure
          const next = collapsed ? w < below + HYSTERESIS_PX : w < below;
          if (next !== collapsed) {
            collapsed = next;
            rebuild();
            apply();
          }
        });
      });
      ro.observe(handle.container);
      const inner = handle.destroy;
      handle.destroy = (): void => {
        ro.disconnect();
        cancelAnimationFrame(frame);
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
