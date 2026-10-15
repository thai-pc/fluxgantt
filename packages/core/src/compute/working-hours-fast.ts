// Closed-form variant of `differenceInWorkingHours` for callers that may measure arbitrarily large
// gaps (the conflict detector, where a mistyped year is reachable). Kept out of
// `working-calendar.ts` so the base bundle (CPM, cascade, renderers) does not pay for it: only
// `conflicts.ts` imports this module. Headless, Temporal-only, no top-level side effects.
import { getTemporal, type TemporalApi } from '../internal/temporal.js';
import type { Temporal } from '@js-temporal/polyfill';
import type { DateInput, WorkingCalendar } from '../types.js';
import {
  NS_PER_HOUR,
  holidaySet,
  isWorkingPlainDate,
  maxZdt,
  minZdt,
  normalize,
  parseTime,
  startOfDay,
  weekdayCode,
  windowsFor,
} from './working-calendar.js';

type T = TemporalApi;
type PlainDate = Temporal.PlainDate;

/**
 * Working hours from `from` to `to` (positive if `to` is after `from`, negative otherwise).
 *
 * Cost is independent of the gap length for zones without DST and O(DST transitions in range)
 * otherwise: the two edge days and the leftover days are walked one by one, and the whole weeks
 * in between are computed in closed form (weekly working hours, minus the working hours of the
 * holidays inside the block, plus the real-vs-nominal window length on days that contain a
 * UTC-offset transition). The result is identical to a day-by-day walk.
 */
export function differenceInWorkingHoursFast(
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
  const walk = (day: PlainDate): void => {
    if (!isWorkingPlainDate(day, cal, holidays)) return;
    for (const w of windowsFor(day, cal, api)) {
      const s = maxZdt(w.start, lo, api);
      const e = minZdt(w.end, hi, api);
      if (api.ZonedDateTime.compare(e, s) > 0) totalNs += e.epochNanoseconds - s.epochNanoseconds;
    }
  };

  const loDay = lo.toPlainDate();
  const hiDay = hi.toPlainDate();
  walk(loDay);
  if (api.PlainDate.compare(loDay, hiDay) < 0) {
    walk(hiDay);
    const interior = loDay.until(hiDay, { largestUnit: 'days' }).days - 1;
    const first = loDay.add({ days: 1 });
    const rem = interior % 7;
    for (let i = 0; i < rem; i++) walk(first.add({ days: i }));
    const weeks = (interior - rem) / 7;
    if (weeks > 0) {
      totalNs += wholeWeeksNs(first.add({ days: rem }), weeks, cal, holidays, api);
    }
  }
  const hours = Number(totalNs) / Number(NS_PER_HOUR);
  return cmp < 0 ? hours : -hours;
}

/** Nominal (wall-clock) working nanoseconds of one working day, ignoring any offset change. */
function nominalDayNs(cal: WorkingCalendar, api: T): bigint {
  let ns = 0n;
  for (const w of cal.workingHours) {
    const span = parseTime(w.end, api).since(parseTime(w.start, api), { largestUnit: 'hours' });
    const n = BigInt(span.hours) * NS_PER_HOUR + BigInt(span.minutes) * 60_000_000_000n;
    if (n > 0n) ns += n;
  }
  return ns;
}

/**
 * Working nanoseconds of `weeks` whole 7-day blocks starting at `start` (every day fully inside
 * the measured interval). Exact: see `differenceInWorkingHours`.
 */
function wholeWeeksNs(
  start: PlainDate,
  weeks: number,
  cal: WorkingCalendar,
  holidays: Set<string>,
  api: T,
): bigint {
  const dayNs = nominalDayNs(cal, api);
  const workingWeekdays = new Set<number>();
  for (let d = 1; d <= 7; d++) {
    if (cal.workingDays.includes(weekdayCode(d))) workingWeekdays.add(d);
  }
  const days = weeks * 7;
  const end = start.add({ days });
  const inBlock = (d: PlainDate): boolean =>
    api.PlainDate.compare(d, start) >= 0 && api.PlainDate.compare(d, end) < 0;
  let total = BigInt(weeks) * BigInt(workingWeekdays.size) * dayNs;

  // Holidays that fall on a working weekday inside the block contribute nothing.
  for (const h of holidays) {
    const d = api.PlainDate.from(h);
    if (inBlock(d) && workingWeekdays.has(d.dayOfWeek)) total -= dayNs;
  }

  // Days containing an offset transition: real window length vs nominal.
  const startZdt = startOfDay(start, cal.timezone, api);
  const endZdt = startOfDay(end, cal.timezone, api);
  const seen = new Set<string>();
  let z = startZdt;
  for (;;) {
    const tr = z.getTimeZoneTransition('next');
    if (tr === null || api.ZonedDateTime.compare(tr, endZdt) >= 0) break;
    z = tr;
    const before = tr.subtract({ nanoseconds: 1 }).withTimeZone(cal.timezone).toPlainDate();
    for (const d of [before, tr.toPlainDate()]) {
      const key = d.toString();
      if (seen.has(key) || !inBlock(d)) continue;
      seen.add(key);
      if (!isWorkingPlainDate(d, cal, holidays)) continue;
      let actual = 0n;
      for (const w of windowsFor(d, cal, api)) actual += w.end.epochNanoseconds - w.start.epochNanoseconds;
      total += actual - dayNs;
    }
  }
  return total;
}

