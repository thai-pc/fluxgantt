---
'@fluxgantt/react': minor
---

Add `onTaskActivated` and `onTaskContextRequested` props (the `task:activated` and
`task:context-requested` core events) and pass through `enableDependencyDrag`. The wrapper now
composes `withEditHooks`, about 0.9 KiB gzip. Call `payload.preventDefault()` in the handler to
suppress the native context menu.
