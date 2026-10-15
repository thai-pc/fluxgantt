// Unit tests for the pure `detectConflicts` (spec-detect-conflicts.md §7). Headless.
import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { detectConflicts } from '../../src/compute/conflicts.js';
import { DEFAULT_CALENDAR, addWorkingHours } from '../../src/compute/working-calendar.js';
import { earliestStartFromPredecessor } from '../../src/compute/dependency-math.js';
import {
  toDependencyId,
  toTaskId,
  type Conflict,
  type DateInput,
  type Dependency,
  type DependencyType,
  type Task,
  type WorkingCalendar,
} from '../../src/types.js';

const now = new Date('2026-01-01T00:00:00Z');
const cal = DEFAULT_CALENDAR; // Mon-Fri 09:00-17:00 UTC; 2026-01-05 is a Monday.

function task(id: string, start: DateInput, end: DateInput, extra: Partial<Task> = {}): Task {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', createdAt: now, updatedAt: now, ...extra };
}
function dep(id: string, from: string, to: string, type: DependencyType = 'FS', lag?: number): Dependency {
  return { id: toDependencyId(id), from: toTaskId(from), to: toTaskId(to), type, ...(lag === undefined ? {} : { lag }) };
}
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o) && !(o instanceof Date) && !('epochNanoseconds' in o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
const dv = (cs: readonly Conflict[]) => cs.filter((c) => c.kind === 'dependency-violation');

describe('detectConflicts — basics', () => {
  it('returns [] for an empty chart and for tasks without dependencies', () => {
    expect(detectConflicts([], [], cal)).toEqual([]);
    expect(detectConflicts([task('a', '2026-01-05T09:00', '2026-01-05T17:00')], [], cal)).toEqual([]);
  });

  it('throws on a duplicate id and on invalid duration / lag, but not on a missing dependency endpoint', () => {
    const a = task('a', '2026-01-05T09:00', '2026-01-05T17:00');
    expect(() => detectConflicts([a, a], [], cal)).toThrow(/duplicate task id/);
    expect(() => detectConflicts([{ ...a, duration: Number.NaN }], [], cal)).toThrow(/invalid duration/);
    expect(() => detectConflicts([{ ...a, duration: -1 }], [], cal)).toThrow(/>= 0/);
    expect(() => detectConflicts([{ ...a, duration: 1e9 }], [], cal)).toThrow(/maximum/);
    const b = task('b', '2026-01-06T09:00', '2026-01-06T17:00');
    expect(() => detectConflicts([a, b], [dep('d', 'a', 'b', 'FS', Number.POSITIVE_INFINITY)], cal)).toThrow(/invalid lag/);
    expect(detectConflicts([a], [dep('d', 'a', 'ghost'), dep('e', 'ghost', 'a')], cal)).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const tasks = deepFreeze([
      task('p', '2026-01-05T09:00', '2026-01-05T17:00'),
      task('c', '2026-01-05T10:00', '2026-01-05T11:00', { parent: toTaskId('p') }),
      task('bad', '2026-01-07T09:00', '2026-01-06T09:00'),
    ]);
    const deps = deepFreeze([dep('d', 'p', 'c', 'FS', 2)]);
    expect(() => detectConflicts(tasks, deps, cal)).not.toThrow();
  });

  it('normalizes ISO string, Date, PlainDate and ZonedDateTime inputs identically', () => {
    const pred = task('a', '2026-01-05T09:00', '2026-01-05T17:00');
    const forms: DateInput[] = [
      '2026-01-05T10:00:00Z',
      new Date('2026-01-05T10:00:00Z'),
      Temporal.ZonedDateTime.from('2026-01-05T10:00:00[UTC]'),
    ];
    const results = forms.map((f) => detectConflicts([pred, task('b', f, '2026-01-05T12:00')], [dep('d', 'a', 'b')], cal));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]).toHaveLength(1);
    // PlainDate: midnight of the day, which is earlier than the predecessor's end.
    const pd = detectConflicts([pred, task('b', Temporal.PlainDate.from('2026-01-05'), '2026-01-05T12:00')], [dep('d', 'a', 'b')], cal);
    expect(pd).toHaveLength(1);
  });
});

describe('detectConflicts — dependency-violation', () => {
  const pred = task('a', '2026-01-05T09:00', '2026-01-05T17:00'); // Mon

  it('FS: satisfied, exactly equal (strict >) and violated with exact payload', () => {
    const d = [dep('d', 'a', 'b')];
    expect(detectConflicts([pred, task('b', '2026-01-06T09:00', '2026-01-06T10:00')], d, cal)).toEqual([]);
    expect(detectConflicts([pred, task('b', '2026-01-05T17:00', '2026-01-06T10:00')], d, cal)).toEqual([]);
    const [c] = detectConflicts([pred, task('b', '2026-01-05T16:00', '2026-01-06T10:00')], d, cal);
    expect(c).toMatchObject({
      kind: 'dependency-violation',
      dependencyId: 'd',
      from: 'a',
      to: 'b',
      dependencyType: 'FS',
      lagHours: 0,
      shortfallHours: 1,
    });
    expect((c as { requiredStart: Temporal.ZonedDateTime }).requiredStart.toString()).toBe('2026-01-05T17:00:00+00:00[UTC]');
  });

  it('SS: satisfied, equal, violated', () => {
    const d = [dep('d', 'a', 'b', 'SS')];
    expect(detectConflicts([pred, task('b', '2026-01-05T09:00', '2026-01-05T12:00')], d, cal)).toEqual([]);
    expect(detectConflicts([pred, task('b', '2026-01-05T10:00', '2026-01-05T12:00')], d, cal)).toEqual([]);
    const [c] = detectConflicts([pred, task('b', '2026-01-04T10:00', '2026-01-05T12:00')], d, cal);
    expect(c).toMatchObject({ kind: 'dependency-violation', dependencyType: 'SS' });
  });

  it('FF: succ.end >= pred.end + lag (required start is implied by the duration)', () => {
    const longPred = task('a', '2026-01-05T09:00', '2026-01-06T17:00'); // 16h
    const d = [dep('d', 'a', 'b', 'FF')];
    const ok = task('b', '2026-01-06T09:00', '2026-01-06T17:00', { duration: 8 }); // ends with pred
    expect(detectConflicts([longPred, ok], d, cal)).toEqual([]);
    const bad = task('b', '2026-01-05T09:00', '2026-01-05T17:00', { duration: 8 });
    const [c] = detectConflicts([longPred, bad], d, cal);
    expect(c).toMatchObject({ kind: 'dependency-violation', dependencyType: 'FF', shortfallHours: 8 });
    expect((c as { requiredStart: Temporal.ZonedDateTime }).requiredStart.toString()).toBe('2026-01-06T09:00:00+00:00[UTC]');
  });

  it('SF: succ.end >= pred.start + lag', () => {
    const d = [dep('d', 'a', 'b', 'SF')];
    const later = task('a', '2026-01-06T09:00', '2026-01-06T17:00');
    const succ = task('b', '2026-01-05T09:00', '2026-01-05T17:00', { duration: 8 });
    expect(detectConflicts([later, succ], d, cal)).toEqual([]); // exactly equal
    const latest = task('a', '2026-01-07T09:00', '2026-01-07T17:00');
    const [c] = detectConflicts([latest, succ], d, cal);
    expect(c).toMatchObject({ dependencyType: 'SF', shortfallHours: 8 });
  });

  it('positive lag (wait) moves the boundary later, including across a weekend and a holiday', () => {
    const friPred = task('a', '2026-01-09T09:00', '2026-01-09T17:00'); // Fri
    const d = [dep('d', 'a', 'b', 'FS', 8)];
    // Fri 17:00 + 8 working hours = Mon 17:00.
    expect(detectConflicts([friPred, task('b', '2026-01-12T17:00', '2026-01-13T10:00')], d, cal)).toEqual([]);
    const [c] = detectConflicts([friPred, task('b', '2026-01-12T09:00', '2026-01-12T17:00')], d, cal);
    expect(c).toMatchObject({ lagHours: 8, shortfallHours: 8 });
    // A Monday holiday pushes the boundary to Tue 17:00.
    const hol: WorkingCalendar = { ...cal, holidays: ['2026-01-12'] };
    expect(detectConflicts([friPred, task('b', '2026-01-12T17:00', '2026-01-13T10:00')], d, hol)).toHaveLength(1);
    expect(detectConflicts([friPred, task('b', '2026-01-13T17:00', '2026-01-14T10:00')], d, hol)).toEqual([]);
  });

  it('negative lag (lead): overlap within the lead is fine, beyond it is a conflict', () => {
    const d = [dep('d', 'a', 'b', 'FS', -4)];
    // Allowed to start from Mon 13:00.
    expect(detectConflicts([pred, task('b', '2026-01-05T13:00', '2026-01-06T10:00')], d, cal)).toEqual([]);
    const [c] = detectConflicts([pred, task('b', '2026-01-05T12:00', '2026-01-06T10:00')], d, cal);
    expect(c).toMatchObject({ lagHours: -4, shortfallHours: 1 });
  });

  it('reports "shortfall 0 but violated" when the gap is only non-working time', () => {
    // Pred ends Fri 17:00; succ starts Sat 10:00: required (Fri 17:00) < start, so no conflict.
    // Reverse: pred ends Sat-normalized? Use lag so required lands in a non-working gap.
    const friPred = task('a', '2026-01-09T09:00', '2026-01-09T17:00');
    const succ = task('b', '2026-01-09T17:00', '2026-01-12T09:00'); // starts at pred.end: fine
    expect(detectConflicts([friPred, succ], [dep('d', 'a', 'b')], cal)).toEqual([]);
    const early = task('b', '2026-01-09T16:59:59', '2026-01-12T10:00');
    const [c] = detectConflicts([friPred, early], [dep('d', 'a', 'b')], cal);
    expect(c!.kind).toBe('dependency-violation');
    // Successor starts on Sunday, predecessor ends later on the same non-working Sunday.
    const sunPred = task('a', '2026-01-09T09:00', '2026-01-11T18:00');
    const sunSucc = task('b', '2026-01-11T10:00', '2026-01-12T12:00');
    const [z] = detectConflicts([sunPred, sunSucc], [dep('d', 'a', 'b')], cal);
    expect(z).toMatchObject({ kind: 'dependency-violation', shortfallHours: 0 });
  });

  it('fast path (FS/SS, lag 0) is identical to earliestStartFromPredecessor', () => {
    for (const type of ['FS', 'SS'] as const) {
      const [c] = detectConflicts(
        [pred, task('b', '2026-01-05T09:30', '2026-01-05T10:00')],
        [dep('d', 'a', 'b', type, 0)],
        cal,
      );
      const expected = earliestStartFromPredecessor(
        Temporal.ZonedDateTime.from('2026-01-05T09:00:00[UTC]'),
        Temporal.ZonedDateTime.from('2026-01-05T17:00:00[UTC]'),
        type,
        0,
        0,
        cal,
      );
      if (type === 'FS') {
        expect(Temporal.ZonedDateTime.compare((c as { requiredStart: Temporal.ZonedDateTime }).requiredStart, expected)).toBe(0);
      } else expect(c).toBeUndefined(); // SS: succ starts 09:30 >= 09:00
    }
  });

  it('a task on a non-working day and a milestone with a non-zero span are NOT conflicts', () => {
    const sat = task('s', '2026-01-10T10:00', '2026-01-10T12:00');
    const ms = task('m', '2026-01-05T09:00', '2026-01-06T09:00', { type: 'milestone' });
    expect(detectConflicts([sat, ms], [], cal)).toEqual([]);
  });

  it('a cycle (allowCycle) neither throws nor loops', () => {
    const a = task('a', '2026-01-05T09:00', '2026-01-05T17:00');
    const b = task('b', '2026-01-05T09:00', '2026-01-05T17:00');
    const r = detectConflicts([a, b], [dep('d1', 'a', 'b'), dep('d2', 'b', 'a'), dep('d3', 'a', 'a')], cal);
    expect(dv(r).length).toBe(3);
  });
});

describe('detectConflicts — outside-parent', () => {
  const parent = task('p', '2026-01-06T09:00', '2026-01-07T17:00');
  const kid = (s: string, e: string, id = 'c') => task(id, s, e, { parent: toTaskId('p') });

  it('reports start, end, both, and nothing when exactly equal', () => {
    const edge = (c: Task) => (detectConflicts([parent, c], [], cal)[0] as { edge?: string } | undefined)?.edge;
    expect(edge(kid('2026-01-05T09:00', '2026-01-07T09:00'))).toBe('start');
    expect(edge(kid('2026-01-06T09:00', '2026-01-08T09:00'))).toBe('end');
    expect(edge(kid('2026-01-05T09:00', '2026-01-08T09:00'))).toBe('both');
    expect(edge(kid('2026-01-06T09:00', '2026-01-07T17:00'))).toBeUndefined();
  });

  it('ignores a dangling parent id, honours `kinds`, and checks each level of a deep chain', () => {
    expect(detectConflicts([task('x', '2026-01-05T09:00', '2026-01-05T10:00', { parent: toTaskId('ghost') })], [], cal)).toEqual([]);
    const c = kid('2026-01-05T09:00', '2026-01-07T09:00');
    expect(detectConflicts([parent, c], [], cal, { kinds: ['dependency-violation'] })).toEqual([]);
    expect(detectConflicts([parent, c], [], cal, { kinds: ['outside-parent'] })).toHaveLength(1);
    const grand = task('g', '2026-01-04T09:00', '2026-01-07T09:00', { parent: toTaskId('c') });
    const r = detectConflicts([parent, c, grand], [], cal);
    expect(r.map((x) => (x as { taskId: string }).taskId)).toEqual(['c', 'g']);
  });
});

describe('detectConflicts — invalid-span', () => {
  it('is reported, ignores an explicit duration, and excludes the task from the other checks', () => {
    const bad = task('bad', '2026-01-07T09:00', '2026-01-06T09:00', { duration: 8, parent: toTaskId('p') });
    const p = task('p', '2026-01-08T09:00', '2026-01-09T09:00');
    const ok = task('ok', '2026-01-05T09:00', '2026-01-05T10:00');
    const r = detectConflicts([bad, p, ok], [dep('d', 'ok', 'bad'), dep('e', 'bad', 'ok', 'FF')], cal);
    expect(r).toEqual([{ kind: 'invalid-span', taskId: 'bad' }]);
  });
});

describe('detectConflicts — ordering', () => {
  it('orders by kind rank then id, regardless of input order', () => {
    const tasks = [
      task('p', '2026-01-06T09:00', '2026-01-06T17:00'),
      task('k', '2026-01-05T09:00', '2026-01-06T17:00', { parent: toTaskId('p') }),
      task('z', '2026-01-09T09:00', '2026-01-08T09:00'),
      task('a', '2026-01-09T09:00', '2026-01-09T17:00'),
      task('b', '2026-01-09T09:00', '2026-01-09T17:00'),
    ];
    const deps = [dep('d2', 'a', 'b'), dep('d1', 'b', 'a')];
    const r = detectConflicts(tasks, deps, cal);
    expect(r.map((c) => c.kind)).toEqual(['invalid-span', 'dependency-violation', 'dependency-violation', 'outside-parent']);
    expect(r.filter((c) => c.kind === 'dependency-violation').map((c) => (c as { dependencyId: string }).dependencyId)).toEqual(['d1', 'd2']);
    expect(detectConflicts([...tasks].reverse(), [...deps].reverse(), cal)).toEqual(r);
  });
});

describe.each(['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York'])('detectConflicts — DST and timezones (%s)', (timezone) => {
  // A window that straddles the 02:00 transition in New_York; harmless elsewhere.
  const tzCal: WorkingCalendar = {
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    workingHours: [{ start: '00:00', end: '06:00' }],
    holidays: [],
    timezone,
  };
  const windows = [
    ['spring-forward', '2026-03-07T00:00', '2026-03-07T06:00'],
    ['fall-back', '2026-10-31T00:00', '2026-10-31T06:00'],
  ] as const;

  for (const type of ['FS', 'SS', 'FF', 'SF'] as const) {
    for (const lag of [-3, 0, 3, 7]) {
      for (const [label, s, e] of windows) {
        it(`${type} lag ${lag} across ${label}: exact instant is fine, 1 ns earlier conflicts`, () => {
          const pred = task('a', s, e);
          const succDur = 4;
          const mk = (start: DateInput): Task => task('b', start, addWorkingHours(start, succDur, tzCal), { duration: succDur });
          const d = [dep('d', 'a', 'b', type, lag)];
          // Find the required start by probing with a far-too-early successor.
          const probe = detectConflicts([pred, mk('2026-01-01T00:00')], d, tzCal);
          expect(probe).toHaveLength(1);
          const required = (probe[0] as { requiredStart: Temporal.ZonedDateTime }).requiredStart;
          expect(required.timeZoneId).toBe(timezone);
          expect(detectConflicts([pred, mk(required)], d, tzCal)).toEqual([]);
          const before = detectConflicts([pred, mk(required.subtract({ nanoseconds: 1 }))], d, tzCal);
          expect(before).toHaveLength(1);
          expect((before[0] as { shortfallHours: number }).shortfallHours).toBeGreaterThanOrEqual(0);
        });
      }
    }
  }
});

describe('detectConflicts — bounded cost', () => {
  const nyCal: WorkingCalendar = { ...DEFAULT_CALENDAR, timezone: 'America/New_York' };

  it.each([
    ['UTC', cal],
    ['America/New_York', nyCal],
  ])('a violated edge with a 1,900-year gap returns quickly (%s)', (_name, c) => {
    // Predecessor in 2026, successor ~1,900 years earlier: required is far after succ.start.
    const tasks = [
      task('a', '2026-01-05T09:00', '2026-01-05T17:00'),
      task('b', '0126-01-05T09:00', '0126-01-05T10:00'),
    ];
    const t0 = performance.now();
    const out = detectConflicts(tasks, [dep('d', 'a', 'b')], c);
    const ms = performance.now() - t0;
    expect(out).toHaveLength(1);
    expect(ms).toBeLessThan(1500); // was ~19 s before the fast path + cap
  });

  it('shortfallHours is a lower bound capped at ~100 years of gap, exact below it', () => {
    const far = detectConflicts(
      [task('a', '2026-01-05T09:00', '2026-01-05T17:00'), task('b', '1026-01-05T09:00', '1026-01-05T10:00')],
      [dep('d', 'a', 'b')],
      cal,
    )[0];
    const near = detectConflicts(
      [task('a', '2026-01-05T09:00', '2026-01-05T17:00'), task('b', '1926-01-05T09:00', '1926-01-05T10:00')],
      [dep('d', 'a', 'b')],
      cal,
    )[0];
    if (far?.kind !== 'dependency-violation' || near?.kind !== 'dependency-violation') throw new Error('expected violations');
    expect(far.shortfallHours).toBeGreaterThan(0);
    // 36,500 days of Mon-Fri 8 h: ~208k h; a 100-year-gap value must not grow with the gap.
    expect(far.shortfallHours).toBeLessThan(220_000);
    expect(near.shortfallHours).toBeGreaterThan(150_000);
  });

  it('1,000 tasks / 1,500 FS lag-0 dependencies detect well under the guard bound', () => {
    const tasks: Task[] = [];
    for (let i = 0; i < 1000; i++) {
      // Cheap wall-clock spans (2 h apart, 1 h long): FS/SS lag 0 never touches the calendar.
      const start = new Date(Date.UTC(2026, 0, 5, 0, 0) + i * 2 * 3_600_000);
      tasks.push(task(`t${i}`, start, new Date(start.getTime() + 3_600_000)));
    }
    const deps: Dependency[] = [];
    for (let i = 1; i < 1000; i++) deps.push(dep(`c${i}`, `t${i - 1}`, `t${i}`));
    for (let i = 2; i < 1000 && deps.length < 1500; i++) deps.push(dep(`s${i}`, `t${i - 2}`, `t${i}`));
    const t0 = performance.now();
    const out = detectConflicts(tasks, deps, cal);
    const ms = performance.now() - t0;
    expect(out).toEqual([]);
    expect(ms).toBeLessThan(2000); // generous: measured ~10 ms; guards against accidental O(n^2)
  });
});
