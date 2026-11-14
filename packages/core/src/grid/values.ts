// The grid's value pipeline (spec-grid-columns.md section 6). Pure and DOM-free: task + column in,
// text out. One reader serves the painted cells and the CSV report, so the two can never disagree.
//
// PERFORMANCE: a row's duration used to cost a working-calendar walk (investigation V, PR #125:
// ~8.4 s for 2000 rows over 520 days). Here every duration comes from ONE `workingHoursMeter` built
// lazily per data revision, and every cell text is memoized per (revision, columns, unit), so a
// repaint that changed no data (zoom, collapse) formats nothing.
//
// SECURITY: `value()` and `format()` are host code and their output may derive from user content:
// exceptions are contained, only strings and finite numbers are accepted, text is capped at
// `MAX_CELL_CHARS` and stripped of controls and bidi overrides. Nothing here builds markup.
import type { GanttInternal } from '../gantt-internal.js';
import { differenceInWorkingHours, normalizeDate, workingHoursMeter } from '../compute/working-calendar.js';
import type { RolledUpRow, Task, TaskId, WorkingCalendar } from '../types.js';
import { MAX_CELL_CHARS, UNSAFE_TEXT, type Column } from './columns.js';

type ZDT = ReturnType<typeof normalizeDate>;
type Unit = 'hours' | 'days';

/** Longest span (days) of one tabulated or measured duration; a task whose own span is longer renders blank. */
const MAX_METER_DAYS = 36_500;
const NS_PER_DAY = 86_400_000_000_000n;
/** Calendar days between two instants (either order). */
const span = (a: ZDT, b: ZDT): number =>
  Number((a.epochNanoseconds > b.epochNanoseconds ? a.epochNanoseconds - b.epochNanoseconds : b.epochNanoseconds - a.epochNanoseconds) / NS_PER_DAY);

/** Reads cell text. */
export interface GridValues {
  /** Display text per column for `task`, memoized for the current data revision. */
  text(task: Task, cols: readonly Column[]): readonly string[];
  /** Raw CSV cell text per column for `task` (dates `YYYY-MM-DD`, duration in the unit, integer percent). */
  raw(task: Task, cols: readonly Column[]): string[];
}

interface Memo {
  rev: number;
  cols: readonly Column[];
  unit: Unit;
  locale: string;
  rollup: ReadonlyMap<TaskId, RolledUpRow> | undefined;
  /** True once `coverSpans` ran for this revision. */
  covered: boolean;
  byId: Map<TaskId, readonly string[]>;
  date: Intl.DateTimeFormat;
  num: Intl.NumberFormat;
  unitNum: Intl.NumberFormat;
  pct: Intl.NumberFormat;
}

/** Working hours in one calendar day (sum of the windows), or 0 when none parse. */
export const hoursPerDay = (cal: WorkingCalendar): number => {
  let h = 0;
  for (const w of cal.workingHours) {
    const m = /^(\d{2}):(\d{2})$/.exec(w.start);
    const n = /^(\d{2}):(\d{2})$/.exec(w.end);
    if (m && n) h += Math.max(0, Number(n[1]) + Number(n[2]) / 60 - Number(m[1]) - Number(m[2]) / 60);
  }
  return h;
};

const clean = (s: string): string => s.slice(0, MAX_CELL_CHARS).replace(UNSAFE_TEXT, ' ');

/** Creates the reader for one instance. `unit` is read live. */
export function createGridValues(internal: GanttInternal, unit: () => Unit): GridValues {
  const cal = internal.calendar;
  const locale = internal.config.locale ?? 'en';
  const hpd = hoursPerDay(cal);
  const warned = new Set<string>();
  let memo: Memo | undefined;

  const warn = (col: Column, err: unknown): void => {
    if (warned.has(col.id)) return;
    warned.add(col.id);
    console.warn(`@fluxgantt/core: grid column "${col.id}" threw; its cells render blank.`, err);
  };

  const make = (cols: readonly Column[], u: Unit): Memo => {
    let loc = locale;
    let fmts: Pick<Memo, 'date' | 'num' | 'unitNum' | 'pct'> | undefined;
    for (let attempt = 0; !fmts; attempt++) {
      try {
        fmts = {
          date: new Intl.DateTimeFormat(loc, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: cal.timezone,
          }),
          num: new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }),
          unitNum: new Intl.NumberFormat(loc, {
            style: 'unit',
            unit: u === 'days' && hpd > 0 ? 'day' : 'hour',
            unitDisplay: 'narrow',
            maximumFractionDigits: 1,
          }),
          pct: new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 0 }),
        };
      } catch (e) {
        if (attempt) throw e;
        loc = 'en'; // an unknown locale tag degrades to English rather than breaking the paint
      }
    }
    const provider = internal.config.rollup;
    const tasks = internal.tasks.all();
    let rollup: ReadonlyMap<TaskId, RolledUpRow> | undefined;
    if (provider && tasks.length) {
      try {
        rollup = provider(tasks, cal);
      } catch (e) {
        console.warn('@fluxgantt/core: config.rollup threw.', e);
      }
    }
    return {
      rev: internal.tasks.revision.peek(),
      cols,
      unit: u,
      locale: loc,
      rollup,
      covered: false,
      byId: new Map(),
      ...fmts,
    };
  };

  // The working-hours table depends only on (calendar, lo, hi), never on the tasks, and a calendar is
  // immutable for an instance's life: it is kept ACROSS data revisions and only rebuilt (over the union)
  // when a task falls outside its range. A table over a long span is expensive (~3.7 s for 100 years).
  let table: { lo: ZDT; hi: ZDT; read: (from: ZDT, to: ZDT) => number } | undefined;

  /** Makes `table` cover every task whose duration is not authored, in the main cluster of dates. */
  const coverSpans = (m: Memo): void => {
    if (m.covered) return;
    m.covered = true;
    const spans: [ZDT, ZDT][] = [];
    for (const t of internal.tasks.all()) {
      const r = t.type === 'milestone' ? undefined : m.rollup?.get(t.id);
      if (t.duration !== undefined && !r) continue;
      try {
        const a = normalizeDate(r?.start ?? t.start, cal.timezone);
        const b = normalizeDate(r?.end ?? t.end, cal.timezone);
        if (span(a, b) <= MAX_METER_DAYS) spans.push([a, b]); // a bad date skips only its own task
      } catch {
        // renders blank
      }
    }
    if (!spans.length) return;
    // Tasks far from the bulk (a "someday" placeholder in 2099) must not stretch the table: only spans
    // within half the cap either side of the median start are tabulated; the rest are measured one by one.
    const starts = spans.map(([a]) => a.epochNanoseconds).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    const anchor = starts[starts.length >> 1]!;
    const half = BigInt(MAX_METER_DAYS / 2) * NS_PER_DAY;
    let lo: ZDT | undefined;
    let hi: ZDT | undefined;
    for (const [a, b] of spans) {
      if (a.epochNanoseconds < anchor - half || b.epochNanoseconds > anchor + half) continue;
      if (!lo || a.epochNanoseconds < lo.epochNanoseconds) lo = a;
      if (!hi || b.epochNanoseconds > hi.epochNanoseconds) hi = b;
    }
    if (!lo || !hi || (table && table.lo.epochNanoseconds <= lo.epochNanoseconds && table.hi.epochNanoseconds >= hi.epochNanoseconds)) return;
    if (table) {
      const ulo = table.lo.epochNanoseconds < lo.epochNanoseconds ? table.lo : lo;
      const uhi = table.hi.epochNanoseconds > hi.epochNanoseconds ? table.hi : hi;
      if (span(ulo, uhi) <= MAX_METER_DAYS) {
        lo = ulo;
        hi = uhi;
      }
    }
    try {
      table = { lo, hi, read: workingHoursMeter(cal, lo, hi) };
    } catch {
      // measured one by one below
    }
  };

  /**
   * Working hours of the task: an AUTHORED `duration` (or the rollup's `durationHours` for a summary)
   * wins over the start/end span, exactly as the critical path reads it, so the cell can disagree with
   * the bar when the host's duration disagrees with its dates. Otherwise the shared table, or one
   * `differenceInWorkingHours` for a span outside it. `undefined` when it cannot be measured.
   */
  const hoursOf = (m: Memo, t: Task, r: RolledUpRow | undefined): number | undefined => {
    if (t.type === 'milestone') return 0;
    const own = r ? (r as { durationHours?: unknown }).durationHours : t.duration;
    if (typeof own === 'number' && Number.isFinite(own) && own >= 0) return own;
    try {
      const a = normalizeDate(r?.start ?? t.start, cal.timezone);
      const b = normalizeDate(r?.end ?? t.end, cal.timezone);
      if (span(a, b) > MAX_METER_DAYS) return undefined;
      coverSpans(m);
      const inside = table && table.lo.epochNanoseconds <= a.epochNanoseconds && table.hi.epochNanoseconds >= b.epochNanoseconds;
      return Math.max(0, inside ? table!.read(a, b) : differenceInWorkingHours(a, b, cal));
    } catch {
      return undefined;
    }
  };

  const custom = (m: Memo, t: Task, col: Column, formatted: boolean): string => {
    try {
      const ctx = { locale: m.locale, calendar: cal, isSummary: internal.tasks.children(t.id).length > 0 };
      const v = col.value!(t, ctx);
      if (typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) return '';
      if (!formatted || !col.format) return String(v);
      const f = col.format(v, t, ctx);
      return typeof f === 'string' ? f : '';
    } catch (e) {
      warn(col, e);
      return '';
    }
  };

  const read = (m: Memo, t: Task, col: Column, raw: boolean): string => {
    if (!col.builtIn) return custom(m, t, col, !raw);
    const r = t.type === 'milestone' ? undefined : m.rollup?.get(t.id);
    switch (col.id) {
      case 'name':
        return String(t.name);
      case 'start':
      case 'end':
        try {
          const z = normalizeDate((col.id === 'start' ? r?.start ?? t.start : r?.end ?? t.end), cal.timezone);
          return raw ? z.toPlainDate().toString() : m.date.format(z.epochMilliseconds);
        } catch {
          return '';
        }
      case 'duration': {
        const h = hoursOf(m, t, r);
        if (h === undefined) return '';
        const n = m.unit === 'days' && hpd > 0 ? h / hpd : h;
        return raw ? String(Math.round(n * 1e4) / 1e4) : m.unitNum.format(n);
      }
      default: {
        // progress
        const p = Math.min(1, Math.max(0, Number(r?.progress ?? t.progress) || 0));
        return raw ? String(Math.round(p * 100)) : m.pct.format(p);
      }
    }
  };

  const current = (cols: readonly Column[]): Memo => {
    const u = unit();
    if (!memo || memo.rev !== internal.tasks.revision.peek() || memo.cols !== cols || memo.unit !== u) {
      memo = make(cols, u);
    }
    return memo;
  };

  return {
    text(task, cols) {
      const m = current(cols);
      let row = m.byId.get(task.id);
      if (!row) {
        row = cols.map((c) => clean(read(m, task, c, false)));
        m.byId.set(task.id, row);
      }
      return row;
    },
    raw(task, cols) {
      const m = current(cols);
      return cols.map((c) => read(m, task, c, true).slice(0, MAX_CELL_CHARS));
    },
  };
}
