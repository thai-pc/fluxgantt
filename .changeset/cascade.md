---
"@fluxgantt/core": minor
---

feat(core): cascade scheduling (opt-in `schedulingMode: 'auto'`)

Add `computeCascade(tasks, dependencies, calendar, changedTaskIds)` — a headless, pure
function that, when a task moves/resizes, computes which transitive successors must shift
LATER to keep their FS/SS/FF/SF (+lag) relationship satisfied, respecting the working
calendar. Push-only (never pulls a successor earlier), forward, downstream; the
directly-changed task is authoritative and never re-derived.

Wired into the facade opt-in via `GanttConfig.schedulingMode?: 'manual' | 'auto'`
(**default `'manual'` — no behavior change**). When `'auto'`, `moveTask`/`resizeTask`/an
`updateTask` that touches start/end/duration, and a drag commit, cascade their dependents,
emitting `task:moved` for every shifted task. This closes the documented spec §7.2 gap as an
opt-in (a later deliberate version bump can flip the default).

`task.constraint` stays inert here (consistent with `computeCriticalPath`, a Pro seam).
Internally, the shared FS/SS/FF/SF earliest-start math + topological sort were extracted to
`compute/dependency-math.ts` and are now shared by critical-path and cascade (a
behavior-preserving refactor — the CPM test suite is unchanged and green).
