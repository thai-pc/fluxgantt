// `useFluxGantt` — the lower-layer composable `<FluxGantt>` wraps (resolution #1, #2, #5).
//
// A Vue composable's body runs EXACTLY ONCE per owning component instance — `setup()` itself
// only runs once; Vue does not re-invoke it on every reactive update the way React re-invokes
// a hook on every render. This is a load-bearing difference from `@fluxgantt/react`:
//   - No lazy-`useRef`-guard pattern is needed to construct the `GanttInstance` "only once" —
//     this function's top-level `createGantt(...)` call already runs exactly once by
//     construction. `tasks`/`dependencies`/`calendar`/`viewMode`/`density`/`locale`/`readOnly`
//     are naturally construction-time-only (resolution #5) as a side effect of this, not
//     something the composable has to defend against re-running.
//   - No `configRef.current = config` "always latest" indirection is needed either. `config`
//     is expected to be a STABLE, LIVE object reference for the composable's whole lifetime —
//     in practice, `<FluxGantt>` passes its own reactive `props` object straight through
//     (never destructured/spread first). Reading `config.onTaskChange` INSIDE a listener
//     closure, at call time, always observes whatever value that property currently holds —
//     true for a Vue reactive proxy (`props`) AND for any plain mutable object, because this
//     is just normal JS property access, not a snapshot. React needs `configRef` only because
//     React hands the hook a BRAND NEW `config` object on every render; Vue never does that.
//
// This composable registers `onMounted`/`onBeforeUnmount` INTERNALLY (parity with react, which
// puts its mount/unmount effect inside the hook, not the component) and calls
// `instance.mount()`/`instance.unmount()` there — NEVER `instance.destroy()` (same rationale
// as react: `gantt.ts`'s `mount()` is a permanent no-op after `destroy()`; nothing about this
// package's lifecycle should risk that). `<FluxGantt>` (the component) registers its OWN,
// SEPARATE `onMounted`/`onBeforeUnmount` pair for the 8 event→emit bridges, because `emit` only
// exists inside a component's `setup()` context — a freestanding composable has no `emit` to
// call. See `FluxGantt.ts` and §6 for how the two hook pairs interleave safely.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createGantt } from '@fluxgantt/core';
import type { GanttInstance } from '@fluxgantt/core';
import type { UseFluxGanttConfig, UseFluxGanttResult } from './types.js';

// Minimal ambient declaration for `process.env.NODE_ENV`, mirroring react's own — this
// package intentionally has no `@types/node` dependency. See use-flux-gantt.ts in
// packages/react for the identical pattern/rationale.
declare const process: { readonly env?: { readonly NODE_ENV?: string } } | undefined;

export function useFluxGantt(config: UseFluxGanttConfig): UseFluxGanttResult {
  const containerRef = ref<HTMLDivElement | null>(null);

  let instance: GanttInstance;
  try {
    // `exactOptionalPropertyTypes` — only include a key when actually set, same pattern
    // `gantt.ts`'s own `#rendererOptions()` and react's `use-flux-gantt.ts` use.
    instance = createGantt({
      ...(config.tasks !== undefined ? { tasks: config.tasks } : {}),
      ...(config.dependencies !== undefined ? { dependencies: config.dependencies } : {}),
      ...(config.calendar !== undefined ? { calendar: config.calendar } : {}),
      ...(config.viewMode !== undefined ? { viewMode: config.viewMode } : {}),
      ...(config.density !== undefined ? { density: config.density } : {}),
      ...(config.locale !== undefined ? { locale: config.locale } : {}),
      ...(config.readOnly !== undefined ? { readOnly: config.readOnly } : {}),
      onTaskChange: (task, prev) => config.onTaskChange?.(task, prev),
    });
  } catch (err) {
    // Same re-throw-with-context contract as react (invalid INITIAL tasks/dependencies —
    // duplicate id, self/duplicate/cyclic link — throws synchronously from `createGantt`).
    // This runs inside `setup()`, so the raw error would otherwise surface with no hint it
    // came from `<FluxGantt>`'s initial props.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[@fluxgantt/vue] invalid initial config passed to useFluxGantt/<FluxGantt>: ${message}`,
      err instanceof Error ? { cause: err } : undefined,
    );
  }

  // Dev-only: warn if `tasks`/`dependencies` change identity after construction. Implemented
  // via `watch` (not a manual ref+effect diff like react) because `config` is expected to be
  // reactive (the component's `props` object) — `watch(() => config.tasks, ...)` only ever
  // fires on an actual identity change AFTER setup (never on the initial value, matching
  // `watch`'s default `immediate: false`), so no extra "was this the first call?" guard is
  // needed the way react's `initialTasksRef` comparison needs one. A plain, non-reactive
  // `config` object simply never triggers this watcher — consistent with "nothing to warn
  // about," since Vue has no way to observe a mutation on a non-reactive object regardless.
  if (!(typeof process !== 'undefined' && process.env?.NODE_ENV === 'production')) {
    watch(
      () => config.tasks,
      () => {
        console.warn(
          '[@fluxgantt/vue] useFluxGantt: `tasks` changed identity after the instance was ' +
            'created. `tasks` is only used as the initial value (uncontrolled) — further ' +
            'changes are ignored. Mutate via the returned `instance` (`addTask`/`updateTask`/' +
            '`removeTask`) instead.',
        );
      },
    );
    watch(
      () => config.dependencies,
      () => {
        console.warn(
          '[@fluxgantt/vue] useFluxGantt: `dependencies` changed identity after the instance ' +
            'was created. Same uncontrolled contract as `tasks` — use `linkTasks`/`unlinkTasks`.',
        );
      },
    );
  }

  // Mount/unmount lifecycle only — NOT the 8 event bridges (those live in `<FluxGantt>`
  // itself, see the module doc-comment above and §6).
  onMounted(() => {
    const node = containerRef.value;
    if (!node) return; // container div is always rendered unconditionally by the render
    // function in the same setup() — should not happen in practice.
    instance.mount(node);
  });

  onBeforeUnmount(() => {
    instance.unmount(); // NOT destroy() — see module doc-comment above.
  });

  return { containerRef, instance };
}
