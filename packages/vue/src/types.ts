// Public prop/emit/config/result types for @fluxgantt/vue (spec-vue-wrapper.md §2).
import type { Ref } from 'vue';
import type {
  DateInput,
  Dependency,
  DependencyId,
  DependencyInput,
  Density,
  GanttConfig,
  GanttInstance,
  Task,
  TaskId,
  TaskInput,
  ViewMode,
  WorkingCalendar,
} from '@fluxgantt/core';

/**
 * Config accepted by `useFluxGantt` — identical shape to `GanttConfig`, no additions.
 *
 * Unlike react's `UseFluxGanttConfig`, this does NOT add discrete `onX` callback fields for
 * the 8 `GanttEventMap` events (resolution #1: Vue's idiom for that is `defineEmits`/template
 * `@x` listeners, wired by `<FluxGantt>` itself — see `FluxGantt.ts` — NOT a composable-level
 * config field, since `emit` only exists inside a component's `setup()` context, not inside a
 * freestanding composable). `onTaskChange` is inherited unchanged from `GanttConfig` — the
 * facade's own "any field changed" catch-all, a different layer, same as react.
 */
export type UseFluxGanttConfig = GanttConfig;

export interface UseFluxGanttResult {
  /** Template ref target for the container element that should host the rendered chart.
   *  Bind it via `h('div', { ref: containerRef })` or, in a consuming SFC template,
   *  `<div ref="containerRef">`. Vue's own template-ref idiom (`ref<T | null>(null)`) — a
   *  DOM node assigned to a `ref()` is NOT deep-reactive-proxied (Vue's reactivity system
   *  treats DOM nodes as an invalid `reactive()` target and stores them raw), so plain
   *  `ref()` is correct here, not `shallowRef()`. */
  readonly containerRef: Ref<HTMLDivElement | null>;
  /** The full `GanttInstance` (resolution #2 — no curated subset, full parity with react's
   *  resolution #6). Stable reference for the composable's lifetime — created exactly once,
   *  because a Vue composable's body runs exactly once per owning component instance
   *  (`setup()` itself only runs once; Vue does not re-invoke it the way React re-invokes a
   *  hook on every render) — see `use-flux-gantt.ts`'s module doc-comment. */
  readonly instance: GanttInstance;
}

/**
 * Runtime `props` shape for `<FluxGantt>` — mirrors `GanttConfig` one-to-one.
 *
 * Deliberately has NO `class`/`style` field. `<FluxGantt>` renders a single root `<div>`, so
 * Vue's default attribute fallthrough (`inheritAttrs: true`, the default — not overridden)
 * automatically merges any `class`/`style` a consumer writes
 * (`<FluxGantt class="my-class" style="height: 600px">`) onto that root element, concatenated
 * with the component's own static `fg-gantt` class. Declaring `class`/`style` as explicit
 * props would instead PULL them out of `$attrs`, breaking that automatic merge for no
 * benefit — the opposite of react, where `className`/`style` MUST be explicit props because
 * React has no attribute-fallthrough mechanism at all.
 */
export type FluxGanttProps = GanttConfig;

/**
 * The 8 discrete typed emits — one per existing `GanttEventMap` event (resolution #1).
 *
 * Declared as a plain call-signature interface, NOT via `defineEmits<T>()` — that's a
 * `<script setup>`-only compiler macro, unavailable to this package's plain-`.ts`
 * `defineComponent` + render-function component (resolution #4 forecloses SFC compilation).
 * This interface documents the same information `defineEmits<T>()` would have encoded, and
 * types `setup()`'s `emit` parameter (see `FluxGantt.ts`). A consuming SFC's `<FluxGantt
 * @task-moved="...">` is still fully type-checked by `vue-tsc`/the Volar language service
 * from the CONSUMER side — losing the macro costs us (the wrapper authors) a little
 * hand-written duplication (see §9), not consumers anything.
 */
export interface FluxGanttEmits {
  (event: 'task-added', task: Task): void;
  /** `prevStart` is `DateInput`, not a plain `Date` — matches `GanttEventMap['task:moved']`. */
  (event: 'task-moved', task: Task, prevStart: DateInput): void;
  (event: 'task-resized', task: Task, prevDuration: number): void;
  (event: 'task-progressed', task: Task, prevProgress: number): void;
  (event: 'task-removed', taskId: TaskId): void;
  (event: 'dependency-added', dependency: Dependency): void;
  (event: 'dependency-removed', dependencyId: DependencyId): void;
  (event: 'critical-path-computed', criticalTaskIds: readonly TaskId[]): void;
}

/** Type of the value `<FluxGantt ref="...">` exposes via `setup()`'s `expose()`. */
export type FluxGanttRef = GanttInstance;

// Re-exported for FluxGantt.ts's `PropType<T>` casts (kept here, not inlined, so the prop
// declaration and this file's own type surface stay adjacent and easy to audit together).
export type { TaskInput, DependencyInput, ViewMode, Density, WorkingCalendar };
