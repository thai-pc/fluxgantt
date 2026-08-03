---
"@fluxgantt/core": patch
---

fix(core): don't throw when a mounted Gantt transitions from 0 to 1 task

`Gantt#renderNow` called `handle.update()` and `handle.setOptions()` (which each trigger an
independent synchronous `render()`) in an order that briefly exposed an empty task list with
no `timeRange` set, making the renderer's `deriveTimeRange()` throw
(`tasks must not be empty`) when a mounted chart went from 0 → 1 task (e.g.
`createGantt({}).mount(el)` then `addTask(...)`). The two calls are now ordered by transition
direction so that "empty tasks + unset timeRange" is never observed. Adds 0→1 and N→0→1
regression tests.
