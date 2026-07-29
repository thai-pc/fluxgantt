// Core type system (spec §6). Branded IDs + DateInput normalized to Temporal internally.
import type { Temporal } from '@js-temporal/polyfill';

// Branded ID types — prevent mixing up IDs at compile time (spec §6.1)
export type Brand<T, B> = T & { readonly __brand: B };

export type TaskId = Brand<string, 'TaskId'>;
export type ResourceId = Brand<string, 'ResourceId'>;
export type DependencyId = Brand<string, 'DependencyId'>;
export type BaselineId = Brand<string, 'BaselineId'>;
export type ProjectId = Brand<string, 'ProjectId'>;

// Coercion at the boundary: the public API accepts plain strings, the core brands
// them internally (spec §6.1). Callers never need to write `as TaskId`.
export const toTaskId = (s: string): TaskId => s as TaskId;
export const toResourceId = (s: string): ResourceId => s as ResourceId;
export const toDependencyId = (s: string): DependencyId => s as DependencyId;
export const toBaselineId = (s: string): BaselineId => s as BaselineId;
export const toProjectId = (s: string): ProjectId => s as ProjectId;

// Schedule instants accept several input shapes; normalized to Temporal internally (spec §6.2).
export type DateInput = string | Date | Temporal.ZonedDateTime | Temporal.PlainDate;

export type DependencyType =
  | 'FS' // Finish-to-Start (default)
  | 'SS' // Start-to-Start
  | 'FF' // Finish-to-Finish
  | 'SF'; // Start-to-Finish (rare)

export type TaskKind = 'task' | 'summary' | 'milestone' | 'project';

export type TaskConstraint =
  | { kind: 'asap' }
  | { kind: 'alap' }
  | { kind: 'must-start-on'; date: DateInput }
  | { kind: 'must-finish-on'; date: DateInput }
  | { kind: 'start-no-earlier-than'; date: DateInput }
  | { kind: 'start-no-later-than'; date: DateInput }
  | { kind: 'finish-no-earlier-than'; date: DateInput }
  | { kind: 'finish-no-later-than'; date: DateInput };

export interface ResourceAssignment {
  resourceId: ResourceId;
  units: number; // 0..1 = % allocation
}

export interface Task {
  id: TaskId;
  name: string;
  start: DateInput; // normalized to Temporal internally
  end: DateInput;
  duration?: number; // working hours; derived from start/end when omitted
  progress: number; // 0..1
  priority?: number; // lower = higher priority; used by resource leveling (spec §13.2)
  parent?: TaskId;
  type: TaskKind;
  constraint?: TaskConstraint;
  resources?: ResourceAssignment[]; // Pro
  notes?: string;
  color?: string; // must be whitelist-validated when rendered (see security rule)
  meta?: Record<string, unknown>; // free-form user field — untrusted when displayed
  createdAt: Date;
  updatedAt: Date;
}

export interface Dependency {
  id: DependencyId;
  from: TaskId;
  to: TaskId;
  type: DependencyType;
  lag?: number; // hours; negative = lead time
}

export type WeekdayCode = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** A working-time window within a day, formatted as "HH:MM" (24h). */
export interface WorkingHours {
  start: string;
  end: string;
}

export interface WorkingCalendar {
  workingDays: WeekdayCode[];
  workingHours: WorkingHours[]; // may contain multiple windows (e.g. a lunch break)
  holidays: DateInput[];
  timezone: string; // IANA, e.g. "America/New_York"
}

// Critical Path (CPM) result types (spec §13.1, §20 Appendix B). Placed here (not
// co-located in compute/critical-path.ts) because the render layer also needs
// `TaskSchedule` per-task to paint `.fg-task--critical` (dashed outline, spec §8.5).
export interface TaskSchedule {
  readonly taskId: TaskId;
  readonly earlyStart: Temporal.ZonedDateTime;
  readonly earlyFinish: Temporal.ZonedDateTime;
  readonly lateStart: Temporal.ZonedDateTime;
  readonly lateFinish: Temporal.ZonedDateTime;
  /** Working hours; always ≥ 0 within epsilon (see CRITICAL_SLACK_EPSILON_HOURS). */
  readonly slackHours: number;
  /** true when slackHours ~ 0 (within CRITICAL_SLACK_EPSILON_HOURS). */
  readonly isCritical: boolean;
}

export interface CriticalPathResult {
  readonly schedule: ReadonlyMap<TaskId, TaskSchedule>;
  /** Task ids with isCritical === true, in the same order as the input `tasks` array. */
  readonly criticalTaskIds: readonly TaskId[];
  readonly projectEnd: Temporal.ZonedDateTime;
}
