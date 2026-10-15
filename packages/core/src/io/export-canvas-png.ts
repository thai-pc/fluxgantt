// Canvas-mode PNG export (spec-canvas-export.md §4.3). Lazily imported by `io/mixin.ts` on the
// first `exportPng()` against a Canvas-mounted chart, so SVG-only consumers never download it.
//
// Instead of rasterizing a 2000+ row SVG through `<img>` (tens of thousands of DOM nodes, a
// multi-MB string, an SVG decode), this paints the FULL chart straight into a detached canvas
// using the Canvas renderer's own paint primitives. No DOM build, no `<img>`, no blob URL, so
// none of the "exported SVG opened as HTML" surface exists on this path.
//
// Browser-only (`document`), same exemption class as `export-png.ts`; never imports
// `svg-renderer.ts`. Date math stays behind `createTimeScale`/`computeGridColumns`/
// `todayLineX` (Temporal); the clock is read once, here, at the DOM boundary.
import { DEFAULT_CALENDAR } from '../compute/working-calendar.js';
import { getTemporal } from '../internal/temporal.js';
import {
  HEADER_HEIGHT,
  MAX_CANVAS_AREA_PX_WEBKIT,
  MAX_CANVAS_DIMENSION_PX,
  MAX_CANVAS_EXPORT_ROWS,
  isWebKitEngine,
  paintDependencies,
  paintGrid,
  paintHeader,
  paintLabelDivider,
  paintRows,
  paintTodayLine,
  resolveDesignTokens,
} from '../render/canvas-renderer.js';
import type { CanvasRendererHandle } from '../render/canvas-renderer.js';
import {
  ROW_HEIGHT,
  computeGridColumns,
  layoutRows,
  layoutTaskBar,
  todayLineX,
} from '../render/renderer-base.js';
import type { TaskBarLayout } from '../render/renderer-base.js';
import type { TaskId } from '../types.js';
import { isValidBackground } from './export-png.js';
import type { ExportPngOptions } from './types.js';

/**
 * Non-WebKit total-area cap: 2^27 px (512 MiB of RGBA backing store), half of Chromium's 2^28
 * ceiling. Chosen so a 2047-row default-density chart ~1600 px wide (~102 M px) fits at scale 1.
 * WebKit uses the measured, much lower `MAX_CANVAS_AREA_PX_WEBKIT`. Memory pressure can still
 * lose the context asynchronously on low-RAM devices; the docs steer big charts to SVG.
 */
export const MAX_EXPORT_CANVAS_AREA_PX = 134_217_728;

const EMPTY_IDS: ReadonlySet<TaskId> = new Set();

function sizeError(pxW: number, pxH: number, cause?: unknown): Error {
  return new Error(
    `gantt.exportPng: output ${pxW}x${pxH}px exceeds this browser's safe canvas limit — use exportSvg() ` +
      '(vector, no pixel limit), lower `scale`, use a more compact density, collapse rows, or narrow the time range',
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Pure limit arithmetic (headless-testable). Returns the integer output size, or throws the
 * same errors as the SVG-mode `exportPng` for degenerate sizes and the engine-aware size error
 * for anything past the per-side or area ceiling.
 */
export function computeExportCanvasSize(
  cssW: number,
  cssH: number,
  scale: number,
  webkit: boolean,
): { readonly pxW: number; readonly pxH: number } {
  const pxW = Math.round(cssW * scale);
  const pxH = Math.round(cssH * scale);
  if (pxW < 1 || pxH < 1) {
    throw new Error(`gantt.exportPng: output ${pxW}x${pxH}px is degenerate — scale too small`);
  }
  if (
    pxW > MAX_CANVAS_DIMENSION_PX ||
    pxH > MAX_CANVAS_DIMENSION_PX ||
    pxW * pxH > (webkit ? MAX_CANVAS_AREA_PX_WEBKIT : MAX_EXPORT_CANVAS_AREA_PX)
  ) {
    throw sizeError(pxW, pxH);
  }
  return { pxW, pxH };
}

/** Paints the whole chart of `handle` (every row, not the live window) to a PNG `Blob`. */
export async function exportCanvasPng(
  handle: CanvasRendererHandle,
  options?: ExportPngOptions,
  isLive?: () => boolean,
): Promise<Blob> {
  if (isLive && !isLive()) {
    throw new Error('gantt.exportPng: the chart was unmounted or remounted while exporting');
  }
  const scale = options?.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`gantt.exportPng: invalid scale (${scale}) — must be a finite number > 0`);
  }
  const background = options?.background ?? '#ffffff';
  if (!isValidBackground(background)) {
    throw new Error(`gantt.exportPng: invalid background "${background}"`);
  }

  // The painted state, not `GanttConfig`: `setDensity()`/`withResponsive` change these at runtime.
  const { input, options: o } = handle.getRenderState();
  const calendar = input.calendar ?? DEFAULT_CALENDAR;
  const density = o.density ?? 'default';
  const rowHeight = ROW_HEIGHT[density];
  const rows = layoutRows(input.tasks, density, input.collapsedIds);
  if (rows.length > MAX_CANVAS_EXPORT_ROWS) {
    throw new Error(
      `gantt.exportPng: ${rows.length} visible rows exceeds the Canvas-mode export limit (${MAX_CANVAS_EXPORT_ROWS}) — collapse some rows first`,
    );
  }
  const timeScale = handle.getTimeScale();
  const offsetX = handle.getLabelColumnWidth();
  const cssW = offsetX + timeScale.totalWidth;
  const cssH = HEADER_HEIGHT + (rows.length > 0 ? rows[rows.length - 1]!.y + rowHeight : rowHeight);
  const { pxW, pxH } = computeExportCanvasSize(cssW, cssH, scale, isWebKitEngine());

  const canvas = document.createElement('canvas');
  try {
    canvas.width = pxW;
    canvas.height = pxH;
    // Engines whose real limit is below the assumed one (Firefox, iOS Chrome/Edge) fail a fresh,
    // over-limit canvas with a null context or a throwing read-back: both mean "too big here".
    let ctx: CanvasRenderingContext2D | null;
    try {
      ctx = canvas.getContext('2d');
    } catch (e) {
      throw sizeError(pxW, pxH, e);
    }
    if (!ctx) throw sizeError(pxW, pxH);

    // Allocation probe: Chromium/WebKit fail an over-limit canvas by silently no-op'ing every
    // draw call, so a one-shot export the user cannot eyeball would yield a transparent PNG.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1, 1);
    let probeAlpha: number | undefined;
    try {
      probeAlpha = ctx.getImageData(0, 0, 1, 1).data[3];
    } catch (e) {
      throw sizeError(pxW, pxH, e);
    }
    if (probeAlpha === 0) throw sizeError(pxW, pxH);
    ctx.clearRect(0, 0, 1, 1);

    if (background !== 'transparent') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, pxW, pxH);
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const tokens = resolveDesignTokens(handle.container);
    const now = getTemporal().Now.zonedDateTimeISO(calendar.timezone);
    const cols = computeGridColumns(
      timeScale,
      o.viewMode ?? 'week',
      calendar,
      o.locale ?? 'en',
      now,
    );
    const bars = new Map<TaskId, TaskBarLayout>();
    for (const row of rows) {
      bars.set(row.task.id, layoutTaskBar(row.task, timeScale, row, rowHeight, input.rollup));
    }
    const critical = new Set(input.criticalPath?.criticalTaskIds ?? []);

    paintGrid(ctx, cols, offsetX, cssH, tokens);
    paintHeader(ctx, cols, offsetX, timeScale.totalWidth, tokens);
    paintLabelDivider(ctx, offsetX, cssH, tokens);
    const todayX = todayLineX(timeScale, now);
    if (todayX !== null) paintTodayLine(ctx, todayX, offsetX, cssH, tokens);

    // Selection and the focus ring are transient UI state: not exported (parity with the SVG
    // export, which strips them). Critical path IS painted (dashed, not color-only).
    ctx.save();
    ctx.translate(0, HEADER_HEIGHT);
    paintDependencies(ctx, input.dependencies, bars, rowHeight, offsetX, 0, tokens);
    paintRows(ctx, rows, bars, critical, EMPTY_IDS, rowHeight, offsetX, 0, tokens, input.rollup);
    ctx.restore();

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('gantt.exportPng: canvas.toBlob returned null'));
      }, 'image/png');
    });
  } finally {
    // Release the (possibly hundreds of MiB) backing store promptly rather than waiting for GC.
    canvas.width = 0;
    canvas.height = 0;
  }
}
