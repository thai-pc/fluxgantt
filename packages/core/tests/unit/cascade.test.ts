import { describe, it, expect } from 'vitest';
import { computeCascade } from '../../src/compute/cascade.js';
import { CyclicDependencyError } from '../../src/compute/critical-path.js';
import { DEFAULT_CALENDAR, addWorkingHours, normalizeDate } from '../../src/compute/working-calendar.js';
import {
  toTaskId,
  toDependencyId,
  type Task,
  type TaskId,
  type Dependency,
  type DependencyType,
  type WorkingCalendar,
} from '../../src/types.js';

// Same fixture convention as critical-path.test.ts. Mon-Fri 09:00-17:00, UTC.
// 2026-01-02 = Fri, 01-03/04 = Sat/Sun, 01-05 = Mon, 01-06 = Tue, 01-07 = Wed.
const cal = DEFAULT_CALENDAR;

const wall = (z: { toPlainDateTime(): { toString(): string } }): string =>
  z.toPlainDateTime().toString();

/**
 * Task with an explicit duration. `end` defaults to `start` (a dummy value) — fine for a
 * task that is only ever a dependency's `to` (a leaf, whose OWN start/end is never read as
 * a predecessor position). A task used as a dependency's `from` (a predecessor) — most
 * importantly the `changedTaskIds` seed, whose position is NEVER overwritten by cascade —
 * MUST pass a correct `end` via `extra`: unlike `computeCriticalPath` (which derives ES/EF
 * purely from `duration`), `computeCascade` seeds each task's initial position directly
 * from `task.start`/`task.end` (see cascade.ts's `current` map), matching the real facade
 * contract that `start`/`end`/`duration` are always kept consistent (`moveTask`/
 * `resizeTask` always set both).
 */
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

let depSeq = 0;
function dep(from: TaskId, to: TaskId, type: DependencyType = 'FS', lag = 0): Dependency {
  depSeq++;
  return { id: toDependencyId(`dep-${depSeq}`), from, to, type, lag };
}

describe('computeCascade — 4 dependency types × positive/negative lag (mirrors CPM formula table)', () => {
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

  it.each(cases)('$type lag=$lag: pred moves later — successor pushed to match the formula', ({ type, lag }) => {
    // succ starts "on time" so it is currently satisfied only by coincidence; give it an
    // early original start so the push is unambiguous for every dep type/lag combination.
    // pred is `changedTaskIds` — its own position is read directly, never re-derived from
    // duration, so `end` must be explicit and correct (Mon 09:00 + 8h = Mon 17:00).
    const pred = task('pred', predStart, predDuration, { end: '2026-01-05T17:00' });
    const succ = task('succ', '2026-01-05T09:00', succDuration, { end: '2026-01-05T09:00' });
    const deps = [dep(pred.id, succ.id, type, lag)];

    const result = computeCascade([pred, succ], deps, cal, [pred.id]);

    let expectedEs;
    switch (type) {
      case 'FS':
        expectedEs = addWorkingHours(addWorkingHours(predStart, predDuration, cal), lag, cal);
        break;
      case 'SS':
        expectedEs = addWorkingHours(predStart, lag, cal);
        break;
      case 'FF':
        expectedEs = addWorkingHours(addWorkingHours(predStart, predDuration, cal), lag - succDuration, cal);
        break;
      case 'SF':
        expectedEs = addWorkingHours(predStart, lag - succDuration, cal);
        break;
    }
    const expectedEf = addWorkingHours(expectedEs, succDuration, cal);

    // Only asserts a shift happened when candidateEs is actually later than succ's original
    // start (2026-01-05T09:00) — true for all 8 cases here since pred's own EF/ES is already
    // >= Mon 09:00 and lag/duration keep the candidate at/after that instant... except when it
    // isn't (SF/FF negative lag can pull the candidate earlier than succ's original start).
    const origStart = normalizeDate('2026-01-05T09:00', cal.timezone);
    if (wall(expectedEs) > wall(origStart)) {
      expect(result.shifts).toHaveLength(1);
      expect(result.shifts[0]!.taskId).toBe(succ.id);
      expect(wall(result.shifts[0]!.start)).toBe(wall(expectedEs));
      expect(wall(result.shifts[0]!.end)).toBe(wall(expectedEf));
    } else {
      expect(result.shifts).toHaveLength(0);
    }
  });
});

describe('computeCascade — push-only', () => {
  it('successor with slack (predecessor moves later, but not enough to violate) → shifts empty', () => {
    const pred = task('pred', '2026-01-05T09:00', 4, { end: '2026-01-05T13:00' }); // EF Mon 13:00
    const succ = task('succ', '2026-01-06T09:00', 4); // starts Tue — plenty of slack for FS lag 0
    const deps = [dep(pred.id, succ.id, 'FS', 0)];

    const result = computeCascade([pred, succ], deps, cal, [pred.id]);
    expect(result.shifts).toHaveLength(0);
  });

  it('predecessor moves EARLIER than its old position → successor is never pulled earlier (shifts empty)', () => {
    // succ already sits comfortably after pred's (now earlier) EF.
    const pred = task('pred', '2026-01-05T09:00', 2, { end: '2026-01-05T11:00' }); // EF Mon 11:00 (already moved earlier by caller)
    const succ = task('succ', '2026-01-06T09:00', 4); // Tue 09:00, well after Mon 11:00
    const deps = [dep(pred.id, succ.id, 'FS', 0)];

    const result = computeCascade([pred, succ], deps, cal, [pred.id]);
    expect(result.shifts).toHaveLength(0);
  });

  it('directly-changed task is never included in shifts, even as its own successor is unaffected', () => {
    const pred = task('pred', '2026-01-05T09:00', 8, { end: '2026-01-05T17:00' });
    const succ = task('succ', '2026-01-06T09:00', 100); // far enough ahead: never violated
    const deps = [dep(pred.id, succ.id, 'FS', 0)];

    const result = computeCascade([pred, succ], deps, cal, [pred.id]);
    expect(result.shifts.some((s) => s.taskId === pred.id)).toBe(false);
  });
});

describe('computeCascade — transitive chain (A→B→C→D, move A later)', () => {
  it('B, C, D all shift, each pushed by exactly one working day, in topological order', () => {
    const A = task('A', '2026-01-06T09:00', 8, { end: '2026-01-06T17:00' }); // A moved to Tue (was Mon)
    const B = task('B', '2026-01-05T09:00', 8);
    const C = task('C', '2026-01-06T09:00', 8);
    const D = task('D', '2026-01-07T09:00', 8);
    const deps = [dep(A.id, B.id, 'FS', 0), dep(B.id, C.id, 'FS', 0), dep(C.id, D.id, 'FS', 0)];

    const result = computeCascade([A, B, C, D], deps, cal, [A.id]);

    expect(result.shifts.map((s) => s.taskId)).toEqual([B.id, C.id, D.id]);
    expect(wall(result.shifts[0]!.start)).toBe('2026-01-06T17:00:00'); // A's new EF
    expect(wall(result.shifts[1]!.start)).toBe('2026-01-07T17:00:00');
    expect(wall(result.shifts[2]!.start)).toBe('2026-01-08T17:00:00');
  });
});

describe('computeCascade — diamond dependency (A→B, A→C, B→D, C→D)', () => {
  it('D shifts exactly once, to the max of the two candidate earliest-starts', () => {
    const A = task('A', '2026-01-06T09:00', 2, { end: '2026-01-06T11:00' }); // moved to Tue; EF Tue 11:00
    const B = task('B', '2026-01-05T09:00', 6); // duration 6 -> if pushed, EF = start+6h
    const C = task('C', '2026-01-05T09:00', 1); // duration 1 -> shorter branch
    const D = task('D', '2026-01-05T09:00', 1);
    const deps = [
      dep(A.id, B.id, 'FS', 0),
      dep(A.id, C.id, 'FS', 0),
      dep(B.id, D.id, 'FS', 0),
      dep(C.id, D.id, 'FS', 0),
    ];

    const result = computeCascade([A, B, C, D], deps, cal, [A.id]);

    // B pushed to A.EF = Tue 11:00, EF = Tue 17:00 (6h).
    const bShift = result.shifts.find((s) => s.taskId === B.id)!;
    expect(wall(bShift.start)).toBe('2026-01-06T11:00:00');
    expect(wall(bShift.end)).toBe('2026-01-06T17:00:00');

    // C pushed to A.EF = Tue 11:00, EF = Tue 12:00 (1h).
    const cShift = result.shifts.find((s) => s.taskId === C.id)!;
    expect(wall(cShift.start)).toBe('2026-01-06T11:00:00');
    expect(wall(cShift.end)).toBe('2026-01-06T12:00:00');

    // D visited exactly once: candidate via B (Tue 17:00) vs via C (Tue 12:00) → max = B's.
    const dShifts = result.shifts.filter((s) => s.taskId === D.id);
    expect(dShifts).toHaveLength(1);
    expect(wall(dShifts[0]!.start)).toBe('2026-01-06T17:00:00');
    // duration 1h from Tue 17:00 (a working-window boundary) rolls into Wed's window.
    expect(wall(dShifts[0]!.end)).toBe('2026-01-07T10:00:00');

    // Topological order: B and C before D.
    const order = result.shifts.map((s) => s.taskId);
    expect(order.indexOf(D.id)).toBeGreaterThan(order.indexOf(B.id));
    expect(order.indexOf(D.id)).toBeGreaterThan(order.indexOf(C.id));
  });
});

describe('computeCascade — resize cascade (duration-sensitive FF/SF)', () => {
  it('FS successor shifts by the same rule as a move; FF successor reflects the new predFinish', () => {
    // Mover (resized): end pushed from Mon 13:00 to Mon 17:00 (duration 4h -> 8h).
    const mover = task('mover', '2026-01-05T09:00', 8, { end: '2026-01-05T17:00' }); // "already resized" — end now Mon 17:00
    const fsSucc = task('fs-succ', '2026-01-05T09:00', 2); // originally right after old EF (13:00) — now violated
    const ffSucc = task('ff-succ', '2026-01-05T09:00', 3); // FF: succ.EF >= pred.EF + lag

    const deps = [dep(mover.id, fsSucc.id, 'FS', 0), dep(mover.id, ffSucc.id, 'FF', 0)];

    const result = computeCascade([mover, fsSucc, ffSucc], deps, cal, [mover.id]);

    const fsShift = result.shifts.find((s) => s.taskId === fsSucc.id)!;
    expect(wall(fsShift.start)).toBe('2026-01-05T17:00:00'); // mover's new EF
    expect(wall(fsShift.end)).toBe('2026-01-06T11:00:00'); // +2h (rolls to Tue)

    // FF: succ.EF >= mover.EF (Mon 17:00) + lag(0) → succ.ES = EF - succDuration(3h) = Mon 14:00.
    const ffShift = result.shifts.find((s) => s.taskId === ffSucc.id)!;
    expect(wall(ffShift.start)).toBe('2026-01-05T14:00:00');
    expect(wall(ffShift.end)).toBe('2026-01-05T17:00:00');
  });
});

describe('computeCascade — non-working-day / holiday skip', () => {
  it('predecessor EF = Fri 16:00, FS lag 2 → successor pushed jumps over the weekend to Mon 10:00', () => {
    const P = task('P', '2026-01-02T09:00', 7, { end: '2026-01-02T16:00' }); // Fri 09:00 + 7h = Fri 16:00
    const S = task('S', '2026-01-02T09:00', 3); // originally same day — now violated
    const deps = [dep(P.id, S.id, 'FS', 2)];

    const result = computeCascade([P, S], deps, cal, [P.id]);
    expect(result.shifts).toHaveLength(1);
    expect(wall(result.shifts[0]!.start)).toBe('2026-01-05T10:00:00');
  });

  it('same case but Mon is a holiday → jumps to Tue 10:00', () => {
    const withHoliday: WorkingCalendar = { ...cal, holidays: ['2026-01-05'] };
    const P = task('P', '2026-01-02T09:00', 7, { end: '2026-01-02T16:00' });
    const S = task('S', '2026-01-02T09:00', 3);
    const deps = [dep(P.id, S.id, 'FS', 2)];

    const result = computeCascade([P, S], deps, withHoliday, [P.id]);
    expect(wall(result.shifts[0]!.start)).toBe('2026-01-06T10:00:00');
  });
});

describe('computeCascade — DST boundary (America/New_York, spring-forward 2026-03-08)', () => {
  it('pushing a successor across a DST weekend stays wall-clock correct', () => {
    const ny: WorkingCalendar = { ...cal, timezone: 'America/New_York' };
    const P = task('P', '2026-03-06T09:00', 7, { end: '2026-03-06T16:00' }); // Fri 09:00 + 7h = Fri 16:00
    const S = task('S', '2026-03-06T09:00', 1); // originally same day — violated
    const deps = [dep(P.id, S.id, 'FS', 2)];

    const result = computeCascade([P, S], deps, ny, [P.id]);
    expect(wall(result.shifts[0]!.start)).toBe('2026-03-09T10:00:00');
    expect(result.shifts[0]!.start.timeZoneId).toBe('America/New_York');
  });
});

describe('computeCascade — multi-timezone', () => {
  const timezones = ['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'];

  it.each(timezones)('%s: FS chain of 2 tasks, pred moves later → successor pushed', (timezone) => {
    const zoned: WorkingCalendar = { ...cal, timezone };
    const A = task('A', '2026-01-06T09:00', 8, { end: '2026-01-06T17:00' }); // moved to Tue
    const B = task('B', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, B.id, 'FS', 0)];

    const result = computeCascade([A, B], deps, zoned, [A.id]);
    expect(result.shifts).toHaveLength(1);
    expect(result.shifts[0]!.start.timeZoneId).toBe(timezone);
  });
});

describe('computeCascade — cycle throws', () => {
  it('self-loop (A→A) throws CyclicDependencyError, message mentions computeCascade', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, A.id)];
    expect(() => computeCascade([A], deps, cal, [A.id])).toThrow(CyclicDependencyError);
    expect(() => computeCascade([A], deps, cal, [A.id])).toThrow(/computeCascade/);
  });

  it('indirect cycle (A→B→C→A) throws CyclicDependencyError, no infinite loop', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const B = task('B', '2026-01-05T09:00', 4);
    const C = task('C', '2026-01-05T09:00', 4);
    const deps = [dep(A.id, B.id), dep(B.id, C.id), dep(C.id, A.id)];
    expect(() => computeCascade([A, B, C], deps, cal, [A.id])).toThrow(CyclicDependencyError);
  });
});

describe('computeCascade — idempotency', () => {
  it('calling computeCascade twice with the second call reflecting the first call\'s shifts applied → second call is empty', () => {
    const A = task('A', '2026-01-06T09:00', 8, { end: '2026-01-06T17:00' });
    const B = task('B', '2026-01-05T09:00', 8);
    const C = task('C', '2026-01-06T09:00', 8);
    const deps = [dep(A.id, B.id, 'FS', 0), dep(B.id, C.id, 'FS', 0)];

    const first = computeCascade([A, B, C], deps, cal, [A.id]);
    expect(first.shifts.length).toBeGreaterThan(0);

    const patched = [A, B, C].map((t) => {
      const shift = first.shifts.find((s) => s.taskId === t.id);
      return shift ? { ...t, start: shift.start, end: shift.end } : t;
    });

    const second = computeCascade(patched, deps, cal, [A.id]);
    expect(second.shifts).toHaveLength(0);
  });
});

describe('computeCascade — changedTaskIds / input validation', () => {
  it('throws when a changed id is not present in tasks', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    expect(() => computeCascade([A], [], cal, [toTaskId('ghost')])).toThrow(/not found/);
  });

  it('throws on duplicate task id', () => {
    const A1 = task('dup', '2026-01-05T09:00', 4);
    const A2 = task('dup', '2026-01-06T09:00', 4);
    expect(() => computeCascade([A1, A2], [], cal, [A1.id])).toThrow(/duplicate task id/);
  });

  it('throws when a dependency references a non-existent task', () => {
    const A = task('A', '2026-01-05T09:00', 4);
    const ghost = toTaskId('ghost');
    const deps = [dep(A.id, ghost)];
    expect(() => computeCascade([A], deps, cal, [A.id])).toThrow(/does not exist/);
  });
});
