---
'@fluxgantt/react': minor
---

Forward every `GanttConfig` field. `ariaLabel`, `messages`, `theme`, `canvasViewportHeight`,
`schedulingMode`, `historyLimit`, `initialCollapsed` and `rollup` type-checked before but were
silently ignored by `<FluxGantt>` / `useFluxGantt`; they now reach `createGantt`. A new
`CONFIG_DISPOSITION` table makes the compiler fail when core adds a config key the wrapper does
not account for.

`theme` is reactive: the wrapper now composes `withTheme`, so changing the prop calls `setTheme()`,
and `setTheme` / `getTheme` / `getResolvedTheme` (`ThemeCapability`) are available on the ref and
on `useFluxGantt().instance`. One deliberate exception to "unset means the core default": an unset
`theme` is `'light'` here, not core's `'auto'`, so existing charts do not turn dark on a dark-mode
OS after upgrading. Pass `theme="auto"` to follow the OS. Anything that hand-implements
`FluxGanttRef` (for example a test mock) now needs the three theme methods.

`rollup` is documented as a `RollupProvider` (`rollup={computeRollup}`), not a boolean.
