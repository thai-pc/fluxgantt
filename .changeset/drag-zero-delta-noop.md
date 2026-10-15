---
'@fluxgantt/core': patch
---

A drag-move shorter than half a day (it snaps to a zero-day delta) no longer rewrites the task. Before, it re-stored the start as a `ZonedDateTime` of the same instant without emitting `task:moved`; now it commits nothing (no store write, no history entry).
