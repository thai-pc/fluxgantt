import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  deriveTimeRange,
  createTimeScale,
  layoutRows,
  layoutTaskBar,
  layoutDependencyPath,
  computeGridColumns,
  todayLineX,
  validateTaskColor,
  PIXELS_PER_DAY,
  ROW_HEIGHT,
  MAX_GRID_COLUMNS,
  MAX_HIERARCHY_DEPTH,
  isKnownTaskKind,
  isKnownDependencyType,
  buildTaskAriaLabel,
  type RolledUpRow,
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
import { toTaskId, toDependencyId, type Task, type TaskId, type WorkingCalendar } from '../../src/types.js';

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

// ---------------------------------------------------------------------------------------
// layoutRows — collapse-awareness (spec-collapse-expand.md §5/§9.2)
// ---------------------------------------------------------------------------------------
describe('layoutRows — collapse-awareness', () => {
  function hierarchy(): Task[] {
    return [
      task('root', '2026-01-05T09:00', '2026-01-05T17:00', { type: 'summary' }),
      task('c1', '2026-01-05T09:00', '2026-01-05T17:00', { type: 'summary', parent: toTaskId('root') }),
      task('c1a', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('c1') }),
      task('c1b', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('c1') }),
      task('c2', '2026-01-06T09:00', '2026-01-06T17:00', { parent: toTaskId('root') }),
    ];
  }

  it('with no collapsedIds, every task is a visible row (baseline)', () => {
    const rows = layoutRows(hierarchy(), 'default');
    expect(rows.map((r) => r.task.id)).toEqual(['root', 'c1', 'c1a', 'c1b', 'c2']);
    expect(rows.every((r) => !r.isCollapsed)).toBe(true);
  });

  it('collapsing a summary hides only its descendants, siblings stay visible', () => {
    const rows = layoutRows(hierarchy(), 'default', new Set([toTaskId('c1')]));
    expect(rows.map((r) => r.task.id)).toEqual(['root', 'c1', 'c2']);
    const c1Row = rows.find((r) => r.task.id === 'c1')!;
    expect(c1Row.hasChildren).toBe(true);
    expect(c1Row.isCollapsed).toBe(true);
    const rootRow = rows.find((r) => r.task.id === 'root')!;
    expect(rootRow.hasChildren).toBe(true);
    expect(rootRow.isCollapsed).toBe(false);
  });

  it('hasChildren === false and isCollapsed === false for a leaf task, even if force-listed in collapsedIds', () => {
    const rows = layoutRows(hierarchy(), 'default', new Set([toTaskId('c1a')]));
    const leaf = rows.find((r) => r.task.id === 'c1a')!;
    expect(leaf.hasChildren).toBe(false);
    expect(leaf.isCollapsed).toBe(false);
  });

  it('collapsing the root hides the entire subtree, only the root row remains', () => {
    const rows = layoutRows(hierarchy(), 'default', new Set([toTaskId('root')]));
    expect(rows.map((r) => r.task.id)).toEqual(['root']);
  });

  it('rowIndex stays contiguous 0..n-1 over the VISIBLE rows only', () => {
    const rows = layoutRows(hierarchy(), 'default', new Set([toTaskId('c1')]));
    expect(rows.map((r) => r.rowIndex)).toEqual([0, 1, 2]);
  });

  it('depth of an emitted row is unaffected by collapse elsewhere in the tree', () => {
    const rows = layoutRows(hierarchy(), 'default', new Set([toTaskId('c1')]));
    const c2Row = rows.find((r) => r.task.id === 'c2')!;
    expect(c2Row.depth).toBe(1); // unchanged whether or not c1 (a sibling) is collapsed
  });

  it('CRITICAL: a valid, acyclic, collapsed hierarchy must NOT throw "cyclic parent chain" — ' +
    'regression test against the naive "skip recursion" implementation (spec §5)', () => {
    // A naive implementation that simply never recurses into a collapsed task's children would
    // never `visit()` those hidden descendants at all, and a coverage check based on
    // `rows.length !== tasks.length` (or any similarly naive "did every task produce a row"
    // check) would then incorrectly conclude the tree is cyclic/dangling for this perfectly
    // valid input, purely because fewer rows were emitted than there are tasks.
    const tasks = hierarchy(); // 5 tasks, but only 3 rows visible when c1 is collapsed
    expect(() => layoutRows(tasks, 'default', new Set([toTaskId('c1')]))).not.toThrow();
    const rows = layoutRows(tasks, 'default', new Set([toTaskId('c1')]));
    expect(rows.length).toBe(3);
    expect(tasks.length).toBe(5);
  });

  it('a cycle entirely inside a collapsed subtree still throws — collapse must not hide it from detection', () => {
    // `root` is a normal, real root with one real child `mid` (so root itself is collapsible);
    // `a`/`b` form a genuine 2-node cycle that is unreachable from `root` at all (an orphaned
    // cyclic component) — proving the fixed algorithm's full-tree coverage check still catches a
    // cycle that isn't even nested under the collapsed task, let alone one that is.
    const tasks = [
      task('root', '2026-01-05T09:00', '2026-01-05T17:00', { type: 'summary' }),
      task('mid', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('root') }),
      task('a', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('b') }),
      task('b', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('a') }),
    ];
    expect(() => layoutRows(tasks, 'default', new Set([toTaskId('root')]))).toThrow(/cyclic parent chain/);
  });

  it('MAX_HIERARCHY_DEPTH still throws for a chain deeper than the guard, even when the whole chain is collapsed', () => {
    const deep: Task[] = [];
    for (let i = 0; i <= MAX_HIERARCHY_DEPTH + 1; i++) {
      deep.push(
        task(`t${i}`, '2026-01-05T09:00', '2026-01-05T17:00', i === 0 ? {} : { parent: toTaskId(`t${i - 1}`) }),
      );
    }
    expect(() => layoutRows(deep, 'default', new Set([toTaskId('t0')]))).toThrow(/exceeds max depth/);
  });

  it('a dangling-parent "root" with real children collapses identically to any other root', () => {
    const tasks = [
      task('ghost-root', '2026-01-05T09:00', '2026-01-05T17:00', { type: 'summary', parent: toTaskId('missing') }),
      task('child', '2026-01-05T09:00', '2026-01-05T17:00', { parent: toTaskId('ghost-root') }),
    ];
    const rows = layoutRows(tasks, 'default', new Set([toTaskId('ghost-root')]));
    expect(rows.map((r) => r.task.id)).toEqual(['ghost-root']);
    expect(rows[0]!.depth).toBe(0);
    expect(rows[0]!.hasChildren).toBe(true);
    expect(rows[0]!.isCollapsed).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// layoutRows — collapse invariants (property-based, spec §5.1/§9.2)
// ---------------------------------------------------------------------------------------
describe('layoutRows — collapse invariants (property-based)', () => {
  // Generates a bounded-depth/fan-out forest of tasks, each keyed by its index in the array, with
  // `parent` (if any) always referencing an EARLIER index — guarantees acyclicity by construction.
  function forestArbitrary(): fc.Arbitrary<{ tasks: Task[]; collapsedIds: Set<ReturnType<typeof toTaskId>> }> {
    return fc
      .array(fc.integer({ min: -1, max: 40 }), { minLength: 1, maxLength: 40 })
      .map((parentOffsets) => {
        const tasks: Task[] = parentOffsets.map((offset, i) => {
          // offset < 0, or offset with no valid earlier index → root (parent undefined).
          const parentIndex = offset >= 0 && offset < i ? offset : undefined;
          return task(
            `n${i}`,
            '2026-01-05T09:00',
            '2026-01-05T17:00',
            parentIndex === undefined ? {} : { parent: toTaskId(`n${parentIndex}`) },
          );
        });
        return { tasks };
      })
      .chain(({ tasks }) =>
        fc
          .subarray(tasks.map((t) => t.id))
          .map((collapsed) => ({ tasks, collapsedIds: new Set(collapsed) })),
      );
  }

  function trueDepthOf(tasks: readonly Task[], id: Task['id']): number {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    let depth = 0;
    let current = byId.get(id);
    while (current?.parent !== undefined && byId.has(current.parent)) {
      depth++;
      current = byId.get(current.parent);
    }
    return depth;
  }

  /** Sum of `subtreeSize(t) - 1` over every MAXIMAL collapsed ancestor (a collapsed task that
   *  doesn't itself have a collapsed ancestor) — the expected number of rows hidden. */
  function expectedVisibleCount(tasks: readonly Task[], collapsedIds: ReadonlySet<Task['id']>): number {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const childrenOf = new Map<Task['id'], Task[]>();
    for (const t of tasks) {
      if (t.parent !== undefined && byId.has(t.parent)) {
        const arr = childrenOf.get(t.parent) ?? [];
        arr.push(t);
        childrenOf.set(t.parent, arr);
      }
    }
    function isHidden(t: Task): boolean {
      let current = t.parent !== undefined ? byId.get(t.parent) : undefined;
      while (current) {
        if (collapsedIds.has(current.id)) return true;
        current = current.parent !== undefined ? byId.get(current.parent) : undefined;
      }
      return false;
    }
    return tasks.filter((t) => !isHidden(t)).length;
  }

  it('never throws, preserves depth, correct visible count, contiguous rowIndex', () => {
    fc.assert(
      fc.property(forestArbitrary(), ({ tasks, collapsedIds }) => {
        let rows: ReturnType<typeof layoutRows>;
        expect(() => {
          rows = layoutRows(tasks, 'default', collapsedIds);
        }).not.toThrow();
        rows = layoutRows(tasks, 'default', collapsedIds);

        // (b) depth preserved for every emitted row.
        for (const r of rows) {
          expect(r.depth).toBe(trueDepthOf(tasks, r.task.id));
        }

        // (c) visible row count matches the maximal-collapsed-ancestor formula.
        expect(rows.length).toBe(expectedVisibleCount(tasks, collapsedIds));

        // (d) rowIndex is contiguous 0..n-1.
        expect(rows.map((r) => r.rowIndex)).toEqual(rows.map((_, i) => i));
      }),
      { numRuns: 200 },
    );
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
// ROW_HEIGHT — the 'touch' level (spec-responsive-mobile.md)
// ---------------------------------------------------------------------------------------
describe("ROW_HEIGHT.touch — the coarse-pointer level", () => {
  const range = {
    start: normalizeDate('2026-01-01T00:00', cal.timezone),
    end: normalizeDate('2026-02-01T00:00', cal.timezone),
  };
  const scale: TimeScale = createTimeScale(range, 'day', cal);
  const aRow = { task: task('_', '2026-01-01', '2026-01-01'), depth: 0, rowIndex: 0, y: 0, hasChildren: false, isCollapsed: false };

  it('is the tallest level, and every level is strictly ordered', () => {
    expect(ROW_HEIGHT.compact).toBeLessThan(ROW_HEIGHT.default);
    expect(ROW_HEIGHT.default).toBeLessThan(ROW_HEIGHT.comfortable);
    expect(ROW_HEIGHT.comfortable).toBeLessThan(ROW_HEIGHT.touch);
    expect(ROW_HEIGHT.touch).toBe(48);
  });

  it('yields a leaf BAR that clears WCAG 2.2 SC 2.5.8 (24x24), where comfortable only ties it', () => {
    // This inequality is the entire reason the level is 48 and not 44 — the drag target is the
    // BAR, a `heightRatio` fraction of the row, not the row itself. If someone lowers this
    // constant, THIS is the assertion that must stop them.
    const leaf = task('leaf', '2026-01-05T00:00', '2026-01-10T00:00');
    const touchBar = layoutTaskBar(leaf, scale, aRow, ROW_HEIGHT.touch);
    const comfortableBar = layoutTaskBar(leaf, scale, aRow, ROW_HEIGHT.comfortable);

    expect(touchBar.height).toBeGreaterThan(24);
    expect(comfortableBar.height).toBe(24); // exactly on the line, i.e. not conformant with margin
  });

  it('scales every derived vertical dimension coherently from the one constant', () => {
    // Milestones derive from rowHeight too (diamond = rowHeight * 0.6), so a taller row must
    // produce a proportionally larger diamond rather than a bar that outgrows its own marker.
    const milestone = task('m', '2026-01-10T00:00', '2026-01-10T00:00', { type: 'milestone' });
    const atDefault = layoutTaskBar(milestone, scale, aRow, ROW_HEIGHT.default);
    const atTouch = layoutTaskBar(milestone, scale, aRow, ROW_HEIGHT.touch);
    expect(atTouch.height / atDefault.height).toBeCloseTo(ROW_HEIGHT.touch / ROW_HEIGHT.default, 6);
    expect(atTouch.width).toBe(atTouch.height); // still square
  });

  it('layoutRows stacks rows by it, so the level is reachable through the normal layout path', () => {
    const tasks = [
      task('a', '2026-01-05T09:00', '2026-01-06T09:00'),
      task('b', '2026-01-07T09:00', '2026-01-08T09:00'),
    ];
    expect(layoutRows(tasks, 'touch').map((r) => r.y)).toEqual([0, ROW_HEIGHT.touch]);
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
  const row = { task: task('_', '2026-01-01', '2026-01-01'), depth: 0, rowIndex: 0, y: 0, hasChildren: false, isCollapsed: false };

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

  // --- rollup override (spec-summary-rollup.md Ticket B2) ---------------------------------

  const rollupOf = (start: string, end: string): ReadonlyMap<TaskId, RolledUpRow> =>
    new Map([
      [
        toTaskId('s'),
        {
          start: normalizeDate(start, cal.timezone),
          end: normalizeDate(end, cal.timezone),
          progress: 0.25,
        },
      ],
    ]);

  it('a rollup entry overrides the authored span the bar is drawn at', () => {
    const t = task('s', '2026-01-05T00:00', '2026-01-06T00:00');
    const authored = layoutTaskBar(t, ts, row, rowHeight);
    const rolled = layoutTaskBar(t, ts, row, rowHeight, rollupOf('2026-01-05T00:00', '2026-01-15T00:00'));
    expect(rolled.x).toBeCloseTo(authored.x, 4);
    // 10 days vs the authored 1 — geometry comes from the map, not from `task.end`.
    expect(rolled.width).toBeCloseTo(authored.width * 10, 4);
  });

  it('`task` on the returned layout stays the ORIGINAL task (rollup is geometry, never identity)', () => {
    const t = task('s', '2026-01-05T00:00', '2026-01-06T00:00');
    const rolled = layoutTaskBar(t, ts, row, rowHeight, rollupOf('2026-01-01T00:00', '2026-01-20T00:00'));
    expect(rolled.task).toBe(t);
    expect(rolled.task.start).toBe('2026-01-05T00:00');
  });

  it('a task with no entry in the map falls back to its authored dates', () => {
    const t = task('other', '2026-01-05T00:00', '2026-01-10T00:00');
    const withMap = layoutTaskBar(t, ts, row, rowHeight, rollupOf('2026-01-01T00:00', '2026-01-20T00:00'));
    const without = layoutTaskBar(t, ts, row, rowHeight);
    expect(withMap).toEqual(without);
  });

  it('a milestone ignores its rollup entry (drawn at its authored instant, still square)', () => {
    // `computeRollup` is structural — it emits an entry for ANY task with children, including
    // one typed `milestone`. A diamond has no span to stretch, so the override must not apply.
    const m = task('s', '2026-01-10T00:00', '2026-01-10T00:00', { type: 'milestone' });
    const rolled = layoutTaskBar(m, ts, row, rowHeight, rollupOf('2026-01-01T00:00', '2026-01-20T00:00'));
    const plain = layoutTaskBar(m, ts, row, rowHeight);
    expect(rolled).toEqual(plain);
    expect(rolled.width).toBe(rolled.height);
  });
});

describe('buildTaskAriaLabel — rollup (spec-summary-rollup.md Ticket B2)', () => {
  const summary = task('s', '2026-01-05T09:00', '2026-01-06T17:00', { type: 'summary', progress: 0.9 });

  it('announces the rolled-up dates and aggregate progress, not the authored ones', () => {
    const label = buildTaskAriaLabel(summary, false, false, cal, 'en', {
      start: normalizeDate('2026-01-05T09:00', cal.timezone),
      end: normalizeDate('2026-01-20T17:00', cal.timezone),
      progress: 0.25,
    });
    // A bar painted across its children's span while its label read the authored dates would be
    // exactly the name/role/value mismatch WCAG exists to prevent.
    expect(label).toContain('25% complete');
    expect(label).not.toContain('90% complete');
    expect(label).toContain('Jan 20');
  });

  it('without a rollup argument the label is unchanged (authored dates + authored progress)', () => {
    expect(buildTaskAriaLabel(summary, false, false, cal, 'en')).toContain('90% complete');
  });

  it('a milestone ignores the rollup argument, matching `layoutTaskBar`', () => {
    const m = task('s', '2026-01-10T09:00', '2026-01-10T09:00', { type: 'milestone', progress: 0.5 });
    const rolled = buildTaskAriaLabel(m, false, false, cal, 'en', {
      start: normalizeDate('2026-01-01T09:00', cal.timezone),
      end: normalizeDate('2026-01-20T17:00', cal.timezone),
      progress: 0.25,
    });
    expect(rolled).toBe(buildTaskAriaLabel(m, false, false, cal, 'en'));
  });
});

describe('buildTaskAriaLabel — i18n scaffold (spec §6.3)', () => {
  const t = task('a', '2026-01-05T09:00', '2026-01-08T17:00', { progress: 0.5 });

  it('with no `messages` the English label is byte-identical, in all 4 critical×selected combos', () => {
    // The whole point of the scaffold is that it changes the SHAPE without changing the OUTPUT.
    expect(buildTaskAriaLabel(t, false, false, cal, 'en')).toBe('a, Jan 5, 2026–Jan 8, 2026 (50% complete)');
    expect(buildTaskAriaLabel(t, true, false, cal, 'en')).toBe('a, Jan 5, 2026–Jan 8, 2026 (50% complete), critical path');
    expect(buildTaskAriaLabel(t, false, true, cal, 'en')).toBe('a, Jan 5, 2026–Jan 8, 2026 (50% complete), selected');
    expect(buildTaskAriaLabel(t, true, true, cal, 'en')).toBe('a, Jan 5, 2026–Jan 8, 2026 (50% complete), critical path, selected');
  });

  it('`messages.taskLabel` replaces the whole sentence', () => {
    const label = buildTaskAriaLabel(t, false, false, cal, 'en', undefined, {
      taskLabel: (p) => `${p.name}: ${p.progressPct}%`,
    });
    expect(label).toBe('a: 50%');
  });

  it('the host can REORDER clauses — the suffix shape is genuinely gone', () => {
    // This is the test that proves the ticket did its job: `, critical path` / `, selected`
    // used to be appended after the fact, so no caller could ever put them first. A
    // verb-final or inflecting language needs exactly this freedom.
    const label = buildTaskAriaLabel(t, true, true, cal, 'en', undefined, {
      taskLabel: (p) =>
        `[${p.isSelected ? 'selected' : ''}] 名前 ${p.name} — ${p.progressPct}%` +
        (p.isCritical ? ' (critical)' : ''),
    });
    expect(label).toBe('[selected] 名前 a — 50% (critical)');
  });

  it('hands the host locale-formatted dates and percent, plus the raw flags and locale', () => {
    let seen: Record<string, unknown> | undefined;
    buildTaskAriaLabel(t, true, false, cal, 'de-DE', undefined, {
      taskLabel: (p) => {
        seen = { ...p };
        return 'x';
      },
    });
    expect(seen).toMatchObject({ name: 'a', isCritical: true, isSelected: false, locale: 'de-DE' });
    // Formatted for the CONFIGURED locale, not hardcoded 'en' — a German host must not get
    // "Jan 5, 2026".
    expect(seen!.startLabel).not.toBe('Jan 5, 2026');
    expect(String(seen!.startLabel)).toContain('2026');
  });

  it('hands the host the ROLLED-UP span and progress when the row is a summary', () => {
    const summary = task('s', '2026-01-05T09:00', '2026-01-06T17:00', { type: 'summary', progress: 0.9 });
    const label = buildTaskAriaLabel(
      summary,
      false,
      false,
      cal,
      'en',
      {
        start: normalizeDate('2026-01-05T09:00', cal.timezone),
        end: normalizeDate('2026-01-20T17:00', cal.timezone),
        progress: 0.25,
      },
      { taskLabel: (p) => `${p.startLabel}|${p.endLabel}|${p.progressPct}` },
    );
    expect(label).toBe('Jan 5, 2026|Jan 20, 2026|25');
  });

  it('caps the task name at MAX_ARIA_TASK_NAME_LENGTH before the host ever sees it', () => {
    const long = task('a', '2026-01-05T09:00', '2026-01-08T17:00');
    const wide = { ...long, name: 'x'.repeat(5_000) } as Task;
    let seenName = '';
    buildTaskAriaLabel(wide, false, false, cal, 'en', undefined, {
      taskLabel: (p) => ((seenName = p.name), 'x'),
    });
    expect(seenName).toHaveLength(200);
  });

  it('`messages: {}` and an absent `taskLabel` both take the English default branch', () => {
    const expected = buildTaskAriaLabel(t, false, false, cal, 'en');
    expect(buildTaskAriaLabel(t, false, false, cal, 'en', undefined, {})).toBe(expected);
    expect(buildTaskAriaLabel(t, false, false, cal, 'en', undefined, undefined)).toBe(expected);
  });

  it('localizes the percent digits — an ar-EG host no longer gets mixed numeral systems', () => {
    // Regression guard: the dates went through Intl but `Math.round()` did not, so an Arabic
    // locale used to render Western Arabic digits beside Arabic-Indic ones in one sentence.
    const arabic = buildTaskAriaLabel(t, false, false, cal, 'ar-EG', undefined, {
      taskLabel: (p) => p.progressPct,
    });
    expect(arabic).not.toBe('50');
    expect(buildTaskAriaLabel(t, false, false, cal, 'en', undefined, { taskLabel: (p) => p.progressPct })).toBe('50');
  });

  it('caps a host-returned string (security.md — unbounded attribute value is a DoS surface)', () => {
    const label = buildTaskAriaLabel(t, false, false, cal, 'en', undefined, {
      taskLabel: () => 'y'.repeat(10_000),
    });
    expect(label).toHaveLength(400);
  });

  it('coerces a non-string return rather than writing a non-string into an attribute', () => {
    const label = buildTaskAriaLabel(t, false, false, cal, 'en', undefined, {
      taskLabel: () => 42 as unknown as string,
    });
    expect(label).toBe('42');
  });

  it('property: ANY host return value yields a string of at most 400 chars', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const label = buildTaskAriaLabel(t, false, false, cal, 'en', undefined, {
          taskLabel: () => value as string,
        });
        expect(typeof label).toBe('string');
        expect(label.length).toBeLessThanOrEqual(400);
      }),
    );
  });

  it('a throwing host function falls back to English — silently, with no console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const label = buildTaskAriaLabel(t, true, false, cal, 'en', undefined, {
        taskLabel: () => {
          throw new Error('boom');
        },
      });
      // A broken formatter must degrade to correct English, not wedge the render effect.
      expect(label).toBe(buildTaskAriaLabel(t, true, false, cal, 'en'));
      // Deliberately silent: this runs once per task per paint, so a warn would emit thousands
      // of identical lines in a single paint of a large chart.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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
// todayLineX — the today marker (spec §9.1)
// ---------------------------------------------------------------------------------------
describe('todayLineX', () => {
  const cal = DEFAULT_CALENDAR;
  const range = {
    start: normalizeDate('2026-01-05T00:00', cal.timezone),
    end: normalizeDate('2026-01-12T00:00', cal.timezone),
  };
  const ts = createTimeScale(range, 'week', cal);

  it('returns the same x `dateToX` would, in content space', () => {
    const now = normalizeDate('2026-01-08T09:30', cal.timezone);
    expect(todayLineX(ts, now)).toBe(ts.dateToX(now));
  });

  it('returns null when `now` is before the range start', () => {
    expect(todayLineX(ts, normalizeDate('2026-01-04T23:59', cal.timezone))).toBeNull();
  });

  it('returns null when `now` is after the range end', () => {
    expect(todayLineX(ts, normalizeDate('2026-01-12T00:01', cal.timezone))).toBeNull();
  });

  it('includes both exact boundaries (inclusive range)', () => {
    expect(todayLineX(ts, range.start)).toBe(0);
    expect(todayLineX(ts, range.end)).not.toBeNull();
  });

  // The property that makes this a LINE and not the `isToday` column wash: a mid-day `now`
  // lands strictly INSIDE its day column, not on either edge of it.
  it('a mid-day `now` lands strictly between its column edges', () => {
    const now = normalizeDate('2026-01-08T12:00', cal.timezone);
    const cols = computeGridColumns(ts, 'week', cal, 'en', now);
    const todayCol = cols.find((col) => col.isToday)!;
    const x = todayLineX(ts, now)!;
    expect(x).toBeGreaterThan(todayCol.x);
    expect(x).toBeLessThan(todayCol.x + todayCol.width);
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
