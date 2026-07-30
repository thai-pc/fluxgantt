// @fluxgantt/core — public entry (spec §7)
// Stub Wave 1: the API surface will grow (createGantt, mount, on, ...).

export const VERSION = '0.0.0';

// Reactive primitives (spec §4.1, §5.2)
export { signal, computed, effect, batch, untracked, Signal } from './signals.js';
export type { ReadonlySignal } from './signals.js';

// State layer (spec §5.1)
export { TaskStore, DependencyStore } from './store/index.js';
export type { TaskInput, TaskPatch, LinkOptions } from './store/index.js';

// Compute layer (spec §5.1, §13)
export {
  DEFAULT_CALENDAR,
  normalizeDate,
  isWorkingDay,
  isHoliday,
  addWorkingHours,
  subtractWorkingHours,
  differenceInWorkingHours,
  computeCriticalPath,
  CyclicDependencyError,
} from './compute/index.js';
export type {
  ComputeCriticalPathOptions,
  ConstraintResolver,
  ConstraintResolverContext,
} from './compute/index.js';

// Render layer (spec §5.1, §8) — SVG renderer public surface only. Layout-math
// internals (`renderer-base.ts`: TimeScale/RowLayout/layoutRows/...) are NOT re-exported
// here — implementation detail for the Canvas renderer/interaction layer/tests, imported
// directly from `render/index.js` (see spec-svg-renderer.md §1.3).
export { createSvgRenderer } from './render/index.js';
export type { SvgRendererInput, SvgRendererOptions, SvgRendererHandle } from './render/index.js';

// Interaction layer (spec §8.4, spec-drag-move.md)
export { enableDragMove } from './interaction/index.js';
export type { DragMoveOptions } from './interaction/index.js';

// ID coercion helpers (spec §6.1)
export { toTaskId, toResourceId, toDependencyId, toBaselineId, toProjectId } from './types.js';

export type {
  Brand,
  TaskId,
  ResourceId,
  DependencyId,
  BaselineId,
  ProjectId,
  DateInput,
  DependencyType,
  TaskKind,
  TaskConstraint,
  ResourceAssignment,
  Task,
  Dependency,
  WeekdayCode,
  WorkingHours,
  WorkingCalendar,
  TaskSchedule,
  CriticalPathResult,
  ViewMode,
  Density,
} from './types.js';
