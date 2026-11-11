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

/** Distance (CSS px) from the pinned column's INLINE-START edge when `clientX` is inside the pinned
 *  zone, else `undefined`. The zone is the label canvas's OWN box (`labels`, `offsetX` wide), measured
 *  where it really is: container padding, a scrollbar or the WebKit RTL pin lag all move it, and this
 *  follows. That distance IS the layout-space x inside the column, so it plugs straight into the label
 *  and toggle hit math. A non-finite `clientX` is outside (comparisons are false). */
export function pinnedDistance(
  labels: HTMLElement,
  rtl: boolean,
  offsetX: number,
  clientX: number,
): number | undefined {
  const r = labels.getBoundingClientRect();
  const d = rtl ? r.right - clientX : clientX - r.left;
  return d >= 0 && d < offsetX ? d : undefined;
}

/** Horizontal `position: sticky` does not pin inside a RTL scroll container in WebKit (Chromium and
 *  Firefox pin it through `inset-inline-start`). Returns a function that measures where `el` really
 *  is and translates it back over the visible inline-start (right) edge of `container`; it is a no-op
 *  wherever sticky already did the job. `reset` drops the translation (RTL turned off). */
export function makePin(el: HTMLElement, container: HTMLElement): (reset?: boolean) => void {
  let shift = 0;
  return (reset) => {
    if (reset) {
      if (shift !== 0) el.style.transform = '';
      shift = 0;
      return;
    }
    const box = container.getBoundingClientRect();
    const dx = box.left + container.clientLeft + container.clientWidth - el.getBoundingClientRect().right;
    if (Math.abs(dx) > 0.5) el.style.transform = `translateX(${(shift += dx)}px)`;
  };
}
