---
'@fluxgantt/core': minor
'@fluxgantt/react': minor
'@fluxgantt/vue': minor
---

Add `scrollToTask()`, `scrollToDate()` and runtime `setDensity()` as an opt-in `withViewport()`
mixin on the new `@fluxgantt/core/viewport` subpath. `scrollToTask` scrolls a task's row and bar
into view (expanding collapsed ancestors by default, never moving focus or selection),
`scrollToDate` scrolls horizontally to a date, and `setDensity` changes row density on a live chart
while keeping the top visible row in place. `viewport:changed` gains an optional `density` field
(present only when emitted by `setDensity`). After `setDensity()` is called, `withResponsive` stops
switching density. `@fluxgantt/react` and `@fluxgantt/vue` compose `withViewport`, so the methods
are available on `FluxGanttRef` and the `useFluxGantt` instance.
