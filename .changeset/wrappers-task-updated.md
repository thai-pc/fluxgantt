---
'@fluxgantt/react': minor
'@fluxgantt/vue': minor
---

Bridge the core `task:updated` event into the wrappers: React gets an `onTaskUpdated` prop and Vue gets a `task-updated` emit, both receiving core's `TaskUpdatedPayload` (`taskId`, `task`, `prev`, `changed`). `TaskUpdatedPayload` is re-exported from both packages.

Beta: `onTaskUpdated` and `task-updated` are `@beta`, following the core event, and may change in any minor release.
