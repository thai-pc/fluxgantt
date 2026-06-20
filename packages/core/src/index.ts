// @fluxgantt/core — public entry (spec §7)
// Stub Wave 1: API surface sẽ mở rộng (createGantt, mount, on, ...).

export const VERSION = '0.0.0';

// ID coercion helpers (spec §6.1)
export {
  toTaskId,
  toResourceId,
  toDependencyId,
  toBaselineId,
  toProjectId,
} from './types.js';

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
