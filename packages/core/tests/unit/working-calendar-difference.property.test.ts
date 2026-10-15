// Differential property test: the closed-form whole-week fast path of `differenceInWorkingHoursFast`
// must equal a naive day-by-day walk bit for bit, across DST/timezone calendars, plus a time guard
// proving the cost no longer scales with the gap.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Temporal } from '@js-temporal/polyfill';
import { differenceInWorkingHoursFast as differenceInWorkingHours } from '../../src/compute/working-hours-fast.js';
import type { WeekdayCode, WorkingCalendar } from '../../src/types.js';

const CODES: WeekdayCode[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Reference: the original one-day-at-a-time algorithm. */
function slowDifference(from: string, to: string, cal: WorkingCalendar): number {
  const a = Temporal.Instant.from(from).toZonedDateTimeISO(cal.timezone);
  const b = Temporal.Instant.from(to).toZonedDateTimeISO(cal.timezone);
  const cmp = Temporal.ZonedDateTime.compare(a, b);
  if (cmp === 0) return 0;
  const lo = cmp < 0 ? a : b;
  const hi = cmp < 0 ? b : a;
  const holidays = new Set(
    cal.holidays.map((h) => Temporal.PlainDate.from(h as string).toString()),
  );
  let total = 0n;
  for (
    let day = lo.toPlainDate();
    Temporal.PlainDate.compare(day, hi.toPlainDate()) <= 0;
    day = day.add({ days: 1 })
  ) {
    if (!cal.workingDays.includes(CODES[day.dayOfWeek - 1] as WeekdayCode)) continue;
    if (holidays.has(day.toString())) continue;
    for (const w of cal.workingHours) {
      const [sh, sm] = w.start.split(':').map(Number) as [number, number];
      const [eh, em] = w.end.split(':').map(Number) as [number, number];
      const s0 = day.toZonedDateTime({
        timeZone: cal.timezone,
        plainTime: Temporal.PlainTime.from({ hour: sh, minute: sm }),
      });
      const e0 = day.toZonedDateTime({
        timeZone: cal.timezone,
        plainTime: Temporal.PlainTime.from({ hour: eh, minute: em }),
      });
      if (Temporal.ZonedDateTime.compare(e0, s0) <= 0) continue;
      const s = Temporal.ZonedDateTime.compare(s0, lo) >= 0 ? s0 : lo;
      const e = Temporal.ZonedDateTime.compare(e0, hi) <= 0 ? e0 : hi;
      if (Temporal.ZonedDateTime.compare(e, s) > 0) total += e.epochNanoseconds - s.epochNanoseconds;
    }
  }
  const hours = Number(total) / 3_600_000_000_000;
  return cmp < 0 ? hours : -hours;
}

const calendars: Record<string, WorkingCalendar> = {
  utc: {
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    workingHours: [{ start: '09:00', end: '17:00' }],
    holidays: ['2026-01-01', '2026-05-25', '2026-12-25', '2027-01-01'],
    timezone: 'UTC',
  },
  hcm: {
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    workingHours: [{ start: '08:00', end: '12:00' }, { start: '13:30', end: '17:30' }],
    holidays: ['2026-02-17', '2026-04-30'],
    timezone: 'Asia/Ho_Chi_Minh',
  },
  newYorkSplit: {
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    workingHours: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
    holidays: ['2026-03-09', '2026-11-02', '2026-07-03', '2027-03-08'],
    timezone: 'America/New_York',
  },
  // A window that straddles the 02:00 transition: real length differs from nominal.
  newYorkNight: {
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    workingHours: [{ start: '01:00', end: '04:00' }],
    holidays: ['2026-03-08', '2026-06-01'],
    timezone: 'America/New_York',
  },
  londonWeekend: {
    workingDays: ['sat', 'sun', 'mon'],
    workingHours: [{ start: '00:00', end: '06:00' }, { start: '12:00', end: '23:00' }],
    holidays: ['2026-03-29', '2026-10-25'],
    timezone: 'Europe/London',
  },
  lordHowe: {
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    workingHours: [{ start: '01:30', end: '03:30' }],
    holidays: [],
    timezone: 'Australia/Lord_Howe',
  },
  noWorkingDays: {
    workingDays: [],
    workingHours: [{ start: '09:00', end: '17:00' }],
    holidays: [],
    timezone: 'UTC',
  },
};

const BASE = Temporal.Instant.from('2025-06-01T00:00:00Z').epochMilliseconds;
const instantArb = fc
  .integer({ min: 0, max: 2 * 365 * 24 * 60 })
  .map((m) => Temporal.Instant.fromEpochMilliseconds(BASE + m * 60_000).toString());

describe('differenceInWorkingHours fast path', () => {
  for (const [name, cal] of Object.entries(calendars)) {
    it(`equals the day-by-day walk, gaps up to 2 years (${name})`, () => {
      fc.assert(
        fc.property(instantArb, instantArb, (a, b) => {
          expect(differenceInWorkingHours(a, b, cal)).toBe(slowDifference(a, b, cal));
        }),
        { numRuns: 40 },
      );
    });
  }

  it('equals the day-by-day walk around each transition and holiday (boundary instants)', () => {
    const edges = [
      '2026-03-07T12:00:00Z', '2026-03-08T07:00:00Z', '2026-03-10T00:00:00Z', '2026-11-01T06:00:00Z',
      '2026-11-03T00:00:00Z', '2026-03-29T01:00:00Z', '2026-10-25T01:00:00Z', '2026-01-01T00:00:00Z',
    ];
    for (const cal of Object.values(calendars)) {
      for (const a of edges) {
        for (const b of edges) {
          expect(differenceInWorkingHours(a, b, cal)).toBe(slowDifference(a, b, cal));
        }
      }
    }
  });

  it('is antisymmetric', () => {
    const cal = calendars['newYorkSplit'] as WorkingCalendar;
    expect(differenceInWorkingHours('2026-02-01', '2027-02-01', cal)).toBe(
      -differenceInWorkingHours('2027-02-01', '2026-02-01', cal),
    );
  });

  it('a 1,900-year gap on a no-DST calendar costs milliseconds, not seconds', () => {
    const cal = calendars['utc'] as WorkingCalendar;
    const t0 = performance.now();
    const h = differenceInWorkingHours('0100-01-01T00:00:00Z', '2026-01-01T00:00:00Z', cal);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(h).toBeGreaterThan(1_000_000);
  });
});
