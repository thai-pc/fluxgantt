---
'@fluxgantt/core': minor
---

Add the `task:updated` event: a bus-level catch-all that fires once per write that changed at least one task field, with the payload `{ taskId, task, prev, changed, source? }`.

Beta: `task:updated`, `TaskUpdatedPayload` and `TaskField` are experimental and may change in any minor release.

- Fires for `updateTask`, `moveTask`, `resizeTask`, `setProgress`, every auto-schedule cascade shift, and undo/redo of an update (`source` is then `'undo'` or `'redo'`). It fires after the write's specific `task:moved` / `task:resized` / `task:progressed` events and after `onTaskChange`, so one write can deliver both a specific event and `task:updated`; subscribe to one kind, not both.
- Never fires for add, remove, import or dependency operations, and not for a no-op patch (`onTaskChange` still does).
- `start` / `end` compare by instant; every other field compares with `Object.is` (a deep-equal replacement object counts as changed); `updatedAt` is ignored.
- Hosts that keep an exhaustive `Record<GanttEventName, ...>` must add the new key.
