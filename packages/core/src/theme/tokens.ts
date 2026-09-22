// Theme token tables (spec §8.2). Pure data — no DOM, no imports, no host input.
//
// SECURITY: every key and every value in this module is a compile-time literal authored here.
// Nothing derived from a `Task`, a config string, or any other host-supplied value ever reaches
// `style.setProperty` through this path, so these values sit OUTSIDE the `validateTaskColor`
// trust boundary that `task.color` must cross (security.md §1/§6). If a future change makes any
// of these dynamic, it must be routed through that validator first.

/** Theme selector. `'auto'` follows the OS `prefers-color-scheme` preference. */
export type ThemeName = 'light' | 'dark' | 'auto';

/** A theme resolved down to something paintable — `'auto'` collapsed to one of these two. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Dark-mode overrides, keyed by the token names the RENDERERS ACTUALLY READ — i.e. the
 * non-`-dark` names (`--fg-bg`, not `--fg-bg-dark`). Spec §8.2 lists a parallel `*-dark` token
 * set, but no renderer reads those names: SVG writes `var(--fg-bg, #fafafa)` inline and Canvas
 * resolves `--fg-bg` via `getComputedStyle`. Shipping dark as a REDEFINITION of the base names
 * is therefore the only shape that actually repaints anything, and it needs zero renderer
 * call-site changes (CSS custom properties inherit from the mount container downward).
 *
 * The five surface values come from spec §8.2's `*-dark` entries verbatim. Grid, border and
 * dependency values are new — §8.2 defines no dark equivalents for them, and leaving them light
 * would paint near-white hairlines and weekend washes on a `#0a0a0a` ground.
 *
 * Task accent colors (`--fg-task-default`, `--fg-task-critical`, `--fg-task-completed`,
 * `--fg-task-milestone`) are deliberately ABSENT: they are saturated mid-tones that carry
 * adequate contrast against both grounds, and re-tinting them per theme would change what
 * "critical red" means depending on the host's OS setting.
 *
 * There is no `LIGHT_TOKENS` counterpart on purpose — every hardcoded renderer fallback is
 * already the light value, so applying light means REMOVING these properties, not setting
 * thirteen more.
 */
export const DARK_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  // Surfaces — spec §8.2 `*-dark`.
  '--fg-bg': '#0a0a0a',
  '--fg-bg-subtle': '#18181b',
  '--fg-fg': '#fafafa',
  '--fg-fg-muted': '#a1a1aa',
  '--fg-border': '#27272a',
  // Not in §8.2's dark set — the light value (#d4d4d8) is the label divider and reads as a
  // bright seam on a dark ground.
  '--fg-border-strong': '#3f3f46',
  // Grid.
  '--fg-grid-line': '#27272a',
  '--fg-grid-line-strong': '#3f3f46',
  '--fg-grid-weekend': '#18181b',
  // Today/holiday washes are inverted in lightness but keep their hue (amber / red), so the
  // "this day is today" and "this day is closed" signals survive the theme switch.
  '--fg-grid-today': '#422006',
  '--fg-grid-holiday': '#450a0a',
  // Dependencies — the light slate (#64748b) is too dim against #0a0a0a to trace an arrow.
  '--fg-dep-line': '#94a3b8',
  // The one token whose renderer fallback is literally `#ffffff` (svg-renderer.ts's link
  // handle) — without this override it stays a white dot in dark mode.
  '--fg-link-handle-fill': '#18181b',
});
