// Working calendar — số học ngày giờ theo lịch làm việc (spec §5.1 Compute Layer).
// Dùng Temporal để xử lý timezone/DST đúng (spec §4.1). Mọi tính toán quy về
// ZonedDateTime trong timezone của lịch; đo khoảng bằng epoch nanoseconds (chính
// xác tuyệt đối, không lệch DST).
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

/** Cộng `hours` giờ làm việc kể từ `start`, bỏ qua ngoài giờ/cuối tuần/holiday. */
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

/** Trừ `hours` giờ làm việc kể từ `start` (đi ngược). */
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

/** Số giờ làm việc từ `from` tới `to` (dương nếu `to` sau `from`, âm nếu ngược lại). */
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
    throw new Error(`workingHours không hợp lệ (cần "HH:MM"): ${hhmm}`);
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
    throw new Error('working-calendar: lịch không có thời gian làm việc khả dụng (lặp vô hạn)');
  }
}

function normalize(input: DateInput, tz: string, api: T): ZDT {
  if (typeof input === 'string') return parseString(input, tz, api);
  if (input instanceof Date) {
    return api.Instant.fromEpochMilliseconds(input.getTime()).toZonedDateTimeISO(tz);
  }
  if (input instanceof api.ZonedDateTime) return input.withTimeZone(tz);
  if (input instanceof api.PlainDate) return input.toZonedDateTime({ timeZone: tz });
  throw new Error('DateInput không hỗ trợ');
}

function parseString(s: string, tz: string, api: T): ZDT {
  try {
    return api.Instant.from(s).toZonedDateTimeISO(tz);
  } catch {
    /* không phải instant tuyệt đối (thiếu offset/Z) → thử wall-clock */
  }
  if (s.length <= 10) return api.PlainDate.from(s).toZonedDateTime({ timeZone: tz });
  return api.PlainDateTime.from(s).toZonedDateTime(tz);
}
