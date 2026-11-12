// Regression for review H1/L1/L2/nit: the meter must normalize its inputs like the old day walk did
// (foreign-zone or non-ISO ZonedDateTimes are legal DateInputs / constraint-seam returns). Expected
// values are what master (the per-pair day walk) returned for the same inputs.
import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { computeCriticalPath } from '../../src/compute/critical-path.js';
import {
  DEFAULT_CALENDAR,
  differenceInWorkingHours,
  workingHoursMeter,
} from '../../src/compute/working-calendar.js';
import { toTaskId, type Task, type WorkingCalendar } from '../../src/types.js';

const now = new Date();
const mk = (id: string, duration: number, start: string): Task => ({
  id: toTaskId(id),
  name: id,
  start,
  end: start,
  duration,
  progress: 0,
  type: 'task',
  createdAt: now,
  updatedAt: now,
});
const z = (s: string, tz = 'UTC'): Temporal.ZonedDateTime => Temporal.PlainDateTime.from(s).toZonedDateTime(tz);

describe('meter input normalization (H1)', () => {
  const kiritimati: WorkingCalendar = { ...DEFAULT_CALENDAR, timezone: 'Pacific/Kiritimati' };

  it('a constraint seam returning a UTC-expressed ES for a Kiritimati calendar: slack 22 (master)', () => {
    const a = mk('a', 8, '2026-01-05T09:00');
    const b = mk('b', 40, '2026-01-05T09:00');
    const es = z('2026-01-06T11:00', 'Pacific/Kiritimati').withTimeZone('UTC');
    const r = computeCriticalPath([a, b], [], kiritimati, {
      resolveConstraint: (t, early) => (t.id === a.id ? es : early),
    });
    expect(r.schedule.get(a.id)!.slackHours).toBe(22);
  });

  it('a seam returning Pacific/Pago_Pago (UTC-11, previous local date): slack 0, no throw (master)', () => {
    const a = mk('a', 8, '2026-01-05T09:00');
    const r = computeCriticalPath([a], [], kiritimati, {
      resolveConstraint: (_t, early) => early.withTimeZone('Pacific/Pago_Pago'),
    });
    expect(r.schedule.get(a.id)!.slackHours).toBe(0);
  });

  it('differenceInWorkingHours with a Japanese-calendar ZonedDateTime, both orders (master 40 / 8)', () => {
    const jp = Temporal.ZonedDateTime.from('2026-01-05T09:00[UTC][u-ca=japanese]');
    expect(differenceInWorkingHours(jp, '2026-01-09T17:00', DEFAULT_CALENDAR)).toBe(40);
    expect(differenceInWorkingHours('2026-01-09T17:00', jp, DEFAULT_CALENDAR)).toBe(-40);
    expect(differenceInWorkingHours(jp, '2026-01-05T17:00', DEFAULT_CALENDAR)).toBe(8);
    expect(differenceInWorkingHours('2026-01-05T17:00', jp, DEFAULT_CALENDAR)).toBe(-8);
  });

  it('computeCriticalPath with a Japanese-calendar start matches master ([32, 0])', () => {
    const jp = Temporal.ZonedDateTime.from('2026-01-05T09:00[UTC][u-ca=japanese]');
    const a = mk('a', 32, jp as unknown as string);
    const b = mk('b', 8, '2026-01-05T09:00');
    const r = computeCriticalPath([a, b], [], DEFAULT_CALENDAR);
    expect([r.schedule.get(a.id)!.slackHours, r.schedule.get(b.id)!.slackHours]).toEqual([0, 24]);
  });
});

describe('meter contract (L1, L2, nit)', () => {
  it('a reading on a day outside the table throws a RangeError naming the day', () => {
    const m = workingHoursMeter(DEFAULT_CALENDAR, z('2026-01-05T00:00'), z('2026-01-06T00:00'));
    expect(() => m(z('2026-01-05T10:00'), z('2026-01-08T10:00'))).toThrow(RangeError);
    expect(() => m(z('2026-01-05T10:00'), z('2026-01-08T10:00'))).toThrow(/2026-01-08/);
  });

  it('readings in a foreign zone are read on the calendar-zone day', () => {
    const m = workingHoursMeter(DEFAULT_CALENDAR, z('2026-01-05T00:00'), z('2026-01-06T23:00'));
    const a = z('2026-01-05T10:00').withTimeZone('Pacific/Kiritimati');
    expect(m(a, z('2026-01-05T12:00'))).toBe(2);
  });

  it('keeps -0 for a backward span with no working time, like master', () => {
    expect(Object.is(differenceInWorkingHours('2026-01-11T10:00', '2026-01-10T10:00', DEFAULT_CALENDAR), -0)).toBe(true);
    expect(Object.is(differenceInWorkingHours('2026-01-10T10:00', '2026-01-11T10:00', DEFAULT_CALENDAR), 0)).toBe(true);
    expect(Object.is(differenceInWorkingHours('2026-01-10T10:00', '2026-01-10T10:00', DEFAULT_CALENDAR), 0)).toBe(true);
  });

  it('pins the known divergence on a day a zone skipped (Pacific/Apia, 2011-12-30)', () => {
    const apia: WorkingCalendar = {
      workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      workingHours: [{ start: '09:00', end: '17:00' }],
      holidays: [],
      timezone: 'Pacific/Apia',
    };
    const from = z('2011-12-29T00:00', apia.timezone);
    const to = z('2011-12-31T12:00', apia.timezone);
    const oneShot = differenceInWorkingHours(from, to, apia);
    const wide = workingHoursMeter(apia, from, z('2012-01-03T00:00', apia.timezone))(from, to);
    const tight = workingHoursMeter(apia, from, to)(from, to);
    expect(oneShot).toBe(14);
    expect(tight).toBe(oneShot); // a table ending at the reading agrees with the one-shot
    expect(wide).toBe(19); // a wider table counts the phantom day's windows at the later date
  });
});
