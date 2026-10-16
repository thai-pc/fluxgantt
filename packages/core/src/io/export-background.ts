// Chart ground for exports (spec-export-background.md). DOM-using (`getComputedStyle`), same
// exemption class as export-svg.ts. Sits below both export-svg.ts and export-png.ts so an
// SVG-only consumer never pulls the rasterizer.
import { validateTaskColor } from '../render/renderer-base.js';

/** Letters-only token: can't be a `url()`/`javascript:`/injection vector (review B5). */
const BARE_COLOR_KEYWORD = /^[a-zA-Z]+$/;

// Modern browsers may serialize `getComputedStyle()` colors in the SPACE-separated CSS Color 4
// form (`rgb(100 116 139)` / `rgb(100 116 139 / 0.5)`), which the legacy comma-form grammar in
// `validateTaskColor` (renderer-base.ts) does not accept. Accept that form too so a resolved
// value isn't silently dropped (which would revert the clone to its `var(--fg-token, fallback)`
// and break WYSIWYG). The shared hex / comma-rgb / comma-hsl grammar is REUSED from
// `validateTaskColor` (single source of truth — no drifting duplicate whitelist, review B2).
// One grammar for both functions (the `%`/`deg` markers are optional for either): slightly looser
// than the two it replaced, but the charset is still digits/space/`%`/`.`/`/` inside a fixed
// `rgb(`/`hsl(` wrapper, so nothing injectable can match.
const COLOR_SPACE = /^(rgb|hsl)a?\(\s*\d{1,3}(deg)?\s+\d{1,3}%?\s+\d{1,3}%?\s*(\/\s*(0|1|0?\.\d+)\s*)?\)$/i;

/** A CSS color safe to write to an attribute or `ctx.fillStyle`: the `Task.color` whitelist
 *  (hex, comma-form `rgb()`/`hsl()`), the space-separated `rgb()`/`hsl()` form, or a bare keyword
 *  (`'transparent'` included). */
export function isValidBackground(background: string): boolean {
  // `'transparent'` is covered by the letters-only keyword branch.
  return (
    BARE_COLOR_KEYWORD.test(background) || validateTaskColor(background) !== undefined || COLOR_SPACE.test(background)
  );
}

/** Throws the shared `gantt.<fn>: invalid background` error (one string for all export paths).
 *  `undefined` (option not given) passes. */
export function assertValidBackground(background: string | undefined, fn: string): void {
  if (background !== undefined && !isValidBackground(background)) throw new Error(`gantt.${fn}: invalid background "${background}"`);
}

/** The chart's ground: the computed `--fg-bg` on `el` when it passes the whitelist AND the browser
 *  parses it as a color (so a typo like `blak` is not exported as a black ground), else `'#ffffff'`.
 *  Host CSS, so an unusable value falls back instead of throwing. */
export function resolveChartBackground(el: Element): string {
  const v = getComputedStyle(el).getPropertyValue('--fg-bg').trim();
  // '' fails every whitelist branch; no `CSS` (jsdom/SSR) leaves the whitelist as the only gate.
  return isValidBackground(v) && (!window.CSS || CSS.supports('color', v)) ? v : '#ffffff';
}
