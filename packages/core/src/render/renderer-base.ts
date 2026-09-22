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
import { MAX_HIERARCHY_DEPTH } from '../compute/hierarchy.js';
import type {
  DateInput,
  Density,
  Dependency,
  DependencyType,
  GanttMessages,
  RolledUpRow,
  RolledUpSpan,
  Task,
  TaskId,
  TaskKind,
  ViewMode,
  WorkingCalendar,
} from '../types.js';

// Re-exported (not redefined) so the render layer's own modules and tests keep importing these
// from here, while `types.ts` stays their single definition — the render layer may not import
// from `compute/`, so they cannot live next to `RollupResult`.
export type { GanttMessages, RolledUpRow, RolledUpSpan };
export type { TaskLabelParams } from '../types.js';

// --- Accessible-name string builder (spec-canvas-renderer-ticket2.md §2.1) ---------------
//
// Shared by `svg-renderer.ts` and `canvas-renderer.ts` so the per-task `aria-label` string
// is produced by exactly one implementation — drift between two hand-duplicated copies would
// be a real a11y correctness bug (a screen-reader user hearing different text depending on
// which renderer is active), not a merely cosmetic one, unlike the small numeric layout
// constants each renderer file duplicates locally by hand. Pure, DOM-free (task/calendar/
// locale in, string out) — this file's own "no DOM API" invariant is unaffected.

/** Defensive string-length cap applied to the task name folded into a per-task `aria-label`
 *  (security.md "limit string length"). Deliberately a DIFFERENT constant name than each
 *  renderer's own local `MAX_ARIA_NAME_LENGTH` (which caps the whole-chart `ariaLabel`
 *  OPTION string, a separate concern) — avoids a same-named-but-different-purpose shadow. */
export const MAX_ARIA_TASK_NAME_LENGTH = 200;

/** Companion cap applied to the FINISHED label — `MAX_ARIA_TASK_NAME_LENGTH` guards only the
 *  name going in, which is enough while core composes the sentence but not once a host-supplied
 *  `messages.taskLabel` can return a string of any length (security.md "limit string length":
 *  an unbounded value written into an attribute once per task per paint is a DoS surface). */
const MAX_ARIA_TASK_LABEL_LENGTH = 400;

/** Hoisted to module scope rather than re-allocated on every `buildTaskAriaLabel` call — this
 *  runs once per task per paint. */
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

/**
 * `rolled` — optional rollup entry for this task (Ticket B2). When present, the dates and
 * percentage announced are the AGGREGATE ones, matching what the bar is actually drawn at.
 * Keeping the two in sync matters more here than anywhere else in the renderer: a summary bar
 * painted across its children's span while its label announced its own stale authored dates
 * would make the chart say one thing visually and another to a screen reader — the exact
 * failure mode WCAG's name/role/value requirement exists to prevent. Omitted/`undefined`
 * reproduces the pre-B2 label byte for byte.
 *
 * A milestone deliberately ignores `rolled`, mirroring `layoutTaskBar`: its bar is not redrawn
 * at an aggregate span, so its label must not claim one either.
 */
export function buildTaskAriaLabel(
  task: Task,
  isCritical: boolean,
  isSelected: boolean,
  calendar: WorkingCalendar,
  locale: string,
  rolled?: RolledUpRow,
  messages?: GanttMessages,
): string {
  const effective = task.type === 'milestone' ? undefined : rolled;
  const start = normalizeDate(effective?.start ?? task.start, calendar.timezone).toPlainDate();
  const end = normalizeDate(effective?.end ?? task.end, calendar.timezone).toPlainDate();
  const name = task.name.slice(0, MAX_ARIA_TASK_NAME_LENGTH);
  const startLabel = start.toLocaleString(locale, DATE_OPTIONS);
  const endLabel = end.toLocaleString(locale, DATE_OPTIONS);
  // `Number.prototype.toLocaleString`, NOT `new Intl.NumberFormat(...)` — identical digits, but
  // no Intl constructor (the expensive half) per task per paint and no format cache to key or
  // invalidate. Localized because an `ar-EG` host was otherwise getting Western Arabic digits
  // sitting next to Intl-formatted dates in the same sentence.
  const progressPct = Math.round(
    (effective?.progress ?? task.progress ?? 0) * 100,
  ).toLocaleString(locale);

  const custom = messages?.taskLabel;
  if (custom) {
    try {
      // Coerced, then capped: a host function is untrusted input like any other (security.md
      // §1). Silent fallback on throw — see `GanttMessages.taskLabel`'s doc comment for why
      // there is deliberately no `console.warn` here. The params object is built ONLY on this
      // branch, so a host that never supplies `messages` allocates nothing extra per task.
      return String(
        custom({ name, startLabel, endLabel, progressPct, isCritical, isSelected, locale }),
      ).slice(0, MAX_ARIA_TASK_LABEL_LENGTH);
    } catch {
      // fall through to the built-in English sentence
    }
  }

  // The built-in English sentence, byte-identical to what core emitted before `messages`
  // existed. Composed with `+=` rather than the old `base`/`withCritical`/`isSelected ? …`
  // ternary chain purely for size; the SHAPE that made it untranslatable — appending fixed
  // fragments — is gone from the public contract, which is what the scaffold is about.
  let label = `${name}, ${startLabel}–${endLabel} (${progressPct}% complete)`;
  if (isCritical) label += ', critical path';
  if (isSelected) label += ', selected';
  return label;
}

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
  /** 0-based index into the VISIBLE row array (i.e. this array itself) — unchanged in meaning
   *  from before collapse/expand existed; a collapsed subtree's hidden rows are simply absent,
   *  so this stays contiguous `0..n-1` over what's actually returned. */
  readonly rowIndex: number;
  readonly y: number;
  /** True iff `task.id` has at least one child among `tasks` — independent of collapsed state.
   *  Renderers use this to decide whether to draw a toggle affordance at all. */
  readonly hasChildren: boolean;
  /** True iff `hasChildren` AND `task.id ∈ collapsedIds`. A `collapsedIds` entry for a
   *  childless task has no effect (mirrors `toggleCollapse()`'s own no-op contract on a leaf) —
   *  this field, not raw `collapsedIds` membership, is what a renderer should read for chevron
   *  orientation / `aria-expanded`. */
  readonly isCollapsed: boolean;
}

/** Row height (px) per `Density` — MUST match `--fg-row-height-*` (spec §8.2). */
export const ROW_HEIGHT: Readonly<Record<Density, number>> = {
  compact: 24,
  default: 32,
  comfortable: 40,
};

/** Re-exported from `compute/hierarchy.ts`, which is the shared home because `computeRollup`
 *  walks the same parent graph under the same bound and the compute layer may not import from
 *  `render/`. Re-exported (not moved silently) so this module's existing public import path —
 *  used by `renderer-base.test.ts` and the barrel — keeps working. */
export { MAX_HIERARCHY_DEPTH };

/**
 * Toggle-affordance geometry (spec-collapse-expand.md §6.1), shared by both renderers for
 * pixel parity — both already import `ROW_HEIGHT` from here, so this is the correct shared
 * home rather than per-renderer duplication (unlike the small layout constants each renderer
 * duplicates BY HAND per the module-isolation rule, which only applies to constants private
 * to one renderer's own internal layout).
 */
export const TOGGLE_GLYPH_SIZE_PX = 10;
/** Reserved horizontal gutter width, applied uniformly to every row's label `x` regardless of
 *  whether that row has a visible glyph — keeps label text column-aligned across sibling
 *  leaf/summary rows at the same depth. */
export const TOGGLE_GLYPH_GUTTER_PX = 14;

/**
 * Pre-order hierarchy layout with cycle guard (spec §5.3), collapse/expand-aware
 * (spec-collapse-expand.md §5). A task whose `parent` does not resolve to any task in
 * `tasks` (dangling reference) is treated as a root at depth 0 — resilient, not thrown
 * (spec §4). A genuine cycle in the parent chain (`A → B → A`, arbitrarily long) throws,
 * mirroring `CyclicDependencyError`'s "detect, don't infinite-loop" contract in the
 * compute layer.
 *
 * `collapsedIds` (optional — omitted/`undefined` means "nothing collapsed", identical to
 * pre-collapse-expand behavior) hides the descendant rows of any collapsed task from the
 * OUTPUT, but must NOT change what is traversed for cycle/depth-guard purposes: this
 * function always walks the FULL tree (every task, hidden or not) and tracks that full-tree
 * coverage via an independent `visited` set — NOT via `rows.length`, which now differs from
 * `tasks.length` for any hierarchy with at least one collapsed ancestor. Using
 * `rows.length !== tasks.length` here would make a valid, merely-collapsed hierarchy
 * spuriously throw "cyclic parent chain" (see the regression test guarding exactly this).
 * Row emission — and whether a subtree's children are walked *as visible* — is governed by
 * a separate `hiddenByAncestor` flag threaded down the recursion, independent of the
 * cycle/depth guards.
 */
export function layoutRows(
  tasks: readonly Task[],
  density: Density,
  collapsedIds?: ReadonlySet<TaskId>,
): RowLayout[] {
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
  const visiting = new Set<TaskId>(); // cycle guard — unchanged in purpose
  const visited = new Set<TaskId>(); // full-tree coverage check — independent of row emission
  let y = 0;

  function visit(task: Task, depth: number, hiddenByAncestor: boolean): void {
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
    visited.add(task.id);

    const children = childrenOf.get(task.id) ?? [];
    const hasChildren = children.length > 0;
    const isCollapsed = hasChildren && (collapsedIds?.has(task.id) ?? false);

    if (!hiddenByAncestor) {
      rows.push({ task, depth, rowIndex: rows.length, y, hasChildren, isCollapsed });
      y += rowHeight;
    }

    const childHidden = hiddenByAncestor || isCollapsed;
    for (const child of children) visit(child, depth + 1, childHidden);

    visiting.delete(task.id);
  }

  for (const root of roots) visit(root, 0, false);

  // A task not reached from any root, by construction, sits entirely inside a cycle of
  // tasks whose `parent` ids all resolve to one another (a dangling/undefined parent
  // would already have made it a root above). Throw instead of silently dropping it.
  // Uses full-tree `visited` coverage, NOT `rows.length` — see the doc comment above.
  if (visited.size !== tasks.length) {
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
 * Whether a laid-out chart is a tree (at least one expandable row) rather than a flat list.
 *
 * Shared by both renderers so the root `role` and the per-row ARIA attributes can never drift.
 * `aria-expanded` and `aria-level` both sit in axe's `invalidTableRowAttrs` list: a row may
 * carry either one only when its owner resolves to `treegrid`, never under a plain `grid`. By
 * deriving the role and both attribute gates from this single predicate, that pairing is
 * structural rather than something two call sites have to remember.
 *
 * Pass the FULL row list, not a windowed slice — otherwise a canvas viewport scrolled past
 * every summary row would silently demote itself to `grid` mid-scroll.
 */
export function isTreeLayout(rows: readonly RowLayout[]): boolean {
  return rows.some((r) => r.hasChildren);
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
 *
 * `rollup` — optional map from `computeRollup()`. When an entry exists for `task.id`, the bar is
 * drawn at the rolled-up span INSTEAD of the task's authored `start`/`end`; otherwise the
 * authored dates are used unchanged. Omitting the argument entirely reproduces the pre-B2
 * behavior exactly, which is what keeps this additive for every existing caller.
 *
 * Two deliberate restrictions:
 *
 * - A `milestone` row ignores `rollup` even when an entry exists. A milestone is a
 *   zero-duration marker drawn as a centered diamond; stretching it across an aggregate span
 *   would turn it into a different shape and contradict its own `type`. `computeRollup` does
 *   emit entries for parented-under-a-milestone cases (it is structural and does not trust
 *   `type` — spec §6.12), so this has to be handled here rather than assumed impossible.
 * - The span is used for geometry only. The task object on the returned layout is the ORIGINAL
 *   task, never a synthesized one: `TaskBarLayout.task` flows into `data-task-id`, hit-testing
 *   and `aria-label`, and substituting a fabricated task there would make the renderer disagree
 *   with the store about what a row actually is. Rollup is derived-on-read (spec §4) and must
 *   not leak into identity.
 */
export function layoutTaskBar(
  task: Task,
  timeScale: TimeScale,
  row: RowLayout,
  rowHeight: number,
  rollup?: ReadonlyMap<TaskId, RolledUpSpan>,
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
  const span = rollup?.get(task.id);
  const x0 = timeScale.dateToX(span?.start ?? task.start);
  const x1 = timeScale.dateToX(span?.end ?? task.end);
  const width = Math.max(0, x1 - x0);
  const heightRatio = task.type === 'task' ? 0.6 : 0.4; // summary/project drawn thinner
  const height = rowHeight * heightRatio;
  return { task, x: x0, y: row.y + (rowHeight - height) / 2, width, height };
}

/**
 * Width in pixels of a task bar's completed portion (spec §5.4, `.fg-task__progress`).
 *
 * Resolution mirrors `buildTaskAriaLabel` exactly — `rolled?.progress ?? task.progress` — so the
 * painted fraction can never disagree with the percentage the label already announces, which is
 * the WCAG name/role/value pairing this element exists to complete.
 *
 * - A `milestone` row returns 0: it is a rotated square, and a partial fill on a diamond reads as
 *   a different shape rather than a different value. Same gate as `layoutTaskBar`.
 * - `progress` is clamped locally. `Task.progress` is documented 0..1 and validated at the IO
 *   boundary and in `setProgress`, but NOT in `addTask` or the store — so an out-of-range or `NaN`
 *   value genuinely reaches the renderer, where unclamped it would paint past the bar's own edge.
 * - Returning 0 (rather than a zero-width geometry) lets callers skip emitting an element at all,
 *   keeping the DOM and the Canvas call log free of no-op nodes.
 */
export function progressFillWidth(task: Task, bar: TaskBarLayout, rolled?: RolledUpRow): number {
  if (task.type === 'milestone') return 0;
  const raw = rolled?.progress ?? task.progress ?? 0;
  const fraction = Number.isNaN(raw) ? 0 : raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
  return bar.width * fraction;
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

const TASK_KINDS: ReadonlySet<string> = new Set<TaskKind>([
  'task',
  'summary',
  'milestone',
  'project',
]);

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

/**
 * Horizontal position of the "today" marker, in CONTENT space (no `LABEL_COLUMN_WIDTH`
 * offset) — the same space `computeGridColumns` and `layoutTaskBar` return, so each renderer
 * adds its own `offsetX` exactly as it already does for those.
 *
 * Distinct from `GridColumn.isToday`, which shades the whole calendar DAY: this is the exact
 * instant within that day. At `viewMode: 'year'` (1 px/day) the shaded column is a hairline,
 * and the marker is the only thing still legible.
 *
 * Returns `null` when `now` is outside `timeScale.range` so the caller emits nothing at all.
 * A clamped line would sit on the chart's edge and read as "today is the first/last day of
 * this project" — a confident, wrong statement, worse than no marker. The bound is tested on
 * the DATES via `ZonedDateTime.compare`, not on the derived pixel against `totalWidth`, which
 * drifts at the boundary.
 *
 * `now` is injected (never `Temporal.Now` read here) so this module stays clock-free and
 * deterministic — the same contract `computeGridColumns` has.
 */
export function todayLineX(timeScale: TimeScale, now: Temporal.ZonedDateTime): number | null {
  const compare = getTemporal().ZonedDateTime.compare;
  if (compare(now, timeScale.range.start) < 0 || compare(now, timeScale.range.end) > 0) return null;
  return timeScale.dateToX(now);
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
