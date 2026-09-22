// Opt-in theme capability mixin (spec §7.6, adapted to the facade split of
// spec-facade-split.md §3.2).
//
// WHY THIS IS A MIXIN AND NOT `gantt.setTheme()` ON THE BASE FACADE: spec §7.6 originally wrote
// this as a base-class method, but the bundle budgets no longer have room for it —
// `withRender + withInteraction` measured 19.43 of its 19.46 kB ceiling before this feature, and
// golden rule 5 says change the shape rather than the budget. A separate `@fluxgantt/core/theme`
// subpath keeps every existing fixture at +0 B and bills theming only to consumers who ask:
//
//   import { createGantt } from '@fluxgantt/core';
//   import { withRender } from '@fluxgantt/core/render';
//   import { withTheme } from '@fluxgantt/core/theme';
//   const gantt = withTheme(withRender(createGantt({ tasks })));
//   gantt.mount(el);
//   gantt.setTheme('dark');
//
// HOW IT REPAINTS, AND WHY THERE IS NO RENDERER CHANGE AT ALL: both renderers already read every
// color from a `--fg-*` custom property — SVG writes `var(--fg-token, <light fallback>)` inline
// at ~27 call sites and lets the browser resolve it at paint time; Canvas cannot (a 2D context
// does not parse `var()`) and instead resolves the same names through
// `getComputedStyle(container)` in `resolveDesignTokens()`, once per `render()`. Custom
// properties INHERIT, so redefining them on the mount container rethemes the entire chart from
// one place. SVG then needs no repaint (the browser re-resolves on the property change);
// Canvas needs one, which is why `apply()` pokes it below.
//
// Export is already correct with no change: `exportSvg()`'s `bakeComputedStyles()` reads
// `getComputedStyle()` off the LIVE nodes and bakes the resolved values into the clone BEFORE
// the `<style>`-stripping step, so a dark chart exports dark.
import type { GanttInstance } from '../gantt.js';
import { getInternal } from '../gantt-internal.js';
import { DARK_TOKENS } from './tokens.js';
import type { ResolvedTheme, ThemeName } from './tokens.js';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The methods `withTheme()` adds to a `GanttInstance`. */
export interface ThemeCapability {
  /**
   * Applies `theme` to the live mount, and remembers it for every subsequent `mount()`.
   * `'auto'` resolves against `prefers-color-scheme` AND keeps following it — an OS theme
   * change repaints the chart until `setTheme` is called with something else.
   *
   * No-op when the theme is unchanged (no repaint). Safe to call headless (the choice is stored
   * and applied when a container appears). Throws on an unknown name, and after `destroy()` —
   * the same posture `zoomTo()` takes, and for the same reason: a silent no-op on a dead
   * instance hides a lifecycle bug.
   */
  setTheme(theme: ThemeName): void;
  /** The CONFIGURED name — returns `'auto'` when auto, not the resolved value. Safe
   *  post-`destroy()` (returns the last value, does not throw), matching `getViewMode()`. */
  getTheme(): ThemeName;
  /** The name currently PAINTED, i.e. `'auto'` collapsed against `prefers-color-scheme`. Safe
   *  post-`destroy()`. Returns `'light'` in an environment with no `matchMedia`. */
  getResolvedTheme(): ResolvedTheme;
}

/**
 * Adds `setTheme`/`getTheme`/`getResolvedTheme` to a `createGantt()` instance. Seeds itself from
 * `config.theme` (default `'auto'`).
 *
 * Application order relative to `withRender`/`withInteraction`/`withIo` is irrelevant: the
 * container is never captured eagerly — it is looked up on demand, and re-applied on each mount
 * via the `renderer:selected` event, which `withRender` emits once per successful mount.
 */
export function withTheme<T extends GanttInstance>(instance: T): T & ThemeCapability {
  const internal = getInternal(instance);

  let theme: ThemeName = internal.config.theme ?? 'auto';
  let resolved: ResolvedTheme = 'light';
  let disposed = false;
  // Queried ONCE, here: `undefined` where the host has no `matchMedia` (jsdom without a stub, a
  // non-DOM runtime), which `prefersDark()` reads as light — the same degrade-quietly posture
  // the renderer takes for a missing `ResizeObserver`, never a throw.
  const mql = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : undefined;

  const prefersDark = (): boolean => mql?.matches === true;

  const onPreferenceChange = (): void => {
    if (disposed || theme !== 'auto') return;
    apply();
  };

  /**
   * Arms or disarms the OS-preference subscription to match the current `theme`. Re-adding the
   * SAME function reference is a documented DOM no-op, so this needs no idempotence flag of its
   * own; `mql` is `undefined` only where `matchMedia` does not exist.
   */
  const syncWatch = (): void => {
    if (theme === 'auto') mql?.addEventListener('change', onPreferenceChange);
    else mql?.removeEventListener('change', onPreferenceChange);
  };

  function apply(): void {
    resolved = theme === 'auto' ? (prefersDark() ? 'dark' : 'light') : theme;
    // The mount slot is the ONLY route to the container — reached as shared state rather than
    // by importing anything from `render/`, which would drag the renderer into this subpath's
    // graph and defeat the split (architecture.md principle 1).
    const mount = internal.getMountState();
    if (!mount) return; // headless or unmounted — the choice is remembered, applied at next mount
    const { container } = mount.rendererHandle;

    // Light is the ABSENCE of overrides: every renderer fallback is already the light value, so
    // removing is both correct and cheaper than writing a second full table.
    for (const key in DARK_TOKENS) {
      if (resolved === 'dark') container.style.setProperty(key, DARK_TOKENS[key]!);
      else container.style.removeProperty(key);
    }

    // SVG re-resolves its inline `var()` declarations by itself on the custom-property change —
    // repainting it would be pure waste. Canvas resolved the OLD values into `fillStyle`
    // strings on its last paint, so it needs a real repaint; an empty option merge is the
    // handle's existing "re-render with what you already have" entry point.
    if (mount.renderer === 'canvas') mount.rendererHandle.setOptions({});
  }

  // A container only exists after a successful mount, and `renderer:selected` is emitted exactly
  // once per mount (both the sync SVG path and the async Canvas one), which makes it the precise
  // hook for "re-apply now". Using the public event rather than a new `GanttInternal` slot keeps
  // mixin application order irrelevant and adds nothing to the shared interface.
  instance.on('renderer:selected', () => {
    if (!disposed) apply();
  });

  const capability: ThemeCapability = {
    setTheme(next: ThemeName): void {
      internal.assertAlive('setTheme');
      if (next !== 'light' && next !== 'dark' && next !== 'auto') {
        throw new Error(`gantt.setTheme: invalid theme "${next}" — light, dark or auto`);
      }
      if (next === theme) return; // no-op: no repaint, no listener churn
      theme = next;
      syncWatch();
      apply();
    },
    getTheme(): ThemeName {
      return theme;
    },
    getResolvedTheme(): ResolvedTheme {
      return resolved;
    },
  };

  // Compose over the instance's own `destroy()` rather than asking the base facade for a
  // teardown hook — `GanttInternal` is shared by every mixin and every byte added to it is
  // billed to fixtures that never import this module. Idempotent from both directions: the
  // inner `destroy()` already guards, and `disposed` guards this half.
  const destroy = instance.destroy.bind(instance);
  const themed = Object.assign(instance, capability, {
    destroy(): void {
      if (!disposed) {
        disposed = true;
        mql?.removeEventListener('change', onPreferenceChange);
        // Hand the host its element back as we found it. The container belongs to the HOST, not
        // to us — the renderers only ever remove the nodes they themselves appended — so
        // leaving 13 inline custom properties behind on a `destroy()`d chart's element would
        // silently retheme whatever the host puts there next.
        const container = internal.getMountState()?.rendererHandle.container;
        if (container) for (const key in DARK_TOKENS) container.style.removeProperty(key);
      }
      destroy();
    },
  });

  // Resolve (and, for `'auto'`, subscribe) immediately so `getResolvedTheme()` is meaningful
  // before the first mount. `apply()` is a no-op on the container while unmounted.
  syncWatch();
  apply();

  return themed;
}
