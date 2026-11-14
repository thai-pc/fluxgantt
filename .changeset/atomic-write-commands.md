---
'@fluxgantt/core': patch
---

`updateTask`, `moveTask`, `resizeTask` and `duplicateTask` are atomic for every failure that can be known before the write. A write that throws now changes nothing: no store write, no history entry, no revision bump, no event, no `onTaskChange` call.

Before, `updateTask(id, { start: 'not-a-date' })` wrote the bad value and recorded an undo entry, then threw while announcing it. A cascade that threw (`schedulingMode: 'auto'` with a cycle added through `allowCycle`, or the working-calendar iteration guard) left the moved task in place and committed. `duplicateTask` with several sources left the copies built before the one that threw. Now the patch is parsed and the cascade is computed against the task as it will be, and only then is anything written.

A throwing `onTaskChange` hook is unchanged: it runs after the write is announced, so its error is rethrown with the write and its events already committed (a hook is a notification, not a veto; validate before writing, or undo from your own code).

A task whose STORED `start` / `end` does not parse (`addTask` and the `createGantt` config validate nothing, only the importers do) is also covered: `updateTask`, `moveTask`, `resizeTask` and `setProgress` on it throw before any write, even when the patch would repair the bad field. Repair such a task with `removeTask` + `addTask`, or fix the data at the source. Validating dates at `addTask` / `createGantt` is a separate follow-up.

`updateTask` still does not validate numbers: `progress` / `duration` of `NaN` or `Infinity` are the caller's responsibility (`setProgress` and `resizeTask` range-check theirs). This is now stated in its TSDoc.

Behaviour changes: `duplicateTask` throws (`task "x" not found`) for a selected id that no longer resolves, before adding any copy; it used to skip it silently (a stale selection is only reachable by mutating the store through internals); a failed command no longer leaves a partial result (it used to leave the direct write of a cascading move); the `task:moved` / history order of a successful command is identical.
