---
'@fluxgantt/vue': minor
---

Add `task-activated` and `task-context-requested` emits (the `task:activated` and
`task:context-requested` core events) and an `enableDependencyDrag` prop. The wrapper now composes
`withEditHooks`, about 0.9 KiB gzip. Call `payload.preventDefault()` in the handler to suppress the
native context menu.
