---
'@fluxgantt/core': minor
---

One batched command path for every mutation. `addTask`, `updateTask`, `moveTask`, `resizeTask`,
`removeTask`, `linkTasks`, `unlinkTasks`, `setProgress`, `duplicateTask`, Delete on a selection,
`undo`/`redo`, imports and collapse/expand now commit all of their writes inside one signal batch,
so a mounted chart repaints (and recomputes the critical path) ONCE per mutation instead of once
per internal write: a 50-task cascade went from 50 effect runs to 1, removing a 100-descendant
subtree from about 200 to 1. A subtree removal no longer paints (or `console.warn`s about) the
transient states where a task is gone but its dependencies are not.

Event timing (the one observable change): event names, payloads and relative order are unchanged,
but listeners and `onTaskChange` now run AFTER the whole mutation has committed and the chart has
repainted, so they observe the final state of a multi-step mutation (for example `task:moved` for
the mover already sees the cascaded successors). `critical-path:computed` fires at most once per
mutation, before that mutation's other events, with the final set. If `onTaskChange` throws, the
remaining events still fire and the first error is rethrown afterwards (before, the throw aborted
the rest of the mutation part-way).

`signals`: a throwing effect no longer drops the other pending effects of the same flush; they all
run and the first error is rethrown.
