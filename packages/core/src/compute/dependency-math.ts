// Shared FS/SS/FF/SF earliest-start math + topological sort + validation helpers — extracted
// from `critical-path.ts` (spec-cascade.md §1/§2) so `computeCriticalPath` and `computeCascade`
// share ONE implementation instead of two that can drift.
//
// Headless, pure, Temporal-only (matches critical-path.ts's own header contract). Module-
// internal to `compute/` — NOT re-exported from `compute/index.ts` or the package barrel
// (spec-cascade.md §1: "public surface stays small"), except `MAX_CPM_HOURS` and
// `CyclicDependencyError`, which `critical-path.ts` re-exports for backward-compatible import
// paths.
import type { Temporal } from '@js-temporal/polyfill';
import { getTemporal } from '../internal/temporal.js';
import { addWorkingHours, differenceInWorkingHours } from './working-calendar.js';
import type { Dependency, DependencyType, Task, TaskId, WorkingCalendar } from '../types.js';

type ZDT = Temporal.ZonedDateTime;

export class CyclicDependencyError extends Error {
  readonly taskIds: readonly TaskId[];

  constructor(taskIds: readonly TaskId[], callerName = 'computeCriticalPath') {
    super(
      `${callerName}: cycle detected in the dependency graph (tasks involved: ${taskIds.join(', ')})`,
    );
    this.name = 'CyclicDependencyError';
    this.taskIds = taskIds;
  }
}

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

export function pushInto<K>(map: Map<K, Dependency[]>, key: K, dep: Dependency): void {
  const arr = map.get(key);
  if (arr) arr.push(dep);
  else map.set(key, [dep]);
}

/**
 * Topological sort + cycle detection via Kahn's algorithm (BFS on in-degree). Chosen
 * over `DependencyStore.hasCycle()` (DFS 3-color) because CPM needs a full topological
 * order to run forward/backward pass, not just a cycle boolean — see
 * spec-critical-path.md §5.2. Any task left with a non-zero in-degree once the queue is
 * exhausted is, by construction, part of (or downstream of) a cycle. `callerName` is
 * threaded into the thrown `CyclicDependencyError` so both `computeCriticalPath` and
 * `computeCascade` report their own name (spec-cascade.md §2.1).
 */
export function topologicalSort(
  tasks: readonly Task[],
  predecessors: Map<TaskId, Dependency[]>,
  callerName: string,
): TaskId[] {
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
    throw new CyclicDependencyError(remaining, callerName);
  }
  return sorted;
}

/**
 * Validates an explicit `task.duration` before it ever reaches the working-calendar
 * arithmetic. Guards against `NaN`/`Infinity`/`-Infinity` (would otherwise throw a
 * cryptic `RangeError` deep inside `hoursToNs()`), negative values (would silently
 * produce `earlyFinish < earlyStart` — a broken invariant, not a throw), and
 * unreasonably large magnitudes (would burn a large fraction of the
 * `assertProgress` iteration guard in a single call). No-op when
 * `task.duration` is `undefined` — the derived-from-start/end branch is validated
 * separately in `resolveDuration`.
 */
export function validateTaskDuration(task: Task, callerName: string): void {
  const { duration } = task;
  if (duration === undefined) return;
  if (!Number.isFinite(duration)) {
    throw new Error(
      `${callerName}: task ${task.id} has an invalid duration (${duration}) — must be a finite number`,
    );
  }
  if (duration < 0) {
    throw new Error(`${callerName}: task ${task.id} has an invalid duration (${duration}) — must be >= 0`);
  }
  if (duration > MAX_CPM_HOURS) {
    throw new Error(
      `${callerName}: task ${task.id} has an invalid duration (${duration}) — exceeds the maximum of ${MAX_CPM_HOURS} working hours`,
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
export function validateDependencyLag(dep: Dependency, callerName: string): void {
  const { lag } = dep;
  if (lag === undefined) return;
  if (!Number.isFinite(lag)) {
    throw new Error(`${callerName}: dependency ${dep.id} has an invalid lag (${lag}) — must be a finite number`);
  }
  if (Math.abs(lag) > MAX_CPM_HOURS) {
    throw new Error(
      `${callerName}: dependency ${dep.id} has an invalid lag (${lag}) — exceeds the maximum magnitude of ${MAX_CPM_HOURS} working hours`,
    );
  }
}

/** Task.duration if explicit, else derived from start/end via the working calendar.
 *  Cached by the caller so both forward and backward pass (CPM) — or the current-span
 *  lookup (cascade) — see the same value. */
export function resolveDuration(task: Task, calendar: WorkingCalendar, callerName: string): number {
  if (task.duration !== undefined) return task.duration;
  const hours = differenceInWorkingHours(task.start, task.end, calendar);
  if (hours < 0) {
    throw new Error(`${callerName}: task ${task.id} has an end before its start and no explicit duration`);
  }
  return hours;
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
export function compareInstant(a: ZDT, b: ZDT): number {
  return getTemporal().ZonedDateTime.compare(a, b);
}

export function laterOf(a: ZDT, b: ZDT): ZDT {
  return compareInstant(a, b) >= 0 ? a : b;
}

export function earlierOf(a: ZDT, b: ZDT): ZDT {
  return compareInstant(a, b) <= 0 ? a : b;
}

/** ES contribution of a single predecessor edge, per the FS/SS/FF/SF formulas
 *  (spec-critical-path.md §6.4). `succDuration` is the duration of the CURRENT task
 *  (the one receiving the dependency), not the predecessor's.
 *
 *  Signature note (spec-cascade.md §2.1): takes the predecessor's resolved
 *  start/finish instants directly (not a `Task` + `es`/`ef` map lookup) — the natural
 *  shared shape for BOTH `computeCriticalPath` (which has an es/ef scratch map from its
 *  own forward pass) and `computeCascade` (which has no such map, only each task's
 *  actual currently-committed start/end). Output is bit-for-bit identical to the old
 *  `earliestStartFromPred(pred, es, ef, ...)` it replaces. */
export function earliestStartFromPredecessor(
  predStart: ZDT,
  predFinish: ZDT,
  depType: DependencyType,
  lag: number,
  succDuration: number,
  calendar: WorkingCalendar,
): ZDT {
  switch (depType) {
    case 'FS':
      return addWorkingHours(predFinish, lag, calendar); // succ.ES >= pred.EF + lag
    case 'SS':
      return addWorkingHours(predStart, lag, calendar); // succ.ES >= pred.ES + lag
    case 'FF':
      return addWorkingHours(predFinish, lag - succDuration, calendar); // succ.EF >= pred.EF + lag
    case 'SF':
      return addWorkingHours(predStart, lag - succDuration, calendar); // succ.EF >= pred.ES + lag
  }
}
