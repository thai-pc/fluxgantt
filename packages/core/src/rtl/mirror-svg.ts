// Pure DOM helper for `withRtl` (spec-rtl-chart.md section 5.3). Mirrors an already painted chart
// svg by wrapping its children in one transformed group, then counter-flips each text so glyphs
// stay upright. Layout code stays LTR and authoritative; the mirror is an ATTRIBUTE transform, so
// `exportSvg()` and the PNG export keep it for free. Writes only numbers and constants into the
// DOM (never task data). No import from `render/`: this subpath must not drag the renderer in.
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Wraps the children of `root` in `<g class="fg-rtl" transform="matrix(-1 0 0 1 width 0)"
 *  direction="rtl">` and counter-flips every `<text>` about its own `x`. Idempotent. `width` is the
 *  painted width (label column + timeline). A non-finite `width` is a no-op. */
export function mirrorSvg(root: SVGSVGElement, width: number): void {
  if (!Number.isFinite(width) || root.firstElementChild?.classList.contains('fg-rtl')) return;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'fg-rtl');
  g.setAttribute('transform', `matrix(-1 0 0 1 ${width} 0)`);
  // The attribute (not CSS) so a standalone export keeps it: `direction: rtl` makes
  // `text-anchor: start` mean "right end of the run" and gives Arabic/Hebrew an RTL bidi base.
  g.setAttribute('direction', 'rtl');
  g.append(...root.childNodes);
  root.appendChild(g);
  for (const t of g.querySelectorAll('text')) {
    const x = Number(t.getAttribute('x'));
    if (Number.isFinite(x)) t.setAttribute('transform', `matrix(-1 0 0 1 ${2 * x} 0)`);
    // Per-label base direction (first strong character), so "Launch!" and "(Review (draft)" keep their
    // order inside the RTL group; Arabic-first labels still run right to left. Inline, so it survives export.
    if (t.classList.contains('fg-timeline__row-label')) t.style.setProperty('unicode-bidi', 'plaintext');
  }
}
