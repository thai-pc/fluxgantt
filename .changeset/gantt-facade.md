---
"@fluxgantt/core": minor
---

feat(core): public facade `createGantt()` / `GanttInstance`

Add the top-level API `createGantt(config)` — the single front door of `@fluxgantt/core`.
It privately owns a `TaskStore` + `DependencyStore` (composed from the config data),
exposes task ops (`addTask`/`updateTask`/`removeTask`/`moveTask`/`resizeTask`/`setProgress`/
`getTask`/`getTasks`/`findTasks`), dependency ops (`linkTasks`/`unlinkTasks`/
`getDependencies`/`getDependenciesOf`), `computeCriticalPath()`, a typed event bus
`on(event, cb): UnsubscribeFn` (`task:added/moved/resized/progressed/removed`,
`dependency:added/removed`, `critical-path:computed`), and lifecycle
`mount`/`unmount`/`destroy`/`refresh`.

The instance is fully headless until `.mount(container)` — mutations, compute, and the
event bus all work with no DOM. `mount()` wires a reactive `effect()` (store revision →
re-render + critical-path recompute) and drag-move (a drag commit flows through the same
mutation pipeline as `moveTask`, so it emits the identical `task:moved` contract). `unmount()`
detaches rendering but keeps state + subscriptions (remountable); `destroy()` tears
everything down.

Known gap (tracked, prerequisite before 1.0): no cascade — `moveTask`/`resizeTask` affect
only the named task; dependents are not auto-shifted yet (spec §7.2 default). Not in v1:
viewport/selection/IO/baselines/resources/AI methods, and the React/Vue wrappers.
