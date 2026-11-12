// Reference implementation for the working-hours meter tests: the ORIGINAL one-day-at-a-time walk
// that `differenceInWorkingHours` used before the day-table meter. Written against raw Temporal
// (no import from `src/compute`) so it is an independent oracle.
import { Temporal } from '@js-temporal/polyfill';
import type { WeekdayCode, WorkingCalendar } from '../../src/types.js';

const CODES: WeekdayCode[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Working hours from `from` to `to`, negative when `to` precedes `from`. */
export function dayWalkDifference(
  from: Temporal.ZonedDateTime,
  to: Temporal.ZonedDateTime,
  cal: WorkingCalendar,
): number {
  const a = from.withTimeZone(cal.timezone);
  const b = to.withTimeZone(cal.timezone);
  const cmp = Temporal.ZonedDateTime.compare(a, b);
  if (cmp === 0) return 0;
  const lo = cmp < 0 ? a : b;
  const hi = cmp < 0 ? b : a;
  const isoDay = (t: Temporal.ZonedDateTime): Temporal.PlainDate => t.toPlainDate().withCalendar('iso8601');
  // Date-only holidays are calendar dates; instant-typed ones ("...Z" / "+hh:mm") land on their
  // date in the calendar's zone.
  const holidays = new Set(
    cal.holidays.map((h) => {
      const str = h as string;
      return /(Z|[+-]\d\d:?\d\d)$/.test(str) && str.length > 10
        ? Temporal.Instant.from(str).toZonedDateTimeISO(cal.timezone).toPlainDate().toString()
        : Temporal.PlainDate.from(str.slice(0, 10)).toString();
    }),
  );
  let total = 0n;
  for (
    let day = isoDay(lo);
    Temporal.PlainDate.compare(day, isoDay(hi)) <= 0;
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

/** Calendars chosen to hit the awkward cases: DST zones, split shifts, night windows that straddle
 *  a transition, weekend work, holidays, a half-hour DST zone, and no working days at all. */
export const METER_CALENDARS: Record<string, WorkingCalendar> = {
  utc: {
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    workingHours: [{ start: '09:00', end: '17:00' }],
    holidays: ['2026-01-01', '2026-05-25', '2026-12-25'],
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
    holidays: ['2026-03-09', '2026-11-02'],
    timezone: 'America/New_York',
  },
  newYorkNight: {
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    workingHours: [{ start: '01:00', end: '04:00' }],
    holidays: ['2026-06-01'], // NOT the 03-08 spring-forward day: its 01:00-04:00 window must be built
    timezone: 'America/New_York',
  },
  // Lord Howe's 2026 transitions (04-05, 10-04) are Sundays, so Sunday must be a working day.
  lordHowe: {
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sun'],
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
