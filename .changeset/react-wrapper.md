---
"@fluxgantt/react": minor
---

feat(react): add the `@fluxgantt/react` wrapper

New package: an idiomatic React wrapper for `@fluxgantt/core`'s `createGantt()` facade.

- `<FluxGantt>` — the primary component (forwardRef; the `ref` exposes the full
  `GanttInstance`). Renders a container `<div>` and mounts the chart into it.
- `useFluxGantt(config)` — the lower-layer hook `<FluxGantt>` wraps, returning
  `{ ref, instance }`.
- Discrete callback props, one per core event: `onTaskAdded`/`onTaskMoved`/`onTaskResized`/
  `onTaskProgressed`/`onTaskRemoved`/`onDependencyAdded`/`onDependencyRemoved`/
  `onCriticalPathComputed`. `onTaskChange` passes straight through to `GanttConfig`.

Uncontrolled-first: `tasks`/`dependencies` (and `calendar`/`viewMode`/`density`/`locale`/
`readOnly`) are read once at construction — the `GanttInstance` is the source of truth
afterwards; mutate via the instance/ref. StrictMode-safe (instance created once via lazy
ref; the mount effect's cleanup calls `unmount()`, never `destroy()`). React
`^18.2.0 || ^19.0.0` peer (via `forwardRef`). Ships a `"use client"` banner for Next.js App
Router. Invalid initial config re-throws with an `@fluxgantt/react`-tagged message.

`viewMode`/`density`/`locale`/`readOnly`/`calendar` are construction-only in v1 (the facade
has no setters yet) — use a `key`-remount to change them. Not in v1: controlled task syncing,
SSR/RSC, `@fluxgantt/vue`.
