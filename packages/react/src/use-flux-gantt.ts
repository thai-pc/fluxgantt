// `useFluxGantt` — the lower-layer hook `<FluxGantt>` wraps (spec-react-wrapper.md §3, §6).
//
// UNCONTROLLED-FIRST (resolution #1): every `GanttConfig` field is read ONCE, at construction,
// except two that stay reactive: `onTaskChange` (routed through `configRef`) and `theme`
// (synced via `instance.setTheme`). `GanttInstance` is the source of truth afterwards — no
// prop→store diffing. `gantt-config.ts` lists the disposition of every field.
//
// STRICTMODE (resolution #2, §10): the instance is created once via lazy `useRef`
// initialization (survives the dev-only double *render*). The mount effect's cleanup calls
// `instance.unmount()`, NEVER `instance.destroy()` — `mount()` is a permanent no-op after
// `destroy()`, and React has no reliable signal to distinguish StrictMode's throwaway unmount
// from a real final one. `destroy()` remains available on the returned `instance` for a
// consumer who wants to explicitly hard-close it.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createGantt } from '@fluxgantt/core';
import { withRender, type RenderCapability } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withEditHooks } from '@fluxgantt/core/edit-hooks';
import { withViewport, type ViewportCapability } from '@fluxgantt/core/viewport';
import { withTheme, type ThemeCapability } from '@fluxgantt/core/theme';
import type { GanttInstance } from '@fluxgantt/core';
import { pickConstructionConfig, syncTheme } from './gantt-config.js';
import type { UseFluxGanttConfig, UseFluxGanttResult } from './types.js';

// Minimal ambient declaration for `process.env.NODE_ENV` — this package intentionally has no
// `@types/node` dependency (no other Node API is used; keeps devDependencies lean per
// architecture.md principle 4). Bundlers (webpack/Next.js/Vite) statically replace this
// expression at build time regardless of these types; the `typeof process !== 'undefined'`
// guard below covers runtimes where the global is genuinely absent (e.g. an unbundled
// `<script type="module">` load).
declare const process: { readonly env?: { readonly NODE_ENV?: string } } | undefined;

// `useLayoutEffect` warns when rendered on the server (React 18); effects never run there
// anyway, so fall back to `useEffect` where there is no `window`.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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
  const instanceRef = useRef<
    (GanttInstance & RenderCapability & ViewportCapability & ThemeCapability) | null
  >(null);
  if (instanceRef.current === null) {
    // Reads `config` HERE ONLY — this block runs exactly once, so every field except
    // `onTaskChange` and `theme` is frozen at whatever the FIRST render passed (resolution #1).
    // `onTaskChange` stays reactive via the `configRef` indirection, `theme` via the effect
    // below. `pickConstructionConfig` copies only fields that are actually set (see
    // `gantt-config.ts`), so core defaults apply to the rest.
    try {
      // `mount()`/`unmount()` and the drag/keyboard/click gestures are opt-in mixins on the
      // core's `/render` and `/interaction` subpaths since the facade split — a wrapper
      // component is by definition a rendering, interactive consumer, so it composes both
      // unconditionally, plus `/viewport` (scrollToTask/scrollToDate/setDensity — a chart UI always
      // wants them) and `/theme` (setTheme/getTheme/getResolvedTheme; the `theme` prop needs it). IO (`/io`) is deliberately NOT composed: the wrapper exposes no
      // import/export surface, so a consumer who never calls it never downloads it.
      instanceRef.current = withTheme(
        withViewport(
          withEditHooks(
            withInteraction(
              withRender(
                createGantt({
                  ...pickConstructionConfig(config),
                  // Always constructed light: `withTheme` arms an OS `matchMedia` listener for
                  // 'auto', and the instance is created during RENDER, where StrictMode / an
                  // abandoned concurrent render can discard it with no cleanup. The real theme
                  // is applied in the layout effect below (and disarmed on teardown). Unset
                  // means 'light' here, not core's 'auto', because wrapper charts have always
                  // been light; hosts opt into OS-following with `theme="auto"`.
                  theme: 'light',
                  onTaskChange: (task, prev) => configRef.current.onTaskChange?.(task, prev),
                }),
              ),
            ),
          ),
        ),
      );
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

  // `theme` is runtime-reactive (a dark-mode toggle is the main use case). A layout effect so a
  // non-discrete update does not paint one frame of the old theme. `setTheme` no-ops when the
  // value is unchanged. Declared BEFORE the mount effect so the theme is set before `mount()`.
  useIsomorphicLayoutEffect(() => {
    syncTheme(instance, config.theme ?? 'light');
    // Disarm on teardown: `theme="auto"` registered a `matchMedia` listener that would otherwise
    // retain the whole instance (the wrapper unmounts, never destroys). Re-armed by the next run
    // of this effect (a theme change, or StrictMode's simulated remount).
    return () => syncTheme(instance, 'light');
  }, [instance, config.theme]);

  // Mount/subscribe/unmount lifecycle — ONE effect. `useLayoutEffect` (not `useEffect`) avoids
  // a one-frame flash of an empty container before the SVG paints, standard for wrapping
  // imperative rendering libraries.
  useIsomorphicLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return; // container div is always rendered unconditionally by the consumer in
    // the same render — should not happen in practice.

    // Subscribe BEFORE mount(): mount() runs the renderer's reactive effect synchronously,
    // which emits the INITIAL `critical-path:computed` for any initial tasks. Subscribing
    // first ensures that first emit is delivered to `onCriticalPathComputed` (on() works
    // headless, pre-mount).
    const unsubs = [
      instance.on('task:added', (task) => configRef.current.onTaskAdded?.(task)),
      instance.on('task:moved', (task, prevStart) =>
        configRef.current.onTaskMoved?.(task, prevStart),
      ),
      instance.on('task:resized', (task, prevDuration) =>
        configRef.current.onTaskResized?.(task, prevDuration),
      ),
      instance.on('task:progressed', (task, prevProgress) =>
        configRef.current.onTaskProgressed?.(task, prevProgress),
      ),
      instance.on('task:removed', (taskId) => configRef.current.onTaskRemoved?.(taskId)),
      instance.on('dependency:added', (dep) => configRef.current.onDependencyAdded?.(dep)),
      instance.on('dependency:removed', (depId) => configRef.current.onDependencyRemoved?.(depId)),
      instance.on('critical-path:computed', (ids) =>
        configRef.current.onCriticalPathComputed?.(ids),
      ),
      instance.on('task:activated', (payload) => configRef.current.onTaskActivated?.(payload)),
      instance.on('task:context-requested', (payload) =>
        configRef.current.onTaskContextRequested?.(payload),
      ),
    ];

    instance.mount(node);

    return () => {
      for (const unsub of unsubs) unsub();
      instance.unmount(); // NOT destroy() — see the module doc-comment above.
    };
  }, [instance]);

  return { ref: containerRef, instance };
}
