---
"@fluxgantt/vue": minor
---

feat(vue): add the `@fluxgantt/vue` wrapper

New package: an idiomatic Vue 3 wrapper for `@fluxgantt/core`'s `createGantt()` facade.

- `<FluxGantt>` — the primary component (a `defineComponent` + render function in plain `.ts`,
  deliberately not a `.vue` SFC; consumers still use it from ordinary SFC templates). Renders a
  container `<div>` and mounts the chart into it. `expose()`s the full `GanttInstance` via a
  template ref (pre-bound so it survives Vue's expose-proxy `this`-rebinding vs core's private
  fields).
- `useFluxGantt(config)` — the lower-layer composable it wraps, returning `{ containerRef, instance }`.
- Eight discrete typed emits, one per core event: `@task-added`/`@task-moved`/`@task-resized`/
  `@task-progressed`/`@task-removed`/`@dependency-added`/`@dependency-removed`/
  `@critical-path-computed`. `onTaskChange` stays a config prop passed to `GanttConfig`.

Uncontrolled-first (tasks/dependencies read once at construction; the instance is the source of
truth afterwards). `unmount()` on teardown, never `destroy()`. `vue: ^3.4.0` peer, Vue 3 only.
Built with tsup + `tsc` (no SFC toolchain, no `vue-tsc`). Invalid initial config re-throws with
an `@fluxgantt/vue`-tagged message. `viewMode`/`density`/`locale`/`readOnly`/`calendar` are
construction-only (use `:key`-remount to change); the component is client-only (wrap in
`<ClientOnly>` under Nuxt). Not in v1: controlled task syncing, SSR, Svelte/Angular.
