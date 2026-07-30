// Working calendar — date/time arithmetic over a working schedule (spec §5.1 Compute Layer).
// Uses Temporal to handle timezone/DST correctly (spec §4.1). Every computation is done in
// ZonedDateTime within the calendar's timezone; intervals are measured in epoch nanoseconds
// (exact, no DST drift).
import type { Temporal } from '@js-temporal/polyfill';
import { getTemporal, type TemporalApi } from '../internal/temporal.js';
import type { DateInput, WeekdayCode, WorkingCalendar } from '../types.js';

export const DEFAULT_CALENDAR: WorkingCalendar = {
  workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  workingHours: [{ start: '09:00', end: '17:00' }],
  holidays: [],
  timezone: 'UTC',
};

type T = TemporalApi;
type ZDT = Temporal.ZonedDateTime;
type PlainDate = Temporal.PlainDate;

const NS_PER_HOUR = 3_600_000_000_000n;

// --- Public API ------------------------------------------------------------

/**
 * Public wrapper around the internal `normalize()` — resolves `TemporalApi` via
 * `getTemporal()` itself so callers outside this file (render/interaction layer) never
 * need to touch `getTemporal()`/`TemporalApi` directly. Does not change `normalize`'s
 * behaviour or signature — additive export only (spec-svg-renderer.md §3.1).
 */
export function normalizeDate(input: DateInput, timezone: string): Temporal.ZonedDateTime {
  return normalize(input, timezone, getTemporal());
}

export function isWorkingDay(date: DateInput, cal: WorkingCalendar): boolean {
  const api = getTemporal();
  const zdt = normalize(date, cal.timezone, api);
  return isWorkingPlainDate(zdt.toPlainDate(), cal, holidaySet(cal, api));
}

export function isHoliday(date: DateInput, cal: WorkingCalendar): boolean {
  const api = getTemporal();
  const zdt = normalize(date, cal.timezone, api);
  return holidaySet(cal, api).has(zdt.toPlainDate().toString());
}

/** Add `hours` working hours from `start`, skipping off-hours/weekends/holidays. */
export function addWorkingHours(start: DateInput, hours: number, cal: WorkingCalendar): ZDT {
  const api = getTemporal();
  if (hours < 0) return subtractWorkingHours(start, -hours, cal);
  let cur = normalize(start, cal.timezone, api);
  let remaining = hoursToNs(hours);
  if (remaining === 0n) return cur;

  const holidays = holidaySet(cal, api);
  let guard = 0;
  while (remaining > 0n) {
    assertProgress(++guard);
    const day = cur.toPlainDate();
    if (!isWorkingPlainDate(day, cal, holidays)) {
      cur = startOfDay(day.add({ days: 1 }), cal.timezone, api);
      continue;
    }
    const windows = windowsFor(day, cal, api);
    const w = windows.find((win) => api.ZonedDateTime.compare(cur, win.end) < 0);
    if (!w) {
      cur = startOfDay(day.add({ days: 1 }), cal.timezone, api);
      continue;
    }
    if (api.ZonedDateTime.compare(cur, w.start) < 0) cur = w.start;
    const avail = w.end.epochNanoseconds - cur.epochNanoseconds;
    const step = avail < remaining ? avail : remaining;
    cur = api.Instant.fromEpochNanoseconds(cur.epochNanoseconds + step).toZonedDateTimeISO(
      cal.timezone,
    );
    remaining -= step;
  }
  return cur;
}

/** Subtract `hours` working hours from `start` (going backwards). */
export function subtractWorkingHours(start: DateInput, hours: number, cal: WorkingCalendar): ZDT {
  const api = getTemporal();
  if (hours < 0) return addWorkingHours(start, -hours, cal);
  let cur = normalize(start, cal.timezone, api);
  let remaining = hoursToNs(hours);
  if (remaining === 0n) return cur;

  const holidays = holidaySet(cal, api);
  let guard = 0;
  while (remaining > 0n) {
    assertProgress(++guard);
    const day = cur.toPlainDate();
    if (!isWorkingPlainDate(day, cal, holidays)) {
      cur = endOfDay(day.subtract({ days: 1 }), cal.timezone, api);
      continue;
    }
    const windows = windowsFor(day, cal, api);
    const w = [...windows].reverse().find((win) => api.ZonedDateTime.compare(win.start, cur) < 0);
    if (!w) {
      cur = endOfDay(day.subtract({ days: 1 }), cal.timezone, api);
      continue;
    }
    if (api.ZonedDateTime.compare(cur, w.end) > 0) cur = w.end;
    const avail = cur.epochNanoseconds - w.start.epochNanoseconds;
    const step = avail < remaining ? avail : remaining;
    cur = api.Instant.fromEpochNanoseconds(cur.epochNanoseconds - step).toZonedDateTimeISO(
      cal.timezone,
    );
    remaining -= step;
  }
  return cur;
}

/** Working hours from `from` to `to` (positive if `to` is after `from`, negative otherwise). */
export function differenceInWorkingHours(
  from: DateInput,
  to: DateInput,
  cal: WorkingCalendar,
): number {
  const api = getTemporal();
  const a = normalize(from, cal.timezone, api);
  const b = normalize(to, cal.timezone, api);
  const cmp = api.ZonedDateTime.compare(a, b);
  if (cmp === 0) return 0;
  const lo = cmp < 0 ? a : b;
  const hi = cmp < 0 ? b : a;

  const holidays = holidaySet(cal, api);
  let totalNs = 0n;
  let day = lo.toPlainDate();
  const lastDay = hi.toPlainDate();
  let guard = 0;
  while (api.PlainDate.compare(day, lastDay) <= 0) {
    assertProgress(++guard);
    if (isWorkingPlainDate(day, cal, holidays)) {
      for (const w of windowsFor(day, cal, api)) {
        const s = maxZdt(w.start, lo, api);
        const e = minZdt(w.end, hi, api);
        if (api.ZonedDateTime.compare(e, s) > 0) totalNs += e.epochNanoseconds - s.epochNanoseconds;
      }
    }
    day = day.add({ days: 1 });
  }
  const hours = Number(totalNs) / Number(NS_PER_HOUR);
  return cmp < 0 ? hours : -hours;
}

// --- Internal --------------------------------------------------------------

function weekdayCode(dayOfWeek: number): WeekdayCode {
  switch (dayOfWeek) {
    case 1:
      return 'mon';
    case 2:
      return 'tue';
    case 3:
      return 'wed';
    case 4:
      return 'thu';
    case 5:
      return 'fri';
    case 6:
      return 'sat';
    default:
      return 'sun';
  }
}

function isWorkingPlainDate(day: PlainDate, cal: WorkingCalendar, holidays: Set<string>): boolean {
  return cal.workingDays.includes(weekdayCode(day.dayOfWeek)) && !holidays.has(day.toString());
}

function holidaySet(cal: WorkingCalendar, api: T): Set<string> {
  const set = new Set<string>();
  for (const h of cal.holidays) set.add(normalize(h, cal.timezone, api).toPlainDate().toString());
  return set;
}

function windowsFor(day: PlainDate, cal: WorkingCalendar, api: T): Array<{ start: ZDT; end: ZDT }> {
  return cal.workingHours
    .map((w) => ({
      start: day.toZonedDateTime({ timeZone: cal.timezone, plainTime: parseTime(w.start, api) }),
      end: day.toZonedDateTime({ timeZone: cal.timezone, plainTime: parseTime(w.end, api) }),
    }))
    .filter((w) => api.ZonedDateTime.compare(w.end, w.start) > 0)
    .sort((a, b) => api.ZonedDateTime.compare(a.start, b.start));
}

function parseTime(hhmm: string, api: T): Temporal.PlainTime {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m || m[1] === undefined || m[2] === undefined) {
    throw new Error(`invalid workingHours (expected "HH:MM"): ${hhmm}`);
  }
  return api.PlainTime.from({ hour: Number(m[1]), minute: Number(m[2]) });
}

function startOfDay(day: PlainDate, tz: string, api: T): ZDT {
  return day.toZonedDateTime({ timeZone: tz, plainTime: api.PlainTime.from('00:00') });
}

function endOfDay(day: PlainDate, tz: string, api: T): ZDT {
  return day.toZonedDateTime({ timeZone: tz, plainTime: api.PlainTime.from('23:59:59.999999999') });
}

function maxZdt(a: ZDT, b: ZDT, api: T): ZDT {
  return api.ZonedDateTime.compare(a, b) >= 0 ? a : b;
}

function minZdt(a: ZDT, b: ZDT, api: T): ZDT {
  return api.ZonedDateTime.compare(a, b) <= 0 ? a : b;
}

function hoursToNs(hours: number): bigint {
  return BigInt(Math.round(hours * Number(NS_PER_HOUR)));
}

function assertProgress(guard: number): void {
  if (guard > 1_000_000) {
    throw new Error(
      'working-calendar: exceeded max iteration guard (1,000,000) — either the calendar has no ' +
        'working time available, or the requested duration/lag magnitude is too large. Check ' +
        'workingDays/workingHours are non-empty and task.duration / dependency.lag are within a ' +
        'reasonable range.',
    );
  }
}

function normalize(input: DateInput, tz: string, api: T): ZDT {
  if (typeof input === 'string') return parseString(input, tz, api);
  if (input instanceof Date) {
    return api.Instant.fromEpochMilliseconds(input.getTime()).toZonedDateTimeISO(tz);
  }
  if (input instanceof api.ZonedDateTime) return input.withTimeZone(tz);
  if (input instanceof api.PlainDate) return input.toZonedDateTime({ timeZone: tz });
  throw new Error('unsupported DateInput');
}

function parseString(s: string, tz: string, api: T): ZDT {
  try {
    return api.Instant.from(s).toZonedDateTimeISO(tz);
  } catch {
    /* not an absolute instant (missing offset/Z) → try wall-clock */
  }
  if (s.length <= 10) return api.PlainDate.from(s).toZonedDateTime({ timeZone: tz });
  return api.PlainDateTime.from(s).toZonedDateTime(tz);
}
