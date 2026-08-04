// PNG export (spec-export-png-svg.md §4). DOM-dependent, browser-only — same exemption class
// as export-svg.ts / render/svg-renderer.ts (architecture.md's headless-first invariant governs
// store/, compute/, and pure-data io/; this is render-adjacent by construction).
//
// Imports `exportSvg` from `./export-svg.js` — one-directional (`export-svg.ts` never imports
// this file), so `import { exportSvg } from '@fluxgantt/core'` alone never pulls this
// canvas-rasterization path into a consumer's bundle.
import { validateTaskColor } from '../render/renderer-base.js';
import { exportSvg } from './export-svg.js';
import type { ExportPngOptions } from './types.js';

/**
 * Conservative cross-browser canvas per-side pixel limit (spec §4) — real browser limits vary
 * roughly 4096–16384+ by device. Not currently exposed as a public option; a real tiling need
 * is a follow-up, not v1 scope.
 */
export const MAX_PNG_DIMENSION_PX = 8192;

/**
 * Total-area cap (spec §4) — browsers enforce a maximum canvas AREA, not just a per-side
 * limit: two sides each under `MAX_PNG_DIMENSION_PX` can still exceed the area cap (e.g. Safari
 * ~16.7M px²), yielding a silent blank/null raster. `4096²` ≈ 16.7M is the conservative
 * cross-browser floor.
 */
export const MAX_PNG_AREA_PX = 4096 * 4096;

/** A CSS color safe to pass to `ctx.fillStyle` — the `Task.color` whitelist (hex/rgb/hsl),
 *  `'transparent'`, OR a bare CSS keyword (`white`/`black`/…): a letters-only token can't be a
 *  `url()`/`javascript:`/injection vector, and unlike the strict `validateTaskColor` whitelist
 *  it accepts the natural named colors a caller would reach for (review B5). */
const BARE_COLOR_KEYWORD = /^[a-zA-Z]+$/;

function isValidBackground(background: string): boolean {
  return (
    background === 'transparent' ||
    BARE_COLOR_KEYWORD.test(background) ||
    validateTaskColor(background) !== undefined
  );
}

/**
 * Rasterizes the currently-mounted `svg` (`SvgRendererHandle.svg`) to a PNG. Internally calls
 * `exportSvg()` to get a baked/sanitized SVG string, draws it onto an in-memory `<canvas>`, and
 * resolves with the resulting `Blob`.
 *
 * Declared as an `async function` (not a manual `Promise` constructor) so EVERY validation
 * failure below — including the synchronous-looking `scale`/`background`/dimension checks — is
 * delivered as a REJECTED promise, consistent with the declared `Promise<Blob>` signature. A
 * caller never needs a synchronous try/catch around the call site itself (spec §5.2).
 */
export async function exportPng(svg: SVGSVGElement, options?: ExportPngOptions): Promise<Blob> {
  const scale = options?.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`gantt.exportPng: invalid scale (${scale}) — must be a finite number > 0`);
  }

  const background = options?.background ?? '#ffffff';
  if (!isValidBackground(background)) {
    // Canvas silently IGNORES an invalid fillStyle (keeps the previous value / defaults to
    // black) rather than throwing — validating here converts a silent footgun into a clear
    // synchronous rejection.
    throw new Error(`gantt.exportPng: invalid background "${background}"`);
  }

  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    // A non-numeric width/height (e.g. `"800px"`) would coerce to NaN and slip past the size
    // guards below (`NaN > MAX` is false), then canvas coerces NaN → 0 → a blank raster
    // surfacing as a misleading "toBlob returned null". Fail clearly instead (review A3).
    throw new Error(`gantt.exportPng: the SVG has no valid numeric width/height (${width}x${height})`);
  }
  const pxWidth = Math.round(width * scale);
  const pxHeight = Math.round(height * scale);
  if (pxWidth < 1 || pxHeight < 1) {
    // A degenerately small scale rounds a side to 0 → null blob. Clear error, not a confusing
    // "toBlob returned null" (review A4).
    throw new Error(`gantt.exportPng: output ${pxWidth}x${pxHeight}px is degenerate — scale too small`);
  }
  if (pxWidth > MAX_PNG_DIMENSION_PX || pxHeight > MAX_PNG_DIMENSION_PX || pxWidth * pxHeight > MAX_PNG_AREA_PX) {
    // Known limitation (no tiling) turned into a clear, guarded error instead of a silent
    // blank/corrupted raster once a real browser canvas size limit is hit — checking BOTH the
    // per-side limit AND the total-area cap (review B1).
    throw new Error(
      `gantt.exportPng: output ${pxWidth}x${pxHeight}px exceeds the ${MAX_PNG_DIMENSION_PX}px ` +
        'per-side / total-area canvas limit — reduce scale or the visible time range/task count',
    );
  }

  // PNG always bakes resolved styles: it rasterizes via `<img src=blob:>` in an ISOLATED
  // document with no access to the host's `--fg-*` custom properties, so an un-baked SVG would
  // resolve every color to its hardcoded fallback and silently mis-theme (review B4 — hence no
  // `inlineComputedStyle` option on `ExportPngOptions`).
  const svgString = exportSvg(svg, { inlineComputedStyle: true });
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    // Attach handlers BEFORE assigning `src` — otherwise a load/error that fires synchronously
    // during the `src` assignment (a cached/mocked/fast-decoding image) would settle before the
    // listeners exist, leaving the promise permanently pending and leaking the object URL
    // (review A5). No CORS/tainting concern: `url` is a same-origin `blob:` URL and the SVG
    // embeds no external `<image>`/`xlink:href` references (v1's renderer never embeds raster
    // assets), so `canvas.toBlob()` below is safe without a `crossOrigin` dance.
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('gantt.exportPng: failed to decode the exported SVG'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = pxWidth;
    canvas.height = pxHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('gantt.exportPng: canvas 2D context unavailable');

    if (background !== 'transparent') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, pxWidth, pxHeight);
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('gantt.exportPng: canvas.toBlob returned null'));
      }, 'image/png');
    });
  } finally {
    // After drawImage has completed, not before.
    URL.revokeObjectURL(url);
  }
}
