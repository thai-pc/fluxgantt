// Shared primitive validators (spec-io-json-csv.md §3.2, §5) — used by BOTH json.ts and
// csv.ts, kept here instead of duplicated so the two format-specific files stay small and the
// shared security-limit logic (size/depth/count caps) has ONE implementation to audit.
import type { DependencyType, TaskConstraint, TaskId, TaskKind } from '../types.js';
import { assertParsableDateInput } from './date.js';
import { IoValidationError } from './errors.js';

export const TASK_KINDS: readonly TaskKind[] = ['task', 'summary', 'milestone', 'project'];
export const DEPENDENCY_TYPES: readonly DependencyType[] = ['FS', 'SS', 'FF', 'SF'];
const DATED_CONSTRAINT_KINDS = [
  'must-start-on',
  'must-finish-on',
  'start-no-earlier-than',
  'start-no-later-than',
  'finish-no-earlier-than',
  'finish-no-later-than',
] as const;
const ALL_CONSTRAINT_KINDS = ['asap', 'alap', ...DATED_CONSTRAINT_KINDS] as const;

/** Cheap, deliberately loose secondary guard (spec §5.4) — NOT the authoritative color
 *  whitelist (that lives in the render layer, per `Task.color`'s own doc comment). Rejects
 *  obviously hostile strings so they never reach the store. */
const COLOR_BLOCKED_CHARS = /[():;<>]/;
const COLOR_BLOCKED_SUBSTRINGS = ['javascript', 'expression', 'url('];

export function assertPlainObject(raw: unknown, path: string): asserts raw is Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new IoValidationError('expected an object', path);
  }
}

export function assertNonEmptyString(raw: unknown, path: string, maxLen: number): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new IoValidationError('expected a non-empty string', path);
  }
  if (raw.length > maxLen) {
    throw new IoValidationError(`string exceeds max length (${maxLen})`, path);
  }
  return raw;
}

/** Like `assertNonEmptyString` but tolerates an empty string (e.g. `Task.name` has no
 *  non-empty requirement in the domain type). */
export function assertString(raw: unknown, path: string, maxLen: number): string {
  if (typeof raw !== 'string') {
    throw new IoValidationError('expected a string', path);
  }
  if (raw.length > maxLen) {
    throw new IoValidationError(`string exceeds max length (${maxLen})`, path);
  }
  return raw;
}

export interface FiniteNumberRange {
  min?: number;
  max?: number;
}

export function assertFiniteNumber(raw: unknown, path: string, range: FiniteNumberRange = {}): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new IoValidationError('expected a finite number', path);
  }
  if (range.min !== undefined && raw < range.min) {
    throw new IoValidationError(`must be >= ${range.min}`, path);
  }
  if (range.max !== undefined && raw > range.max) {
    throw new IoValidationError(`must be <= ${range.max}`, path);
  }
  return raw;
}

export function assertFiniteNumberInRange(raw: unknown, min: number, max: number, path: string): number {
  return assertFiniteNumber(raw, path, { min, max });
}

export function assertOneOf<T extends string>(raw: unknown, options: readonly T[], path: string): T {
  if (typeof raw !== 'string' || !options.includes(raw as T)) {
    throw new IoValidationError(`expected one of ${JSON.stringify(options)}`, path);
  }
  return raw as T;
}

export function validateColor(raw: unknown, path: string, maxLen: number): string {
  const value = assertString(raw, path, maxLen);
  if (COLOR_BLOCKED_CHARS.test(value)) {
    throw new IoValidationError('color contains a disallowed character', path);
  }
  const lower = value.toLowerCase();
  for (const bad of COLOR_BLOCKED_SUBSTRINGS) {
    if (lower.includes(bad)) {
      throw new IoValidationError(`color contains a disallowed substring "${bad}"`, path);
    }
  }
  return value;
}

/** Validates a `TaskConstraint`-shaped object. `date`, when present, is kept as the raw
 *  (validated) string — `DateInput` accepts `string` directly, no eager Temporal conversion. */
export function validateTaskConstraint(raw: unknown, path: string): TaskConstraint {
  assertPlainObject(raw, path);
  const kind = assertOneOf(raw.kind, ALL_CONSTRAINT_KINDS, `${path}.kind`);
  if (kind === 'asap' || kind === 'alap') {
    return { kind };
  }
  const date = assertParsableDateInput(raw.date, `${path}.date`);
  return { kind, date };
}

/** Validates `meta`: a plain object, bounded top-level key count and nesting depth (spec
 *  §5.1). Values are otherwise untouched (`meta` is intentionally free-form/untrusted-when-
 *  displayed, not IO's job to interpret). */
export function validateMeta(
  raw: unknown,
  path: string,
  maxKeys: number,
  maxDepth: number,
): Record<string, unknown> {
  assertPlainObject(raw, path);
  const keys = Object.keys(raw);
  if (keys.length > maxKeys) {
    throw new IoValidationError(`meta exceeds maxMetaKeys (${maxKeys})`, path);
  }
  checkMetaDepth(raw, path, maxKeys, maxDepth, 1);
  return raw;
}

function checkMetaDepth(
  value: unknown,
  path: string,
  maxKeys: number,
  maxDepth: number,
  depth: number,
): void {
  if (depth > maxDepth) {
    throw new IoValidationError(`meta exceeds maxMetaDepth (${maxDepth})`, path);
  }
  if (Array.isArray(value)) {
    // Cap element count at EVERY level, not just the top (security review N3) — a deeply
    // nested huge array is otherwise only transitively bounded by maxInputLengthChars.
    if (value.length > maxKeys) {
      throw new IoValidationError(`meta array exceeds maxMetaKeys (${maxKeys})`, path);
    }
    value.forEach((item, i) => checkMetaDepth(item, `${path}[${i}]`, maxKeys, maxDepth, depth + 1));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (entries.length > maxKeys) {
      throw new IoValidationError(`meta object exceeds maxMetaKeys (${maxKeys})`, path);
    }
    for (const [key, v] of entries) {
      checkMetaDepth(v, `${path}.${key}`, maxKeys, maxDepth, depth + 1);
    }
  }
}

/**
 * Bounds `Task.parent` chain walking (spec §5.3) — `TaskStore` itself has no cycle check on
 * `Task.parent` chains today, so IO is the only place currently positioned to catch it on the
 * import path. Operates only over the task set WITHIN this one import batch — a `parent` id
 * referencing a task id outside the batch terminates the walk there (legitimate external
 * reference for a partial/incremental import), not an error. A genuine cycle is caught by the
 * per-walk `seen` set well before `maxDepth`, so cycle and over-depth share one error path.
 */
export function checkHierarchyDepth(
  tasks: ReadonlyArray<{ id: TaskId; parent?: TaskId }>,
  maxDepth: number,
): void {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const task of tasks) {
    let depth = 0;
    let cur: { id: TaskId; parent?: TaskId } = task;
    const seen = new Set<TaskId>();
    while (cur.parent !== undefined) {
      if (seen.has(cur.id)) {
        throw new IoValidationError(`cyclic parent chain detected at task "${cur.id}"`, `$.tasks[${task.id}]`);
      }
      seen.add(cur.id);
      depth += 1;
      if (depth > maxDepth) {
        throw new IoValidationError(
          `task "${task.id}" exceeds maxHierarchyDepth (${maxDepth})`,
          `$.tasks[${task.id}]`,
        );
      }
      const next = byId.get(cur.parent);
      if (next === undefined) break; // parent outside this batch — stop, not an error
      cur = next;
    }
  }
}
