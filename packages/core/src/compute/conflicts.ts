// Schedule conflict detection (spec-detect-conflicts.md). Headless, pure function: no DOM, no
// framework, never mutates its inputs, no top-level side effects. Reports where the AUTHORED
// schedule contradicts a rule Core enforces in the cascade (`computeCascade`) or in hierarchy
// rollup. Per-edge, O(T + D); needs no topological sort, so a cycle never makes it throw or loop.
import type { Temporal } from '@js-temporal/polyfill';
import { normalizeDate } from './working-calendar.js';
import { differenceInWorkingHoursFast } from './working-hours-fast.js';
import {
  validateTaskDuration,
  validateDependencyLag,
  resolveDuration,
  compareInstant,
  earliestStartFromPredecessor,
} from './dependency-math.js';
import type {
  Conflict,
  ConflictKind,
  Dependency,
  Task,
  TaskId,
  WorkingCalendar,
} from '../types.js';

const CALLER_NAME = 'detectConflicts';

/**
 * `shortfallHours` is measured over at most this many calendar days past the successor's start
 * (~100 years). `differenceInWorkingHoursFast` is closed-form per whole week, but a DST zone still
 * costs one transition lookup per half year, and a typo'd or hostile date can put the
 * successor millennia away; the cap keeps the cost of one violated edge bounded. Past it the value
 * is a lower bound (it saturates at the working hours of the capped window).
 */
const MAX_SHORTFALL_DAYS = 36_500;

export interface DetectConflictsOptions {
  /** Default: all kinds. */
  readonly kinds?: readonly ConflictKind[];
}

type Span = { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime };

const KIND_RANK: Record<ConflictKind, number> = {
  'invalid-span': 0,
  'dependency-violation': 1,
  'outside-parent': 2,
};

function sortKey(c: Conflict): string {
  return c.kind === 'dependency-violation' ? c.dependencyId : c.taskId;
}

function compareConflicts(a: Conflict, b: Conflict): number {
  if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  const ka = sortKey(a);
  const kb = sortKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  const pa = a.kind === 'outside-parent' ? a.parentId : '';
  const pb = b.kind === 'outside-parent' ? b.parentId : '';
  return pa < pb ? -1 : pa > pb ? 1 : 0;
}

function cappedShortfallEnd(
  start: Temporal.ZonedDateTime,
  required: Temporal.ZonedDateTime,
): Temporal.ZonedDateTime {
  const limit = start.add({ days: MAX_SHORTFALL_DAYS });
  return compareInstant(required, limit) > 0 ? limit : required;
}

/**
 * Reports schedule conflicts: `dependency-violation` (per violated edge), `outside-parent`
 * (child span escapes the parent's) and `invalid-span` (`end` before `start`). Output is in a
 * canonical, input-order-independent order. A dependency referencing a missing task is skipped
 * (a diagnostic must tolerate half-edited states). Throws on a duplicate task id or a
 * non-finite / out-of-range `duration` or `lag` on any task and on every dependency whose two
 * tasks exist and are not `invalid-span` (skipped edges are not validated). A violation's
 * `shortfallHours` saturates at ~100 years (36,500 days) of gap: beyond that it is a lower bound,
 * which keeps one corrupt date from costing seconds per detection.
 */
export function detectConflicts(
  tasks: readonly Task[],
  dependencies: readonly Dependency[],
  calendar: WorkingCalendar,
  options?: DetectConflictsOptions,
): Conflict[] {
  const kinds = new Set<ConflictKind>(
    options?.kinds ?? ['invalid-span', 'dependency-violation', 'outside-parent'],
  );
  const byId = new Map<TaskId, Task>();
  for (const t of tasks) {
    if (byId.has(t.id)) throw new Error(`${CALLER_NAME}: duplicate task id ${t.id}`);
    byId.set(t.id, t);
    validateTaskDuration(t, CALLER_NAME);
  }

  const spans = new Map<TaskId, Span>();
  const spanOf = (t: Task): Span => {
    let s = spans.get(t.id);
    if (!s) {
      s = {
        start: normalizeDate(t.start, calendar.timezone),
        end: normalizeDate(t.end, calendar.timezone),
      };
      spans.set(t.id, s);
    }
    return s;
  };

  const invalid = new Set<TaskId>();
  const out: Conflict[] = [];
  for (const t of tasks) {
    const s = spanOf(t);
    if (compareInstant(s.end, s.start) < 0) {
      invalid.add(t.id);
      if (kinds.has('invalid-span')) out.push({ kind: 'invalid-span', taskId: t.id });
    }
  }

  if (kinds.has('dependency-violation')) {
    for (const d of dependencies) {
      const pred = byId.get(d.from);
      const succ = byId.get(d.to);
      if (!pred || !succ || invalid.has(d.from) || invalid.has(d.to)) continue;
      validateDependencyLag(d, CALLER_NAME);
      const lag = d.lag ?? 0;
      const ps = spanOf(pred);
      const ss = spanOf(succ);
      // Zero-lag FS/SS: the required start is exactly the predecessor's end/start, so skip the
      // calendar walk (`addWorkingHours(x, 0)` returns x unchanged).
      const required =
        lag === 0 && d.type === 'FS'
          ? ps.end
          : lag === 0 && d.type === 'SS'
            ? ps.start
            : earliestStartFromPredecessor(
                ps.start,
                ps.end,
                d.type,
                lag,
                d.type === 'FF' || d.type === 'SF' ? resolveDuration(succ, calendar, CALLER_NAME) : 0,
                calendar,
              );
      if (compareInstant(required, ss.start) > 0) {
        out.push({
          kind: 'dependency-violation',
          dependencyId: d.id,
          from: d.from,
          to: d.to,
          dependencyType: d.type,
          lagHours: lag,
          requiredStart: required,
          shortfallHours: differenceInWorkingHoursFast(
            ss.start,
            cappedShortfallEnd(ss.start, required),
            calendar,
          ),
        });
      }
    }
  }

  if (kinds.has('outside-parent')) {
    for (const t of tasks) {
      const p = t.parent === undefined ? undefined : byId.get(t.parent);
      if (!p || invalid.has(t.id) || invalid.has(p.id)) continue;
      const cs = spanOf(t);
      const pSpan = spanOf(p);
      const before = compareInstant(cs.start, pSpan.start) < 0;
      const after = compareInstant(cs.end, pSpan.end) > 0;
      if (before || after) {
        out.push({
          kind: 'outside-parent',
          taskId: t.id,
          parentId: p.id,
          edge: before && after ? 'both' : before ? 'start' : 'end',
        });
      }
    }
  }

  return out.sort(compareConflicts);
}
