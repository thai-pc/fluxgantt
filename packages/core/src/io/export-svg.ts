// SVG export (spec-export-png-svg.md §3). DOM-dependent, browser-only — unlike every other
// file in io/, this one touches `document`/`XMLSerializer`/`getComputedStyle`. Same exemption
// class as render/svg-renderer.ts: architecture.md's headless-first invariant governs store/,
// compute/, and pure-data io/ — this is render-adjacent by nature (it serializes render/'s own
// live DOM output) and was never in scope for that invariant.
//
// SECURITY (security.md §1 — read before touching this file): the returned string must never
// become active content if the file is later opened as/embedded in HTML. `task.name` (and any
// other free text) reaches the LIVE DOM exclusively via `document.createTextNode`
// (svg-renderer.ts) — `cloneNode(true)` clones those as `Text` nodes, and `XMLSerializer`
// escapes text-node content automatically, so no code path here can turn task data into markup.
// The one thing THIS file adds is baked `getComputedStyle()` values — gated through
// `isSafeStyleValue()` (a hard whitelist) before ever being written into the clone.
import { validateTaskColor } from '../render/renderer-base.js';
import type { ExportSvgOptions } from './types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Paint/typography properties baked from the LIVE element's `getComputedStyle()` into the
 * exported clone's inline style (spec §3.1). Deliberately excludes `r` (the link-handle
 * circle's radius, the only place `r` is set via `style.setProperty` in svg-renderer.ts) —
 * those circles are removed from the export entirely (§3.2 — see `removeLinkHandles` below),
 * so baking their radius would be wasted work, and `r` as an SVG **geometry** property has
 * less consistent cross-browser `getComputedStyle` support than paint properties.
 */
const BAKED_STYLE_PROPERTIES = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'text-anchor',
  'dominant-baseline',
] as const;

// --- Security: whitelist gate for baked computed-style values (spec §6.3) -----------------

const SAFE_PAINT_KEYWORDS = new Set(['none', 'currentcolor', 'transparent']);
// Modern browsers may serialize `getComputedStyle()` colors in the SPACE-separated CSS Color 4
// form (`rgb(100 116 139)` / `rgb(100 116 139 / 0.5)`), which the legacy comma-form grammar in
// `validateTaskColor` (renderer-base.ts) does not accept. Accept that form too so a resolved
// value isn't silently dropped (which would revert the clone to its `var(--fg-token, fallback)`
// and break WYSIWYG). The shared hex / comma-rgb / comma-hsl grammar is REUSED from
// `validateTaskColor` (single source of truth — no drifting duplicate whitelist, review B2).
const RGB_SPACE = /^rgba?\(\s*\d{1,3}\s+\d{1,3}\s+\d{1,3}\s*(\/\s*(0|1|0?\.\d+)\s*)?\)$/i;
const HSL_SPACE = /^hsla?\(\s*\d{1,3}(deg)?\s+\d{1,3}%\s+\d{1,3}%\s*(\/\s*(0|1|0?\.\d+)\s*)?\)$/i;
/** A same-document SVG paint-server fragment reference only — no scheme, no external URL (the
 *  only `url()` form `fill`/`stroke` can legitimately resolve to, spec §6.3). Quotes optional:
 *  `getComputedStyle` serializes paint-server refs as `url("#id")` (review B6). */
const LOCAL_PAINT_URL_REF = /^url\(\s*['"]?#[A-Za-z0-9_-]+['"]?\s*\)$/;
/** Plain-token charset for every baked property that isn't `fill`/`stroke` — no `(`, `)`,
 *  `:`, `;`, `<`, `>` (spec §6.3). */
const SAFE_TOKEN = /^[A-Za-z0-9 %.,-]+$/;

/**
 * Defense-in-depth whitelist gate (spec §6.3) applied to every `getComputedStyle()`-resolved
 * value before it is written into the exported clone. Reasoned to be unnecessary in principle
 * (the CSSOM can only ever resolve `fill`/`stroke` to a `<paint>` value, never script), added
 * anyway as cheap defense-in-depth — a value that fails this check is skipped, never thrown
 * (the clone keeps its original `var(--fg-token, fallback)` declaration for that property).
 * Known v1 limitation: an exotic host color syntax (`oklch()`/`lab()`/`color()`) isn't in the
 * grammar, so such a value falls back to the token default in the export rather than baking —
 * acceptable, and never a security or crash issue. Exported for direct unit testing.
 */
export function isSafeStyleValue(prop: string, value: string): boolean {
  if (value === '') return false;
  if (prop === 'fill' || prop === 'stroke') {
    const lower = value.trim().toLowerCase();
    return (
      SAFE_PAINT_KEYWORDS.has(lower) ||
      validateTaskColor(value) !== undefined || // shared hex / comma-rgb / comma-hsl grammar
      RGB_SPACE.test(value) ||
      HSL_SPACE.test(value) ||
      LOCAL_PAINT_URL_REF.test(value)
    );
  }
  return SAFE_TOKEN.test(value);
}

/**
 * Serializes the currently-mounted `svg` (`SvgRendererHandle.svg`) into a self-contained,
 * standalone SVG string — XML declaration, explicit `xmlns`, resolved computed styles baked in
 * by default (WYSIWYG, decision 1), interactive-only chrome (link-handle circles + their
 * hover-reveal `<style>`) stripped, `<title>` promoted from `aria-label` (spec §3, §8).
 *
 * Never mutates `svg` — operates entirely on a detached `cloneNode(true)` copy.
 * `getComputedStyle()` is ALWAYS read from the LIVE `svg`/its live descendants, never from the
 * clone (a detached clone has no meaningful computed style / CSS custom-property inheritance
 * chain — see spec §7).
 */
export function exportSvg(svg: SVGSVGElement, options?: ExportSvgOptions): string {
  const inline = options?.inlineComputedStyle ?? true;

  // 1. Deep clone. NEVER append the clone into `document`.
  const clone = svg.cloneNode(true) as SVGSVGElement;

  // 2. Pair up live/clone elements BEFORE removing anything from the clone, so both arrays
  //    are the same length/order (cloneNode(true) is a structural mirror at this point).
  const liveEls = svg.querySelectorAll<SVGElement>('*');
  const cloneEls = clone.querySelectorAll<SVGElement>('*');

  if (inline) {
    bakeComputedStyles(liveEls, cloneEls);
  }

  // 4. Remove interactive-only chrome. Removes the link-handle ELEMENTS themselves, not just
  //    the `<style>` block below — see spec §3.2, this is load-bearing: `renderLinkHandle()`
  //    gives the handle circles no inline `opacity`, they are hidden only by the `<style>`
  //    rule stripped in step 5, so leaving the circles in place would render them at full
  //    opacity in the static export.
  clone.querySelectorAll('.fg-task__link-handle').forEach((el) => el.remove());

  // 5. Strip every interactive-only `<style>` block — link-handle hover-reveal AND the
  //    selection-outline rule (spec-selection.md §7.3/§11: selection is transient UI state,
  //    not persisted/exported). `svg-renderer.ts` now appends TWO `<style>` elements
  //    unconditionally (selection) / conditionally (link handles), so this must remove ALL of
  //    them, not just the first (`querySelector('style')` would leave the second behind).
  clone.querySelectorAll('style').forEach((el) => el.remove());

  // 5b. Strip `tabindex` (spec-keyboard-nav.md §9): a static, non-interactive exported SVG
  //     has nothing that is actually focusable — leaving `tabindex="0"`/`"-1"` in place would
  //     be a meaningless, potentially confusing artifact if the file is opened directly in a
  //     browser/editor. ARIA roles/attributes (`role`, `aria-rowindex`, `aria-selected`,
  //     `aria-rowcount`, `aria-multiselectable`) are LEFT IN PLACE — they are accurate, static
  //     descriptions of the chart's structure/state at export time and are plain attributes,
  //     not interpolated user strings, so they pose no security or correctness issue.
  clone.querySelectorAll('[tabindex]').forEach((el) => el.removeAttribute('tabindex'));

  // 6. A11y: promote the existing aria-label into a <title> — more portable than aria-label
  //    alone for standalone-file / `<img src>` contexts (spec §8).
  const label = clone.getAttribute('aria-label');
  if (label) {
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = label; // textContent, never innerHTML
    clone.prepend(title);
  }

  // 7. Defense-in-depth namespace guarantee. `clone` (a `cloneNode(true)` of a live root
  //    created via `document.createElementNS(SVG_NS, 'svg')`) always already carries the SVG
  //    namespace as its `namespaceURI` — which `XMLSerializer` uses to emit `xmlns="..."` on
  //    the serialized root automatically. Only add an explicit `xmlns` ATTRIBUTE when that
  //    guarantee is somehow absent: adding it unconditionally would duplicate the
  //    namespace-derived declaration in the serialized text (two `xmlns="..."` occurrences on
  //    the same tag — invalid XML, confirmed via a real `XMLSerializer` round-trip).
  if (clone.namespaceURI !== SVG_NS) {
    clone.setAttribute('xmlns', SVG_NS);
  }

  // 8. Serialize + declare. `<title>` text and `task.name` text nodes are escaped
  //    automatically by XMLSerializer — a platform guarantee, not implemented here.
  const xml = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

/**
 * Bakes each element's browser-RESOLVED value for every `BAKED_STYLE_PROPERTIES` entry — read
 * via `getComputedStyle()` on the LIVE node — into the paired clone node's inline style. Only
 * ever done for properties the live element actually declared inline (i.e. ones svg-renderer.ts
 * set via `style.setProperty`, mostly `var(--fg-token, fallback)`) — skipping anything not
 * inline-declared keeps the walk cheap and never invents a style the renderer didn't already
 * opt into. Warns (at most once per property per call) and leaves the clone's original
 * declaration untouched when a resolved value fails `isSafeStyleValue`.
 */
function bakeComputedStyles(liveEls: NodeListOf<SVGElement>, cloneEls: NodeListOf<SVGElement>): void {
  const warnedProps = new Set<string>();
  for (let i = 0; i < liveEls.length; i++) {
    const live = liveEls[i]!;
    const cloned = cloneEls[i]!;
    // Resolve the computed style ONCE per element (a forced style read) — not once per
    // property, which was up to 6 getComputedStyle() calls per node and O(n*props) layout
    // thrash on a large chart (review A2/B3).
    const computed = getComputedStyle(live);
    for (const prop of BAKED_STYLE_PROPERTIES) {
      const declared = live.style.getPropertyValue(prop);
      if (declared === '') continue;
      const resolved = computed.getPropertyValue(prop).trim();
      if (isSafeStyleValue(prop, resolved)) {
        cloned.style.setProperty(prop, resolved);
      } else if (!warnedProps.has(prop)) {
        warnedProps.add(prop);
        console.warn(`exportSvg: computed "${prop}" failed the safety check — left as-is`);
      }
    }
  }
}
