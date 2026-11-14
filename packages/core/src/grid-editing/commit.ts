// The calendar-aware commit mapping of the grid cell editors (spec-grid-columns.md section 10.4). Pure given the
// instance: no DOM, no listeners. `planEdit` turns the text a user typed into ONE write (`updateTask`, `resizeTask`
// or `setProgress`), so one edit is one undo entry and one `task:updated`; it never writes by itself.
//
//   start    -> `updateTask(id, { start, end })`. The new day snaps FORWARD to a working day (holidays included),
//               the bar starts at that day's first working window and keeps its working duration (`task.duration`,
//               else the working hours between its old start and end). `moveTask` is not used: it shifts by an
//               exact instant and would not respect non-working time.
//   end      -> `resizeTask(id, hours)`. The day snaps BACKWARD to a working day and the bar ends at that day's last
//               working window end; it must end after it starts. `resizeTask` writes `end` and `duration` together.
//   duration -> `resizeTask(id, hours)` (days are `hoursPerDay` hours). A calendar with no working hours or no working
//               day cannot place a bar, so its start, end and duration cells are not editable.
//   progress -> `setProgress(id, n / 100)`.      name / custom -> `updateTask(id, patch)`.
//
// Dates are Temporal in the calendar's zone (window starts and ends resolve DST gaps the way the calendar helpers
// do). SECURITY (security.md): the store does NOT validate a patch (`updateTask` writes what it is given), so a custom
// `commit` result is vetted here: only `name`, `start`, `end`, `duration` and `progress` may appear (anything else is
// `rejected`, nothing is written), each checked like the built-in editor of that field (name through `parseText` at the
// 500-character core cap, dates in 1900..2200 with the end after the start, duration and progress finite and in range),
// and an error message it returns is capped.
import type { GanttInstance } from '../gantt.js';
import type { GanttInternal } from '../gantt-internal.js';
import {
  addWorkingHours,
  dayAt,
  differenceInWorkingHours,
  holidaySet,
  isWorkingPlainDate,
  normalizeDate,
  windowsFor,
} from '../compute/working-calendar.js';
import { getTemporal } from '../internal/temporal.js';
import type { TaskPatch } from '../store/index.js';
import type { EditErrorReason, Task, WorkingCalendar } from '../types.js';
import type { Column } from '../grid/columns.js';
import { hoursPerDay } from '../grid/values.js';
import { UNSAFE_TEXT } from '../grid/columns.js';
import { MAX_NAME_LENGTH, parseDay, parseNumber, parseText, type Parsed } from './parse.js';

/** Longest `duration` an editor accepts: ten years, in the column unit (a longer one is a multi-second calendar walk). */
const MAX_DAYS = 3_650;
const MAX_HOURS = 87_600;
/** Largest value a custom `number` editor hands to `commit`. */
const MAX_NUMBER = 1e15;
/** The only fields a custom editor's patch may write. */
const WRITABLE = ['name', 'start', 'end', 'duration', 'progress'];
/** Longest message a custom editor or host callback can show. */
export const MAX_MESSAGE_CHARS = 200;

export interface PlanEnv {
  readonly gantt: GanttInstance;
  readonly internal: GanttInternal;
  readonly unit: 'hours' | 'days';
}

export type Plan =
  /** The value is the one already there: write nothing. */
  | { readonly kind: 'noop' }
  | {
      readonly kind: 'error';
      readonly reason: EditErrorReason;
      /** A host's own text (shown as given); absent for the library's reasons. */
      readonly message?: string;
      readonly min?: number;
      readonly max?: number;
    }
  | {
      readonly kind: 'write';
      /** What the host's `beforeCommit` sees: the parsed value. */
      readonly input: string | number;
      readonly patch: TaskPatch;
      /** The one store call. May throw (the store rejects a bad write); nothing is written then. */
      readonly run: () => void;
      readonly snapped?: 'next' | 'previous';
    };

const fail = (reason: EditErrorReason, extra: { message?: string; min?: number; max?: number } = {}): Plan => ({ kind: 'error', reason, ...extra });
const bad = <T>(p: Parsed<T>): p is { readonly error: EditErrorReason } => 'error' in p;

/** A calendar that cannot place a bar: no working hours, or no working day. */
export const unschedulable = (cal: WorkingCalendar): boolean => hoursPerDay(cal) <= 0 || !cal.workingDays.length;

/** The first working day on or after `day` (`step` 1) or on or before it (`step` -1); undefined if there is none. */
function snap(day: ReturnType<ReturnType<typeof getTemporal>['PlainDate']['from']>, cal: WorkingCalendar, step: 1 | -1) {
  const holidays = holidaySet(cal, getTemporal());
  let d = day;
  for (let n = 0; n <= 400; n++, d = d.add({ days: step })) {
    if (isWorkingPlainDate(d, cal, holidays)) return { day: d, moved: n > 0 };
  }
  return undefined;
}

/**
 * Plans the edit of `col` on `task` from `text`. `current` is the cell's unformatted text (what the editor
 * started with), used to detect an edit that changes nothing. `task` must be a leaf where the column needs one
 * (the caller checks editability); a summary or milestone reaching a rule that does not apply is `rejected`.
 */
export function planEdit(env: PlanEnv, task: Task, col: Column, text: string, current: string): Plan {
  try {
    return plan(env, task, col, text, current);
  } catch (e) {
    // The calendar helpers throw on a calendar with no working time; the store throws on a bad write.
    return fail('rejected', { message: e instanceof Error ? e.message.slice(0, MAX_MESSAGE_CHARS) : '' });
  }
}

function plan(env: PlanEnv, task: Task, col: Column, text: string, current: string): Plan {
  const { gantt, internal } = env;
  const cal = internal.calendar;
  const locale = internal.config.locale ?? 'en';
  const id = task.id;
  const api = getTemporal();
  // Rolled-up cells and a milestone's end and duration have no value of their own to edit.
  if (
    col.builtIn &&
    col.id !== 'name' &&
    (internal.tasks.children(id).length > 0 || (task.type === 'milestone' && (col.id === 'end' || col.id === 'duration')))
  ) {
    return fail('rejected');
  }
  // The calendar helpers would walk their million-day guard.
  if (col.builtIn && ['start', 'end', 'duration'].includes(col.id) && unschedulable(cal)) return fail('rejected');
  switch (col.builtIn ? col.id : '') {
    case 'name': {
      const p = parseText(text, MAX_NAME_LENGTH);
      if (bad(p)) return fail(p.error);
      return p.ok === task.name.replace(UNSAFE_TEXT, '').trim()
        ? { kind: 'noop' }
        : { kind: 'write', input: p.ok, patch: { name: p.ok }, run: () => void gantt.updateTask(id, { name: p.ok }) };
    }
    case 'start': {
      const p = parseDay(text);
      if (bad(p)) return fail(p.error);
      if (p.ok === current) return { kind: 'noop' };
      const s = snap(api.PlainDate.from(p.ok), cal, 1);
      if (!s) return fail('rejected');
      const w = windowsFor(s.day, cal, api)[0];
      const start = w ? w.start : dayAt(s.day, cal.timezone, '00:00', api);
      const was = normalizeDate(task.start, cal.timezone);
      if (start.epochNanoseconds === was.epochNanoseconds) return { kind: 'noop' };
      // The working duration the bar keeps: the authored one, else the hours between its old start and end.
      const hours = task.type === 'milestone' ? 0 : task.duration ?? differenceInWorkingHours(was, normalizeDate(task.end, cal.timezone), cal);
      const patch: TaskPatch = { start, end: hours > 0 ? addWorkingHours(start, hours, cal) : start };
      return { kind: 'write', input: p.ok, patch, run: () => void gantt.updateTask(id, patch), ...(s.moved ? { snapped: 'next' as const } : {}) };
    }
    case 'end': {
      const p = parseDay(text);
      if (bad(p)) return fail(p.error);
      if (p.ok === current) return { kind: 'noop' };
      const s = snap(api.PlainDate.from(p.ok), cal, -1);
      if (!s) return fail('rejected');
      const ws = windowsFor(s.day, cal, api);
      const end = ws.length ? ws[ws.length - 1]!.end : dayAt(s.day, cal.timezone, '23:59:59.999999999', api);
      const start = normalizeDate(task.start, cal.timezone);
      if (end.epochNanoseconds <= start.epochNanoseconds) return fail('end-before-start');
      const hours = differenceInWorkingHours(start, end, cal);
      const was = task.duration ?? differenceInWorkingHours(start, normalizeDate(task.end, cal.timezone), cal);
      if (Math.abs(hours - was) < 1e-9) return { kind: 'noop' };
      return {
        kind: 'write',
        input: p.ok,
        patch: { end, duration: hours },
        run: () => void gantt.resizeTask(id, hours),
        ...(s.moved ? { snapped: 'previous' as const } : {}),
      };
    }
    case 'duration': {
      const p = parseNumber(text, locale);
      if (bad(p)) return fail(p.error);
      const days = env.unit === 'days';
      const max = days ? MAX_DAYS : MAX_HOURS;
      if (p.ok > max) return fail('out-of-range', { min: 0, max });
      if (Math.round(p.ok * 1e4) / 1e4 === Number(current)) return { kind: 'noop' };
      const hours = days ? p.ok * hoursPerDay(cal) : p.ok;
      const start = normalizeDate(task.start, cal.timezone);
      return {
        kind: 'write',
        input: p.ok,
        // Only `beforeCommit` reads it: `resizeTask` walks the calendar itself, so it is not walked twice for nothing.
        get patch() {
          return { end: addWorkingHours(start, hours, cal), duration: hours };
        },
        run: () => void gantt.resizeTask(id, hours),
      };
    }
    case 'progress': {
      const p = parseNumber(text, locale, true);
      if (bad(p)) return fail(p.error);
      if (p.ok > 100) return fail('out-of-range', { min: 0, max: 100 });
      const n = Math.round(p.ok * 10) / 10;
      if (n === Number(current)) return { kind: 'noop' };
      return { kind: 'write', input: n, patch: { progress: n / 100 }, run: () => void gantt.setProgress(id, n / 100) };
    }
  }
  const ed = col.editor;
  if (!ed) return fail('rejected');
  let input: string | number;
  if (ed.type === 'number') {
    const p = parseNumber(text, locale);
    if (bad(p)) return fail(p.error);
    const [lo, hi] = [ed.min ?? 0, Math.min(ed.max ?? MAX_NUMBER, MAX_NUMBER)];
    if (p.ok < lo || p.ok > hi) return fail('out-of-range', { min: lo, max: hi });
    input = p.ok;
  } else if (ed.type === 'date') {
    const p = parseDay(text);
    if (bad(p)) return fail(p.error);
    input = p.ok;
  } else {
    // A custom text field may be cleared (the host's `commit` decides whether that is allowed).
    const p = text.trim() ? parseText(text, Math.min(ed.maxLength ?? 1000, 1000)) : { ok: '' };
    if (bad(p)) return fail(p.error);
    input = p.ok;
  }
  let res: unknown;
  try {
    res = ed.commit(input, task, { locale, calendar: cal, isSummary: internal.tasks.children(id).length > 0 });
  } catch {
    return fail('rejected');
  }
  const message = (res as { error?: unknown } | null)?.error;
  if (typeof message === 'string') return fail('rejected', { message: message.slice(0, MAX_MESSAGE_CHARS) });
  const patch = vet(task, res, cal);
  if ('kind' in patch) return patch;
  const instant = (v: unknown): bigint => normalizeDate(v as string, cal.timezone).epochNanoseconds;
  if (
    Object.entries(patch).every(([k, v]) =>
      k === 'start' || k === 'end' ? instant(v) === instant((task as unknown as Record<string, unknown>)[k]) : Object.is(v, (task as unknown as Record<string, unknown>)[k]),
    )
  ) {
    return { kind: 'noop' };
  }
  return { kind: 'write', input, patch, run: () => void gantt.updateTask(id, patch) };
}

/**
 * Vets a custom editor's patch (see the header): the allow-listed fields only, each valid, or a `rejected` / `end-before-start`
 * plan. The store validates nothing, and `updateTask` writes a bad date and only then throws, so nothing unchecked reaches it.
 */
function vet(task: Task, res: unknown, cal: WorkingCalendar): TaskPatch | Plan {
  if (typeof res !== 'object' || res === null || Array.isArray(res)) return fail('rejected');
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(res)) {
    if (!WRITABLE.includes(k)) return fail('rejected', { message: `"${k.slice(0, 40)}" cannot be written by an editor.` });
    const v = (res as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (k === 'name') {
      const p = typeof v === 'string' ? parseText(v, MAX_NAME_LENGTH) : ({ error: 'rejected' } as const);
      if (bad(p)) return fail(p.error);
      out[k] = p.ok;
    } else if (k === 'start' || k === 'end') {
      const year = normalizeDate(v as string, cal.timezone).year; // throws on a bad date: planEdit reports `rejected`
      if (year < 1900 || year > 2200) return fail('not-a-date');
      out[k] = v;
    } else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > (k === 'progress' ? 1 : MAX_HOURS)) {
      return fail('out-of-range', k === 'progress' ? { min: 0, max: 1 } : { min: 0, max: MAX_HOURS });
    } else out[k] = v;
  }
  if ('start' in out || 'end' in out) {
    const s = normalizeDate((out['start'] ?? task.start) as string, cal.timezone).epochNanoseconds;
    const e = normalizeDate((out['end'] ?? task.end) as string, cal.timezone).epochNanoseconds;
    if (task.type === 'milestone' ? e < s : e <= s) return fail('end-before-start');
  }
  return out as TaskPatch;
}
