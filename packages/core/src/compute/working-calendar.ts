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

export const NS_PER_HOUR = 3_600_000_000_000n;

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
      cur = dayAt(day.add({ days: 1 }), cal.timezone, '00:00', api);
      continue;
    }
    const windows = windowsFor(day, cal, api);
    const w = windows.find((win) => api.ZonedDateTime.compare(cur, win.end) < 0);
    if (!w) {
      cur = dayAt(day.add({ days: 1 }), cal.timezone, '00:00', api);
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
      cur = dayAt(day.subtract({ days: 1 }), cal.timezone, '23:59:59.999999999', api);
      continue;
    }
    const windows = windowsFor(day, cal, api);
    const w = [...windows].reverse().find((win) => api.ZonedDateTime.compare(win.start, cur) < 0);
    if (!w) {
      cur = dayAt(day.subtract({ days: 1 }), cal.timezone, '23:59:59.999999999', api);
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
  const asc = api.ZonedDateTime.compare(a, b) <= 0;
  return workingHoursMeter(cal, asc ? a : b, asc ? b : a)(a, b);
}

/**
 * A `(from, to) => hours` meter for instants inside `[lo, hi]`: one pass over the days builds the
 * cumulative working time at each day start, so every later reading costs two day lookups instead
 * of a walk over the gap (CPM reads ~N slacks over one shared span). Exact, same as a day walk.
 */
export function workingHoursMeter(
  cal: WorkingCalendar,
  lo: ZDT,
  hi: ZDT,
): (from: ZDT, to: ZDT) => number {
  const api = getTemporal();
  const holidays = holidaySet(cal, api);
  const before = new Map<string, bigint>();
  const last = hi.toPlainDate();
  let total = 0n;
  let guard = 0;
  for (let day = lo.toPlainDate(); api.PlainDate.compare(day, last) <= 0; day = day.add({ days: 1 })) {
    assertProgress(++guard);
    before.set(day.toString(), total);
    total += workingNsUpTo(day, hi.epochNanoseconds, cal, holidays, api); // the last day's total is never read
  }
  const at = (t: ZDT): bigint => {
    const day = t.toPlainDate();
    return before.get(day.toString())! + workingNsUpTo(day, t.epochNanoseconds, cal, holidays, api);
  };
  return (from, to) => Number(at(to) - at(from)) / Number(NS_PER_HOUR);
}

// --- Internal (exported for sibling compute modules only; NOT re-exported by the barrel) ----

const WEEKDAYS: readonly WeekdayCode[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** ISO day of week (1 = Monday .. 7 = Sunday) to its code. */
export function weekdayCode(dayOfWeek: number): WeekdayCode {
  return WEEKDAYS[dayOfWeek % 7]!;
}

export function isWorkingPlainDate(day: PlainDate, cal: WorkingCalendar, holidays: Set<string>): boolean {
  return cal.workingDays.includes(weekdayCode(day.dayOfWeek)) && !holidays.has(day.toString());
}

// Parsed holiday sets, keyed by the `holidays` array and revalidated by timezone + length, so
// replacing or growing it (or retargeting the zone) re-parses. Callers only ever read the set.
// Editing an entry IN PLACE is not detected (calendars are immutable for an instance's life).
const holidayCache = new WeakMap<DateInput[], [string, Set<string>]>();

export function holidaySet(cal: WorkingCalendar, api: T): Set<string> {
  const key = `${cal.timezone}|${cal.holidays.length}`;
  const hit = holidayCache.get(cal.holidays);
  if (hit?.[0] === key) return hit[1];
  const set = new Set<string>();
  for (const h of cal.holidays) set.add(normalize(h, cal.timezone, api).toPlainDate().toString());
  holidayCache.set(cal.holidays, [key, set]);
  return set;
}

export function windowsFor(day: PlainDate, cal: WorkingCalendar, api: T): Array<{ start: ZDT; end: ZDT }> {
  return cal.workingHours
    .map((w) => ({
      start: day.toZonedDateTime({ timeZone: cal.timezone, plainTime: parseTime(w.start, api) }),
      end: day.toZonedDateTime({ timeZone: cal.timezone, plainTime: parseTime(w.end, api) }),
    }))
    .filter((w) => api.ZonedDateTime.compare(w.end, w.start) > 0)
    .sort((a, b) => api.ZonedDateTime.compare(a.start, b.start));
}

export function parseTime(hhmm: string, api: T): Temporal.PlainTime {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m || m[1] === undefined || m[2] === undefined) {
    throw new Error(`invalid workingHours (expected "HH:MM"): ${hhmm}`);
  }
  return api.PlainTime.from({ hour: Number(m[1]), minute: Number(m[2]) });
}

/** `day` at wall-clock `time` ("00:00" = start of day, "23:59:59.999999999" = end) in `tz`. */
export function dayAt(day: PlainDate, tz: string, time: string, api: T): ZDT {
  return day.toZonedDateTime({ timeZone: tz, plainTime: api.PlainTime.from(time) });
}

/** Working ns on `day` up to instant `now` (epoch ns): each window clipped at `now`. */
export function workingNsUpTo(day: PlainDate, now: bigint, cal: WorkingCalendar, holidays: Set<string>, api: T): bigint {
  let ns = 0n;
  if (isWorkingPlainDate(day, cal, holidays)) {
    for (const w of windowsFor(day, cal, api)) {
      const end = now < w.end.epochNanoseconds ? now : w.end.epochNanoseconds;
      if (end > w.start.epochNanoseconds) ns += end - w.start.epochNanoseconds;
    }
  }
  return ns;
}

function hoursToNs(hours: number): bigint {
  return BigInt(Math.round(hours * Number(NS_PER_HOUR)));
}

function assertProgress(guard: number): void {
  if (guard > 1_000_000) {
    throw new Error(
      'working-calendar: exceeded max iteration guard — empty workingDays/Hours, or huge duration/lag?',
    );
  }
}

export function normalize(input: DateInput, tz: string, api: T): ZDT {
  if (typeof input === 'string') return parseString(input, tz, api);
  if (input instanceof Date) {
    return api.Instant.fromEpochMilliseconds(input.getTime()).toZonedDateTimeISO(tz);
  }
  if (input instanceof api.ZonedDateTime) return input.withTimeZone(tz);
  if (input instanceof api.PlainDate) return input.toZonedDateTime({ timeZone: tz });
  throw new Error('unsupported DateInput');
}

function parseString(s: string, tz: string, api: T): ZDT {
  // A date-only string can never be an absolute instant, and `Instant.from` THROWS on it: with
  // 2000 date-only tasks that is thousands of exceptions per paint.
  if (s.length <= 10) return api.PlainDate.from(s).toZonedDateTime({ timeZone: tz });
  try {
    return api.Instant.from(s).toZonedDateTimeISO(tz);
  } catch {
    /* not an absolute instant (missing offset/Z) → try wall-clock */
  }
  return api.PlainDateTime.from(s).toZonedDateTime(tz);
}
