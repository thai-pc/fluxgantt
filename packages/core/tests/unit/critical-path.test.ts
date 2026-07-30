import { describe, it, expect, vi } from 'vitest';
import {
  computeCriticalPath,
  CyclicDependencyError,
  ASAP_ONLY_RESOLVER,
  MAX_CPM_HOURS,
  type ConstraintResolver,
} from '../../src/compute/critical-path.js';
import { DEFAULT_CALENDAR, addWorkingHours } from '../../src/compute/working-calendar.js';
import {
  toTaskId,
  toDependencyId,
  type Task,
  type TaskId,
  type Dependency,
  type DependencyType,
  type TaskConstraint,
  type WorkingCalendar,
} from '../../src/types.js';

// Same fixture convention as working-calendar.test.ts. Mon-Fri 09:00-17:00, UTC.
// 2026-01-02 = Fri, 01-03/04 = Sat/Sun, 01-05 = Mon, 01-06 = Tue, 01-07 = Wed.
const cal = DEFAULT_CALENDAR;

const wall = (z: { toPlainDateTime(): { toString(): string } }): string =>
  z.toPlainDateTime().toString();

/** Task with an explicit duration (end is irrelevant — duration wins). */
function task(id: string, start: string, duration: number, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: toTaskId(id),
    name: id,
    start,
    end: start,
    duration,
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

/** Task without an explicit duration — derived from start/end via the working calendar. */
function taskFromRange(id: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: toTaskId(id),
    name: id,
    start,
    end,
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

let depSeq = 0;
function dep(from: TaskId, to: TaskId, type: DependencyType = 'FS', lag = 0): Dependency {
  depSeq++;
  return { id: toDependencyId(`dep-${depSeq}`), from, to, type, lag };
}

describe('computeCriticalPath — simple FS chain', () => {
  it('2 tasks, lag 0: ES/EF/LS/LF correct, both critical, projectEnd correct', () => {
    const A = task('A', '2026-01-05T09:00', 8); // Mon 09:00-17:00
    const B = task('B', '2026-01-05T09:00', 8);
    const deps = [dep(A.id, B.id, 'FS', 0)];

    const result = computeCriticalPath([A, B], deps, cal);

    const a = result.schedule.get(A.id)!;
    const b = result.schedule.get(B.id)!;

    expect(wall(a.earlyStart)).toBe('2026-01-05T09:00:00');
    expect(wall(a.earlyFinish)).toBe('2026-01-05T17:00:00');
    expect(wall(a.lateStart)).toBe('2026-01-05T09:00:00');
    // NOTE: LF(A) is NOT "Mon 17:00" (that would assume the backward pass mirrors the
    // forward pass 1:1). It is subtractWorkingHours(LS(B), lag=0, cal) = LS(B) itself
    // (lag 0 short-circuits), and LS(B) = subtractWorkingHours(projectEnd, 8h, cal) =
    // Tue 09:00 (8 working hours before Tue 17:00 fits entirely within Tuesday's own
    // 09:00-17:00 window — it does not need to reach back into Monday).
    expect(wall(a.lateFinish)).toBe('2026-01-06T09:00:00');
    expect(a.slackHours).toBeCloseTo(0, 9);
    expect(a.isCritical).toBe(true);

    // FS lag 0 does not "snap" the successor forward — addWorkingHours(x, 0) is an
    // identity normalize, so ES(B) sits exactly at pred.EF even if that instant is a
    // working-window boundary.
    expect(wall(b.earlyStart)).toBe('2026-01-05T17:00:00');
    expect(wall(b.earlyFinish)).toBe('2026-01-06T17:00:00'); // rolls into Tuesday
    // LF(B) = projectEnd (Tue 17:00, no successors). LS(B) = 8 working hours before
    // that, which fits entirely inside Tuesday's own window → Tue 09:00 (not Mon 17:00).
    expect(wall(b.lateStart)).toBe('2026-01-06T09:00:00');
    expect(wall(b.lateFinish)).toBe('2026-01-06T17:00:00');
    expect(b.slackHours).toBeCloseTo(0, 9);
    expect(b.isCritical).toBe(true);

    expect([...result.criticalTaskIds].sort()).toEqual([A.id, B.id].sort());
    expect(wall(result.projectEnd)).toBe('2026-01-06T17:00:00');
  });
});

describe('computeCriticalPath — 4 dependency types × positive/negative lag (§6.4 formulas)', () => {
  const predStart = '2026-01-05T09:00'; // Mon 09:00
  const predDuration = 8; // EF = Mon 17:00
  const succDuration = 4;

  const cases: Array<{ type: DependencyType; lag: number }> = [
    { type: 'FS', lag: 2 },
    { type: 'FS', lag: -2 },
    { type: 'SS', lag: 2 },
    { type: 'SS', lag: -2 },
    { type: 'FF', lag: 2 },
    { type: 'FF', lag: -2 },
    { type: 'SF', lag: 2 },
    { type: 'SF', lag: -2 },
  ];

  it.each(cases)('$type lag=$lag: successor ES/EF match the formula', ({ type, lag }) => {
    const pred = task('pred', predStart, predDuration);
    const succ = task('succ', predStart, succDuration);
    const deps = [dep(pred.id, succ.id, type, lag)];

    const result = computeCriticalPath([pred, succ], deps, cal);
    const predSchedule = result.schedule.get(pred.id)!;
    const succSchedule = result.schedule.get(succ.id)!;

    let expectedEs;
    switch (type) {
      case 'FS':
        expectedEs = addWorkingHours(predSchedule.earlyFinish, lag, cal);
        break;
      case 'SS':
        expectedEs = addWorkingHours(predSchedule.earlyStart, lag, cal);
        break;
      case 'FF':
        expectedEs = addWorkingHours(predSchedule.earlyFinish, lag - succDuration, cal);
        break;
      case 'SF':
        expectedEs = addWorkingHours(predSchedule.earlyStart, lag - succDuration, cal);
        break;
    }
    const expectedEf = addWorkingHours(expectedEs, succDuration, cal);

    expect(wall(succSchedule.earlyStart)).toBe(wall(expectedEs));
    expect(wall(succSchedule.earlyFinish)).toBe(wall(expectedEf));
  });
});

describe('computeCriticalPath — multiple predecessors: ES = latest', () => {
  it('picks the latest candidate (not the first/last in the array)', () => {
    const A = task('A', '2026-01-05T09:00', 8); // EF Mon 17:00
    const B = task('B', '2026-01-05T09:00', 2); // EF Mon 11:00
    const C = task('C', '2026-01-05T09:00', 1); // EF Mon 10:00
    const target = task('target', '2026-01-05T09:00', 1);

    // B is in the middle of the array — if the implementation wrongly picks the first (A)
    // or last (C) candidate instead of the true max, this test fails.
    const deps = [
      dep(A.id, target.id, 'FS', 0), // candidate = Mon 17:00
      dep(B.id, target.id, 'FS', 10), // candidate = Tue 13:00 (latest)
      dep(C.id, target.id, 'SS', 1), // candidate = Mon 10:00
    ];

    const result = computeCriticalPath([A, B, C, target], deps, cal);
    const targetSchedule = result.schedule.get(target.id)!;

    expect(wall(targetSchedule.earlyStart)).toBe('2026-01-06T13:00:00');
    expect(wall(targetSchedule.earlyFinish)).toBe('2026-01-06T14:00:00');
  });
});

describe('computeCriticalPath — multiple successors: LF = earliest', () => {
  it('picks the earliest candidate (not the first/last in the array)', () => {
    const X = task('X', '2026-01-05T09:00', 4); // ES Mon09:00, EF Mon13:00
    const D = task('D', '2026-01-05T09:00', 8);
    const E = task('E', '2026-01-05T09:00', 2);
    const F = task('F', '2026-01-05T09:00', 1);

    // D is in the middle — the correct (earliest) candidate comes from D, not E (first) or F (last).
    const deps = [
      dep(X.id, E.id, 'SS', 6),
      dep(X.id, D.id, 'FS', 0),
      dep(X.id, F.id, 'FF', 0),
    ];

    const result = computeCriticalPath([X, D, E, F], deps, cal);
    const xSchedule = result.schedule.get(X.id)!;

    expect(wall(xSchedule.lateFinish)).toBe('2026-01-05T13:00:00');
    expect(wall(xSchedule.lateStart)).toBe('2026-01-05T09:00:00');
    expect(xSchedule.slackHours).toBeCloseTo(0, 9);
    expect(xSchedule.isCritical).toBe(true);
  });
});

describe('computeCriticalPath — diamond dependency (A→B, A→C, B→D, C→D)', () => {
  it('the longer branch (B) is critical; the shorter branch (C) slack = duration difference', () => {
    const A = task('A', '2026-01-05T09:00', 2); // ES Mon09:00, EF Mon11:00
    const B = task('B', '2026-01-05T09:00', 6);
    const C = task('C', '2026-01-05T09:00', 2);
    const D = task('D', '2026-01-05T09:00', 1);

    const deps = [
      dep(A.id, B.id, 'FS', 0),
      dep(A.id, C.id, 'FS', 0),
      dep(B.id, D.id, 'FS', 0),
      dep(C.id, D.id, 'FS', 0),
    ];

    const result = computeCriticalPath([A, B, C, D], deps, cal);
    const a = result.schedule.get(A.id)!;
    const b = result.schedule.get(B.id)!;
    const c = result.schedule.get(C.id)!;
    const d = result.schedule.get(D.id)!;

    expect(a.isCritical).toBe(true);
    expect(b.isCritical).toBe(true);
    expect(d.isCritical).toBe(true);

    expect(c.isCritical).toBe(false);
    // duration(B) - duration(C) = 6 - 2 = 4
    expect(c.slackHours).toBeCloseTo(4, 9);

    expect(wall(result.projectEnd)).toBe('2026-01-06T10:00:00');
  });
});

describe('computeCriticalPath — milestone', () => {
  it('duration 0 (start === end, no duration set): ES === EF, no error', () => {
    const M = taskFromRange('M', '2026-01-05T09:00', '2026-01-05T09:00', { type: 'milestone' });
    const result = computeCriticalPath([M], [], cal);
    const m = result.schedule.get(M.id)!;

    expect(wall(m.earlyStart)).toBe(wall(m.earlyFinish));
    expect(m.slackHours).toBeCloseTo(0, 9);
    expect(m.isCritical).toBe(true);
  });
});

describe('computeCriticalPath — root task', () => {
  it('task with no predecessor: ES = normalized task.start', () => {
    const A = task('A', '2026-01-05T10:30', 4);
    const result = computeCriticalPath([A], [], cal);
    const a = result.schedule.get(A.id)!;
    expect(wall(a.earlyStart)).toBe(wall(addWorkingHours('2026-01-05T10:30', 0, cal)));
  });
});

describe('computeCriticalPath — non-working day / holiday skip', () => {
  it('predecessor EF = Fri 16:00, FS lag 2 → successor ES jumps over the weekend to Mon 10:00', () => {
    // Reuses the working-calendar.test.ts fixture ("jumps over the weekend").
    const P = task('P', '2026-01-02T09:00', 7); // Fri 09:00 + 7h = Fri 16:00
    const S = task('S', '2026-01-02T09:00', 3);
    const deps = [dep(P.id, S.id, 'FS', 2)];

    const result = computeCriticalPath([P, S], deps, cal);
    const p = result.schedule.get(P.id)!;
    const s = result.schedule.get(S.id)!;

    expect(wall(p.earlyFinish)).toBe('2026-01-02T16:00:00');
    expect(wall(s.earlyStart)).toBe('2026-01-05T10:00:00');
  });

  it('same case but Mon is a holiday → jumps to Tue 10:00', () => {
    const withHoliday: WorkingCalendar = { ...cal, holidays: ['2026-01-05'] };
    const P = task('P', '2026-01-02T09:00', 7);
    const S = task('S', '2026-01-02T09:00', 3);
    const deps = [dep(P.id, S.id, 'FS', 2)];

    const result = computeCriticalPath([P, S], deps, withHoliday);
    const s = result.schedule.get(S.id)!;

    expect(wall(s.earlyStart)).toBe('2026-01-06T10:00:00');
  });
});

describe('computeCriticalPath — DST boundary (America/New_York, spring-forward 2026-03-08)', () => {
  it('adding across a DST weekend stays wall-clock correct (Fri 16:00 + lag2 → Mon 10:00)', () => {
    const ny: WorkingCalendar = { ...cal, timezone: 'America/New_York' };
    // 2026-03-06 = Fri, 03-08 = Sun (DST), 03-09 = Mon.
    const P = task('P', '2026-03-06T09:00', 7);
    const S = task('S', '2026-03-06T09:00', 1);
    const deps = [dep(P.id, S.id, 'FS', 2)];

    const result = computeCriticalPath([P, S], deps, ny);
    const s = result.schedule.get(S.id)!;

    expect(wall(s.earlyStart)).toBe('2026-03-09T10:00:00');
    expect(s.earlyStart.timeZoneId).toBe('America/New_York');
  });
});

describe('computeCriticalPath — multi-timezone', () => {
  const timezones = ['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'];

  it.each(timezones)('%s: FS chain of 2 tasks lag 0 → both critical', (timezone) => {
    const zoned: WorkingCalendar = { ...cal, timezone };
    const A = task('A', '2026-01-05T09:00', 8);
    const B = task('B', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, B.id, 'FS', 0)];

    const result = computeCriticalPath([A, B], deps, zoned);
    const a = result.schedule.get(A.id)!;
    const b = result.schedule.get(B.id)!;

    expect(a.isCritical).toBe(true);
    expect(b.isCritical).toBe(true);
    expect(a.earlyStart.timeZoneId).toBe(timezone);
  });
});

describe('computeCriticalPath — required edge cases', () => {
  it('throws when tasks is empty', () => {
    expect(() => computeCriticalPath([], [], cal)).toThrow(/must not be empty/);
  });

  it('throws on duplicate task id', () => {
    const A1 = task('dup', '2026-01-05T09:00', 4);
    const A2 = task('dup', '2026-01-06T09:00', 4);
    expect(() => computeCriticalPath([A1, A2], [], cal)).toThrow(/duplicate task id/);
  });

  it('throws when a dependency references a non-existent task', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const ghost = toTaskId('ghost');
    const deps = [dep(A.id, ghost)];
    expect(() => computeCriticalPath([A], deps, cal)).toThrow(/does not exist/);
  });

  it('throws on negative duration (end before start, no duration set)', () => {
    const A = taskFromRange('A', '2026-01-06T09:00', '2026-01-05T09:00');
    expect(() => computeCriticalPath([A], [], cal)).toThrow(/end before its start/);
  });

  it('throw CyclicDependencyError khi self-loop (A→A)', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, A.id)];
    expect(() => computeCriticalPath([A], deps, cal)).toThrow(CyclicDependencyError);
  });

  it('throws CyclicDependencyError on a direct cycle (A→B, B→A), taskIds correct', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const B = task('B', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, B.id), dep(B.id, A.id)];

    expect.assertions(2);
    try {
      computeCriticalPath([A, B], deps, cal);
    } catch (err) {
      expect(err).toBeInstanceOf(CyclicDependencyError);
      expect((err as CyclicDependencyError).taskIds.slice().sort()).toEqual([A.id, B.id].slice().sort());
    }
  });

  it('throws CyclicDependencyError on an indirect cycle (A→B→C→A), no infinite loop', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const B = task('B', '2026-01-05T09:00', 4);
    const C = task('C', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, B.id), dep(B.id, C.id), dep(C.id, A.id)];

    expect(() => computeCriticalPath([A, B, C], deps, cal)).toThrow(CyclicDependencyError);
  });
});

describe('computeCriticalPath — N1: explicit task.duration / dependency.lag validation (security review)', () => {
  it('throws when explicit task.duration is negative', () => {
    const A = task('A', '2026-01-05T09:00', -5);
    expect(() => computeCriticalPath([A], [], cal)).toThrow(/invalid duration.*must be >= 0/);
  });

  it('throws when explicit task.duration is NaN', () => {
    const A = task('A', '2026-01-05T09:00', Number.NaN);
    expect(() => computeCriticalPath([A], [], cal)).toThrow(/invalid duration.*must be a finite number/);
  });

  it('throws when explicit task.duration is Infinity', () => {
    const A = task('A', '2026-01-05T09:00', Number.POSITIVE_INFINITY);
    expect(() => computeCriticalPath([A], [], cal)).toThrow(/invalid duration.*must be a finite number/);
  });

  it('throws when explicit task.duration is -Infinity', () => {
    const A = task('A', '2026-01-05T09:00', Number.NEGATIVE_INFINITY);
    expect(() => computeCriticalPath([A], [], cal)).toThrow(/invalid duration.*must be a finite number/);
  });

  it('throws when explicit task.duration exceeds MAX_CPM_HOURS', () => {
    const A = task('A', '2026-01-05T09:00', MAX_CPM_HOURS + 1);
    expect(() => computeCriticalPath([A], [], cal)).toThrow(/invalid duration.*exceeds the maximum/);
  });

  it('does NOT throw when explicit task.duration = 0 or = MAX_CPM_HOURS (valid boundary)', () => {
    const zero = task('zero', '2026-01-05T09:00', 0);
    expect(() => computeCriticalPath([zero], [], cal)).not.toThrow();

    const atMax = task('at-max', '2026-01-05T09:00', MAX_CPM_HOURS);
    expect(() => computeCriticalPath([atMax], [], cal)).not.toThrow();
  });

  it('throws when dependency.lag is NaN', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const B = task('B', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, B.id, 'FS', Number.NaN)];
    expect(() => computeCriticalPath([A, B], deps, cal)).toThrow(/invalid lag.*must be a finite number/);
  });

  it('throws when dependency.lag is Infinity', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const B = task('B', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, B.id, 'FS', Number.POSITIVE_INFINITY)];
    expect(() => computeCriticalPath([A, B], deps, cal)).toThrow(/invalid lag.*must be a finite number/);
  });

  it('throws when dependency.lag is -Infinity', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const B = task('B', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, B.id, 'FS', Number.NEGATIVE_INFINITY)];
    expect(() => computeCriticalPath([A, B], deps, cal)).toThrow(/invalid lag.*must be a finite number/);
  });

  it('throws when dependency.lag exceeds MAX_CPM_HOURS magnitude (both positive and negative)', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const B = task('B', '2026-01-05T09:00', 4);
    const C = task('C', '2026-01-05T09:00', 4);
    const depsPos = [dep(A.id, B.id, 'FS', MAX_CPM_HOURS + 1)];
    const depsNeg = [dep(A.id, C.id, 'FS', -(MAX_CPM_HOURS + 1))];
    expect(() => computeCriticalPath([A, B], depsPos, cal)).toThrow(/invalid lag.*exceeds the maximum magnitude/);
    expect(() => computeCriticalPath([A, C], depsNeg, cal)).toThrow(/invalid lag.*exceeds the maximum magnitude/);
  });

  it('does NOT throw when dependency.lag = ±MAX_CPM_HOURS (valid boundary)', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const B = task('B', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, B.id, 'FS', MAX_CPM_HOURS)];
    expect(() => computeCriticalPath([A, B], deps, cal)).not.toThrow();
  });
});

describe('computeCriticalPath — constraint inert (Core v1, ALL 8 kinds required)', () => {
  const A = task('A', '2026-01-05T09:00', 8);
  const B = task('B', '2026-01-05T09:00', 4);
  const deps = [dep(A.id, B.id, 'FS', 2)];
  const baseline = computeCriticalPath([A, B], deps, cal);

  const constraints: TaskConstraint[] = [
    { kind: 'asap' },
    { kind: 'alap' },
    { kind: 'must-start-on', date: '2026-01-10' },
    { kind: 'must-finish-on', date: '2026-01-10' },
    { kind: 'start-no-earlier-than', date: '2026-01-10' },
    { kind: 'start-no-later-than', date: '2026-01-01' },
    { kind: 'finish-no-earlier-than', date: '2026-01-10' },
    { kind: 'finish-no-later-than', date: '2026-01-01' },
  ];

  it.each(constraints)(
    'constraint $kind on a mid-chain task still yields ASAP, no throw',
    (constraint) => {
      const bWithConstraint: Task = { ...B, constraint };
      expect(() => computeCriticalPath([A, bWithConstraint], deps, cal)).not.toThrow();

      const result = computeCriticalPath([A, bWithConstraint], deps, cal);
      const expected = baseline.schedule.get(B.id)!;
      const actual = result.schedule.get(B.id)!;

      expect(wall(actual.earlyStart)).toBe(wall(expected.earlyStart));
      expect(wall(actual.earlyFinish)).toBe(wall(expected.earlyFinish));
      expect(wall(actual.lateStart)).toBe(wall(expected.lateStart));
      expect(wall(actual.lateFinish)).toBe(wall(expected.lateFinish));
      expect(actual.slackHours).toBeCloseTo(expected.slackHours, 9);
      expect(actual.isCritical).toBe(expected.isCritical);
    },
  );
});

describe('computeCriticalPath — seam: options.resolveConstraint', () => {
  it('called exactly once per task, with (task, computedEarlyStart, {calendar, taskDuration}); the return value propagates to EF/backward/slack', () => {
    const A = task('A', '2026-01-05T09:00', 8); // EF Mon 17:00
    const B = task('B', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, B.id, 'FS', 0)];

    const calls: Array<{ taskId: TaskId; es: string; taskDuration: number }> = [];
    const resolver: ConstraintResolver = vi.fn((t, computedEs, context) => {
      calls.push({ taskId: t.id, es: wall(computedEs), taskDuration: context.taskDuration });
      if (t.id === B.id) return addWorkingHours(computedEs, 4, cal); // push B 4h later
      return computedEs;
    });

    const result = computeCriticalPath([A, B], deps, cal, { resolveConstraint: resolver });

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      { taskId: A.id, es: '2026-01-05T09:00:00', taskDuration: 8 },
      { taskId: B.id, es: '2026-01-05T17:00:00', taskDuration: 4 },
    ]);
    // context.calendar passed through by reference
    const firstCall = (resolver as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall?.[2]?.calendar).toBe(cal);

    const b = result.schedule.get(B.id)!;
    const a = result.schedule.get(A.id)!;

    // ES(B) shifted from Mon 17:00 (ASAP) to Tue 13:00 (+4 working hours) by the resolver.
    expect(wall(b.earlyStart)).toBe('2026-01-06T13:00:00');
    expect(wall(b.earlyFinish)).toBe(wall(addWorkingHours(b.earlyStart, 4, cal)));
    expect(b.slackHours).toBeCloseTo(0, 9); // B still the last task, drives projectEnd
    expect(b.isCritical).toBe(true);

    // A now has slack because B (its only successor) got pushed later by the resolver —
    // proves the resolver's return value really reaches the backward pass, not just EF.
    expect(a.slackHours).toBeCloseTo(4, 9);
    expect(a.isCritical).toBe(false);
  });

  it('ASAP_ONLY_RESOLVER produces identical results to passing no options', () => {
    const A = task('A', '2026-01-05T09:00', 8);
    const B = task('B', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, B.id, 'FS', 2)];

    const withoutOptions = computeCriticalPath([A, B], deps, cal);
    const withIdentityResolver = computeCriticalPath([A, B], deps, cal, {
      resolveConstraint: ASAP_ONLY_RESOLVER,
    });

    for (const id of [A.id, B.id]) {
      const expected = withoutOptions.schedule.get(id)!;
      const actual = withIdentityResolver.schedule.get(id)!;
      expect(wall(actual.earlyStart)).toBe(wall(expected.earlyStart));
      expect(wall(actual.earlyFinish)).toBe(wall(expected.earlyFinish));
      expect(wall(actual.lateStart)).toBe(wall(expected.lateStart));
      expect(wall(actual.lateFinish)).toBe(wall(expected.lateFinish));
      expect(actual.slackHours).toBeCloseTo(expected.slackHours, 9);
      expect(actual.isCritical).toBe(expected.isCritical);
    }
  });
});
