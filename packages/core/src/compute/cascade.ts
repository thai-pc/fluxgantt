// Cascade scheduling — push-only, forward, downstream (spec-cascade.md §2/§3, plan §6
// resolution #3). Headless, pure function: no DOM, no framework, never mutates its inputs.
//
// Given the FULL current task/dependency set — where the caller's `changedTaskIds` task(s)
// already reflect their NEW, already-committed start/end — computes which transitive
// successors must shift LATER to keep their FS/SS/FF/SF (+lag) relationship satisfied, and
// their new start/end (duration-preserving). Never pulls a successor earlier. `task.constraint`
// is INERT here (spec-cascade.md §2, resolution #4), consistent with `computeCriticalPath`.
import type { Temporal } from '@js-temporal/polyfill';
import { normalizeDate, addWorkingHours } from './working-calendar.js';
import {
  pushInto,
  topologicalSort,
  validateTaskDuration,
  validateDependencyLag,
  resolveDuration,
  compareInstant,
  laterOf,
  earliestStartFromPredecessor,
} from './dependency-math.js';
import type { Dependency, Task, TaskId, WorkingCalendar } from '../types.js';

const CALLER_NAME = 'computeCascade';

export interface CascadeShift {
  readonly taskId: TaskId;
  readonly start: Temporal.ZonedDateTime;
  readonly end: Temporal.ZonedDateTime;
}

export interface CascadeResult {
  /**
   * Successors that must move, in the order they were resolved (a valid topological
   * order restricted to the affected subgraph — see the algorithm below). NEVER includes
   * any id from `changedTaskIds` — the directly-changed task(s) are authoritative and are
   * never re-derived by this function (resolution #3). Empty when no successor violates
   * its dependency (e.g. the change was a move earlier, or every successor already has
   * enough slack).
   */
  readonly shifts: readonly CascadeShift[];
}

/**
 * Push-only, forward, downstream cascade (plan §6 resolution #3). Given the FULL current
 * task/dependency set — where `changedTaskIds` task(s) already reflect their NEW,
 * already-committed start/end — computes which transitive successors must shift LATER to
 * keep their FS/SS/FF/SF (+lag) relationship satisfied, and their new start/end
 * (duration-preserving). Never mutates `tasks`/`dependencies`. `task.constraint` is
 * INERT (resolution #4, matches `computeCriticalPath`).
 *
 * `tasks` must already contain the changed task(s)' new `start`/`end` — the caller (facade)
 * applies the direct mutation to its store FIRST, then calls `computeCascade` with
 * `taskStore.all()`. Cascade itself never receives an explicit "old vs. new" delta; it
 * recomputes each successor's required earliest-start from the graph's CURRENT state, which
 * is why it is naturally idempotent — calling it twice in a row with no intervening state
 * change returns `{ shifts: [] }` the second time.
 *
 * Throws `CyclicDependencyError` if the dependency graph has a cycle (resolution #6, reused
 * from `computeCriticalPath`/`dependency-math.ts` — should be unreachable via `linkTasks`,
 * which already rejects cycles at edge-creation time; only reachable via
 * `DependencyStore.link(..., { allowCycle: true })` used directly).
 */
export function computeCascade(
  tasks: readonly Task[],
  dependencies: readonly Dependency[],
  calendar: WorkingCalendar,
  changedTaskIds: readonly TaskId[],
): CascadeResult {
  const taskById = new Map<TaskId, Task>();
  for (const t of tasks) {
    if (taskById.has(t.id)) {
      throw new Error(`computeCascade: duplicate task id ${t.id}`);
    }
    taskById.set(t.id, t);
    validateTaskDuration(t, CALLER_NAME);
  }

  for (const d of dependencies) {
    if (!taskById.has(d.from) || !taskById.has(d.to)) {
      throw new Error(`computeCascade: dependency ${d.id} references a task that does not exist`);
    }
    validateDependencyLag(d, CALLER_NAME);
  }

  for (const id of changedTaskIds) {
    if (!taskById.has(id)) {
      throw new Error(`computeCascade: changed task ${id} not found`);
    }
  }

  const predecessors = new Map<TaskId, Dependency[]>(); // dep.to   -> dep
  const successors = new Map<TaskId, Dependency[]>(); // dep.from -> dep
  for (const d of dependencies) {
    pushInto(predecessors, d.to, d);
    pushInto(successors, d.from, d);
  }

  // Whole-graph topological order + cycle check (reused — see spec-cascade.md §2.3).
  const sortedAll = topologicalSort(tasks, predecessors, CALLER_NAME);

  // "current" = each task's as-scheduled position, seeded from its actual committed
  // start/end (already includes the changed task's NEW position, since `tasks` was passed
  // in post-commit). Overwritten in place as tasks are pushed below.
  const current = new Map<TaskId, { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime }>();
  for (const t of tasks) {
    current.set(t.id, {
      start: normalizeDate(t.start, calendar.timezone),
      end: normalizeDate(t.end, calendar.timezone),
    });
  }

  // Affected = every task transitively reachable from ANY changed task via successor
  // edges (BFS over `successors`). Tasks outside this set are never touched — the heart
  // of "push-only, downstream only" (resolution #3): cascade never even looks at a task
  // that isn't a descendant of something that just changed.
  const affected = new Set<TaskId>();
  const queue: TaskId[] = [...changedTaskIds];
  let qHead = 0;
  while (qHead < queue.length) {
    const id = queue[qHead];
    qHead++;
    if (id === undefined) continue; // unreachable — queue never holds holes
    for (const dep of successors.get(id) ?? []) {
      if (!affected.has(dep.to)) {
        affected.add(dep.to);
        queue.push(dep.to);
      }
    }
  }

  const changedSet = new Set(changedTaskIds);
  const shifts: CascadeShift[] = [];

  // Walk the WHOLE graph's topological order, but only ACT on affected, non-changed
  // tasks. Because `sortedAll` is topologically valid for the whole graph, by the time we
  // reach any affected task, every one of its predecessors (whether itself affected or
  // not) already has its final position in `current`.
  for (const id of sortedAll) {
    if (!affected.has(id)) continue; // not a descendant of any changed task — skip
    if (changedSet.has(id)) continue; // defensive no-op — the mover is authoritative

    const task = taskById.get(id)!;
    const taskDuration = resolveDuration(task, calendar, CALLER_NAME); // task's own span, preserved on push

    const preds = predecessors.get(id) ?? [];
    if (preds.length === 0) continue; // no predecessor edge → nothing constrains it

    const candidateEs = preds
      .map((dep) => {
        const predPos = current.get(dep.from)!; // always present: earlier in topo order, or untouched original
        return earliestStartFromPredecessor(predPos.start, predPos.end, dep.type, dep.lag ?? 0, taskDuration, calendar);
      })
      .reduce((acc, candidate) => laterOf(acc, candidate));

    const curPos = current.get(id)!;
    if (compareInstant(candidateEs, curPos.start) > 0) {
      // STRICTLY later than the current start → violated, push.
      const newEnd = addWorkingHours(candidateEs, taskDuration, calendar);
      current.set(id, { start: candidateEs, end: newEnd });
      shifts.push({ taskId: id, start: candidateEs, end: newEnd });
    }
    // else: candidateEs <= current start → dependency already satisfied (has slack, or
    // exactly meets it) → leave untouched (resolution #3 "never pulls a successor
    // earlier"; also covers "successor with slack is unaffected").
  }

  return { shifts };
}
