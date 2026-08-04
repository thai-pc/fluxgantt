// Pure layout math for the render layer (spec-svg-renderer.md §1.2, §3).
//
// NO DOM API anywhere in this file (`document`, `SVGElement`, `HTMLElement`, ...) — it
// must run under vitest's default `environment: 'node'` with zero jsdom dependency.
// This is the shared seam a future `canvas-renderer.ts` reuses: every exported function
// returns a plain number/string/boolean/readonly-array value object, never a DOM node
// (spec §3 "Seam cho Canvas").
//
// Every date computation calls back into `compute/working-calendar.ts`
// (`normalizeDate`, `isWorkingDay`, `isHoliday`) — this file never reimplements
// calendar/timezone/DST arithmetic with native `Date` (architecture.md "Temporal API
// for all date/time computation").
import type { Temporal } from '@js-temporal/polyfill';
import { getTemporal } from '../internal/temporal.js';
import { normalizeDate, isWorkingDay, isHoliday } from '../compute/working-calendar.js';
import type {
  DateInput,
  Density,
  Dependency,
  DependencyType,
  Task,
  TaskId,
  TaskKind,
  ViewMode,
  WorkingCalendar,
} from '../types.js';

type ZDT = Temporal.ZonedDateTime;

// --- Time-scale --------------------------------------------------------------------

export interface TimeRange {
  readonly start: Temporal.ZonedDateTime;
  readonly end: Temporal.ZonedDateTime;
}

export interface TimeScale {
  readonly range: TimeRange;
  readonly pixelsPerDay: number;
  readonly totalWidth: number;
  dateToX(date: DateInput): number;
  xToDate(x: number): Temporal.ZonedDateTime;
}

/**
 * Horizontal pixel density per calendar day, keyed by `ViewMode`. Header columns
 * (`computeGridColumns`, spec §5.6) always step by ONE calendar day for every
 * `ViewMode` in v1 — only this value and the label format change with zoom level. Tuned
 * for readability: wide at `'day'`, hairline at `'year'` (where a one-year range renders
 * ~365 columns — accepted v1 simplification, see spec §5.6 note).
 */
export const PIXELS_PER_DAY: Readonly<Record<ViewMode, number>> = {
  day: 60,
  week: 24,
  month: 8,
  quarter: 3,
  year: 1,
};

/**
 * Viewport padding (calendar days), added on both sides when `deriveTimeRange` infers
 * the visible range from task dates and no explicit `timeRange` was supplied (spec
 * §5.1).
 */
const TIME_RANGE_PADDING_DAYS: Readonly<Record<ViewMode, number>> = {
  day: 3,
  week: 7,
  month: 30,
  quarter: 90,
  year: 180,
};

/**
 * Infers the visible `TimeRange` from `tasks`: `min(start)..max(end)` + viewMode-scaled
 * padding (spec §5.1). Throws on an empty `tasks` array — symmetric with
 * `computeCriticalPath` throwing on `tasks.length === 0` (there is nothing to derive a
 * viewport from). Callers that already have an explicit `options.timeRange` should skip
 * this function entirely, not call it and discard the result.
 */
export function deriveTimeRange(
  tasks: readonly Task[],
  viewMode: ViewMode,
  calendar: WorkingCalendar,
): TimeRange {
  if (tasks.length === 0) {
    throw new Error('deriveTimeRange: tasks must not be empty');
  }
  const api = getTemporal();
  let minStart: ZDT | undefined;
  let maxEnd: ZDT | undefined;
  for (const task of tasks) {
    const start = normalizeDate(task.start, calendar.timezone);
    const end = normalizeDate(task.end, calendar.timezone);
    if (minStart === undefined || api.ZonedDateTime.compare(start, minStart) < 0) minStart = start;
    if (maxEnd === undefined || api.ZonedDateTime.compare(end, maxEnd) > 0) maxEnd = end;
  }
  const padding = TIME_RANGE_PADDING_DAYS[viewMode];
  return {
    start: minStart!.subtract({ days: padding }),
    end: maxEnd!.add({ days: padding }),
  };
}

/** Real elapsed hours between two instants (epoch-nanosecond based — exact, correctly
 *  reflects 23h/25h DST-transition days; never uses fractional `Duration` fields, which
 *  Temporal requires to be integers). */
function hoursBetween(a: ZDT, b: ZDT): number {
  return Number(b.epochNanoseconds - a.epochNanoseconds) / 3_600_000_000_000;
}

/**
 * Builds a pure date↔pixel mapping over `range` (spec §5.2). `dateToX`/`xToDate` are
 * exact inverses within a small rounding error (nanosecond rounding when converting
 * pixels back to an instant) — see round-trip property test.
 */
export function createTimeScale(
  range: TimeRange,
  viewMode: ViewMode,
  calendar: WorkingCalendar,
): TimeScale {
  const api = getTemporal();
  const pixelsPerDay = PIXELS_PER_DAY[viewMode];
  const totalWidth = Math.max(0, (hoursBetween(range.start, range.end) / 24) * pixelsPerDay);

  function dateToX(date: DateInput): number {
    const zdt = normalizeDate(date, calendar.timezone);
    return (hoursBetween(range.start, zdt) / 24) * pixelsPerDay;
  }

  function xToDate(x: number): Temporal.ZonedDateTime {
    const hours = (x / pixelsPerDay) * 24;
    const ns = BigInt(Math.round(hours * 3_600_000_000_000));
    return api.Instant.fromEpochNanoseconds(range.start.epochNanoseconds + ns).toZonedDateTimeISO(
      calendar.timezone,
    );
  }

  return { range, pixelsPerDay, totalWidth, dateToX, xToDate };
}

// --- Hierarchy / rows ----------------------------------------------------------------

export interface RowLayout {
  readonly task: Task;
  readonly depth: number;
  readonly rowIndex: number;
  readonly y: number;
}

/** Row height (px) per `Density` — MUST match `--fg-row-height-*` (spec §8.2). */
export const ROW_HEIGHT: Readonly<Record<Density, number>> = {
  compact: 24,
  default: 32,
  comfortable: 40,
};

/**
 * Max hierarchy nesting depth (review N1). The `visiting` set already rejects genuine
 * cycles, but a very deep *acyclic* parent chain (e.g. 50k tasks each parenting the next,
 * from untrusted host data) would recurse deep enough to blow the call stack with an
 * opaque `RangeError` instead of a controlled, explainable throw. 1,000 levels is far
 * beyond any real project WBS.
 */
export const MAX_HIERARCHY_DEPTH = 1_000;

/**
 * Pre-order hierarchy layout with cycle guard (spec §5.3). A task whose `parent` does
 * not resolve to any task in `tasks` (dangling reference) is treated as a root at
 * depth 0 — resilient, not thrown (spec §4). A genuine cycle in the parent chain
 * (`A → B → A`, arbitrarily long) throws, mirroring `CyclicDependencyError`'s
 * "detect, don't infinite-loop" contract in the compute layer.
 */
export function layoutRows(tasks: readonly Task[], density: Density): RowLayout[] {
  const rowHeight = ROW_HEIGHT[density];
  const byId = new Set<TaskId>(tasks.map((t) => t.id));
  const childrenOf = new Map<TaskId, Task[]>();
  for (const t of tasks) {
    if (t.parent !== undefined && byId.has(t.parent)) {
      const arr = childrenOf.get(t.parent);
      if (arr) arr.push(t);
      else childrenOf.set(t.parent, [t]);
    }
  }
  // Root = no parent, or parent id doesn't resolve within `tasks` (dangling — spec §5.3).
  const roots = tasks.filter((t) => t.parent === undefined || !byId.has(t.parent));

  const rows: RowLayout[] = [];
  const visiting = new Set<TaskId>();
  let y = 0;

  function visit(task: Task, depth: number): void {
    if (depth > MAX_HIERARCHY_DEPTH) {
      throw new Error(
        `layoutRows: hierarchy nesting exceeds max depth (${MAX_HIERARCHY_DEPTH}) at task "${task.id}" — ` +
          'the parent chain is unreasonably deep.',
      );
    }
    if (visiting.has(task.id)) {
      throw new Error(`layoutRows: cyclic parent chain involving task "${task.id}"`);
    }
    visiting.add(task.id);
    rows.push({ task, depth, rowIndex: rows.length, y });
    y += rowHeight;
    for (const child of childrenOf.get(task.id) ?? []) visit(child, depth + 1);
    visiting.delete(task.id);
  }

  for (const root of roots) visit(root, 0);

  // A task not reached from any root, by construction, sits entirely inside a cycle of
  // tasks whose `parent` ids all resolve to one another (a dangling/undefined parent
  // would already have made it a root above). Throw instead of silently dropping it.
  if (rows.length !== tasks.length) {
    const visited = new Set(rows.map((r) => r.task.id));
    const remaining = tasks.filter((t) => !visited.has(t.id)).map((t) => t.id);
    throw new Error(`layoutRows: cyclic parent chain involving task(s) ${remaining.join(', ')}`);
  }

  return rows;
}

// --- Task bar geometry -----------------------------------------------------------------

export interface TaskBarLayout {
  readonly task: Task;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Computes one task bar's geometry (spec §5.4). Milestones render as a square (the
 * caller rotates it 45° for the diamond shape — geometry stays a plain rect here, no
 * DOM). Non-milestones clamp `end < start` to width 0 instead of throwing — resilient
 * rendering, deliberately diverging from CPM's `resolveDuration`, which throws on the
 * same condition (spec §4, §11 Q5): a single malformed record must not crash the whole
 * chart. Callers that want to warn about clamped tasks compare
 * `timeScale.dateToX(task.end) < timeScale.dateToX(task.start)` themselves (pure
 * arithmetic on values already produced by `TimeScale`, not a re-implementation of date
 * math).
 */
export function layoutTaskBar(
  task: Task,
  timeScale: TimeScale,
  row: RowLayout,
  rowHeight: number,
): TaskBarLayout {
  if (task.type === 'milestone') {
    const cx = timeScale.dateToX(task.start);
    const size = rowHeight * 0.6;
    return {
      task,
      x: cx - size / 2,
      y: row.y + (rowHeight - size) / 2,
      width: size,
      height: size,
    };
  }
  const x0 = timeScale.dateToX(task.start);
  const x1 = timeScale.dateToX(task.end);
  const width = Math.max(0, x1 - x0);
  const heightRatio = task.type === 'task' ? 0.6 : 0.4; // summary/project drawn thinner
  const height = rowHeight * heightRatio;
  return { task, x: x0, y: row.y + (rowHeight - height) / 2, width, height };
}

// --- Dependency routing ----------------------------------------------------------------

export interface DependencyPathLayout {
  readonly dependency: Dependency;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

type BarEdge = 'start' | 'end';

const DEPENDENCY_EDGES: Readonly<Record<DependencyType, readonly [BarEdge, BarEdge]>> = {
  FS: ['end', 'start'],
  SS: ['start', 'start'],
  FF: ['end', 'end'],
  SF: ['start', 'end'],
};

const TASK_KINDS: ReadonlySet<string> = new Set<TaskKind>(['task', 'summary', 'milestone', 'project']);

/**
 * Runtime whitelist guards for the two enums that get folded into CSS class names
 * (review N3/N5). `task.type`/`dependency.type` are compile-time-narrowed unions, but a
 * host app that skips TypeScript (plain JS, `any`, untrusted JSON import) could pass an
 * arbitrary string. Callers use these to fall back to a safe class / skip the record
 * instead of interpolating raw untrusted text into a `class` attribute (CSS-token
 * spoofing — not XSS, `setAttribute` still can't break out — but defense-in-depth).
 */
export function isKnownTaskKind(kind: string): kind is TaskKind {
  return TASK_KINDS.has(kind);
}
export function isKnownDependencyType(type: string): type is DependencyType {
  return Object.prototype.hasOwnProperty.call(DEPENDENCY_EDGES, type);
}

/** Exported for `interaction/drag-create-dep.ts` (via `render/svg-renderer.ts`'s
 *  `renderLinkHandle`) — the connector handle's position must sit exactly where a resulting
 *  FS/SS/FF/SF arrow would attach, with zero duplicated geometry math. */
export function anchorOf(bar: TaskBarLayout, edge: BarEdge): { x: number; y: number } {
  return edge === 'start'
    ? { x: bar.x, y: bar.y + bar.height / 2 }
    : { x: bar.x + bar.width, y: bar.y + bar.height / 2 };
}

/**
 * Elbow-routes a dependency line between two task bars, anchored per `DependencyType`
 * (spec §5.5). Same-row bars connect with a straight line; different rows get a
 * 3-segment elbow through a `rowHeight * 0.4` gutter. Does NOT reflect critical-path
 * status on the edge (spec §4: `CriticalPathResult` only marks tasks, not edges —
 * inferring "both ends critical ⇒ edge critical" is an unverified heuristic, not drawn).
 */
export function layoutDependencyPath(
  dependency: Dependency,
  fromBar: TaskBarLayout,
  toBar: TaskBarLayout,
  rowHeight: number,
): DependencyPathLayout {
  const edges = DEPENDENCY_EDGES[dependency.type];
  if (edges === undefined) {
    // Fail-fast on an unknown type (review N5) rather than destructuring `undefined` into
    // an opaque TypeError. Resilient callers (`svg-renderer.renderDependencies`) skip such
    // a dependency via `isKnownDependencyType` before ever reaching here.
    throw new Error(`layoutDependencyPath: unknown dependency type "${dependency.type}"`);
  }
  const [fromEdge, toEdge] = edges;
  const p0 = anchorOf(fromBar, fromEdge);
  const p3 = anchorOf(toBar, toEdge);

  if (fromBar.y === toBar.y) {
    return { dependency, points: [p0, p3] };
  }
  const gutter = rowHeight * 0.4;
  const midX = fromEdge === 'end' ? p0.x + gutter : p0.x - gutter;
  return {
    dependency,
    points: [p0, { x: midX, y: p0.y }, { x: midX, y: p3.y }, p3],
  };
}

// --- Grid / header -----------------------------------------------------------------------

export interface GridColumn {
  readonly x: number;
  readonly width: number;
  readonly label: string;
  readonly isWeekend: boolean;
  readonly isHoliday: boolean;
  readonly isToday: boolean;
}

/**
 * Safety guard against a pathologically large `TimeRange` (security.md — "limit
 * size ... avoid DoS"). 20,000 days ≈ 54 years, comfortably beyond any real
 * project timeline; a caller-supplied `options.timeRange` spanning centuries would
 * otherwise allocate an unbounded number of `<rect>`/`<text>` nodes.
 */
export const MAX_GRID_COLUMNS = 20_000;

const GRID_LABEL_OPTIONS: Readonly<Record<ViewMode, Intl.DateTimeFormatOptions>> = {
  day: { weekday: 'short', day: 'numeric' },
  week: { weekday: 'short', day: 'numeric' },
  month: { day: 'numeric' },
  quarter: { day: 'numeric' },
  year: { day: 'numeric' },
};

/**
 * Header/grid columns, one per calendar day across `timeScale.range` (spec §5.6 —
 * v1 deliberately steps by day for every `viewMode`, only `pixelsPerDay`/label format
 * change; see spec note re: not merging real week/month columns in v1).
 * `isWeekend`/`isHoliday` are computed by calling back into
 * `compute/working-calendar.ts` (`isWorkingDay`/`isHoliday`) — never re-derived here.
 * `now` is an injected parameter (not `Temporal.Now` read internally) so this function
 * stays deterministic/testable (spec §6).
 */
export function computeGridColumns(
  timeScale: TimeScale,
  viewMode: ViewMode,
  calendar: WorkingCalendar,
  locale: string,
  now: Temporal.ZonedDateTime,
): GridColumn[] {
  const api = getTemporal();
  const cols: GridColumn[] = [];
  const endDate = timeScale.range.end.toPlainDate();
  const nowDate = now.toPlainDate();
  let cursor = timeScale.range.start.toPlainDate();
  let guard = 0;

  while (api.PlainDate.compare(cursor, endDate) <= 0) {
    guard++;
    if (guard > MAX_GRID_COLUMNS) {
      throw new Error(
        `computeGridColumns: exceeded max column guard (${MAX_GRID_COLUMNS}) — the time range is ` +
          'unreasonably large; narrow `options.timeRange` or the task date spread.',
      );
    }
    cols.push({
      x: timeScale.dateToX(cursor),
      width: timeScale.pixelsPerDay,
      label: cursor.toLocaleString(locale, GRID_LABEL_OPTIONS[viewMode]),
      isWeekend: !isWorkingDay(cursor, calendar),
      isHoliday: isHoliday(cursor, calendar),
      isToday: cursor.equals(nowDate),
    });
    cursor = cursor.add({ days: 1 });
  }
  return cols;
}

// --- Security: color whitelist ------------------------------------------------------------

// Full-match (`^...$`) whitelist only — no `.includes()`/partial match, which would let
// something like `"red; background:url(javascript:alert(1))"` slip through by merely
// starting with a valid prefix (spec §8).
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/;
const HSL_COLOR = /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/;

/**
 * Validates `task.color` against a strict whitelist (hex 3/4/6/8, `rgb()`/`rgba()`,
 * `hsl()`/`hsla()`) before it is allowed anywhere near `el.style` (spec §8 — security
 * critical). Returns `undefined` for anything invalid or absent — the caller
 * (`svg-renderer.ts`) is responsible for falling back to a default token, and must
 * never pass an unvalidated value into `style.setProperty`. No CSS named colors
 * (`"red"`, ...) in v1 — deliberately minimal, easy-to-audit whitelist (spec §8).
 */
export function validateTaskColor(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  if (HEX_COLOR.test(color) || RGB_COLOR.test(color) || HSL_COLOR.test(color)) return color;
  return undefined;
}
