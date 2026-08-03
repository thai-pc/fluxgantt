// `useFluxGantt` — the lower-layer hook `<FluxGantt>` wraps (spec-react-wrapper.md §3, §6).
//
// UNCONTROLLED-FIRST (resolution #1): `tasks`/`dependencies`/`calendar`/`viewMode`/`density`/
// `locale`/`readOnly` are read ONCE, at construction. `GanttInstance` is the source of truth
// afterwards — no prop→store diffing. `onTaskChange` is the one config field that stays
// reactive (routed through `configRef`).
//
// STRICTMODE (resolution #2, §10): the instance is created once via lazy `useRef`
// initialization (survives the dev-only double *render*). The mount effect's cleanup calls
// `instance.unmount()`, NEVER `instance.destroy()` — `mount()` is a permanent no-op after
// `destroy()`, and React has no reliable signal to distinguish StrictMode's throwaway unmount
// from a real final one. `destroy()` remains available on the returned `instance` for a
// consumer who wants to explicitly hard-close it.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createGantt } from '@fluxgantt/core';
import type { GanttInstance } from '@fluxgantt/core';
import type { UseFluxGanttConfig, UseFluxGanttResult } from './types.js';

// Minimal ambient declaration for `process.env.NODE_ENV` — this package intentionally has no
// `@types/node` dependency (no other Node API is used; keeps devDependencies lean per
// architecture.md principle 4). Bundlers (webpack/Next.js/Vite) statically replace this
// expression at build time regardless of these types; the `typeof process !== 'undefined'`
// guard below covers runtimes where the global is genuinely absent (e.g. an unbundled
// `<script type="module">` load).
declare const process: { readonly env?: { readonly NODE_ENV?: string } } | undefined;

export function useFluxGantt(config: UseFluxGanttConfig): UseFluxGanttResult {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Always-latest callbacks, read only from inside event listeners/effects — never during
  // render. Assigning a ref during render (not reading it) is a well-established, side-effect-
  // free pattern; avoids re-subscribing `instance.on(...)` every time an inline arrow prop
  // changes identity.
  const configRef = useRef(config);
  configRef.current = config;

  // Lazy ref-initialization (React's own sanctioned pattern for constructing a non-React,
  // stateful object exactly once). Survives StrictMode's dev-only double *render* because the
  // ref persists across both synchronous render calls of the same commit; the `=== null` guard
  // makes the second call a no-op.
  const instanceRef = useRef<GanttInstance | null>(null);
  if (instanceRef.current === null) {
    // Reads `config` HERE ONLY — this block runs exactly once, so `tasks`/`dependencies`/
    // `calendar`/`viewMode`/`density`/`locale`/`readOnly` are frozen at whatever the FIRST
    // render passed (resolution #1: construction-time only). `onTaskChange` is the one field
    // that stays reactive, via the `configRef` indirection.
    //
    // Each optional field is included only when actually set — `GanttConfig` has
    // `exactOptionalPropertyTypes: true`, so writing an explicit `undefined` to an optional
    // property that isn't itself typed `X | undefined` is a compile error, not just redundant
    // (mirrors `gantt.ts`'s own `#rendererOptions()` pattern).
    try {
      instanceRef.current = createGantt({
        ...(config.tasks !== undefined ? { tasks: config.tasks } : {}),
        ...(config.dependencies !== undefined ? { dependencies: config.dependencies } : {}),
        ...(config.calendar !== undefined ? { calendar: config.calendar } : {}),
        ...(config.viewMode !== undefined ? { viewMode: config.viewMode } : {}),
        ...(config.density !== undefined ? { density: config.density } : {}),
        ...(config.locale !== undefined ? { locale: config.locale } : {}),
        ...(config.readOnly !== undefined ? { readOnly: config.readOnly } : {}),
        onTaskChange: (task, prev) => configRef.current.onTaskChange?.(task, prev),
      });
    } catch (err) {
      // `createGantt` constructs the stores synchronously and throws on invalid INITIAL data
      // (a duplicate task id, or a self/duplicate/cyclic initial dependency). Because this
      // runs in React's render phase, that raw error would surface with no hint it came from
      // the initial `tasks`/`dependencies` props. Re-throw with that context so the consumer
      // (or their error boundary) sees an actionable message. Still fail-fast — the instance
      // must exist synchronously for the hook's contract (returned `instance` + `ref`), so we
      // do not swallow or defer. Fix bad initial config, or pre-validate before rendering.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[@fluxgantt/react] invalid initial config passed to useFluxGantt/<FluxGantt>: ${message}`,
        err instanceof Error ? { cause: err } : undefined,
      );
    }
  }
  const instance = instanceRef.current;

  // Dev-only: warn if `tasks`/`dependencies` prop identity changes after construction — the
  // uncontrolled contract (resolution #1) makes this a silent no-op otherwise. `useRef(x)`'s
  // initial argument is used ONLY on the first render, so these naturally capture the
  // construction-time arrays without extra guarding.
  const initialTasksRef = useRef(config.tasks);
  const initialDependenciesRef = useRef(config.dependencies);
  useEffect(() => {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return;
    if (config.tasks !== initialTasksRef.current) {
      console.warn(
        '[@fluxgantt/react] useFluxGantt: `tasks` changed identity after the instance was ' +
          'created. `tasks` is only used as the initial value (uncontrolled) — further changes ' +
          'are ignored. Mutate via the returned `instance` (`addTask`/`updateTask`/`removeTask`) ' +
          'instead.',
      );
    }
    if (config.dependencies !== initialDependenciesRef.current) {
      console.warn(
        '[@fluxgantt/react] useFluxGantt: `dependencies` changed identity after the instance ' +
          'was created. Same uncontrolled contract as `tasks` — use `linkTasks`/`unlinkTasks`.',
      );
    }
  }, [config.tasks, config.dependencies]);

  // Mount/subscribe/unmount lifecycle — ONE effect. `useLayoutEffect` (not `useEffect`) avoids
  // a one-frame flash of an empty container before the SVG paints, standard for wrapping
  // imperative rendering libraries.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return; // container div is always rendered unconditionally by the consumer in
    // the same render — should not happen in practice.

    instance.mount(node);

    const unsubs = [
      instance.on('task:added', (task) => configRef.current.onTaskAdded?.(task)),
      instance.on('task:moved', (task, prevStart) => configRef.current.onTaskMoved?.(task, prevStart)),
      instance.on('task:resized', (task, prevDuration) =>
        configRef.current.onTaskResized?.(task, prevDuration),
      ),
      instance.on('task:progressed', (task, prevProgress) =>
        configRef.current.onTaskProgressed?.(task, prevProgress),
      ),
      instance.on('task:removed', (taskId) => configRef.current.onTaskRemoved?.(taskId)),
      instance.on('dependency:added', (dep) => configRef.current.onDependencyAdded?.(dep)),
      instance.on('dependency:removed', (depId) => configRef.current.onDependencyRemoved?.(depId)),
      instance.on('critical-path:computed', (ids) => configRef.current.onCriticalPathComputed?.(ids)),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
      instance.unmount(); // NOT destroy() — see the module doc-comment above.
    };
  }, [instance]);

  return { ref: containerRef, instance };
}
