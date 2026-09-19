// Property-based tests (fast-check) for computeRollup — spec-summary-rollup.md §7.
// Forests are acyclic BY CONSTRUCTION (a node's parent is always a lower array index), so
// these properties never depend on the cycle guard — that is covered by rollup.test.ts.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeRollup, type RollupResult } from '../../src/compute/rollup.js';
import { DEFAULT_CALENDAR, normalizeDate } from '../../src/compute/working-calendar.js';
import { toTaskId, type Task, type TaskId } from '../../src/types.js';

const cal = DEFAULT_CALENDAR;
const ROOT_START = '2026-01-05T09:00'; // Mon 09:00 — fixed, deterministic.

interface NodeSpec {
  /** Index into the node array, or `null` for a root. Always < this node's own index. */
  parentIdx: number | null;
  /** Working hours; 0 makes the node a zero-duration (milestone-like) contributor. */
  duration: number;
  /** Deliberately unbounded, including out-of-range and non-finite, to exercise clamping. */
  progress: number;
  /** Start offset in working hours from ROOT_START — lets subtrees interleave arbitrarily. */
  startOffset: number;
}

/**
 * Forest by construction: node `i`'s parent is an index in `[0, i)` or `null`, so a cycle can
 * never occur and every node is reachable from some root. Durations are explicit (never
 * derived from start/end) so `resolveDuration` can never throw on the "end before start"
 * path — that case has its own dedicated test.
 */
function forestArbitrary(): fc.Arbitrary<NodeSpec[]> {
  return fc.integer({ min: 1, max: 12 }).chain((n) =>
    fc.tuple(
      ...Array.from({ length: n }, (_unused, i) =>
        fc.record<NodeSpec>({
          parentIdx: i === 0 ? fc.constant(null) : fc.option(fc.integer({ min: 0, max: i - 1 })),
          duration: fc.integer({ min: 0, max: 40 }),
          progress: fc.oneof(
            fc.double({ min: 0, max: 1, noNaN: true }),
            // Hostile values: the returned progress must stay in 0..1 regardless (§7 prop 3).
            fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -7, 42),
          ),
          startOffset: fc.integer({ min: 0, max: 200 }),
        }),
      ),
    ),
  );
}

function buildTasks(specs: readonly NodeSpec[]): Task[] {
  const now = new Date();
  return specs.map((spec, i) => {
    const task: Task = {
      id: toTaskId(`t${i}`),
      name: `t${i}`,
      // `start`/`end` are equal and `duration` explicit — `resolveDuration` reads `duration`
      // and never the derived span, so an equal pair is consistent, not malformed.
      start: ROOT_START,
      end: ROOT_START,
      duration: spec.duration,
      progress: spec.progress,
      type: spec.duration === 0 ? 'milestone' : 'task',
      createdAt: now,
      updatedAt: now,
    };
    return spec.parentIdx === null ? task : { ...task, parent: toTaskId(`t${spec.parentIdx}`) };
  });
}

/** Distinct starts per node, so min/max are actually exercised rather than all-equal. */
function buildTasksWithOffsets(specs: readonly NodeSpec[]): Task[] {
  return buildTasks(specs).map((task, i) => {
    const offsetDays = specs[i]!.startOffset % 20; // stay inside a few weeks
    const day = 5 + offsetDays; // 2026-01-05 is a Monday
    const iso = `2026-01-${String(day).padStart(2, '0')}T09:00`;
    return { ...task, start: iso, end: iso };
  });
}

function childrenByParent(tasks: readonly Task[]): Map<TaskId, Task[]> {
  const byId = new Set(tasks.map((t) => t.id));
  const map = new Map<TaskId, Task[]>();
  for (const t of tasks) {
    if (t.parent === undefined || !byId.has(t.parent)) continue;
    const arr = map.get(t.parent);
    if (arr) arr.push(t);
    else map.set(t.parent, [t]);
  }
  return map;
}

function descendantsOf(id: TaskId, children: Map<TaskId, Task[]>): Task[] {
  const out: Task[] = [];
  const stack = [...(children.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    out.push(next);
    stack.push(...(children.get(next.id) ?? []));
  }
  return out;
}

/** The instants a descendant actually contributes: its rolled-up span when it has one,
 *  otherwise its own authored start/end, normalized the same way the production code does. */
function spanOf(
  task: Task,
  rollup: ReadonlyMap<TaskId, RollupResult>,
): { start: bigint; end: bigint } {
  const rolled = rollup.get(task.id);
  if (rolled) {
    return { start: rolled.start.epochNanoseconds, end: rolled.end.epochNanoseconds };
  }
  return {
    start: normalizeDate(task.start, cal.timezone).epochNanoseconds,
    end: normalizeDate(task.end, cal.timezone).epochNanoseconds,
  };
}

const runs = { numRuns: 200 };

describe('computeRollup — property-based invariants (spec §7)', () => {
  it('prop 1+2: a rolled-up span contains every transitive descendant, and start <= end', () => {
    fc.assert(
      fc.property(forestArbitrary(), (specs) => {
        const tasks = buildTasksWithOffsets(specs);
        const rollup = computeRollup(tasks, cal);
        const children = childrenByParent(tasks);

        for (const [id, result] of rollup) {
          expect(result.start.epochNanoseconds <= result.end.epochNanoseconds).toBe(true);
          for (const descendant of descendantsOf(id, children)) {
            const span = spanOf(descendant, rollup);
            expect(result.start.epochNanoseconds <= span.start).toBe(true);
            expect(result.end.epochNanoseconds >= span.end).toBe(true);
          }
        }
      }),
      runs,
    );
  });

  it('prop 3: progress is always within 0..1 and finite, for arbitrary hostile child values', () => {
    fc.assert(
      fc.property(forestArbitrary(), (specs) => {
        for (const result of computeRollup(buildTasksWithOffsets(specs), cal).values()) {
          expect(Number.isFinite(result.progress)).toBe(true);
          expect(result.progress).toBeGreaterThanOrEqual(0);
          expect(result.progress).toBeLessThanOrEqual(1);
        }
      }),
      runs,
    );
  });

  it('prop 4: shuffling the input array yields an equal result map', () => {
    fc.assert(
      fc.property(forestArbitrary(), fc.integer({ min: 0, max: 1_000 }), (specs, seed) => {
        const tasks = buildTasksWithOffsets(specs);
        // Deterministic rotation-based shuffle — order-independence is the property under
        // test, so any reordering serves; a rotation keeps it reproducible from `seed`.
        const shift = seed % Math.max(1, tasks.length);
        const rotated = [...tasks.slice(shift), ...tasks.slice(0, shift)].reverse();

        const a = computeRollup(tasks, cal);
        const b = computeRollup(rotated, cal);
        expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
        for (const [id, expected] of a) {
          const actual = b.get(id)!;
          expect(actual.start.epochNanoseconds).toBe(expected.start.epochNanoseconds);
          expect(actual.end.epochNanoseconds).toBe(expected.end.epochNanoseconds);
          expect(actual.durationHours).toBeCloseTo(expected.durationHours, 9);
          expect(actual.progress).toBeCloseTo(expected.progress, 9);
        }
      }),
      runs,
    );
  });

  it('prop 5: adding a child whose range is inside an ancestor span never moves that span', () => {
    fc.assert(
      fc.property(forestArbitrary(), (specs) => {
        const tasks = buildTasksWithOffsets(specs);
        const before = computeRollup(tasks, cal);
        // Only meaningful when something already rolls up.
        const targetId = [...before.keys()][0];
        if (targetId === undefined) return;
        const target = before.get(targetId)!;

        const now = new Date();
        const inside: Task = {
          id: toTaskId('__inserted'),
          name: 'inserted',
          // The ancestor's own rolled-up start is by definition inside its own span.
          start: target.start,
          end: target.start,
          duration: 1,
          progress: 0.5,
          type: 'task',
          parent: targetId,
          createdAt: now,
          updatedAt: now,
        };
        const after = computeRollup([...tasks, inside], cal).get(targetId)!;
        expect(after.start.epochNanoseconds).toBe(target.start.epochNanoseconds);
        expect(after.end.epochNanoseconds).toBe(target.end.epochNanoseconds);
      }),
      runs,
    );
  });

  it('prop 6: no childless task ever appears as a key', () => {
    fc.assert(
      fc.property(forestArbitrary(), (specs) => {
        const tasks = buildTasksWithOffsets(specs);
        const children = childrenByParent(tasks);
        const rollup = computeRollup(tasks, cal);
        for (const id of rollup.keys()) {
          expect((children.get(id) ?? []).length).toBeGreaterThan(0);
        }
        for (const t of tasks) {
          if ((children.get(t.id) ?? []).length === 0) expect(rollup.has(t.id)).toBe(false);
        }
      }),
      runs,
    );
  });

  it('never mutates its input, for any forest', () => {
    fc.assert(
      fc.property(forestArbitrary(), (specs) => {
        const tasks = buildTasksWithOffsets(specs);
        const snapshot = JSON.stringify(tasks);
        computeRollup(tasks, cal);
        expect(JSON.stringify(tasks)).toBe(snapshot);
      }),
      runs,
    );
  });
});
