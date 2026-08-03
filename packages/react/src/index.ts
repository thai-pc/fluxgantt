// @fluxgantt/react — public entry (spec-react-wrapper.md §5).
export { FluxGantt } from './FluxGantt.js';
export { useFluxGantt } from './use-flux-gantt.js';
export type { FluxGanttProps, FluxGanttRef, UseFluxGanttConfig, UseFluxGanttResult } from './types.js';

// Re-exported from @fluxgantt/core: exactly the entity types FluxGanttProps/UseFluxGanttConfig/
// UseFluxGanttResult reference, or that a consumer needs to type `instance.addTask(...)`
// call sites. NOT re-exporting render/interaction/compute internals — that stays
// @fluxgantt/core's job (mirrors how core's own index.ts scopes its render-layer exports).
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
  DateInput,
  ViewMode,
  Density,
  WorkingCalendar,
} from '@fluxgantt/core';
