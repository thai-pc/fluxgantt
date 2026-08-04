// Property-based tests (fast-check) for computeCascade — spec-cascade.md §7.3. Reuses
// critical-path.property.test.ts's DAG-by-construction arbitrary as the base.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Temporal } from '@js-temporal/polyfill';
import { computeCascade } from '../../src/compute/cascade.js';
import { DEFAULT_CALENDAR, addWorkingHours, differenceInWorkingHours } from '../../src/compute/working-calendar.js';
import { toTaskId, toDependencyId, type Task, type Dependency, type DependencyType, type TaskId } from '../../src/types.js';

const cal = DEFAULT_CALENDAR;
const ROOT_START = '2026-01-05T09:00'; // Mon 09:00 — fixed, deterministic root instant.
const EPSILON_HOURS = 1e-6;

interface GraphSpec {
  n: number;
  durations: number[];
  edges: Array<{ fromIdx: number; toIdx: number; type: DependencyType; lag: number }>;
  changedIdx: number;
  pushHours: number;
}

// DAG by construction: every edge goes from a lower array index to a higher one, so a
// cycle can never occur. Duration 1..40h, calendar fixed (Mon-Fri 09:00-17:00 UTC).
// Every task starts at the same ROOT_START (isolated tasks would otherwise need their own
// consistent start/end pair — pinning them all to ROOT_START keeps every task's `start`
// AND `end` correct-by-construction for the "task.end must already be consistent with
// duration" contract computeCascade relies on, see cascade.test.ts's fixture comment).
function graphArbitrary(): fc.Arbitrary<GraphSpec> {
  return fc.integer({ min: 2, max: 7 }).chain((n) =>
    fc
      .record({
        durations: fc.array(fc.integer({ min: 1, max: 40 }), { minLength: n, maxLength: n }),
        edges: fc.array(
          fc
            .integer({ min: 0, max: n - 2 })
            .chain((fromIdx) =>
              fc.record({
                fromIdx: fc.constant(fromIdx),
                toIdx: fc.integer({ min: fromIdx + 1, max: n - 1 }),
                type: fc.constantFrom<DependencyType>('FS', 'SS', 'FF', 'SF'),
                lag: fc.integer({ min: -20, max: 20 }),
              }),
            ),
          { maxLength: n * 2 },
        ),
        changedIdx: fc.integer({ min: 0, max: n - 1 }),
        // Positive-only push (a later shift), per resolution #3's "push territory" scope.
        pushHours: fc.integer({ min: 1, max: 40 }),
      })
      .map((rest) => ({ n, ...rest })),
  );
}

function buildGraph(spec: GraphSpec): { tasks: Task[]; dependencies: Dependency[]; changedId: TaskId } {
  const now = new Date();
  const tasks: Task[] = spec.durations.map((duration, i) => ({
    id: toTaskId(`t${i}`),
    name: `t${i}`,
    start: ROOT_START,
    end: addWorkingHours(ROOT_START, duration, cal), // always consistent with duration
    duration,
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
  }));

  const dependencies: Dependency[] = spec.edges.map((e, i) => ({
    id: toDependencyId(`d${i}`),
    from: tasks[e.fromIdx]!.id,
    to: tasks[e.toIdx]!.id,
    type: e.type,
    lag: e.lag,
  }));

  // Apply the "already committed" push to the changed task BEFORE calling computeCascade,
  // matching the facade's contract (tasks[] already reflects the new position).
  const changed = tasks[spec.changedIdx]!;
  const newStart = addWorkingHours(changed.start, spec.pushHours, cal);
  const newEnd = addWorkingHours(newStart, changed.duration!, cal);
  const patchedTasks = tasks.map((t) => (t.id === changed.id ? { ...t, start: newStart, end: newEnd } : t));

  return { tasks: patchedTasks, dependencies, changedId: changed.id };
}

function boundarySatisfied(boundary: Temporal.ZonedDateTime, actual: Temporal.ZonedDateTime): boolean {
  return differenceInWorkingHours(boundary, actual, cal) >= -EPSILON_HOURS;
}

/** Every task transitively reachable from `changedId` via successor (`dep.from ->
 *  dep.to`) edges — mirrors cascade.ts's own `affected` BFS. Deliberately EXCLUDES
 *  `changedId` itself: the changed task's own predecessor relationship (if it has one) is
 *  explicitly out of scope for cascade (spec-cascade.md §6 edge case 8 — "self-
 *  authoritative move violating an upstream predecessor" — cascade never re-derives a
 *  changed task's own predecessors, only walks downstream). An edge whose `to` is the
 *  changed task itself may therefore be legitimately violated post-cascade; the property
 *  below only checks edges whose `to` is a genuine downstream descendant. */
function affectedSet(changedId: TaskId, dependencies: readonly Dependency[]): Set<TaskId> {
  const successors = new Map<TaskId, TaskId[]>();
  for (const d of dependencies) {
    const arr = successors.get(d.from);
    if (arr) arr.push(d.to);
    else successors.set(d.from, [d.to]);
  }
  const affected = new Set<TaskId>();
  const queue: TaskId[] = [changedId];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head]!;
    head++;
    for (const next of successors.get(id) ?? []) {
      if (!affected.has(next)) {
        affected.add(next);
        queue.push(next);
      }
    }
  }
  return affected;
}

/** Post-cascade position: the shifted position if present in `shifts`, else the task's own
 *  (already patched, in the case of the changed task) start/end. */
function postCascadePosition(
  taskId: TaskId,
  tasks: readonly Task[],
  shifts: readonly { taskId: TaskId; start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime }[],
): { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } {
  const shift = shifts.find((s) => s.taskId === taskId);
  if (shift) return { start: shift.start, end: shift.end };
  const t = tasks.find((x) => x.id === taskId)!;
  return {
    start: t.start as Temporal.ZonedDateTime,
    end: t.end as Temporal.ZonedDateTime,
  };
}

describe('computeCascade — property-based invariants', () => {
  it('does not throw on a structurally acyclic graph', () => {
    fc.assert(
      fc.property(graphArbitrary(), (spec) => {
        const { tasks, dependencies, changedId } = buildGraph(spec);
        expect(() => computeCascade(tasks, dependencies, cal, [changedId])).not.toThrow();
      }),
    );
  });

  it('every dependency edge whose `to` is affected satisfies its forward-pass inequality post-cascade', () => {
    fc.assert(
      fc.property(graphArbitrary(), (spec) => {
        const { tasks, dependencies, changedId } = buildGraph(spec);
        const result = computeCascade(tasks, dependencies, cal, [changedId]);
        const affected = affectedSet(changedId, dependencies);

        for (const d of dependencies) {
          if (!affected.has(d.to)) continue; // out of scope — see affectedSet's doc comment
          const predPos = postCascadePosition(d.from, tasks, result.shifts);
          const succPos = postCascadePosition(d.to, tasks, result.shifts);
          const lag = d.lag ?? 0;

          switch (d.type) {
            case 'FS': {
              const boundary = addWorkingHours(predPos.end, lag, cal);
              expect(boundarySatisfied(boundary, succPos.start)).toBe(true);
              break;
            }
            case 'SS': {
              const boundary = addWorkingHours(predPos.start, lag, cal);
              expect(boundarySatisfied(boundary, succPos.start)).toBe(true);
              break;
            }
            case 'FF': {
              const boundary = addWorkingHours(predPos.end, lag, cal);
              expect(boundarySatisfied(boundary, succPos.end)).toBe(true);
              break;
            }
            case 'SF': {
              const boundary = addWorkingHours(predPos.start, lag, cal);
              expect(boundarySatisfied(boundary, succPos.end)).toBe(true);
              break;
            }
          }
        }
      }),
    );
  });

  it('the directly-changed task is never in result.shifts', () => {
    fc.assert(
      fc.property(graphArbitrary(), (spec) => {
        const { tasks, dependencies, changedId } = buildGraph(spec);
        const result = computeCascade(tasks, dependencies, cal, [changedId]);
        expect(result.shifts.some((s) => s.taskId === changedId)).toBe(false);
      }),
    );
  });

  it("no task's post-cascade start is earlier than its pre-cascade start (push-only)", () => {
    fc.assert(
      fc.property(graphArbitrary(), (spec) => {
        const { tasks, dependencies, changedId } = buildGraph(spec);
        const result = computeCascade(tasks, dependencies, cal, [changedId]);

        for (const shift of result.shifts) {
          const before = tasks.find((t) => t.id === shift.taskId)!;
          const diff = differenceInWorkingHours(before.start, shift.start, cal);
          expect(diff).toBeGreaterThanOrEqual(-EPSILON_HOURS);
        }
      }),
    );
  });

  it('idempotency: re-running computeCascade on the post-cascade graph yields empty shifts', () => {
    fc.assert(
      fc.property(graphArbitrary(), (spec) => {
        const { tasks, dependencies, changedId } = buildGraph(spec);
        const first = computeCascade(tasks, dependencies, cal, [changedId]);

        const patched = tasks.map((t) => {
          const shift = first.shifts.find((s) => s.taskId === t.id);
          return shift ? { ...t, start: shift.start, end: shift.end } : t;
        });

        const second = computeCascade(patched, dependencies, cal, [changedId]);
        expect(second.shifts).toHaveLength(0);
      }),
    );
  });
});
