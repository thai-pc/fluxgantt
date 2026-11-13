// Core type system (spec §6). Branded IDs + DateInput normalized to Temporal internally.
import type { Temporal } from '@js-temporal/polyfill';

// Branded ID types — prevent mixing up IDs at compile time (spec §6.1)
/** Tags a primitive so differently branded IDs cannot be mixed up. */
export type Brand<T, B> = T & { readonly __brand: B };

/** Branded task identifier. */
export type TaskId = Brand<string, 'TaskId'>;
/**
 * Branded resource identifier (reserved for the Pro resource view).
 *
 * @beta
 */
export type ResourceId = Brand<string, 'ResourceId'>;
/** Branded dependency identifier. */
export type DependencyId = Brand<string, 'DependencyId'>;
/**
 * Branded baseline identifier (reserved for the Pro baseline feature).
 *
 * @beta
 */
export type BaselineId = Brand<string, 'BaselineId'>;
/**
 * Branded project identifier (reserved for Cloud).
 *
 * @beta
 */
export type ProjectId = Brand<string, 'ProjectId'>;

// Coercion at the boundary: the public API accepts plain strings, the core brands
// them internally (spec §6.1). Callers never need to write `as TaskId`.
/** Brands a string as a `TaskId`. */
export const toTaskId = (s: string): TaskId => s as TaskId;
/**
 * Brands a string as a `ResourceId`.
 *
 * @beta
 */
export const toResourceId = (s: string): ResourceId => s as ResourceId;
/** Brands a string as a `DependencyId`. */
export const toDependencyId = (s: string): DependencyId => s as DependencyId;
/**
 * Brands a string as a `BaselineId`.
 *
 * @beta
 */
export const toBaselineId = (s: string): BaselineId => s as BaselineId;
/**
 * Brands a string as a `ProjectId`.
 *
 * @beta
 */
export const toProjectId = (s: string): ProjectId => s as ProjectId;

// Schedule instants accept several input shapes; normalized to Temporal internally (spec §6.2).
/** Any date value the API accepts; normalized to a `Temporal.ZonedDateTime` internally. */
export type DateInput = string | Date | Temporal.ZonedDateTime | Temporal.PlainDate;

/** Dependency link type: finish-to-start, start-to-start, finish-to-finish or start-to-finish. */
export type DependencyType =
  | 'FS' // Finish-to-Start (default)
  | 'SS' // Start-to-Start
  | 'FF' // Finish-to-Finish
  | 'SF'; // Start-to-Finish (rare)

/** What a task is: a normal task, a summary, a milestone or a project. */
export type TaskKind = 'task' | 'summary' | 'milestone' | 'project';

/**
 * A scheduling constraint on a task, discriminated by `kind`.
 *
 * @beta
 */
export type TaskConstraint =
  | { kind: 'asap' }
  | { kind: 'alap' }
  | { kind: 'must-start-on'; date: DateInput }
  | { kind: 'must-finish-on'; date: DateInput }
  | { kind: 'start-no-earlier-than'; date: DateInput }
  | { kind: 'start-no-later-than'; date: DateInput }
  | { kind: 'finish-no-earlier-than'; date: DateInput }
  | { kind: 'finish-no-later-than'; date: DateInput };

/**
 * Assignment of a resource to a task with a utilisation `units` fraction.
 *
 * @beta
 */
export interface ResourceAssignment {
  resourceId: ResourceId;
  units: number; // 0..1 = % allocation
}

/** A scheduled task, summary or milestone. */
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

/** A directed link between two tasks. */
export interface Dependency {
  id: DependencyId;
  from: TaskId;
  to: TaskId;
  type: DependencyType;
  lag?: number; // hours; negative = lead time
}

/** Two-letter weekday code (`MO` to `SU`). */
export type WeekdayCode = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** A working-time window within a day, formatted as "HH:MM" (24h). */
export interface WorkingHours {
  start: string;
  end: string;
}

/** Which weekdays and hours count as work, plus holidays and the time zone. */
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
/** Time-axis zoom level. */
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
/** The computed early/late dates and slack of one task. */
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

/** What `computeCriticalPath` returns: per-task schedule and the critical path. */
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
 * What a keyboard move, resize or link just did, for the polite live region (`GanttMessages.announce`).
 * Discriminated by `kind`. New kinds and fields MAY be added in a minor release, so a host `switch` should
 * keep a `default`.
 *
 * @beta
 */
export type GanttAnnouncement =
  /** After a keyboard move or resize (`moved`, `resized`), or when one changed nothing (`cannot-move`,
   *  `cannot-resize`: a summary, a milestone resize, the one-day minimum, or no working time to extend into).
   *  `start` / `end` are the task's span as ZonedDateTime strings; `startLabel` / `endLabel` are those
   *  instants localized with times. */
  | {
      readonly kind: 'moved' | 'resized' | 'cannot-move' | 'cannot-resize';
      readonly id: TaskId;
      readonly name: string;
      readonly start: string;
      readonly end: string;
      readonly startLabel: string;
      readonly endLabel: string;
      readonly locale: string;
    }
  /** After Alt+Enter: `linked` when the dependency was created, `link-failed` when it was rejected
   *  (`reason`). `from` / `to` are task names. */
  | {
      readonly kind: 'linked' | 'link-failed';
      readonly fromId: TaskId;
      readonly toId: TaskId;
      readonly from: string;
      readonly to: string;
      readonly reason?: 'duplicate' | 'cycle' | 'self';
      readonly locale: string;
    };

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
 * Two keys so far (`taskLabel`, `announce`). The scaffold value is the shape: adding `gridColumnLabel`,
 * `emptyState`, `tooltip` or `dependencyLabel` later is a new optional key on an existing optional
 * interface — non-breaking by construction, no architectural change.
 */
export interface GanttMessages {
  /** Text for the polite live region that announces keyboard move, resize and link results
   *  (`withInteraction`). Return a complete sentence; throwing or returning a non-string falls back
   *
   * @beta
   *  to the English default. Inserted with `textContent`, never as HTML. */
  readonly announce?: (announcement: GanttAnnouncement) => string;
  /** Replaces the per-task `aria-label` sentence wholesale. Throwing, or returning a
   *  non-string, falls back to the English default — silently, by design: this runs once per
   *  task per paint, so a `console.warn` would emit thousands of identical lines in a single
   *  paint of a large chart, and the fallback is correct English rather than a broken chart. */
  readonly taskLabel?: (params: TaskLabelParams) => string;
  /** Accessible name of a grid column header (`withGrid`). Default
   *  `${header}, column ${index} of ${count}`. Throwing or returning a non-string falls back to it.
   *
   * @beta */
  readonly gridColumnLabel?: (params: {
    readonly columnId: string;
    readonly header: string;
    /** 1-based. */
    readonly index: number;
    readonly count: number;
    readonly locale: string;
  }) => string;
}

// --- Conflicts (spec-detect-conflicts.md) ---------------------------------------------------

/**
 * A successor scheduled earlier than one of its dependencies allows (same inequality as the
 * auto-scheduling cascade). One conflict per violated dependency.
 */
export interface DependencyViolationConflict {
  readonly kind: 'dependency-violation';
  readonly dependencyId: DependencyId;
  /** Predecessor. */
  readonly from: TaskId;
  /** Successor that starts too early. */
  readonly to: TaskId;
  readonly dependencyType: DependencyType;
  /** `dependency.lag ?? 0`, in working hours. */
  readonly lagHours: number;
  /** Earliest instant the successor may start (for FF/SF this is the start implied by the finish
   *  rule, same convention as the cascade). Temporal values are not `JSON.stringify`-friendly:
   *  call `.toString()` yourself. */
  readonly requiredStart: Temporal.ZonedDateTime;
  /** Working hours between the successor's actual start and `requiredStart`. May be 0 when the
   *  whole gap is non-working time; the conflict still exists. */
  readonly shortfallHours: number;
}

/** A child whose authored span is not contained in its parent's authored span. */
export interface OutsideParentConflict {
  readonly kind: 'outside-parent';
  readonly taskId: TaskId;
  readonly parentId: TaskId;
  /** Which side(s) of the child escape the parent. */
  readonly edge: 'start' | 'end' | 'both';
}

/** A task whose `end` is strictly before its `start`. */
export interface InvalidSpanConflict {
  readonly kind: 'invalid-span';
  readonly taskId: TaskId;
}

/**
 * A place where the authored schedule contradicts a rule Core enforces elsewhere. The union is
 * OPEN to additive growth in minor releases (Pro adds resource and constraint kinds): keep a
 * default branch in any `switch (conflict.kind)`.
 */
export type Conflict = DependencyViolationConflict | OutsideParentConflict | InvalidSpanConflict;
/** The discriminant values of `Conflict`. New kinds may be added in a minor release, so keep a `default` branch. */
export type ConflictKind = Conflict['kind'];
