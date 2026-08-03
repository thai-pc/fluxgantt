// @fluxgantt/vue — public entry (spec-vue-wrapper.md §5).
export { FluxGantt } from './FluxGantt.js';
export { useFluxGantt } from './use-flux-gantt.js';
export type {
  FluxGanttProps,
  FluxGanttEmits,
  FluxGanttRef,
  UseFluxGanttConfig,
  UseFluxGanttResult,
} from './types.js';

// Re-exported from @fluxgantt/core — exactly the entity types this package's own types
// reference, or that a consumer needs to type `instance.addTask(...)` call sites reached via
// the exposed `GanttInstance`. NOT re-exporting render/interaction/compute internals — same
// scoping react's own index.ts uses.
export type {
  GanttInstance,
  GanttConfig,
  GanttEventMap,
  GanttEventName,
  UnsubscribeFn,
  Task,
  TaskId,
  TaskInput,
  TaskPatch,
  Dependency,
  DependencyId,
  DependencyInput,
  DateInput,
  ViewMode,
  Density,
  WorkingCalendar,
} from '@fluxgantt/core';
