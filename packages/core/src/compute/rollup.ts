// Summary task auto-rollup — compute layer (spec-summary-rollup.md, plan-summary-rollup-collapse.md
// Ticket B). Headless, pure function: no DOM, no framework, never mutates its inputs.
//
// Given the FULL task set, derives each parent task's aggregate span (earliest descendant start →
// latest descendant end), duration-weighted progress, and span length in working hours. Results are
// DERIVED ON READ and never written back into `TaskStore` (plan §4): materializing them would make
// every leaf edit rewrite its whole ancestor chain through undo/redo's exact-value `restore()`,
// would drift on IO round-trip (export writes authored fields, a re-import would diverge from a
// re-computed rollup), and would silently feed synthetic dates into `computeCriticalPath`, which
// does not special-case summary rows today.
import type { Temporal } from '@js-temporal/polyfill';
import { DEFAULT_CALENDAR, normalizeDate, differenceInWorkingHours } from './working-calendar.js';
import { compareInstant, resolveDuration } from './dependency-math.js';
import { MAX_HIERARCHY_DEPTH } from './hierarchy.js';
import type { Task, TaskId, WorkingCalendar } from '../types.js';

type ZDT = Temporal.ZonedDateTime;

const CALLER_NAME = 'computeRollup';

export interface RollupResult {
  /** Earliest start across the whole descendant subtree. */
  readonly start: ZDT;
  /** Latest end across the whole descendant subtree. */
  readonly end: ZDT;
  /** Duration-weighted mean progress of the immediate children, always within 0..1. */
  readonly progress: number;
  /**
   * Working hours between `start` and `end`, per the supplied calendar — the SPAN, deliberately
   * NOT the sum of descendant durations (spec §5.4). A summary bar is drawn from its earliest
   * start to its latest end, so its length must include the idle gaps between children;
   * sum-of-children is a different metric (work content vs. elapsed time) and mixing the two
   * would make `durationHours` disagree with this result's own `start`/`end`.
   */
  readonly durationHours: number;
}

/** The span a task contributes to its parent: its rolled-up value when it has children,
 *  otherwise its own authored fields. */
interface Span {
  readonly start: ZDT;
  readonly end: ZDT;
  readonly progress: number;
  readonly durationHours: number;
}

/** `Task.progress` is documented as 0..1 but nothing validates it at the store boundary, so a
 *  hostile or buggy value must not poison an entire ancestor chain (spec §5.3). `NaN` → 0. */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n <= 0) return 0;
  return n >= 1 ? 1 : n;
}

/**
 * Bottom-up aggregation of every parent task's span, progress and duration
 * (spec-summary-rollup.md §4). Pure: never mutates `tasks`, never touches a store, emits no
 * event.
 *
 * The returned map has an entry for EVERY task with at least one child, regardless of
 * `task.type` — `type` is host-supplied metadata, and a host that parents rows under a
 * `type: 'task'` still wants the aggregate. Deciding which rows *draw* a summary bar is the
 * render layer's job, which already derives `hasChildren` structurally (`layoutRows`). A
 * childless task gets no entry at all, so `map.size` is a meaningful count and a caller's
 * `rollup.get(id) ?? task` fallback reads naturally.
 *
 * A task whose `parent` does not resolve to any task in `tasks` is treated as a root —
 * resilient, not thrown, mirroring `layoutRows`' dangling-parent posture. A cyclic parent
 * chain (including self-parenting) throws, matching `layoutRows`' "detect, don't
 * infinite-loop" contract. Note this is a plain `Error`, NOT `CyclicDependencyError`: that
 * error describes a cycle in the *dependency* graph (its message and `taskIds` field both come
 * from a topological sort of `Dependency` edges), which is a different failure from a cyclic
 * hierarchy.
 *
 * Throws (propagated, not swallowed — matching `computeCriticalPath`/`computeCascade`) when a
 * task has an `end` before its `start` and no explicit `duration`: a malformed record is a
 * caller bug, not something to paper over with a zero.
 */
export function computeRollup(
  tasks: readonly Task[],
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): ReadonlyMap<TaskId, RollupResult> {
  const result = new Map<TaskId, RollupResult>();
  if (tasks.length === 0) return result;

  const byId = new Map<TaskId, Task>();
  for (const t of tasks) byId.set(t.id, t);

  const childrenOf = new Map<TaskId, Task[]>();
  const roots: Task[] = [];
  for (const t of tasks) {
    // Self-parenting (`t.parent === t.id`) is deliberately NOT special-cased away here: it is
    // recorded as its own child, which makes it unreachable from any root and therefore picked
    // up by the coverage walk at the end, where `visit` recurses into it and the `visiting`
    // guard reports it as the cycle it is — rather than silently normalizing it to a root.
    if (t.parent !== undefined && byId.has(t.parent)) {
      const arr = childrenOf.get(t.parent);
      if (arr) arr.push(t);
      else childrenOf.set(t.parent, [t]);
    } else {
      roots.push(t);
    }
  }

  const visiting = new Set<TaskId>(); // cycle guard
  const visited = new Set<TaskId>(); // full-coverage check, independent of `result`'s size

  /** Post-order: a child's rolled-up span is what its parent aggregates (spec §5.1), so a
   *  nested summary's authored start/end are ignored whenever it has children. */
  function spanOf(task: Task): Span {
    const rolled = result.get(task.id);
    if (rolled) return rolled;
    return {
      start: normalizeDate(task.start, calendar.timezone),
      end: normalizeDate(task.end, calendar.timezone),
      progress: clamp01(task.progress),
      durationHours: resolveDuration(task, calendar, CALLER_NAME),
    };
  }

  function visit(task: Task, depth: number): void {
    if (depth > MAX_HIERARCHY_DEPTH) {
      throw new Error(
        `${CALLER_NAME}: hierarchy nesting exceeds max depth (${MAX_HIERARCHY_DEPTH}) at task ` +
          `"${task.id}" — the parent chain is unreasonably deep.`,
      );
    }
    if (visiting.has(task.id)) {
      throw new Error(`${CALLER_NAME}: cyclic parent chain involving task "${task.id}"`);
    }
    visiting.add(task.id);
    visited.add(task.id);

    const children = childrenOf.get(task.id);
    if (children !== undefined && children.length > 0) {
      for (const child of children) visit(child, depth + 1);

      // Seeded from the first child rather than `undefined`, so `start`/`end` are `ZDT` (not
      // `ZDT | undefined`) throughout and no non-null assertion is needed to store them.
      const first = spanOf(children[0]!);
      let start = first.start;
      let end = first.end;
      let weightedSum = first.durationHours * first.progress;
      let weightTotal = first.durationHours;
      let plainSum = first.progress;
      for (let i = 1; i < children.length; i++) {
        const span = spanOf(children[i]!);
        // Min/max by INSTANT, never by working-hour difference: two instants less than one
        // working hour apart — or both inside non-working time — can differ while
        // `differenceInWorkingHours` returns exactly 0, which would pick the wrong candidate.
        // Same deviation `dependency-math.ts`'s `compareInstant` documents for max-ES/min-LF.
        if (compareInstant(span.start, start) < 0) start = span.start;
        if (compareInstant(span.end, end) > 0) end = span.end;
        // Milestones (and any zero-duration task) carry weight 0: they move the span but not
        // the percentage (spec §5.2).
        weightedSum += span.durationHours * span.progress;
        weightTotal += span.durationHours;
        plainSum += span.progress;
      }
      result.set(task.id, {
        start,
        end,
        // All-zero-duration children (e.g. every child is a milestone) would make this 0/0;
        // fall back to the unweighted mean rather than leak `NaN` into a public result.
        progress: clamp01(weightTotal > 0 ? weightedSum / weightTotal : plainSum / children.length),
        durationHours: differenceInWorkingHours(start, end, calendar),
      });
    }

    visiting.delete(task.id);
  }

  for (const root of roots) visit(root, 0);

  // Any task not reached from a root is inside a parent cycle (a dangling parent was already
  // routed to `roots` above). Walking it surfaces the cycle as a controlled throw instead of
  // silently returning a partial map. Tracked via an independent `visited` set — NOT via
  // `result.size`, which legitimately differs from `tasks.length` for any hierarchy with leaves.
  for (const t of tasks) {
    if (!visited.has(t.id)) visit(t, 0);
  }

  return result;
}
