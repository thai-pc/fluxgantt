// @fluxgantt/core — public entry (spec §7)
// Stub Wave 1: API surface sẽ mở rộng (createGantt, mount, on, ...).

export const VERSION = '0.0.0';

// Reactive primitives (spec §4.1, §5.2)
export { signal, computed, effect, batch, untracked, Signal } from './signals.js';
export type { ReadonlySignal } from './signals.js';

// State layer (spec §5.1)
export { TaskStore } from './store/index.js';
export type { TaskInput, TaskPatch } from './store/index.js';

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
} from './types.js';
