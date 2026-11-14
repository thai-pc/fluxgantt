---
'@fluxgantt/core': patch
---

`updateTask`, `moveTask`, `resizeTask` and `duplicateTask` are atomic for every failure that can be known before the write. A write that throws now changes nothing: no store write, no history entry, no revision bump, no event, no `onTaskChange` call.

Before, `updateTask(id, { start: 'not-a-date' })` wrote the bad value and recorded an undo entry, then threw while announcing it. A cascade that threw (`schedulingMode: 'auto'` with a cycle added through `allowCycle`, or the working-calendar iteration guard) left the moved task in place and committed. `duplicateTask` with several sources left the copies built before the one that threw. Now the patch is parsed and the cascade is computed against the task as it will be, and only then is anything written.

A throwing `onTaskChange` hook is unchanged: it runs after the write is announced, so its error is rethrown with the write and its events already committed (a hook is a notification, not a veto; validate before writing, or undo from your own code).

Behaviour changes: a failed command no longer leaves a partial result (it used to leave the direct write of a cascading move); the `task:moved` / history order of a successful command is identical.
