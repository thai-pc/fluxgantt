import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Temporal } from '@js-temporal/polyfill';
import {
  DEFAULT_CALENDAR,
  differenceInWorkingHours,
  workingHoursMeter,
} from '../../src/compute/working-calendar.js';
import type { WorkingCalendar } from '../../src/types.js';
import { METER_CALENDARS, dayWalkDifference } from '../helpers/day-walk.js';

const z = (s: string, tz = 'UTC'): Temporal.ZonedDateTime => Temporal.PlainDateTime.from(s).toZonedDateTime(tz);

describe('workingHoursMeter', () => {
  const cal = DEFAULT_CALENDAR; // Mon-Fri 09:00-17:00 UTC; 2026-01-05 = Mon

  it('reads the same instant as 0, and a same-day span as the clipped window', () => {
    const lo = z('2026-01-05T00:00');
    const hi = z('2026-01-05T23:59');
    const m = workingHoursMeter(cal, lo, hi);
    expect(m(z('2026-01-05T10:00'), z('2026-01-05T10:00'))).toBe(0);
    expect(m(z('2026-01-05T10:00'), z('2026-01-05T12:30'))).toBe(2.5);
    expect(m(z('2026-01-05T06:00'), z('2026-01-05T20:00'))).toBe(8); // clipped to the window
  });

  it('is antisymmetric: reading backwards negates the forward reading', () => {
    const m = workingHoursMeter(cal, z('2026-01-05T00:00'), z('2026-01-16T23:00'));
    const a = z('2026-01-06T11:00');
    const b = z('2026-01-14T15:00');
    expect(m(a, b)).toBe(6 + 24 + 16 + 6); // Tue rest, Wed-Fri, Mon-Tue, Wed morning
    expect(m(b, a)).toBe(-m(a, b));
  });

  it('serves many readings from one table and matches differenceInWorkingHours', () => {
    const lo = z('2026-01-05T00:00');
    const hi = z('2026-02-27T23:00');
    const m = workingHoursMeter(cal, lo, hi);
    for (const [a, b] of [
      ['2026-01-05T09:00', '2026-02-27T17:00'],
      ['2026-01-09T12:00', '2026-01-12T10:00'], // across a weekend
      ['2026-02-20T16:00', '2026-01-07T09:30'], // backwards
    ] as const) {
      expect(m(z(a), z(b))).toBe(differenceInWorkingHours(a, b, cal));
    }
  });

  it('a holiday-only span measures 0', () => {
    const holiday: WorkingCalendar = { ...cal, holidays: ['2026-01-06'] };
    const m = workingHoursMeter(holiday, z('2026-01-06T00:00'), z('2026-01-06T23:00'));
    expect(m(z('2026-01-06T00:00'), z('2026-01-06T23:00'))).toBe(0);
    // ...and a span across it loses exactly that day's 8h
    const across = workingHoursMeter(holiday, z('2026-01-05T00:00'), z('2026-01-07T23:00'));
    expect(across(z('2026-01-05T09:00'), z('2026-01-07T17:00'))).toBe(16);
  });

  it('empty workingDays measures 0 over a long span', () => {
    const m = workingHoursMeter(
      METER_CALENDARS.noWorkingDays!,
      z('2026-01-01T00:00'),
      z('2027-06-01T00:00'),
    );
    expect(m(z('2026-01-01T00:00'), z('2027-06-01T00:00'))).toBe(0);
  });

  it('is exact across the America/New_York spring-forward day (a 03:00 window loses an hour)', () => {
    const night: WorkingCalendar = { ...METER_CALENDARS.newYorkNight!, holidays: [] }; // 01:00-04:00 daily; 03-08 is 2h long
    const tz = night.timezone;
    const m = workingHoursMeter(night, z('2026-03-07T00:00', tz), z('2026-03-09T23:00', tz));
    expect(m(z('2026-03-07T00:00', tz), z('2026-03-08T23:00', tz))).toBe(3 + 2);
    expect(m(z('2026-03-07T00:00', tz), z('2026-03-09T23:00', tz))).toBe(3 + 2 + 3);
  });

  it('clips inside the shortened spring-forward window (01:30 and 03:30 EDT on 2026-03-08)', () => {
    const night: WorkingCalendar = { ...METER_CALENDARS.newYorkNight!, holidays: [] };
    const tz = night.timezone;
    const m = workingHoursMeter(night, z('2026-03-07T00:00', tz), z('2026-03-09T23:00', tz));
    const t0 = z('2026-03-08T01:30', tz);
    const t1 = z('2026-03-08T03:30', tz); // 03:30 EDT: the 02:00-03:00 hour does not exist
    expect(m(t0, t1)).toBe(1); // 01:30 EST -> 03:00 EDT is 30 min, then 30 min more
    expect(m(t0, t1)).toBeCloseTo(dayWalkDifference(t0, t1, night), 9);
  });

  it('is exact across the America/New_York fall-back day (a 03:00 window gains an hour)', () => {
    const night: WorkingCalendar = { ...METER_CALENDARS.newYorkNight!, holidays: [] };
    const tz = night.timezone;
    const m = workingHoursMeter(night, z('2026-10-31T00:00', tz), z('2026-11-02T23:00', tz));
    // 2026-11-01 is 25h long; the 01:00-04:00 window spans 4 real hours.
    expect(m(z('2026-10-31T00:00', tz), z('2026-11-01T23:00', tz))).toBe(3 + 4);
  });

  it('is exact across a Lord Howe half-hour transition', () => {
    const lh = METER_CALENDARS.lordHowe!;
    const tz = lh.timezone;
    const from = z('2026-04-01T00:00', tz);
    const to = z('2026-04-10T00:00', tz); // crosses the 2026-04-05 fall-back (30 min shift)
    const m = workingHoursMeter(lh, from, to);
    expect(m(from, to)).toBe(dayWalkDifference(from, to, lh));
  });

  it('matches the day walk on every shared calendar, forwards and backwards', () => {
    for (const [name, c] of Object.entries(METER_CALENDARS)) {
      const tz = c.timezone;
      const lo = z('2026-02-20T00:00', tz);
      const hi = z('2026-11-20T00:00', tz);
      const m = workingHoursMeter(c, lo, hi);
      const a = z('2026-03-07T22:15', tz);
      const b = z('2026-11-01T12:45', tz);
      expect(m(a, b), name).toBeCloseTo(dayWalkDifference(a, b, c), 9);
      expect(m(b, a), name).toBeCloseTo(dayWalkDifference(b, a, c), 9);
    }
  });
});

describe('workingHoursMeter — holidays at the span edges (fast-check)', () => {
  const BASE = Temporal.Instant.from('2026-02-01T00:00:00Z').epochMilliseconds;
  const ms = fc.integer({ min: 0, max: 200 * 24 * 60 }).map((m) => BASE + m * 60_000);
  for (const name of ['utc', 'hcm', 'newYorkSplit', 'newYorkNight', 'lordHowe']) {
    it(`date-only and instant-typed holidays on and around lo/hi (${name})`, () => {
      const c0 = METER_CALENDARS[name]!;
      fc.assert(
        fc.property(ms, ms, fc.array(fc.tuple(fc.integer({ min: -1, max: 1 }), fc.boolean(), fc.boolean()), { maxLength: 4 }), (m1, m2, hs) => {
          const mk = (t: number) => Temporal.Instant.fromEpochMilliseconds(t).toZonedDateTimeISO(c0.timezone);
          const [a, b] = [mk(Math.min(m1, m2)), mk(Math.max(m1, m2))];
          const holidays = hs.map(([off, atHi, asInstant]) => {
            const day = (atHi ? b : a).toPlainDate().add({ days: off });
            return asInstant
              ? day.toZonedDateTime({ timeZone: c0.timezone, plainTime: '12:00' }).toInstant().toString()
              : day.toString();
          });
          const c: WorkingCalendar = { ...c0, holidays };
          const m = workingHoursMeter(c, a, b);
          expect(m(a, b)).toBeCloseTo(dayWalkDifference(a, b, c), 9);
          expect(differenceInWorkingHours(b, a, c)).toBeCloseTo(dayWalkDifference(b, a, c), 9);
        }),
        { numRuns: 25 },
      );
    });
  }
});

describe('workingHoursMeter — equivalence with the old day walk (fast-check)', () => {
  const BASE = Temporal.Instant.from('2025-12-01T00:00:00Z').epochMilliseconds;
  const instantMs = fc.integer({ min: 0, max: 400 * 24 * 60 }).map((m) => BASE + m * 60_000);

  for (const [name, c] of Object.entries(METER_CALENDARS)) {
    it(`one table, many random readings in both directions (${name})`, () => {
      fc.assert(
        fc.property(fc.array(instantMs, { minLength: 2, maxLength: 6 }), (ms) => {
          const zs = ms.map((t) => Temporal.Instant.fromEpochMilliseconds(t).toZonedDateTimeISO(c.timezone));
          const lo = zs.reduce((a, b) => (Temporal.ZonedDateTime.compare(a, b) <= 0 ? a : b));
          const hi = zs.reduce((a, b) => (Temporal.ZonedDateTime.compare(a, b) >= 0 ? a : b));
          const m = workingHoursMeter(c, lo, hi);
          for (let i = 0; i + 1 < zs.length; i++) {
            expect(m(zs[i]!, zs[i + 1]!)).toBeCloseTo(dayWalkDifference(zs[i]!, zs[i + 1]!, c), 9);
          }
        }),
        { numRuns: 12 },
      );
    });

    it(`differenceInWorkingHours (the one-shot meter) equals the day walk (${name})`, () => {
      fc.assert(
        fc.property(instantMs, instantMs, (a, b) => {
          const za = Temporal.Instant.fromEpochMilliseconds(a).toZonedDateTimeISO(c.timezone);
          const zb = Temporal.Instant.fromEpochMilliseconds(b).toZonedDateTimeISO(c.timezone);
          expect(differenceInWorkingHours(za, zb, c)).toBeCloseTo(dayWalkDifference(za, zb, c), 9);
        }),
        { numRuns: 12 },
      );
    });
  }
});
