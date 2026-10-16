---
'@fluxgantt/vue': minor
---

Forward every `GanttConfig` field and declare it as a prop. `ariaLabel`, `messages`, `theme`,
`canvasViewportHeight`, `schedulingMode`, `historyLimit`, `initialCollapsed` and `rollup` were not
declared in `<FluxGantt>`'s `props`, so Vue treated them as fallthrough attributes and set them on
the root `<div>` (for example an `arialabel` DOM attribute) instead of configuring the chart. They
now reach `createGantt` and no longer fall through. Note the visible consequence for accessibility:
`aria-label="Plan"` (kebab-case) used to land on the root `<div>`; Vue now camelizes it to the
`ariaLabel` prop, so it names the chart's `<svg>` instead. Update CSS or test selectors that matched
`[aria-label]` on the container. The `theme` prop is validated (`'light' | 'dark' | 'auto'`). A new `CONFIG_DISPOSITION` table makes the
compiler fail when core adds a config key the wrapper does not account for.

`theme` is reactive: the wrapper now composes `withTheme`, so changing the prop calls `setTheme()`,
and `setTheme` / `getTheme` / `getResolvedTheme` (`ThemeCapability`) are available on the exposed
ref and on `useFluxGantt().instance`. One deliberate exception to "unset means the core default":
an unset `theme` is `'light'` here, not core's `'auto'`, so existing charts do not turn dark on a
dark-mode OS after upgrading. Pass `theme="auto"` to follow the OS. Anything that hand-implements
`FluxGanttRef` (for example a test mock) now needs the three theme methods.
