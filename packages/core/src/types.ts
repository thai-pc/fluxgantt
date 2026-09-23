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

// Render/view vocabulary (spec §6.3, §8). Placed here (not render-local) because it is
// shared future vocabulary for `GanttConfig` (facade, not yet written) as well as the
// render layer — avoids a duplicate definition when the facade lands. NOT a `Viewport`
// type name on purpose: that name is reserved for a future reactive `ViewportStore`
// (pan/zoom state), which does not exist yet — see render/renderer-base.ts `TimeRange`.
export type ViewMode = 'day' | 'week' | 'month' | 'quarter' | 'year';
/**
 * Row-height scale. `'touch'` is the coarse-pointer level (spec-responsive-mobile.md): it is
 * NEVER selected automatically by either renderer — `withResponsive()` from
 * `@fluxgantt/core/responsive` is what switches to it under `(pointer: coarse)`, so a chart
 * without that mixin renders byte-identically to before this level existed. A host may also
 * pass it explicitly via `GanttConfig.density` to force touch sizing on a desktop.
 */
export type Density = 'compact' | 'default' | 'comfortable' | 'touch';

/** Facade-level scheduling behavior (spec-cascade.md §4.1). `'manual'` (default) = v1's
 *  original single-task-only behavior — `moveTask`/`resizeTask`/`updateTask`/a drag commit
 *  affect only the named task. `'auto'` cascades dependent tasks along FS/SS/FF/SF (+lag)
 *  via `computeCascade`. */
export type SchedulingMode = 'manual' | 'auto';

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

/**
 * The rolled-up span a row should be DRAWN at, or `undefined` to use the task's own authored
 * dates (spec-summary-rollup.md Ticket B2).
 *
 * Deliberately a narrow structural type rather than `RollupResult` itself, and deliberately here
 * in `types.ts` rather than in `render/`: the render layer may not import from `compute/`
 * (architecture.md principle 1, the same rule that put `MAX_HIERARCHY_DEPTH` in
 * `compute/hierarchy.ts`), and geometry needs only the two instants anyway. `RollupResult` is
 * assignable to this structurally, so a caller passes `computeRollup()`'s map straight through
 * with no adapter and no cast.
 */
export interface RolledUpSpan {
  readonly start: Temporal.ZonedDateTime;
  readonly end: Temporal.ZonedDateTime;
}

/**
 * What a renderer needs from a rollup entry: the span for geometry plus the aggregate
 * `progress` for the row's `aria-label`. Split from `RolledUpSpan` so `layoutTaskBar`, which is
 * pure geometry, cannot accidentally read a field it has no business in.
 *
 * `RollupResult` (which also carries `durationHours`) is structurally assignable to this, so a
 * caller passes `computeRollup()`'s map through unchanged.
 */
export interface RolledUpRow extends RolledUpSpan {
  /** Duration-weighted aggregate progress, 0..1 — already clamped by `computeRollup`. */
  readonly progress: number;
}

/**
 * Aggregation a mounted chart calls to decide where each parent row's bar is DRAWN
 * (`GanttConfig.rollup`, spec-summary-rollup.md Ticket B2). `computeRollup` satisfies it as
 * written — `RollupResult` carries a `durationHours` this shape simply ignores.
 *
 * Injected rather than imported by the render layer so `compute/rollup.js` stays out of every
 * `@fluxgantt/core/render` bundle that doesn't use it (~400 B gzip); see `GanttConfig.rollup`.
 *
 * Contract: pure, must not mutate `tasks`, and may return an entry for any subset of ids — a
 * task with no entry is drawn at its authored dates.
 */
export type RollupProvider = (
  tasks: readonly Task[],
  calendar: WorkingCalendar,
) => ReadonlyMap<TaskId, RolledUpRow>;

// --- i18n scaffold (spec §6.3) -------------------------------------------------------
//
// English is the only language `@fluxgantt/core` SHIPS. What lives here is the structure by
// which a host supplies another one: the library hands out every piece of state and the host
// returns a finished sentence. No catalog format, no ICU parser, no bundled translations.

/**
 * Parameters handed to `GanttMessages.taskLabel`.
 *
 * Dates arrive PRE-FORMATTED only. Handing over the raw `Temporal.PlainDate` pair as well was
 * designed and then cut: it cost bundle bytes the `withRender + withInteraction` budget did not
 * have (golden rule 5 — change the shape, not the budget). A host needing a different date
 * skeleton is therefore not served yet; that is a tracked follow-up, and the interface is
 * additive, so `start`/`end` can be reinstated without a breaking change.
 */
export interface TaskLabelParams {
  /** Already truncated to `MAX_ARIA_TASK_NAME_LENGTH` (200) by the caller. */
  readonly name: string;
  /** The task's span — the ROLLED-UP aggregate when the row is a summary, authored dates
   *  otherwise — formatted with `Intl` for `locale`. What the English default prints. */
  readonly startLabel: string;
  readonly endLabel: string;
  /** Whole-number percent 0..100, ALREADY localized for `locale` (so an `ar-EG` host gets
   *  Arabic-Indic digits rather than Western Arabic ones beside its localized dates). The `%`
   *  sign is deliberately NOT included: its placement is grammar and varies by locale
   *  (Turkish writes `%50`), so it belongs to this function's caller. */
  readonly progressPct: string;
  readonly isCritical: boolean;
  readonly isSelected: boolean;
  readonly locale: string;
}

/**
 * Host-supplied accessible-name builders (`GanttConfig.messages`).
 *
 * Every entry is a COMPLETE sentence produced by one function — deliberately not a table of
 * fragments to be concatenated. The built-in English label used to compose by suffixing
 * (`base` + `', critical path'` + `', selected'`), a shape that cannot produce a correct
 * sentence in any verb-final or inflecting language no matter how the fragments are swapped.
 * Handing the host all of the state and none of the grammar is what actually makes the string
 * translatable, and it costs zero parser bytes.
 *
 * ONE key at launch, because the audited translatable surface of core is exactly one composed
 * sentence. The scaffold value is the shape: adding `gridColumnLabel`, `emptyState`, `tooltip`
 * or `dependencyLabel` later is a new optional key on an existing optional interface —
 * non-breaking by construction, no architectural change.
 */
export interface GanttMessages {
  /** Replaces the per-task `aria-label` sentence wholesale. Throwing, or returning a
   *  non-string, falls back to the English default — silently, by design: this runs once per
   *  task per paint, so a `console.warn` would emit thousands of identical lines in a single
   *  paint of a large chart, and the fallback is correct English rather than a broken chart. */
  readonly taskLabel?: (params: TaskLabelParams) => string;
}
