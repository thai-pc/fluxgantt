// Critical Path Method (CPM) — compute layer (spec §13.1, §20 Appendix B).
// Headless, pure function: no DOM, no framework, never mutates its inputs.
//
// Core v1 schedules pure ASAP (predecessor-driven early start). `task.constraint` is
// INERT here — it is never read in this file. Constraint resolution (must-start-on,
// SNET/SNLT/FNET/FNLT, alap) is a Pro-tier feature; the only extension point Core
// exposes is `ComputeCriticalPathOptions.resolveConstraint` (see NOTE in Appendix B).
import type { Temporal } from '@js-temporal/polyfill';
import { getTemporal } from '../internal/temporal.js';
import { addWorkingHours, subtractWorkingHours, differenceInWorkingHours } from './working-calendar.js';
import type {
  CriticalPathResult,
  Dependency,
  DependencyType,
  Task,
  TaskId,
  TaskSchedule,
  WorkingCalendar,
} from '../types.js';

type ZDT = Temporal.ZonedDateTime;

/**
 * Pro plug-in point: receives the ASAP-computed early start (from predecessors, or
 * `task.start` normalized for a root task) and returns the constrained early start to
 * use instead. Core does NOT supply an implementation — `options.resolveConstraint`
 * left `undefined` (the default) means pure ASAP, every `task.constraint` inert.
 */
export type ConstraintResolver = (
  task: Task,
  computedEarlyStart: Temporal.ZonedDateTime,
  context: ConstraintResolverContext,
) => Temporal.ZonedDateTime;

export interface ConstraintResolverContext {
  readonly calendar: WorkingCalendar;
  /** Resolved working-hours duration of `task` (task.duration, or derived from start/end). */
  readonly taskDuration: number;
}

export interface ComputeCriticalPathOptions {
  /** Pro-tier seam. `undefined` (default) = never called — pure ASAP, every
   *  `task.constraint` inert. */
  resolveConstraint?: ConstraintResolver;
}

/** Documents Core's default behavior: identity, never changes the early start. Not
 *  required to be passed — Core skips the call entirely when `options?.resolveConstraint`
 *  is `undefined`, this constant only exists as explicit documentation of that contract. */
export const ASAP_ONLY_RESOLVER: ConstraintResolver = (_task, earlyStart) => earlyStart;

export class CyclicDependencyError extends Error {
  readonly taskIds: readonly TaskId[];

  constructor(taskIds: readonly TaskId[]) {
    super(
      `computeCriticalPath: cycle detected in the dependency graph (tasks involved: ${taskIds.join(', ')})`,
    );
    this.name = 'CyclicDependencyError';
    this.taskIds = taskIds;
  }
}

/** Working hours; slack within this epsilon of 0 is treated as critical (float error
 *  from bigint-nanosecond → number-hours conversion). */
export const CRITICAL_SLACK_EPSILON_HOURS = 1e-6;

/**
 * Upper bound (in working hours) accepted for an explicit `task.duration` or a
 * `dependency.lag` magnitude. 100,000 hours ≈ 12,500 working days ≈ ~50 working years
 * at 8h/day — generous for any real-world project (multi-decade programs included),
 * while keeping `addWorkingHours`/`subtractWorkingHours`
 * (`working-calendar.ts`) comfortably under their 1,000,000-iteration `assertProgress`
 * guard: in the common case of one working window per day, each iteration consumes at
 * least one calendar day of progress, so this bound caps a single call at roughly
 * 100,000 / 8 × (7/5) ≈ 17,500 iterations worst case — more than 50x headroom below the
 * guard. Also blocks `NaN`/`Infinity`/`-Infinity` up front with a clear domain error,
 * instead of letting them reach `hoursToNs()`'s `BigInt(Math.round(...))`, which throws
 * a cryptic `RangeError`.
 */
export const MAX_CPM_HOURS = 100_000;

export function computeCriticalPath(
  tasks: readonly Task[],
  dependencies: readonly Dependency[],
  calendar: WorkingCalendar,
  options?: ComputeCriticalPathOptions,
): CriticalPathResult {
  if (tasks.length === 0) {
    throw new Error('computeCriticalPath: tasks must not be empty');
  }

  const taskById = new Map<TaskId, Task>();
  for (const task of tasks) {
    if (taskById.has(task.id)) {
      throw new Error(`computeCriticalPath: duplicate task id ${task.id}`);
    }
    taskById.set(task.id, task);
    validateTaskDuration(task);
  }

  for (const dep of dependencies) {
    if (!taskById.has(dep.from) || !taskById.has(dep.to)) {
      throw new Error(`computeCriticalPath: dependency ${dep.id} references a task that does not exist`);
    }
    validateDependencyLag(dep);
  }

  const predecessors = new Map<TaskId, Dependency[]>();
  const successors = new Map<TaskId, Dependency[]>();
  for (const dep of dependencies) {
    pushInto(predecessors, dep.to, dep);
    pushInto(successors, dep.from, dep);
  }

  const sorted = topologicalSort(tasks, predecessors);

  // --- Forward pass (ES/EF) -------------------------------------------------
  const duration = new Map<TaskId, number>();
  const es = new Map<TaskId, ZDT>();
  const ef = new Map<TaskId, ZDT>();
  const resolveConstraint = options?.resolveConstraint;

  for (const id of sorted) {
    const task = taskById.get(id)!;
    const taskDuration = resolveDuration(task, calendar);
    duration.set(id, taskDuration);

    const preds = predecessors.get(id) ?? [];
    const candidateEs =
      preds.length === 0
        ? addWorkingHours(task.start, 0, calendar) // normalize task.start (root task, no predecessor)
        : preds
            .map((dep) => {
              const predTask = taskById.get(dep.from)!;
              return earliestStartFromPred(predTask, es, ef, dep.type, dep.lag ?? 0, taskDuration, calendar);
            })
            .reduce((acc, candidate) => laterOf(acc, candidate));

    const finalEs = resolveConstraint
      ? resolveConstraint(task, candidateEs, { calendar, taskDuration })
      : candidateEs;

    es.set(id, finalEs);
    ef.set(id, addWorkingHours(finalEs, taskDuration, calendar));
  }

  const projectEnd = tasks
    .map((task) => ef.get(task.id)!)
    .reduce((acc, finish) => laterOf(acc, finish));

  // --- Backward pass (LS/LF) -------------------------------------------------
  // No constraint seam in v1 — see spec open question re: Pro's backward-pass hook.
  const ls = new Map<TaskId, ZDT>();
  const lf = new Map<TaskId, ZDT>();

  for (const id of [...sorted].reverse()) {
    const predDuration = duration.get(id)!;
    const succs = successors.get(id) ?? [];
    const finalLf =
      succs.length === 0
        ? projectEnd
        : succs
            .map((dep) => latestFinishFromSucc(predDuration, dep.to, ls, lf, dep.type, dep.lag ?? 0, calendar))
            .reduce((acc, candidate) => earlierOf(acc, candidate));

    lf.set(id, finalLf);
    ls.set(id, subtractWorkingHours(finalLf, predDuration, calendar));
  }

  // --- Slack + result ----------------------------------------------------
  const schedule = new Map<TaskId, TaskSchedule>();
  const criticalTaskIds: TaskId[] = [];

  for (const task of tasks) {
    const earlyStart = es.get(task.id)!;
    const earlyFinish = ef.get(task.id)!;
    const lateStart = ls.get(task.id)!;
    const lateFinish = lf.get(task.id)!;
    // from=ES, to=LS → positive slack. (Appendix B has the arguments swapped; that is a
    // pseudocode bug, not intentional — see spec-critical-path.md §5.4.)
    const slackHours = differenceInWorkingHours(earlyStart, lateStart, calendar);
    const isCritical = slackHours <= CRITICAL_SLACK_EPSILON_HOURS;

    schedule.set(task.id, {
      taskId: task.id,
      earlyStart,
      earlyFinish,
      lateStart,
      lateFinish,
      slackHours,
      isCritical,
    });
    if (isCritical) criticalTaskIds.push(task.id);
  }

  return { schedule, criticalTaskIds, projectEnd };
}

// --- Internal ----------------------------------------------------------------

function pushInto<K>(map: Map<K, Dependency[]>, key: K, dep: Dependency): void {
  const arr = map.get(key);
  if (arr) arr.push(dep);
  else map.set(key, [dep]);
}

/**
 * Topological sort + cycle detection via Kahn's algorithm (BFS on in-degree). Chosen
 * over `DependencyStore.hasCycle()` (DFS 3-color) because CPM needs a full topological
 * order to run forward/backward pass, not just a cycle boolean — see
 * spec-critical-path.md §5.2. Any task left with a non-zero in-degree once the queue is
 * exhausted is, by construction, part of (or downstream of) a cycle.
 */
function topologicalSort(tasks: readonly Task[], predecessors: Map<TaskId, Dependency[]>): TaskId[] {
  const successorsOf = new Map<TaskId, TaskId[]>();
  const inDegree = new Map<TaskId, number>();
  for (const task of tasks) {
    inDegree.set(task.id, predecessors.get(task.id)?.length ?? 0);
  }
  for (const [to, deps] of predecessors) {
    for (const dep of deps) {
      const arr = successorsOf.get(dep.from);
      if (arr) arr.push(to);
      else successorsOf.set(dep.from, [to]);
    }
  }

  // Queue seeded in original `tasks` order for deterministic output.
  const queue: TaskId[] = [];
  for (const task of tasks) {
    if (inDegree.get(task.id) === 0) queue.push(task.id);
  }

  const sorted: TaskId[] = [];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head];
    head++;
    if (id === undefined) continue; // unreachable — queue never holds holes
    sorted.push(id);
    for (const nextId of successorsOf.get(id) ?? []) {
      const remaining = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, remaining);
      if (remaining === 0) queue.push(nextId);
    }
  }

  if (sorted.length !== tasks.length) {
    const sortedSet = new Set(sorted);
    const remaining = tasks.map((task) => task.id).filter((id) => !sortedSet.has(id));
    throw new CyclicDependencyError(remaining);
  }
  return sorted;
}

/**
 * Validates an explicit `task.duration` before it ever reaches the working-calendar
 * arithmetic. Guards against `NaN`/`Infinity`/`-Infinity` (would otherwise throw a
 * cryptic `RangeError` deep inside `hoursToNs()`), negative values (would silently
 * produce `earlyFinish < earlyStart` — a broken invariant, not a throw), and
 * unreasonably large magnitudes (would burn a large fraction of the
 * `assertProgress` iteration guard in a single `computeCriticalPath` call). No-op when
 * `task.duration` is `undefined` — the derived-from-start/end branch is validated
 * separately in `resolveDuration`.
 */
function validateTaskDuration(task: Task): void {
  const { duration } = task;
  if (duration === undefined) return;
  if (!Number.isFinite(duration)) {
    throw new Error(
      `computeCriticalPath: task ${task.id} has an invalid duration (${duration}) — must be a finite number`,
    );
  }
  if (duration < 0) {
    throw new Error(
      `computeCriticalPath: task ${task.id} has an invalid duration (${duration}) — must be >= 0`,
    );
  }
  if (duration > MAX_CPM_HOURS) {
    throw new Error(
      `computeCriticalPath: task ${task.id} has an invalid duration (${duration}) — exceeds the maximum of ${MAX_CPM_HOURS} working hours`,
    );
  }
}

/**
 * Validates `dependency.lag` (positive = wait, negative = lead) before it reaches
 * `addWorkingHours`/`subtractWorkingHours`. Same rationale as `validateTaskDuration`:
 * blocks non-finite values early with a clear domain error, and bounds the magnitude
 * (in either direction) so a single dependency edge cannot drive the calendar
 * arithmetic toward the iteration guard. No-op when `dependency.lag` is `undefined`
 * (defaults to 0 at every call site via `dep.lag ?? 0`).
 */
function validateDependencyLag(dep: Dependency): void {
  const { lag } = dep;
  if (lag === undefined) return;
  if (!Number.isFinite(lag)) {
    throw new Error(
      `computeCriticalPath: dependency ${dep.id} has an invalid lag (${lag}) — must be a finite number`,
    );
  }
  if (Math.abs(lag) > MAX_CPM_HOURS) {
    throw new Error(
      `computeCriticalPath: dependency ${dep.id} has an invalid lag (${lag}) — exceeds the maximum magnitude of ${MAX_CPM_HOURS} working hours`,
    );
  }
}

/** Task.duration if explicit, else derived from start/end via the working calendar.
 *  Cached by the caller so both forward and backward pass see the same value. */
function resolveDuration(task: Task, calendar: WorkingCalendar): number {
  if (task.duration !== undefined) return task.duration;
  const hours = differenceInWorkingHours(task.start, task.end, calendar);
  if (hours < 0) {
    throw new Error(
      `computeCriticalPath: task ${task.id} has an end before its start and no explicit duration`,
    );
  }
  return hours;
}

/** ES contribution of a single predecessor edge, per the FS/SS/FF/SF formulas
 *  (spec-critical-path.md §6.4). `succDuration` is the duration of the CURRENT task
 *  (the one receiving the dependency), not the predecessor's. */
function earliestStartFromPred(
  pred: Task,
  es: ReadonlyMap<TaskId, ZDT>,
  ef: ReadonlyMap<TaskId, ZDT>,
  depType: DependencyType,
  lag: number,
  succDuration: number,
  calendar: WorkingCalendar,
): ZDT {
  const predEs = es.get(pred.id);
  const predEf = ef.get(pred.id);
  if (!predEs || !predEf) {
    throw new Error(`computeCriticalPath: internal error — predecessor ${pred.id} was not scheduled yet`);
  }
  switch (depType) {
    case 'FS':
      return addWorkingHours(predEf, lag, calendar); // succ.ES >= pred.EF + lag
    case 'SS':
      return addWorkingHours(predEs, lag, calendar); // succ.ES >= pred.ES + lag
    case 'FF':
      return addWorkingHours(predEf, lag - succDuration, calendar); // succ.EF >= pred.EF + lag
    case 'SF':
      return addWorkingHours(predEs, lag - succDuration, calendar); // succ.EF >= pred.ES + lag
  }
}

/** LF contribution of a single successor edge — inverse of the forward-pass formulas
 *  (spec-critical-path.md §6.5). `predDuration` is the duration of the CURRENT task
 *  (the predecessor whose LF is being computed). */
function latestFinishFromSucc(
  predDuration: number,
  succId: TaskId,
  ls: ReadonlyMap<TaskId, ZDT>,
  lf: ReadonlyMap<TaskId, ZDT>,
  depType: DependencyType,
  lag: number,
  calendar: WorkingCalendar,
): ZDT {
  const succLs = ls.get(succId);
  const succLf = lf.get(succId);
  if (!succLs || !succLf) {
    throw new Error(`computeCriticalPath: internal error — successor ${succId} was not scheduled yet`);
  }
  switch (depType) {
    case 'FS':
      return subtractWorkingHours(succLs, lag, calendar); // pred.LF <= succ.LS - lag
    case 'SS':
      return addWorkingHours(succLs, predDuration - lag, calendar); // pred.LF <= succ.LS - lag + pred.duration
    case 'FF':
      return subtractWorkingHours(succLf, lag, calendar); // pred.LF <= succ.LF - lag
    case 'SF':
      return addWorkingHours(succLf, predDuration - lag, calendar); // pred.LF <= succ.LF - lag + pred.duration
  }
}

/**
 * Chronological comparison between two ZonedDateTime instants, used to pick max-ES /
 * min-LF (`laterOf`/`earlierOf` below).
 *
 * DEVIATION FROM spec-critical-path.md §5.3: the spec proposed reusing the *sign* of
 * `differenceInWorkingHours` to avoid a second Temporal runtime access point. That was
 * overridden at the main-session level: two instants that differ by less than one
 * working hour, or that both fall inside non-working time, can produce a
 * `differenceInWorkingHours` of exactly 0 despite being wall-clock different — which
 * would pick the wrong candidate when choosing max-ES/min-LF. `compare` gives an
 * unambiguous, duration-independent ordering. `differenceInWorkingHours` is still used
 * everywhere duration/slack *magnitude* is needed (see resolveDuration, slackHours).
 */
function compareInstant(a: ZDT, b: ZDT): number {
  return getTemporal().ZonedDateTime.compare(a, b);
}

function laterOf(a: ZDT, b: ZDT): ZDT {
  return compareInstant(a, b) >= 0 ? a : b;
}

function earlierOf(a: ZDT, b: ZDT): ZDT {
  return compareInstant(a, b) <= 0 ? a : b;
}
