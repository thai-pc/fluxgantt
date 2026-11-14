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
// Resize (G3, `resize.ts`): `resizeGridColumn` is the one write path; a pointer drag on a sizer (SVG) or the
// header band (Canvas), and Alt+Arrow on a focused column header, all end in it.
// Keyboard (G4, `resize.ts` + the lazy `resize-ui.ts`): the APG treegrid model in a capture listener on the
// container, so `keyboard-nav` is not edited and without `withGrid` every key behaves as before.
//
// The width is applied after the first paint (the renderer reads its options at construction and the
// facade passes none for the width), so a mount paints twice; the first paint is skipped by the hook.
// On a Canvas mount (2000+ tasks) the painter chunk is fetched first, so the first Canvas paint may show
// the plain label column for the moment the chunk takes to arrive.
import type { GanttInstance } from '../gantt.js';
import type { CanvasGridPainter, CanvasRendererHandle } from '../render/canvas-renderer.js';
import { getInternal } from '../gantt-internal.js';
import { resolveColumns, publicColumn, type Column } from './columns.js';
import { gridCsv } from './csv.js';
import { HEADER_HEIGHT, type GridView } from './fit.js';
import { attachKeys, gridPaint, type ResizeEnv } from './resize.js';
import type * as ResizeUi from './resize-ui.js';
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
 * - With `withEditHooks` composed, `task:activated` / `task:context-requested` from a cell report `part: 'cell'` and its
 *   `columnId` (every column but `name`, which keeps `'label'` for the pointer and `'row'` for the keyboard).
 * - Keyboard (after the APG treegrid pattern; the chart stays ONE Tab stop, the active row). In ROW mode, Right
 *   on a collapsed parent expands it, on an expanded parent or a leaf it enters the first cell; Left on an
 *   expanded parent collapses it, otherwise it moves to (and selects) the parent row; Ctrl/Cmd+Home/End go to the
 *   first/last row. In CELL mode (a `gridcell` has focus), Left/Right/Home/End move between cells, Up/Down/Page
 *   keep the column, Escape or Left from the first cell returns to the row. Up on the first row (or from one of
 *   its cells) enters HEADER mode: Left/Right/Home/End between headers, Alt+Left/Right resizes, Down/Escape
 *   return. Left and Right swap under RTL. Without `withGrid`, Left/Right and Ctrl+Home/End do nothing. Alt+Arrow
 *   and Alt+Enter (task move, resize, link), Space, Delete, `g`, Shift+Arrow, Enter and F2 are not claimed: they
 *   behave as from a row, also from a focused cell. The first key may act a moment late (the key handlers are
 *   a lazy chunk), but whether it is claimed is decided at once.
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
  let canvasResize: ((handle: CanvasRendererHandle, env: ResizeEnv) => () => void) | undefined;
  let loading: Promise<void> | undefined;
  let view = viewOf(all, all);
  const values = createGridValues(internal, () => unit);
  const resizable = options.resizable !== false;
  // Header focus bookkeeping shared with the resize code (`ResizeEnv.nav`).
  const nav: ResizeEnv['nav'] = { tab: 0, col: -1 };
  // The lazy half of the resize code (`resize-ui.ts`), fetched once; a failure is warned once and retried.
  let ui: Promise<typeof ResizeUi | undefined> | undefined;
  const loadUi = (): Promise<typeof ResizeUi | undefined> =>
    (ui ??= import('./resize-ui.js').then(
      (m) => m,
      (e: unknown) => {
        ui = undefined;
        console.warn('@fluxgantt/core: withGrid could not load its column resize code.', e);
        return undefined;
      },
    ));
  const envOf = (handle: { container: HTMLElement; mirrorX?: unknown }): ResizeEnv => ({
    container: handle.container,
    mirrored: () => handle.mirrorX !== undefined,
    view: () => view,
    resize: (id, width) => capability.resizeGridColumn(id, width),
    internal,
    gantt: instance,
    can: resizable,
    nav,
    ui: loadUi,
  });
  // The SVG mount's env: the drag handles are painted only for the live SVG chart (not for the throwaway
  // renderer a Canvas `exportSvg()` builds, which receives the same paint hooks).
  let svgEnv: ResizeEnv | undefined;

  const paints = (internal.paints ??= []);
  internal.colAt = (t, x = NaN, y = NaN) => {
    const pin = t.closest('.fg-timeline__sticky-column');
    const r = pin?.getBoundingClientRect();
    const d = r ? (internal.mountOf()?.handle.mirrorX ? r.right - x : x - r.left) : NaN;
    const id =
      t.closest('[data-column-id]')?.getAttribute('data-column-id') ??
      view.cols.find((c, i) => d >= view.offs[i]! && d < view.offs[i]! + c.width)?.id;
    // The row spanning y, by arithmetic (a pinned clone row's box is only its text): rows start under the header
    // and the first label sits at its centre, which gives the row height at any density.
    const h = 2 * (Number(pin?.querySelector('.fg-timeline__row-label')?.getAttribute('y')) - HEADER_HEIGHT);
    return id ? [id, pin?.querySelectorAll('g[data-row-index]')[Math.floor((y - r!.top - HEADER_HEIGHT) / h)]] : undefined;
  };
  paints.push(createGridPaint(internal, () => view, values));
  paints.push((e) => {
    if (svgEnv) gridPaint(svgEnv, e);
  });

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
        canvasResize = m.attachCanvasResize;
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
    // Everything this mount sets up is undone by the wrapped destroy (there is no unmount event).
    const stops: (() => void)[] = [() => nav.stop?.()];
    const inner = handle.destroy;
    handle.destroy = (): void => {
      for (const stop of stops) stop();
      inner.call(handle);
    };
    const svg = 'paintHooks' in handle;
    const env = envOf(handle);
    stops.push(attachKeys(env), () => Object.assign(nav, { col: -1, head: false, back: false, syn: false })); // nav is per mount
    if (svg) {
      svgEnv = env;
      stops.push(() => {
        if (svgEnv === env) svgEnv = undefined;
      });
    }
    if (svg) apply();
    else
      void loadPainter().then(() => {
        applyLater(handle);
        // After `applyLater`, which only runs for the live mount: a late chunk must not wire a dead handle.
        if (resizable && canvasResize && internal.mountOf()?.handle === handle) stops.push(canvasResize(handle as CanvasRendererHandle, env));
      });
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
      stops.push(() => {
        ro.disconnect();
        cancelAnimationFrame(frame);
      });
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
    resizeGridColumn(id: string, width: number): boolean {
      internal.alive('resizeGridColumn');
      const i = all.findIndex((c) => c.id === id);
      const c = all[i];
      if (!resizable || !c || !Number.isFinite(width)) return false;
      const next = Math.min(c.maxWidth, Math.max(c.minWidth, Math.round(width)));
      if (next === c.width) return false;
      all = all.map((x, j) => (j === i ? { ...x, width: next } : x));
      rebuild();
      apply(); // the one repaint
      internal.emit('column:resized', {
        columnId: id,
        width: next,
        widths: Object.fromEntries(all.map((x) => [x.id, x.width])),
      });
      return true;
    },
    exportGridCsv(): string {
      internal.alive('exportGridCsv');
      return gridCsv(internal.tasks.all(), all, values);
    },
  };
  return Object.assign(instance, capability);
}
