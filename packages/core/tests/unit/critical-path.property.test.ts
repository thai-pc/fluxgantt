// Property-based tests (fast-check) for computeCriticalPath — spec-critical-path.md §8.4.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Temporal } from '@js-temporal/polyfill';
import {
  computeCriticalPath,
  CRITICAL_SLACK_EPSILON_HOURS,
} from '../../src/compute/critical-path.js';
import { DEFAULT_CALENDAR, addWorkingHours, differenceInWorkingHours } from '../../src/compute/working-calendar.js';
import { toTaskId, toDependencyId, type Task, type Dependency, type DependencyType } from '../../src/types.js';

const cal = DEFAULT_CALENDAR;
const ROOT_START = '2026-01-05T09:00'; // Mon 09:00 — fixed, deterministic root instant.

interface GraphSpec {
  n: number;
  durations: number[];
  edges: Array<{ fromIdx: number; toIdx: number; type: DependencyType; lag: number }>;
}

// DAG by construction: every edge goes from a lower array index to a higher one, so a
// cycle can never occur. Duration 1..40h, calendar fixed (Mon-Fri 09:00-17:00 UTC —
// always has working days, sidesteps the "empty calendar" degenerate case entirely).
function makeGraphArbitrary(
  lag: { min: number; max: number },
  types: readonly DependencyType[],
): fc.Arbitrary<GraphSpec> {
  return fc.integer({ min: 2, max: 7 }).chain((n) =>
    fc.record({
      durations: fc.array(fc.integer({ min: 1, max: 40 }), { minLength: n, maxLength: n }),
      edges: fc.array(
        fc
          .integer({ min: 0, max: n - 2 })
          .chain((fromIdx) =>
            fc.record({
              fromIdx: fc.constant(fromIdx),
              toIdx: fc.integer({ min: fromIdx + 1, max: n - 1 }),
              type: fc.constantFrom<DependencyType>(...types),
              lag: fc.integer(lag),
            }),
          ),
        { maxLength: n * 2 },
      ),
    }).map((rest) => ({ n, ...rest })),
  );
}

// General-purpose arbitrary — all 4 dependency types, lag in [-20, 20] (both "wait" and
// "lead/overlap").
const graphArbitrary = makeGraphArbitrary({ min: -20, max: 20 }, ['FS', 'SS', 'FF', 'SF']);

// Restricted arbitrary used solely for the "at least one critical task" invariant
// below. The classical CPM theorem ("at least one task has zero slack") assumes lag
// that preserves precedence semantics — it does NOT hold unconditionally for the
// general lag+FS/SS/FF/SF formula set in spec-critical-path.md §6.4/§6.5. Three
// independent counterexamples were found empirically by this very property test while
// writing it (each verified correct by hand-tracing the algorithm against §6.4/§6.5 —
// genuine consequences of the formulas, not implementation bugs):
//  1. Large-magnitude NEGATIVE lag lets a successor fully precede its predecessor's own
//     finish (e.g. pred duration 20h, succ duration 1h, FS lag -2h) — the successor's
//     backward-pass window never has to reach back far enough to constrain the
//     predecessor, so neither ends up with zero slack.
//  2. SF ties the predecessor's late-finish to `succ.LF - lag + predDuration`, and SS
//     ties it to `succ.LS - lag + predDuration` (§6.5 table) — both have a
//     `+ predDuration` term that FS/FF's backward formulas do NOT have. When
//     predDuration is large relative to the rest of the graph, that extra term loosens
//     the bound and the predecessor never gets pinned to zero slack, EVEN AT lag = 0
//     (reproduces with a single SF or SS edge, non-negative lag — independent of lag
//     sign; e.g. pred duration 30h, succ duration 1h, SF lag 0, or pred duration 9h,
//     succ duration 1h, SS lag 0).
// FS and FF are the only two types whose backward formula is an exact algebraic inverse
// of their forward formula (no extra duration term — see §6.5: FS backward
// `pred.LF <= succ.LS - lag`, FF backward `pred.LF <= succ.LF - lag`). Restricting to
// {FS, FF} with non-negative lag keeps the invariant inside the domain where the
// classical "tight chain from sink back to source" proof actually applies.
const wellBehavedGraphArbitrary = makeGraphArbitrary({ min: 0, max: 20 }, ['FS', 'FF']);

function buildGraph(spec: GraphSpec): { tasks: Task[]; dependencies: Dependency[] } {
  const now = new Date();
  const tasks: Task[] = spec.durations.map((duration, i) => ({
    id: toTaskId(`t${i}`),
    name: `t${i}`,
    start: ROOT_START,
    end: ROOT_START,
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

  return { tasks, dependencies };
}

function boundarySatisfied(boundary: Temporal.ZonedDateTime, actual: Temporal.ZonedDateTime): boolean {
  // actual should be >= boundary; differenceInWorkingHours(boundary, actual) >= 0 means
  // `actual` is at or after `boundary`.
  return differenceInWorkingHours(boundary, actual, cal) >= -CRITICAL_SLACK_EPSILON_HOURS;
}

describe('computeCriticalPath — property-based invariants', () => {
  it('không throw trên đồ thị phi chu trình theo cấu trúc', () => {
    fc.assert(
      fc.property(graphArbitrary, (spec) => {
        const { tasks, dependencies } = buildGraph(spec);
        expect(() => computeCriticalPath(tasks, dependencies, cal)).not.toThrow();
      }),
    );
  });

  it('slack luôn >= -epsilon; isCritical nhất quán với slackHours', () => {
    fc.assert(
      fc.property(graphArbitrary, (spec) => {
        const { tasks, dependencies } = buildGraph(spec);
        const result = computeCriticalPath(tasks, dependencies, cal);
        for (const s of result.schedule.values()) {
          expect(s.slackHours).toBeGreaterThanOrEqual(-CRITICAL_SLACK_EPSILON_HOURS);
          expect(s.isCritical).toBe(s.slackHours <= CRITICAL_SLACK_EPSILON_HOURS);
        }
      }),
    );
  });

  it('slackHours khớp với differenceInWorkingHours(es, ls) tính độc lập', () => {
    fc.assert(
      fc.property(graphArbitrary, (spec) => {
        const { tasks, dependencies } = buildGraph(spec);
        const result = computeCriticalPath(tasks, dependencies, cal);
        for (const s of result.schedule.values()) {
          const recomputed = differenceInWorkingHours(s.earlyStart, s.lateStart, cal);
          expect(Math.abs(recomputed - s.slackHours)).toBeLessThan(1e-6);
        }
      }),
    );
  });

  it('luôn tồn tại ít nhất 1 task critical (trong miền well-behaved — xem comment wellBehavedGraphArbitrary)', () => {
    fc.assert(
      fc.property(wellBehavedGraphArbitrary, (spec) => {
        const { tasks, dependencies } = buildGraph(spec);
        const result = computeCriticalPath(tasks, dependencies, cal);
        expect(result.criticalTaskIds.length).toBeGreaterThanOrEqual(1);
      }),
    );
  });

  it('projectEnd bằng earlyFinish muộn nhất trong schedule (tính lại độc lập)', () => {
    fc.assert(
      fc.property(graphArbitrary, (spec) => {
        const { tasks, dependencies } = buildGraph(spec);
        const result = computeCriticalPath(tasks, dependencies, cal);
        const finishes = [...result.schedule.values()].map((s) => s.earlyFinish);
        const maxFinish = finishes.reduce((acc, f) =>
          Temporal.ZonedDateTime.compare(acc, f) >= 0 ? acc : f,
        );
        expect(Temporal.ZonedDateTime.compare(result.projectEnd, maxFinish)).toBe(0);
      }),
    );
  });

  it('mọi dependency thoả bất đẳng thức forward-pass tương ứng (FS/SS/FF/SF)', () => {
    fc.assert(
      fc.property(graphArbitrary, (spec) => {
        const { tasks, dependencies } = buildGraph(spec);
        const result = computeCriticalPath(tasks, dependencies, cal);

        for (const d of dependencies) {
          const predSchedule = result.schedule.get(d.from)!;
          const succSchedule = result.schedule.get(d.to)!;
          const lag = d.lag ?? 0;

          switch (d.type) {
            case 'FS': {
              const boundary = addWorkingHours(predSchedule.earlyFinish, lag, cal);
              expect(boundarySatisfied(boundary, succSchedule.earlyStart)).toBe(true);
              break;
            }
            case 'SS': {
              const boundary = addWorkingHours(predSchedule.earlyStart, lag, cal);
              expect(boundarySatisfied(boundary, succSchedule.earlyStart)).toBe(true);
              break;
            }
            case 'FF': {
              const boundary = addWorkingHours(predSchedule.earlyFinish, lag, cal);
              expect(boundarySatisfied(boundary, succSchedule.earlyFinish)).toBe(true);
              break;
            }
            case 'SF': {
              const boundary = addWorkingHours(predSchedule.earlyStart, lag, cal);
              expect(boundarySatisfied(boundary, succSchedule.earlyFinish)).toBe(true);
              break;
            }
          }
        }
      }),
    );
  });

  it('thêm 1 task cô lập KHÔNG kéo dài hơn projectEnd hiện có → projectEnd và criticalTaskIds của phần đồ thị gốc không đổi', () => {
    // NOTE: nếu task cô lập có EF muộn hơn projectEnd hiện có, nó tất yếu TRỞ THÀNH
    // projectEnd mới (đúng định nghĩa CPM: projectEnd = max EF trên mọi task) — khi đó
    // các leaf task cũ (LF = projectEnd) sẽ nhận thêm slack và có thể mất critical. Vì
    // vậy bất biến "criticalTaskIds cũ không đổi" chỉ đúng khi task cô lập không vượt
    // quá projectEnd cũ — ràng buộc `extraDuration` bằng cách này để bất biến thực sự
    // đúng, thay vì đúng "hầu hết trường hợp" rồi flaky.
    fc.assert(
      fc.property(graphArbitrary, fc.integer({ min: 1, max: 40 }), (spec, extraDuration) => {
        const { tasks, dependencies } = buildGraph(spec);
        const before = computeCriticalPath(tasks, dependencies, cal);

        const maxAllowedHours = differenceInWorkingHours(ROOT_START, before.projectEnd, cal);
        const safeDuration = Math.max(1, Math.min(extraDuration, Math.floor(maxAllowedHours)));

        const extraTask: Task = {
          id: toTaskId('isolated-extra'),
          name: 'isolated-extra',
          start: ROOT_START,
          end: ROOT_START,
          duration: safeDuration,
          progress: 0,
          type: 'task',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const after = computeCriticalPath([...tasks, extraTask], dependencies, cal);

        expect(Temporal.ZonedDateTime.compare(after.projectEnd, before.projectEnd)).toBe(0);

        const beforeCritical = new Set(before.criticalTaskIds);
        const afterCriticalWithoutExtra = after.criticalTaskIds.filter((id) => id !== extraTask.id);

        for (const id of before.schedule.keys()) {
          const b = before.schedule.get(id)!;
          const a = after.schedule.get(id)!;
          expect(Temporal.ZonedDateTime.compare(a.earlyStart, b.earlyStart)).toBe(0);
          expect(Temporal.ZonedDateTime.compare(a.earlyFinish, b.earlyFinish)).toBe(0);
          expect(Temporal.ZonedDateTime.compare(a.lateStart, b.lateStart)).toBe(0);
          expect(Temporal.ZonedDateTime.compare(a.lateFinish, b.lateFinish)).toBe(0);
          expect(a.isCritical).toBe(b.isCritical);
        }
        expect(new Set(afterCriticalWithoutExtra)).toEqual(beforeCritical);
      }),
    );
  });
});
