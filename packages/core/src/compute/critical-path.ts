// Critical Path Method (CPM) — compute layer (spec §13.1, §20 Appendix B).
// Headless, pure function: no DOM, no framework, never mutates its inputs.
//
// Core v1 schedules pure ASAP (predecessor-driven early start). `task.constraint` is
// INERT here — it is never read in this file. Constraint resolution (must-start-on,
// SNET/SNLT/FNET/FNLT, alap) is a Pro-tier feature; the only extension point Core
// exposes is `ComputeCriticalPathOptions.resolveConstraint` (see NOTE in Appendix B).
//
// The FS/SS/FF/SF earliest-start formulas, topological sort, and validation/comparison
// helpers are shared with `compute/cascade.ts` via `compute/dependency-math.ts`
// (spec-cascade.md §1/§2) — this file re-exports `MAX_CPM_HOURS`/`CyclicDependencyError`
// so existing import paths (`'../../src/compute/critical-path.js'`) keep working.
import type { Temporal } from '@js-temporal/polyfill';
import { addWorkingHours, subtractWorkingHours, differenceInWorkingHours } from './working-calendar.js';
import {
  MAX_CPM_HOURS,
  CyclicDependencyError,
  pushInto,
  topologicalSort,
  validateTaskDuration,
  validateDependencyLag,
  resolveDuration,
  laterOf,
  earlierOf,
  earliestStartFromPredecessor,
} from './dependency-math.js';
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

const CALLER_NAME = 'computeCriticalPath';

export { MAX_CPM_HOURS, CyclicDependencyError };

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

/** Working hours; slack within this epsilon of 0 is treated as critical (float error
 *  from bigint-nanosecond → number-hours conversion). */
export const CRITICAL_SLACK_EPSILON_HOURS = 1e-6;

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
    validateTaskDuration(task, CALLER_NAME);
  }

  for (const dep of dependencies) {
    if (!taskById.has(dep.from) || !taskById.has(dep.to)) {
      throw new Error(`computeCriticalPath: dependency ${dep.id} references a task that does not exist`);
    }
    validateDependencyLag(dep, CALLER_NAME);
  }

  const predecessors = new Map<TaskId, Dependency[]>();
  const successors = new Map<TaskId, Dependency[]>();
  for (const dep of dependencies) {
    pushInto(predecessors, dep.to, dep);
    pushInto(successors, dep.from, dep);
  }

  const sorted = topologicalSort(tasks, predecessors, CALLER_NAME);

  // --- Forward pass (ES/EF) -------------------------------------------------
  const duration = new Map<TaskId, number>();
  const es = new Map<TaskId, ZDT>();
  const ef = new Map<TaskId, ZDT>();
  const resolveConstraint = options?.resolveConstraint;

  for (const id of sorted) {
    const task = taskById.get(id)!;
    const taskDuration = resolveDuration(task, calendar, CALLER_NAME);
    duration.set(id, taskDuration);

    const preds = predecessors.get(id) ?? [];
    const candidateEs =
      preds.length === 0
        ? addWorkingHours(task.start, 0, calendar) // normalize task.start (root task, no predecessor)
        : preds
            .map((dep) => {
              const predEs = es.get(dep.from)!;
              const predEf = ef.get(dep.from)!;
              return earliestStartFromPredecessor(predEs, predEf, dep.type, dep.lag ?? 0, taskDuration, calendar);
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

/** LF contribution of a single successor edge — inverse of the forward-pass formulas
 *  (spec-critical-path.md §6.5). `predDuration` is the duration of the CURRENT task
 *  (the predecessor whose LF is being computed). Backward-pass-only — not shared with
 *  cascade (push-only-forward, spec-cascade.md §2.2), so it stays private here. */
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
