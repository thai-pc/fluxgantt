// Drift guard + pick helper for the `GanttConfig` fields a wrapper hands to `createGantt`.
//
// `CONFIG_DISPOSITION` has to name EVERY key of `GanttConfig`: the `satisfies` clause below is a
// compile error the moment core adds a key that is not listed, so a new config field can never
// again be silently dropped by the wrapper (the bug this file exists to prevent: eight fields
// were type-checked but never forwarded). A byte-identical copy lives in the sibling React/Vue wrapper package;
// duplicating ~40 lines is cheaper than a new shared export on core's public surface.
import type { GanttConfig } from '@fluxgantt/core';
import type { ThemeCapability } from '@fluxgantt/core/theme';

type Disposition = 'forwarded' | 'reactive' | { readonly excluded: string };

/**
 * - `forwarded`: handed to `createGantt` once, at construction (uncontrolled).
 * - `reactive`: handed to `createGantt` AND kept in sync afterwards (`theme` via `setTheme`,
 *   `onTaskChange` via an always-latest closure).
 * - `{ excluded }`: deliberately not forwarded; the string is the mandatory reason.
 */
export const CONFIG_DISPOSITION = {
  tasks: 'forwarded',
  dependencies: 'forwarded',
  calendar: 'forwarded',
  viewMode: 'forwarded',
  density: 'forwarded',
  locale: 'forwarded',
  ariaLabel: 'forwarded',
  messages: 'forwarded',
  canvasViewportHeight: 'forwarded',
  readOnly: 'forwarded',
  enableDependencyDrag: 'forwarded',
  schedulingMode: 'forwarded',
  historyLimit: 'forwarded',
  initialCollapsed: 'forwarded',
  rollup: 'forwarded',
  // Construction-time only (like `locale`): changing it needs a remount (use `key`). Read by
  // `withRtl`, which the wrapper composes unconditionally (inert unless `rtl === true`).
  rtl: 'forwarded',
  theme: 'reactive',
  onTaskChange: 'reactive',
} as const satisfies Record<keyof GanttConfig, Disposition>;

/**
 * Copies every forwarded/reactive `GanttConfig` field that is actually set. Unset keys are
 * omitted rather than written as `undefined` (`exactOptionalPropertyTypes`, and so core's own
 * defaults apply). The caller overrides `onTaskChange` and `theme` afterwards.
 */
export function pickConstructionConfig(config: GanttConfig): GanttConfig {
  const out: Record<string, unknown> = {};
  const source = config as unknown as Record<string, unknown>;
  for (const key of Object.keys(CONFIG_DISPOSITION) as Array<keyof typeof CONFIG_DISPOSITION>) {
    const disposition: Disposition = CONFIG_DISPOSITION[key];
    if (typeof disposition === 'object') continue;
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  // Single cast: every key written above is a `GanttConfig` key by construction.
  return out as GanttConfig;
}

const THEMES: readonly string[] = ['light', 'dark', 'auto'];

/**
 * Applies `theme` to the instance for the reactive `theme` prop. `setTheme` throws on a
 * destroyed instance (a host can call `destroy()` on the exposed ref); a prop change after that
 * must not take down the host's tree, so a VALID theme on a dead instance is dropped. An invalid
 * theme still throws, as `setTheme` documents.
 */
export function syncTheme(instance: ThemeCapability, theme: string): void {
  try {
    instance.setTheme(theme as Parameters<ThemeCapability['setTheme']>[0]);
  } catch (err) {
    if (!THEMES.includes(theme)) throw err;
  }
}
