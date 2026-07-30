import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  deriveTimeRange,
  createTimeScale,
  layoutRows,
  layoutTaskBar,
  layoutDependencyPath,
  computeGridColumns,
  validateTaskColor,
  PIXELS_PER_DAY,
  ROW_HEIGHT,
  MAX_GRID_COLUMNS,
  MAX_HIERARCHY_DEPTH,
  isKnownTaskKind,
  isKnownDependencyType,
  type TimeScale,
  type TaskBarLayout,
} from '../../src/render/renderer-base.js';
import {
  DEFAULT_CALENDAR,
  normalizeDate,
  isWorkingDay,
  isHoliday,
} from '../../src/compute/working-calendar.js';
import { getTemporal } from '../../src/internal/temporal.js';
import { toTaskId, toDependencyId, type Task, type WorkingCalendar } from '../../src/types.js';

const cal = DEFAULT_CALENDAR;
const T = getTemporal();

function task(id: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: toTaskId(id),
    name: id,
    start,
    end,
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------
// deriveTimeRange
// ---------------------------------------------------------------------------------------
describe('deriveTimeRange', () => {
  it('spans min(start)..max(end) + viewMode padding', () => {
    const tasks = [
      task('a', '2026-01-05T09:00', '2026-01-07T17:00'),
      task('b', '2026-01-06T09:00', '2026-01-10T17:00'),
    ];
    const range = deriveTimeRange(tasks, 'week', cal);
    // week padding = 7 days each side
    expect(range.start.toPlainDate().toString()).toBe('2025-12-29'); // 2026-01-05 − 7d
    expect(range.end.toPlainDate().toString()).toBe('2026-01-17'); // 2026-01-10 + 7d
    // start is always before end
    expect(T.ZonedDateTime.compare(range.start, range.end)).toBeLessThan(0);
  });

  it('throws when tasks is empty (nothing to infer a viewport from)', () => {
    expect(() => deriveTimeRange([], 'week', cal)).toThrow(/must not be empty/);
  });

  it('padding differs by viewMode (day < week < month)', () => {
    const tasks = [task('a', '2026-06-15T09:00', '2026-06-15T17:00')];
    const dayStart = deriveTimeRange(tasks, 'day', cal).start.toPlainDate();
    const monthStart = deriveTimeRange(tasks, 'month', cal).start.toPlainDate();
    // month padding (30) is earlier than day padding (3)
    expect(T.PlainDate.compare(monthStart, dayStart)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------------------
// createTimeScale — round-trip, monotonic, DST, multi-timezone
// ---------------------------------------------------------------------------------------
describe('createTimeScale', () => {
  const range = {
    start: normalizeDate('2026-01-01T00:00', cal.timezone),
    end: normalizeDate('2026-02-01T00:00', cal.timezone),
  };

  it('dateToX(start) === 0, monotonically increasing by day, totalWidth > 0', () => {
    const ts = createTimeScale(range, 'week', cal);
    expect(ts.dateToX(range.start)).toBeCloseTo(0, 6);
    expect(ts.totalWidth).toBeGreaterThan(0);
    expect(ts.dateToX('2026-01-10T00:00')).toBeLessThan(ts.dateToX('2026-01-20T00:00'));
    expect(ts.pixelsPerDay).toBe(PIXELS_PER_DAY.week);
  });

  it('xToDate(dateToX(d)) round-trips within < 1 hour', () => {
    const ts = createTimeScale(range, 'day', cal);
    const d = normalizeDate('2026-01-15T13:37', cal.timezone);
    const back = ts.xToDate(ts.dateToX(d));
    const diffHours =
      Number(back.epochNanoseconds - d.epochNanoseconds) / 3_600_000_000_000;
    expect(Math.abs(diffHours)).toBeLessThan(1);
  });

  it('no NaN/Infinity when the range crosses a DST boundary (America/New_York, March)', () => {
    const dstCal: WorkingCalendar = { ...cal, timezone: 'America/New_York' };
    // 2026-03-08 02:00 is the DST spring-forward in New York
    const dstRange = {
      start: normalizeDate('2026-03-06T00:00', dstCal.timezone),
      end: normalizeDate('2026-03-10T00:00', dstCal.timezone),
    };
    const ts = createTimeScale(dstRange, 'day', dstCal);
    const x = ts.dateToX('2026-03-09T00:00');
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(ts.totalWidth)).toBe(true);
    expect(ts.totalWidth).toBeGreaterThan(0);
  });

  it.each(['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'])(
    'totalWidth is finite & positive in timezone %s',
    (tz) => {
      const c: WorkingCalendar = { ...cal, timezone: tz };
      const r = {
        start: normalizeDate('2026-01-01T00:00', tz),
        end: normalizeDate('2026-03-01T00:00', tz),
      };
      const ts = createTimeScale(r, 'month', c);
      expect(Number.isFinite(ts.totalWidth)).toBe(true);
      expect(ts.totalWidth).toBeGreaterThan(0);
    },
  );

  it('property: valid tasks → totalWidth finite, not NaN', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }),
        fc.integer({ min: 1, max: 300 }),
        (startOffset, spanDays) => {
          const start = normalizeDate('2026-01-01T00:00', cal.timezone).add({ days: startOffset });
          const end = start.add({ days: spanDays });
          const ts = createTimeScale({ start, end }, 'week', cal);
          expect(Number.isFinite(ts.totalWidth)).toBe(true);
          expect(ts.totalWidth).toBeGreaterThanOrEqual(0);
          expect(Number.isNaN(ts.dateToX(end))).toBe(false);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------------------
// layoutRows — depth, pre-order, cycle throw, dangling parent
// ---------------------------------------------------------------------------------------
describe('layoutRows', () => {
  it('correct depth + pre-order keeps sibling order + y increases by ROW_HEIGHT', () => {
    const tasks = [
      task('root', '2026-01-05T09:00', '2026-01-05T17:00', { type: 'summary' }),
      task('c1', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('root') }),
      task('c2', '2026-01-06T09:00', '2026-01-06T17:00', { parent: toTaskId('root') }),
    ];
    const rows = layoutRows(tasks, 'default');
    expect(rows.map((r) => r.task.id)).toEqual(['root', 'c1', 'c2']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1]);
    expect(rows.map((r) => r.y)).toEqual([0, ROW_HEIGHT.default, ROW_HEIGHT.default * 2]);
  });

  it('non-existent parent (dangling) → task is a root at depth 0, no throw', () => {
    const tasks = [task('x', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('ghost') })];
    const rows = layoutRows(tasks, 'default');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.depth).toBe(0);
  });

  it('cycle parent-chain 2 node → throw', () => {
    const tasks = [
      task('a', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('b') }),
      task('b', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('a') }),
    ];
    expect(() => layoutRows(tasks, 'default')).toThrow(/cyclic parent chain/);
  });

  it('long parent-chain cycle (a→b→c→a) → throws', () => {
    const tasks = [
      task('a', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('c') }),
      task('b', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('a') }),
      task('c', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('b') }),
    ];
    expect(() => layoutRows(tasks, 'default')).toThrow(/cyclic parent chain/);
  });

  it('acyclic chain deeper than MAX_HIERARCHY_DEPTH → controlled throw, no stack overflow (N1)', () => {
    // t0 ← t1 ← t2 ← ... : each task's parent is the previous one → a linear chain (no cycle).
    const deep: Task[] = [];
    for (let i = 0; i <= MAX_HIERARCHY_DEPTH + 1; i++) {
      deep.push(
        task(`t${i}`, '2026-01-05T09:00', '2026-01-05T17:00', i === 0 ? {} : { parent: toTaskId(`t${i - 1}`) }),
      );
    }
    expect(() => layoutRows(deep, 'default')).toThrow(/exceeds max depth/);
  });
});

describe('enum whitelist guards (N3/N5)', () => {
  it('isKnownTaskKind: true only for the 4 valid TaskKinds', () => {
    for (const k of ['task', 'summary', 'milestone', 'project']) expect(isKnownTaskKind(k)).toBe(true);
    for (const k of ['', 'evil', 'fg-task--x foo', '__proto__']) expect(isKnownTaskKind(k)).toBe(false);
  });

  it('isKnownDependencyType: true only for FS/SS/FF/SF', () => {
    for (const t of ['FS', 'SS', 'FF', 'SF']) expect(isKnownDependencyType(t)).toBe(true);
    for (const t of ['', 'XX', 'toString', 'constructor']) expect(isKnownDependencyType(t)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
// layoutTaskBar — milestone square, clamp end<start, proportional
// ---------------------------------------------------------------------------------------
describe('layoutTaskBar', () => {
  const range = {
    start: normalizeDate('2026-01-01T00:00', cal.timezone),
    end: normalizeDate('2026-02-01T00:00', cal.timezone),
  };
  const ts: TimeScale = createTimeScale(range, 'day', cal);
  const rowHeight = ROW_HEIGHT.default;
  const row = { task: task('_', '2026-01-01', '2026-01-01'), depth: 0, rowIndex: 0, y: 0 };

  it('milestone: width === height (square for the diamond)', () => {
    const m = task('m', '2026-01-10T00:00', '2026-01-10T00:00', { type: 'milestone' });
    const bar = layoutTaskBar(m, ts, row, rowHeight);
    expect(bar.width).toBe(bar.height);
    expect(bar.width).toBeGreaterThan(0);
  });

  it('end < start → clamps width to 0, does NOT throw', () => {
    const bad = task('bad', '2026-01-20T00:00', '2026-01-10T00:00');
    const bar = layoutTaskBar(bad, ts, row, rowHeight);
    expect(bar.width).toBe(0);
  });

  it('width is proportional to the day span (a 10-day task is ~2× a 5-day task)', () => {
    const short = layoutTaskBar(task('s', '2026-01-05T00:00', '2026-01-10T00:00'), ts, row, rowHeight);
    const long = layoutTaskBar(task('l', '2026-01-05T00:00', '2026-01-15T00:00'), ts, row, rowHeight);
    expect(long.width).toBeCloseTo(short.width * 2, 4);
  });

  it('property: width is always ≥ 0 and finite for any start/end', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 }), (s, e) => {
        const t = task(
          'p',
          `2026-01-01T00:00`,
          `2026-01-01T00:00`,
        );
        const tt: Task = {
          ...t,
          start: normalizeDate('2026-01-01T00:00', cal.timezone).add({ days: s }).toString(),
          end: normalizeDate('2026-01-01T00:00', cal.timezone).add({ days: e }).toString(),
        };
        const bar = layoutTaskBar(tt, ts, row, rowHeight);
        expect(bar.width).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(bar.width)).toBe(true);
      }),
    );
  });
});

// ---------------------------------------------------------------------------------------
// layoutDependencyPath — 4 anchor-edge types
// ---------------------------------------------------------------------------------------
describe('layoutDependencyPath', () => {
  const from: TaskBarLayout = { task: task('a', '', ''), x: 10, y: 0, width: 40, height: 20 };
  const to: TaskBarLayout = { task: task('b', '', ''), x: 100, y: 40, width: 40, height: 20 };
  const dep = (type: 'FS' | 'SS' | 'FF' | 'SF') => ({
    id: toDependencyId(`${type}-dep`),
    from: toTaskId('a'),
    to: toTaskId('b'),
    type,
  });

  it('FS: anchor end(from) → start(to)', () => {
    const p = layoutDependencyPath(dep('FS'), from, to, 20);
    expect(p.points[0]).toEqual({ x: 50, y: 10 }); // from.x+width, mid-y
    expect(p.points[p.points.length - 1]).toEqual({ x: 100, y: 50 }); // to.x, mid-y
  });

  it('SS: anchor start(from) → start(to)', () => {
    const p = layoutDependencyPath(dep('SS'), from, to, 20);
    expect(p.points[0]).toEqual({ x: 10, y: 10 });
    expect(p.points[p.points.length - 1]).toEqual({ x: 100, y: 50 });
  });

  it('FF: anchor end(from) → end(to)', () => {
    const p = layoutDependencyPath(dep('FF'), from, to, 20);
    expect(p.points[0]).toEqual({ x: 50, y: 10 });
    expect(p.points[p.points.length - 1]).toEqual({ x: 140, y: 50 });
  });

  it('SF: anchor start(from) → end(to)', () => {
    const p = layoutDependencyPath(dep('SF'), from, to, 20);
    expect(p.points[0]).toEqual({ x: 10, y: 10 });
    expect(p.points[p.points.length - 1]).toEqual({ x: 140, y: 50 });
  });

  it('same row (same y) → straight 2-point line', () => {
    const sameRow: TaskBarLayout = { task: task('b', '', ''), x: 100, y: 0, width: 40, height: 20 };
    const p = layoutDependencyPath(dep('FS'), from, sameRow, 20);
    expect(p.points).toHaveLength(2);
  });

  it('property: all points finite (no NaN) for random rects', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.integer({ min: -500, max: 500 }),
          y: fc.integer({ min: 0, max: 500 }),
          width: fc.integer({ min: 0, max: 200 }),
          height: fc.integer({ min: 1, max: 60 }),
        }),
        fc.constantFrom('FS', 'SS', 'FF', 'SF') as fc.Arbitrary<'FS' | 'SS' | 'FF' | 'SF'>,
        (rect, type) => {
          const b: TaskBarLayout = { task: task('z', '', ''), ...rect };
          const p = layoutDependencyPath(dep(type), from, b, 20);
          for (const pt of p.points) {
            expect(Number.isFinite(pt.x)).toBe(true);
            expect(Number.isFinite(pt.y)).toBe(true);
          }
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------------------
// computeGridColumns — delegates to working-calendar, MAX_GRID_COLUMNS guard
// ---------------------------------------------------------------------------------------
describe('computeGridColumns', () => {
  const now = normalizeDate('2026-01-15T12:00', cal.timezone);

  it('isWeekend/isHoliday EXACTLY match working-calendar isWorkingDay/isHoliday (no calendar guessing)', () => {
    const range = {
      start: normalizeDate('2026-01-05T00:00', cal.timezone), // Mon
      end: normalizeDate('2026-01-11T00:00', cal.timezone), // Sun
    };
    const ts = createTimeScale(range, 'week', cal);
    const cols = computeGridColumns(ts, 'week', cal, 'en', now);
    expect(cols.length).toBe(7);
    for (const col of cols) {
      // recompute independently with the same compute fn → assert the renderer does not drift
      const d = ts.xToDate(col.x).toPlainDate();
      expect(col.isWeekend).toBe(!isWorkingDay(d, cal));
      expect(col.isHoliday).toBe(isHoliday(d, cal));
    }
    // Mon-Fri are working days → 2 weekend days
    expect(cols.filter((c) => c.isWeekend)).toHaveLength(2);
  });

  it('a holiday inside the range is marked isHoliday', () => {
    const holidayCal: WorkingCalendar = { ...cal, holidays: ['2026-01-07'] };
    const range = {
      start: normalizeDate('2026-01-05T00:00', cal.timezone),
      end: normalizeDate('2026-01-09T00:00', cal.timezone),
    };
    const ts = createTimeScale(range, 'week', holidayCal);
    const cols = computeGridColumns(ts, 'week', holidayCal, 'en', now);
    expect(cols.filter((c) => c.isHoliday)).toHaveLength(1);
  });

  it('isToday on the column containing `now`', () => {
    const range = {
      start: normalizeDate('2026-01-14T00:00', cal.timezone),
      end: normalizeDate('2026-01-16T00:00', cal.timezone),
    };
    const ts = createTimeScale(range, 'week', cal);
    const cols = computeGridColumns(ts, 'week', cal, 'en', now);
    expect(cols.filter((c) => c.isToday)).toHaveLength(1);
  });

  it('throws when the range exceeds MAX_GRID_COLUMNS (anti-DoS)', () => {
    const start = normalizeDate('2000-01-01T00:00', cal.timezone);
    const range = { start, end: start.add({ days: MAX_GRID_COLUMNS + 10 }) };
    const ts = createTimeScale(range, 'year', cal);
    expect(() => computeGridColumns(ts, 'year', cal, 'en', now)).toThrow(/max column guard/);
  });
});

// ---------------------------------------------------------------------------------------
// validateTaskColor — whitelist full-match (security)
// ---------------------------------------------------------------------------------------
describe('validateTaskColor', () => {
  it.each(['#fff', '#ffff', '#6366f1', '#6366f1ff', 'rgb(1,2,3)', 'rgba(1, 2, 3, 0.5)', 'hsl(210,50%,50%)', 'hsla(210, 50%, 50%, 1)'])(
    'accepts valid color %s',
    (c) => {
      expect(validateTaskColor(c)).toBe(c);
    },
  );

  it.each([
    'red',
    'tomato',
    'url(javascript:alert(1))',
    'expression(alert(1))',
    'javascript:alert(1)',
    '<script>alert(1)</script>',
    '#6366f1; background:url(x)',
    'red; } * { display:none',
    '#12345', // 5 hex — invalid
    '',
  ])('rejects dangerous/invalid color %s', (c) => {
    expect(validateTaskColor(c)).toBeUndefined();
  });

  it('undefined → undefined', () => {
    expect(validateTaskColor(undefined)).toBeUndefined();
  });

  it('no partial-match: a string that starts valid but has a malicious tail → reject', () => {
    expect(validateTaskColor('#6366f1 url(javascript:alert(1))')).toBeUndefined();
  });
});
