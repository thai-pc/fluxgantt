// Edge-case tests for computeRollup — spec-summary-rollup.md §6/§7.
import { describe, it, expect } from 'vitest';
import { computeRollup } from '../../src/compute/rollup.js';
import { MAX_HIERARCHY_DEPTH } from '../../src/compute/hierarchy.js';
import {
  DEFAULT_CALENDAR,
  normalizeDate,
  differenceInWorkingHours,
} from '../../src/compute/working-calendar.js';
import {
  toTaskId,
  type DateInput,
  type Task,
  type TaskId,
  type WorkingCalendar,
} from '../../src/types.js';

// Same calendar convention as critical-path.test.ts / cascade.test.ts: Mon-Fri 09:00-17:00, UTC.
// 2026-01-05 = Mon, 01-06 = Tue, 01-07 = Wed, 01-08 = Thu, 01-09 = Fri.
const cal = DEFAULT_CALENDAR;

/** A leaf task with a real start/end pair, so `resolveDuration` derives from the calendar
 *  rather than needing an explicit `duration` on every fixture. */
function task(id: string, start: DateInput, end: DateInput, extra: Partial<Task> = {}): Task {
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

function summary(id: string, extra: Partial<Task> = {}): Task {
  // A summary's own start/end are ignored whenever it has children (spec §5.1) — these
  // deliberately absurd values are what the "authored fields ignored" test asserts against.
  return task(id, '2099-01-04T09:00', '2099-01-04T17:00', { type: 'summary', ...extra });
}

const wall = (z: { toPlainDateTime(): { toString(): string } }): string =>
  z.toPlainDateTime().toString();

const parent = (id: string): Partial<Task> => ({ parent: toTaskId(id) });

describe('computeRollup — basic aggregation', () => {
  it('a summary over two tasks rolls up span, progress and duration', () => {
    const tasks = [
      summary('s'),
      task('a', '2026-01-05T09:00', '2026-01-05T17:00', { ...parent('s'), progress: 1 }),
      task('b', '2026-01-07T09:00', '2026-01-08T17:00', { ...parent('s'), progress: 0.5 }),
    ];
    const r = computeRollup(tasks, cal);

    expect(r.size).toBe(1); // only `s` has children
    const s = r.get(toTaskId('s'))!;
    expect(wall(s.start)).toBe('2026-01-05T09:00:00'); // min over children
    expect(wall(s.end)).toBe('2026-01-08T17:00:00'); // max over children
    // Span = Mon 09:00 → Thu 17:00 = 4 working days × 8h. NOT the 8+16=24h sum of children.
    expect(s.durationHours).toBeCloseTo(32, 6);
    // Duration-weighted: (8h × 1.0 + 16h × 0.5) / 24h = 16/24.
    expect(s.progress).toBeCloseTo(16 / 24, 6);
  });

  it("a summary's OWN authored start/end/progress are ignored when it has children (§5.1)", () => {
    const tasks = [
      summary('s', { progress: 0.99 }), // authored start/end are in 2099
      task('a', '2026-01-05T09:00', '2026-01-05T17:00', { ...parent('s'), progress: 0 }),
    ];
    const s = computeRollup(tasks, cal).get(toTaskId('s'))!;
    expect(wall(s.start)).toBe('2026-01-05T09:00:00');
    expect(wall(s.end)).toBe('2026-01-05T17:00:00');
    expect(s.progress).toBe(0);
  });

  it('weighted progress is not a flat mean: 80h at 100% + 20h at 0% = 0.8, not 0.5', () => {
    const tasks = [
      summary('s'),
      task('big', '2026-01-05T09:00', '2026-01-05T09:00', {
        ...parent('s'),
        duration: 80,
        progress: 1,
      }),
      task('small', '2026-01-05T09:00', '2026-01-05T09:00', {
        ...parent('s'),
        duration: 20,
        progress: 0,
      }),
    ];
    expect(computeRollup(tasks, cal).get(toTaskId('s'))!.progress).toBeCloseTo(0.8, 6);
  });

  it('nested summaries aggregate the level below their rolled-up value (§5.1, N6.8)', () => {
    const tasks = [
      summary('top'),
      summary('mid', parent('top')),
      summary('inner', parent('mid')),
      task('leaf1', '2026-01-05T09:00', '2026-01-05T17:00', { ...parent('inner'), progress: 1 }),
      task('leaf2', '2026-01-09T09:00', '2026-01-09T17:00', { ...parent('mid'), progress: 0 }),
    ];
    const r = computeRollup(tasks, cal);
    expect([...r.keys()].sort()).toEqual(['inner', 'mid', 'top']);

    const inner = r.get(toTaskId('inner'))!;
    expect(wall(inner.start)).toBe('2026-01-05T09:00:00');
    expect(wall(inner.end)).toBe('2026-01-05T17:00:00');
    expect(inner.progress).toBe(1);

    const mid = r.get(toTaskId('mid'))!;
    expect(wall(mid.start)).toBe('2026-01-05T09:00:00');
    expect(wall(mid.end)).toBe('2026-01-09T17:00:00');
    // `inner` contributes its ROLLED-UP 8h/100%, `leaf2` its own 8h/0% → 0.5.
    expect(mid.progress).toBeCloseTo(0.5, 6);

    const top = r.get(toTaskId('top'))!;
    expect(wall(top.start)).toBe(wall(mid.start));
    expect(wall(top.end)).toBe(wall(mid.end));
    expect(top.progress).toBeCloseTo(mid.progress, 6);
  });

  it('rolls up structurally, regardless of the parent row’s `type` (§3, N6.12)', () => {
    // `type` is host-supplied metadata; a host that parents rows under a plain task still
    // wants the aggregate. The renderer decides what draws a summary bar, not this function.
    const tasks = [
      task('p', '2099-01-04T09:00', '2099-01-04T17:00'), // type: 'task', but has a child
      task('c', '2026-01-05T09:00', '2026-01-06T17:00', parent('p')),
    ];
    const p = computeRollup(tasks, cal).get(toTaskId('p'))!;
    expect(wall(p.start)).toBe('2026-01-05T09:00:00');
    expect(wall(p.end)).toBe('2026-01-06T17:00:00');
  });

  it('never mutates its input', () => {
    const tasks = [
      summary('s'),
      task('a', '2026-01-05T09:00', '2026-01-05T17:00', { ...parent('s'), progress: 0.25 }),
    ];
    const before = JSON.stringify(tasks);
    computeRollup(tasks, cal);
    expect(JSON.stringify(tasks)).toBe(before);
  });

  it('`calendar` omitted is identical to explicitly passing DEFAULT_CALENDAR', () => {
    const tasks = [
      summary('s'),
      task('a', '2026-01-05T09:00', '2026-01-07T17:00', { ...parent('s'), progress: 0.4 }),
    ];
    const implicit = computeRollup(tasks).get(toTaskId('s'))!;
    const explicit = computeRollup(tasks, DEFAULT_CALENDAR).get(toTaskId('s'))!;
    expect(wall(implicit.start)).toBe(wall(explicit.start));
    expect(wall(implicit.end)).toBe(wall(explicit.end));
    expect(implicit.progress).toBe(explicit.progress);
    expect(implicit.durationHours).toBe(explicit.durationHours);
  });
});

describe('computeRollup — edge cases (spec §6)', () => {
  it('N6.1 dangling `parent` (points at no existing task) is treated as a root, no throw', () => {
    const tasks = [task('orphan', '2026-01-05T09:00', '2026-01-05T17:00', parent('nope'))];
    const r = computeRollup(tasks, cal);
    expect(r.size).toBe(0); // a root with no children of its own gets no entry
  });

  it('N6.2 a cyclic parent chain throws a plain Error, never infinite-loops', () => {
    const tasks = [
      task('a', '2026-01-05T09:00', '2026-01-05T17:00', parent('b')),
      task('b', '2026-01-05T09:00', '2026-01-05T17:00', parent('a')),
    ];
    expect(() => computeRollup(tasks, cal)).toThrow(/cyclic parent chain involving task/);
  });

  it('N6.2 a longer cycle (a -> b -> c -> a) throws too', () => {
    const tasks = [
      task('a', '2026-01-05T09:00', '2026-01-05T17:00', parent('c')),
      task('b', '2026-01-05T09:00', '2026-01-05T17:00', parent('a')),
      task('c', '2026-01-05T09:00', '2026-01-05T17:00', parent('b')),
    ];
    expect(() => computeRollup(tasks, cal)).toThrow(/cyclic parent chain/);
  });

  it('N6.2 self-parenting (`a.parent === a`) is a cycle, not silently a root', () => {
    const tasks = [task('a', '2026-01-05T09:00', '2026-01-05T17:00', parent('a'))];
    expect(() => computeRollup(tasks, cal)).toThrow(/cyclic parent chain involving task "a"/);
  });

  it('N6.3 an acyclic chain deeper than MAX_HIERARCHY_DEPTH gives a controlled throw', () => {
    // Deep enough to exceed the guard, and asserted on the message: a stack-exhaustion
    // `RangeError` would not match, so this genuinely proves the guard fires first.
    const tasks: Task[] = [];
    for (let i = 0; i <= MAX_HIERARCHY_DEPTH + 1; i++) {
      tasks.push(
        task(`t${i}`, '2026-01-05T09:00', '2026-01-05T17:00', i === 0 ? {} : parent(`t${i - 1}`)),
      );
    }
    expect(() => computeRollup(tasks, cal)).toThrow(/hierarchy nesting exceeds max depth/);
  });

  it('N6.4 a childless summary gets NO entry — the caller falls back to its own fields', () => {
    const tasks = [summary('lonely'), task('elsewhere', '2026-01-05T09:00', '2026-01-05T17:00')];
    const r = computeRollup(tasks, cal);
    expect(r.has(toTaskId('lonely'))).toBe(false);
    expect(r.size).toBe(0);
  });

  it('N6.5 hostile child `progress` is clamped, never propagated', () => {
    const cases: Array<{ progress: number; expected: number }> = [
      { progress: Number.NaN, expected: 0 },
      { progress: Number.POSITIVE_INFINITY, expected: 1 },
      { progress: -5, expected: 0 },
      { progress: 900, expected: 1 },
    ];
    for (const { progress, expected } of cases) {
      const tasks = [
        summary('s'),
        task('a', '2026-01-05T09:00', '2026-01-05T17:00', { ...parent('s'), progress }),
      ];
      expect(computeRollup(tasks, cal).get(toTaskId('s'))!.progress).toBe(expected);
    }
  });

  it('N6.6 all-milestone children: span from the instants, unweighted-mean progress', () => {
    // Every child is zero-duration, so the weighted denominator is 0 — the unweighted mean
    // must be used rather than leaking NaN.
    const milestone = (id: string, at: string, progress: number): Task =>
      task(id, at, at, { ...parent('s'), type: 'milestone', duration: 0, progress });
    const tasks = [
      summary('s'),
      milestone('m1', '2026-01-05T09:00', 1),
      milestone('m2', '2026-01-08T17:00', 0),
    ];
    const s = computeRollup(tasks, cal).get(toTaskId('s'))!;
    expect(wall(s.start)).toBe('2026-01-05T09:00:00');
    expect(wall(s.end)).toBe('2026-01-08T17:00:00');
    expect(s.progress).toBeCloseTo(0.5, 6);
    expect(Number.isNaN(s.progress)).toBe(false);
  });

  it('N6.6 a milestone sibling moves the span but carries weight 0 toward progress', () => {
    const tasks = [
      summary('s'),
      task('work', '2026-01-05T09:00', '2026-01-05T17:00', { ...parent('s'), progress: 1 }),
      task('ms', '2026-01-09T17:00', '2026-01-09T17:00', {
        ...parent('s'),
        type: 'milestone',
        duration: 0,
        progress: 0,
      }),
    ];
    const s = computeRollup(tasks, cal).get(toTaskId('s'))!;
    expect(wall(s.end)).toBe('2026-01-09T17:00:00'); // the milestone extended the span
    expect(s.progress).toBe(1); // ...but did not dilute the percentage
  });

  it('N6.7 a child with `end` before `start` and no duration propagates the throw', () => {
    const tasks = [summary('s'), task('bad', '2026-01-08T09:00', '2026-01-05T17:00', parent('s'))];
    expect(() => computeRollup(tasks, cal)).toThrow(
      /end before its start and no explicit duration/,
    );
  });

  it('N6.10 an empty task array returns an empty map, no throw', () => {
    expect(computeRollup([], cal).size).toBe(0);
  });

  it('N6.11 sibling order in the input array does not change the result', () => {
    const base = [
      summary('s'),
      task('a', '2026-01-05T09:00', '2026-01-05T17:00', { ...parent('s'), progress: 1 }),
      task('b', '2026-01-07T09:00', '2026-01-08T17:00', { ...parent('s'), progress: 0.5 }),
      task('c', '2026-01-06T09:00', '2026-01-06T17:00', { ...parent('s'), progress: 0.25 }),
    ];
    const forward = computeRollup(base, cal).get(toTaskId('s'))!;
    const reversed = computeRollup([...base].reverse(), cal).get(toTaskId('s'))!;
    expect(wall(reversed.start)).toBe(wall(forward.start));
    expect(wall(reversed.end)).toBe(wall(forward.end));
    expect(reversed.progress).toBeCloseTo(forward.progress, 9);
    expect(reversed.durationHours).toBeCloseTo(forward.durationHours, 9);
  });

  it('a flat project with no hierarchy at all returns an empty map', () => {
    const tasks = [
      task('a', '2026-01-05T09:00', '2026-01-05T17:00'),
      task('b', '2026-01-06T09:00', '2026-01-06T17:00'),
    ];
    expect(computeRollup(tasks, cal).size).toBe(0);
  });
});

describe('computeRollup — timezones and DST (spec §6.9)', () => {
  const timezones = ['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'];

  for (const timezone of timezones) {
    it(`aggregates correctly in ${timezone}`, () => {
      const zoned: WorkingCalendar = { ...DEFAULT_CALENDAR, timezone };
      const tasks = [
        summary('s'),
        task('a', '2026-01-05T09:00', '2026-01-05T17:00', { ...parent('s'), progress: 1 }),
        task('b', '2026-01-07T09:00', '2026-01-08T17:00', { ...parent('s'), progress: 0 }),
      ];
      const s = computeRollup(tasks, zoned).get(toTaskId('s'))!;
      // The wall-clock span is the same in every zone (inputs are zone-less wall times), and
      // `durationHours` is re-derived by the same calendar, so it must agree with a direct call.
      expect(wall(s.start)).toBe('2026-01-05T09:00:00');
      expect(wall(s.end)).toBe('2026-01-08T17:00:00');
      expect(s.start.timeZoneId).toBe(timezone);
      expect(s.durationHours).toBeCloseTo(differenceInWorkingHours(s.start, s.end, zoned), 6);
    });
  }

  it('a subtree spanning a US spring-forward transition keeps start <= end and a sane span', () => {
    // 2026-03-08 is the US DST spring-forward date (02:00 -> 03:00 local).
    const ny: WorkingCalendar = { ...DEFAULT_CALENDAR, timezone: 'America/New_York' };
    const tasks = [
      summary('s'),
      task('before', '2026-03-06T09:00', '2026-03-06T17:00', { ...parent('s'), progress: 1 }),
      task('after', '2026-03-09T09:00', '2026-03-10T17:00', { ...parent('s'), progress: 0 }),
    ];
    const s = computeRollup(tasks, ny).get(toTaskId('s'))!;
    expect(wall(s.start)).toBe('2026-03-06T09:00:00');
    expect(wall(s.end)).toBe('2026-03-10T17:00:00');
    // Fri + Mon + Tue working days inside the span = 3 × 8h; the lost hour falls on a Sunday
    // (a non-working day), so it must NOT be subtracted from the working-hour span.
    expect(s.durationHours).toBeCloseTo(24, 6);
    expect(s.start.epochNanoseconds <= s.end.epochNanoseconds).toBe(true);
  });

  it('normalizes a Date / Temporal input the same way the calendar does', () => {
    const tasks = [
      summary('s'),
      task('a', new Date(Date.UTC(2026, 0, 5, 9, 0)), new Date(Date.UTC(2026, 0, 5, 17, 0)), {
        ...parent('s'),
        progress: 1,
      }),
    ];
    const s = computeRollup(tasks, cal).get(toTaskId('s'))!;
    expect(s.start.epochNanoseconds).toBe(
      normalizeDate(new Date(Date.UTC(2026, 0, 5, 9, 0)), cal.timezone).epochNanoseconds,
    );
  });
});

describe('computeRollup — key set', () => {
  it('every key has at least one child, and no leaf is ever a key (§3)', () => {
    const tasks = [
      summary('root'),
      summary('branch', parent('root')),
      task('leaf-a', '2026-01-05T09:00', '2026-01-05T17:00', parent('branch')),
      task('leaf-b', '2026-01-06T09:00', '2026-01-06T17:00', parent('root')),
      task('island', '2026-01-07T09:00', '2026-01-07T17:00'),
    ];
    const r = computeRollup(tasks, cal);
    expect([...r.keys()].sort()).toEqual(['branch', 'root']);
    const leaves: TaskId[] = [toTaskId('leaf-a'), toTaskId('leaf-b'), toTaskId('island')];
    for (const id of leaves) expect(r.has(id)).toBe(false);
  });
});
