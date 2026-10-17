// Canvas RTL mirroring helpers (spec-rtl-chart.md section 6). A leaf module: imported by the lazy
// Canvas chunk only (canvas-renderer, canvas-drag, export-canvas-png), so it costs 0 B in every
// size fixture, and it cannot form an import cycle with any of them.

/** Call right after the base `setTransform`: mirrors x about `width` (CSS px of the painted box) and
 *  marks the context `direction = 'rtl'`, which is both the bidi base and the one flag `fillTextAt`
 *  reads (it is 2D state, so `save()`/`restore()` scope it). */
export function applyMirror(ctx: CanvasRenderingContext2D, width: number): void {
  ctx.transform(-1, 0, 0, 1, width, 0);
  ctx.direction = 'rtl';
}

/** `ctx.fillText` for a possibly mirrored context: counter-flips about the anchor so glyphs stay
 *  upright, and anchors the run's right end (it then extends toward the visual left). */
export function fillTextAt(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  if (ctx.direction !== 'rtl') {
    ctx.fillText(text, x, y);
    return;
  }
  ctx.save();
  ctx.transform(-1, 0, 0, 1, 2 * x, 0);
  // Physical values are mirrored by the group flip, so they swap sides; `start` is the physical right
  // under `direction: rtl` and, like `center` and `end`, already lands right after the counter-flip.
  const align = ctx.textAlign;
  if (align === 'left' || align === 'start') ctx.textAlign = 'right';
  else if (align === 'right') ctx.textAlign = 'left';
  // Per-label base direction from the first strong character (`unicode-bidi: plaintext`), so
  // "Launch!" or "(Review (draft)" keep their order inside an RTL chart.
  const strong = /[A-Za-z\u00C0-\u052F]|([\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF])/.exec(text);
  if (strong && !strong[1]) ctx.direction = 'ltr';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Layout x for a canvas-local visual x (mirror is an involution, so this also maps back). */
export function layoutX(rtl: boolean, x: number, width: number): number {
  return rtl ? width - x : x;
}
