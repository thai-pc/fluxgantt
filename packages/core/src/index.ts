// @fluxgantt/core — public entry (spec §7)

export const VERSION = '0.0.0';

// Public facade (spec §7)
export { createGantt } from './gantt.js';
export type {
  GanttConfig,
  GanttInstance,
  GanttEventMap,
  GanttEventName,
  UnsubscribeFn,
  DependencyInput,
  EventMeta,
  ImportSummary,
  ViewportChangedPayload,
  RendererSelectedPayload,
} from './gantt.js';

// Reactive primitives (spec §4.1, §5.2)
export { signal, computed, effect, batch, untracked, Signal } from './signals.js';
export type { ReadonlySignal } from './signals.js';

// State layer (spec §5.1)
export { TaskStore, DependencyStore, SelectionStore, CollapseStore } from './store/index.js';
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
export { computeCascade } from './compute/index.js';
export type { CascadeResult, CascadeShift } from './compute/index.js';
export { computeRollup } from './compute/index.js';
export type { RollupResult } from './compute/index.js';

// Render + interaction layers — NOT re-exported here (spec-facade-split.md §3.4). Both are
// opt-in capability subpaths now: re-exporting `createSvgRenderer`/`enableDragMove`/... from this
// barrel would keep their whole graph statically reachable from the main entry, so every
// `createGantt()`-only consumer — including a headless one — would pay for the renderer and all
// six interaction recognizers whether or not they ever mount. Import from the subpaths instead:
//   import { withRender, createSvgRenderer, CANVAS_AUTO_SWITCH_THRESHOLD } from '@fluxgantt/core/render';
//   import { withInteraction, enableDragMove } from '@fluxgantt/core/interaction';

// IO layer (spec §7.8, security.md §2) — NOT re-exported here (spec-facade-split.md §3.4).
// Re-exporting `exportJson`/`importCsv`/`exportPng`/... from this barrel would keep the whole
// `io/*` graph statically reachable from the main entry, so every `createGantt()`-only consumer
// would pay for it whether or not they import it. Import from the subpath instead:
//   import { withIo, exportJson, IoValidationError } from '@fluxgantt/core/io';

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
  RolledUpSpan,
  RolledUpRow,
  RollupProvider,
  GanttMessages,
  TaskLabelParams,
  ViewMode,
  Density,
  SchedulingMode,
} from './types.js';
