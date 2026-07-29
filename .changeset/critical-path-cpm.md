---
"@fluxgantt/core": minor
---

feat(core): critical path (CPM) compute layer

Add `computeCriticalPath(tasks, dependencies, calendar, options?)` — a headless,
pure-function forward/backward pass (ES/EF/LS/LF/slack) over FS/SS/FF/SF dependencies
with lag/lead, honoring the working calendar. Detects cycles via Kahn's algorithm and
throws `CyclicDependencyError` (`.taskIds`). Core schedules ASAP only; `task.constraint`
is inert and never read — constraint resolution is exposed as a Pro-tier seam via
`ComputeCriticalPathOptions.resolveConstraint`. Also exports `TaskSchedule` and
`CriticalPathResult` types for the render layer.
