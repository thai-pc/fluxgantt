// CPM slack now comes from one shared day-table meter (`workingHoursMeter`) instead of a day walk
// per task. These tests pin it to an independent day-walk oracle on random graphs, including
// negative lag (where LS can precede ES, so the table must cover LS before ES), several zones and
// DST-straddling start dates; plus a deterministic work-count tripwire against the O(N x span) walk.
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { Temporal } from '@js-temporal/polyfill';
import { computeCriticalPath } from '../../src/compute/critical-path.js';
import {
  toTaskId,
  toDependencyId,
  type Dependency,
  type DependencyType,
  type Task,
  type WorkingCalendar,
} from '../../src/types.js';
import { METER_CALENDARS, dayWalkDifference } from '../helpers/day-walk.js';

const ZONES: Array<[string, WorkingCalendar, string]> = [
  ['UTC', METER_CALENDARS.utc!, '2026-01-05T09:00'],
  ['Asia/Ho_Chi_Minh', METER_CALENDARS.hcm!, '2026-02-09T08:00'],
  // Starts 4 days before the 2026-03-08 spring-forward so the graph straddles it.
  ['America/New_York (spring-forward)', { ...METER_CALENDARS.newYorkNight!, holidays: ['2026-03-12'] }, '2026-03-04T01:00'],
  ['America/New_York (fall-back)', METER_CALENDARS.newYorkSplit!, '2026-10-28T09:00'],
];

function makeTasks(durations: number[], start: string): Task[] {
  const now = new Date();
  return durations.map((duration, i) => ({
    id: toTaskId(`t${i}`),
    name: `t${i}`,
    start,
    end: start,
    duration,
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
  }));
}

interface Spec {
  durations: number[];
  edges: Array<{ from: number; to: number; type: DependencyType; lag: number }>;
}

const specArb: fc.Arbitrary<Spec> = fc.integer({ min: 2, max: 8 }).chain((n) =>
  fc.record({
    durations: fc.array(fc.integer({ min: 1, max: 60 }), { minLength: n, maxLength: n }),
    edges: fc.array(
      fc.integer({ min: 0, max: n - 2 }).chain((from) =>
        fc.record({
          from: fc.constant(from),
          to: fc.integer({ min: from + 1, max: n - 1 }),
          type: fc.constantFrom<DependencyType>('FS', 'SS', 'FF', 'SF'),
          lag: fc.integer({ min: -30, max: 30 }), // negative lag = lead: LS can land before ES
        }),
      ),
      { maxLength: n * 2 },
    ),
  }),
);

function link(tasks: Task[], spec: Spec['edges']): Dependency[] {
  return spec.map((e, i) => ({
    id: toDependencyId(`d${i}`),
    from: tasks[e.from]!.id,
    to: tasks[e.to]!.id,
    type: e.type,
    lag: e.lag,
  }));
}

describe('computeCriticalPath slack == day-walk oracle', () => {
  for (const [name, cal, start] of ZONES) {
    it(`random graphs incl. negative lag (${name})`, () => {
      fc.assert(
        fc.property(specArb, (spec) => {
          const tasks = makeTasks(spec.durations, start);
          const result = computeCriticalPath(tasks, link(tasks, spec.edges), cal);
          for (const s of result.schedule.values()) {
            expect(s.slackHours).toBeCloseTo(dayWalkDifference(s.earlyStart, s.lateStart, cal), 9);
          }
        }),
        { numRuns: 12 },
      );
    });
  }

  it('a constraint-pushed ES (Pro seam) keeps slack on the oracle, with negative lag', () => {
    // ES <= LS holds in this model even with the seam (a pushed predecessor loosens its own LS by
    // the same amount), so the meter range is ES..LS; the meter itself is also tested with
    // readings in both directions in working-hours-meter.test.ts.
    const cal = METER_CALENDARS.newYorkSplit!;
    const tasks = makeTasks([8, 8, 8], '2026-10-28T09:00');
    const deps = link(tasks, [
      { from: 0, to: 1, type: 'FS', lag: -4 },
      { from: 1, to: 2, type: 'FS', lag: 0 },
    ]);
    const late = Temporal.PlainDateTime.from('2026-11-30T09:00').toZonedDateTime(cal.timezone);
    const result = computeCriticalPath(tasks, deps, cal, {
      resolveConstraint: (task, earlyStart) => (task.id === tasks[0]!.id ? late : earlyStart),
    });
    for (const s of result.schedule.values()) {
      expect(s.slackHours).toBeCloseTo(dayWalkDifference(s.earlyStart, s.lateStart, cal), 9);
    }
  });
});

describe('computeCriticalPath work tripwire (deterministic, no wall clock)', () => {
  it('builds O(N + span) day windows, not O(N x span)', () => {
    const cal = METER_CALENDARS.utc!;
    const N = 150;
    // No dependencies: every task has LF = projectEnd, so every ES..LS gap spans ~the whole project.
    // One long task stretches the project to ~250 working days (~350 calendar days).
    const tasks = makeTasks(
      Array.from({ length: N }, (_, i) => (i === 0 ? 2000 : 8)),
      '2026-01-05T09:00',
    );
    const proto = Object.getPrototypeOf(Temporal.PlainDate.from('2026-01-05')) as {
      toZonedDateTime: (...a: unknown[]) => unknown;
    };
    const spy = vi.spyOn(proto, 'toZonedDateTime');
    const result = computeCriticalPath(tasks, [], cal);
    const calls = spy.mock.calls.length;
    spy.mockRestore();

    const spanDays = result.projectEnd.toPlainDate().since('2026-01-05', { largestUnit: 'days' }).days;
    expect(spanDays).toBeGreaterThan(300);
    // The old walk: ~N tasks x ~spanDays days x 2 window ends = 150 x 350 x 2 >= 100k calls.
    // The meter: the table (2 per day) + a few window builds per task for ES/EF/LS/LF/slack.
    expect(calls).toBeLessThan(10 * (N + spanDays)); // measured ~4400; the old walk is >100k
    expect(calls).toBeLessThan((N * spanDays) / 8);
  });
});
