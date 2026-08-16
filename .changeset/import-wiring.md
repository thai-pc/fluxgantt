---
"@fluxgantt/core": minor
---

feat(core): wire `importJson`/`importCsv` into the `Gantt` facade

Add `gantt.importJson(data, options?)` and `gantt.importCsv(csv, options?)` on
`GanttInstance`, plus a `data:imported` event. Both wholesale-REPLACE the entire live
task/dependency set — equivalent to what `createGantt({ tasks, dependencies })` would have
produced from the same data, not a merge/append.

The complete replacement dataset is validated and staged against throwaway store instances
BEFORE any live store is touched, so a rejected import (invalid schema, or a cyclic
dependency set — which the pure `importJson()` deliberately does not detect) leaves the live
instance's tasks, dependencies, undo/redo history, and selection completely unchanged. On
success, both undo/redo stacks are cleared (import is not itself undoable, same precedent as
construction-time `config.tasks`/`config.dependencies` seeding), the selection is cleared,
and exactly one `data:imported` event fires — never a `task:added`/`dependency:added` storm.
Not gated by `readOnly` (matches every other programmatic mutation method). Both methods
return an `ImportSummary` (`{ format, taskCount, dependencyCount }`), the same value emitted
by `data:imported`; `importCsv`'s `dependencyCount` is always `0` (CSV has no dependency
concept).
