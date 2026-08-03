// JSON export/import (spec-io-json-csv.md §3, §4). Headless, pure-data, no DOM. Does NOT
// import anything from csv.ts — tree-shakable: a consumer who imports only
// `{ exportJson, importJson }` never pulls in the CSV writer/parser.
import { toResourceId, toTaskId, type Dependency, type ResourceAssignment, type Task, type TaskConstraint, type TaskId } from '../types.js';
import type { TaskInput } from '../store/index.js';
import { dateInputToIso, dateToIso, assertParsableDateInput } from './date.js';
import { IoValidationError, truncateForError } from './errors.js';
import { DEFAULT_IMPORT_LIMITS } from './limits.js';
import type {
  DependencyInput,
  ExportBundle,
  ExportJsonOptions,
  ExportedDependency,
  ExportedTask,
  ExportedTaskConstraint,
  ImportJsonOptions,
  ImportLimits,
  ImportResult,
} from './types.js';
import {
  DEPENDENCY_TYPES,
  TASK_KINDS,
  assertFiniteNumber,
  assertFiniteNumberInRange,
  assertNonEmptyString,
  assertOneOf,
  assertPlainObject,
  assertString,
  checkHierarchyDepth,
  validateColor,
  validateMeta,
  validateTaskConstraint,
} from './validate.js';

// --- Export ------------------------------------------------------------------------------

/**
 * Returns a plain JSON-serializable object (NOT a string). Call
 * `JSON.stringify(exportJson(...))` to get text for a file/network boundary.
 *
 * Envelope shape: `{ fluxgantt: { schemaVersion, exported_at }, tasks, dependencies }` — no
 * `resources`/`baselines`/`project` keys in Core v1 (see spec §3.1). `createdAt`/`updatedAt`
 * and dependency `id` ARE included for informational fidelity, but `importJson` validates-
 * and-drops them on re-import (store-generated metadata, always re-stamped — see §10).
 */
export function exportJson(
  tasks: readonly Task[],
  dependencies: readonly Dependency[],
  options?: ExportJsonOptions,
): ExportBundle {
  const timezone = options?.timezone ?? 'UTC';
  return {
    fluxgantt: { schemaVersion: '1.0', exported_at: dateToIso(new Date()) },
    tasks: tasks.map((t) => exportTask(t, timezone)),
    dependencies: dependencies.map(exportDependency),
  };
}

function exportTask(task: Task, timezone: string): ExportedTask {
  return {
    id: task.id,
    name: task.name,
    start: dateInputToIso(task.start, timezone),
    end: dateInputToIso(task.end, timezone),
    ...(task.duration !== undefined ? { duration: task.duration } : {}),
    progress: task.progress,
    ...(task.priority !== undefined ? { priority: task.priority } : {}),
    ...(task.parent !== undefined ? { parent: task.parent } : {}),
    type: task.type,
    ...(task.constraint !== undefined ? { constraint: exportConstraint(task.constraint, timezone) } : {}),
    ...(task.resources !== undefined ? { resources: task.resources } : {}),
    ...(task.notes !== undefined ? { notes: task.notes } : {}),
    ...(task.color !== undefined ? { color: task.color } : {}),
    ...(task.meta !== undefined ? { meta: task.meta } : {}),
    createdAt: dateToIso(task.createdAt),
    updatedAt: dateToIso(task.updatedAt),
  };
}

function exportConstraint(constraint: TaskConstraint, timezone: string): ExportedTaskConstraint {
  if (constraint.kind === 'asap' || constraint.kind === 'alap') return { kind: constraint.kind };
  return { kind: constraint.kind, date: dateInputToIso(constraint.date, timezone) };
}

function exportDependency(dep: Dependency): ExportedDependency {
  return {
    id: dep.id,
    from: dep.from,
    to: dep.to,
    type: dep.type,
    ...(dep.lag !== undefined ? { lag: dep.lag } : {}),
  };
}

// --- Import ------------------------------------------------------------------------------

/**
 * Validates `input` (a JSON string, or an already-parsed object) and returns
 * `{ tasks, dependencies }` ready to feed `createGantt({ tasks, dependencies })` (whose
 * constructor already validates duplicate ids + dependency cycles via the stores — NOT
 * re-implemented here, see spec §5.5). Throws `IoValidationError` on anything malformed —
 * atomically: every check runs before any item is pushed onto the returned arrays, so a
 * caller never observes a partially-validated result (reject, not best-effort).
 *
 * Accepts either the full `{ fluxgantt, tasks, dependencies }` envelope or a bare
 * `{ tasks, dependencies }` object (lenient-in). `resources`/`baselines`/any other unknown
 * top-level key is tolerated and silently ignored (forward-compat with a future Pro export).
 */
export function importJson(input: string | object, options?: ImportJsonOptions): ImportResult {
  const limits: ImportLimits = { ...DEFAULT_IMPORT_LIMITS, ...options?.limits };
  const raw = parseIfString(input, limits.maxInputLengthChars);
  const envelope = unwrapEnvelope(raw);
  validateSchemaVersion(envelope);
  const tasks = validateAndBuildTasks(envelope.tasks, limits);
  const dependencies = validateAndBuildDependencies(envelope.dependencies, limits);
  return { tasks, dependencies };
}

function parseIfString(input: string | object, maxLen: number): unknown {
  if (typeof input !== 'string') return input;
  if (input.length > maxLen) {
    throw new IoValidationError(`input exceeds maxInputLengthChars (${maxLen})`, '$');
  }
  try {
    return JSON.parse(input) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new IoValidationError(`invalid JSON: ${message}`, '$');
  }
}

function unwrapEnvelope(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new IoValidationError('root must be a JSON object', '$');
  }
  const obj = raw as Record<string, unknown>;
  if ('fluxgantt' in obj) {
    const fg = obj.fluxgantt;
    if (typeof fg !== 'object' || fg === null || Array.isArray(fg)) {
      throw new IoValidationError('fluxgantt must be an object', '$.fluxgantt');
    }
  }
  return obj;
}

function validateSchemaVersion(envelope: Record<string, unknown>): void {
  if (!('fluxgantt' in envelope)) return; // bare form has no version to check
  const fg = envelope.fluxgantt as Record<string, unknown>;
  const version = fg.schemaVersion;
  if (version !== '1.0') {
    throw new IoValidationError(
      `unsupported schemaVersion "${truncateForError(String(version))}" (expected "1.0")`,
      '$.fluxgantt.schemaVersion',
    );
  }
  // exported_at is read-only metadata, not validated beyond being present-or-absent.
}

function validateAndBuildTasks(rawTasksIn: unknown, limits: ImportLimits): TaskInput[] {
  const rawTasks = rawTasksIn === undefined ? [] : rawTasksIn;
  if (!Array.isArray(rawTasks)) {
    throw new IoValidationError('tasks must be an array', '$.tasks');
  }
  if (rawTasks.length > limits.maxTaskCount) {
    throw new IoValidationError(`tasks exceeds maxTaskCount (${limits.maxTaskCount})`, '$.tasks');
  }

  const seenIds = new Set<string>();
  const result: TaskInput[] = [];
  rawTasks.forEach((raw: unknown, i: number) => {
    const path = `$.tasks[${i}]`;
    assertPlainObject(raw, path);

    const id = assertNonEmptyString(raw.id, `${path}.id`, limits.maxIdLength);
    if (seenIds.has(id)) {
      throw new IoValidationError(`duplicate task id "${id}" within import`, `${path}.id`);
    }
    seenIds.add(id);

    const name = assertString(raw.name, `${path}.name`, limits.maxNameLength);
    const start = assertParsableDateInput(raw.start, `${path}.start`);
    const end = assertParsableDateInput(raw.end, `${path}.end`);
    const progress = assertFiniteNumberInRange(raw.progress, 0, 1, `${path}.progress`);
    const type = assertOneOf(raw.type, TASK_KINDS, `${path}.type`);

    const duration =
      raw.duration === undefined ? undefined : assertFiniteNumber(raw.duration, `${path}.duration`, { min: 0 });
    const priority = raw.priority === undefined ? undefined : assertFiniteNumber(raw.priority, `${path}.priority`);
    const parent =
      raw.parent === undefined || raw.parent === null
        ? undefined
        : assertNonEmptyString(raw.parent, `${path}.parent`, limits.maxIdLength);
    const notes = raw.notes === undefined ? undefined : assertString(raw.notes, `${path}.notes`, limits.maxStringLength);
    const color =
      raw.color === undefined ? undefined : validateColor(raw.color, `${path}.color`, limits.maxStringLength);
    const constraint =
      raw.constraint === undefined ? undefined : validateTaskConstraint(raw.constraint, `${path}.constraint`);
    const resources =
      raw.resources === undefined ? undefined : validateResourceAssignments(raw.resources, `${path}.resources`, limits);
    const meta =
      raw.meta === undefined ? undefined : validateMeta(raw.meta, `${path}.meta`, limits.maxMetaKeys, limits.maxMetaDepth);

    // createdAt/updatedAt: validated if present (must parse as a DateInput string) but
    // INTENTIONALLY DROPPED below — TaskInput cannot carry them, TaskStore.add() always
    // re-stamps fresh timestamps (spec §9/§10).
    if (raw.createdAt !== undefined && raw.createdAt !== null) {
      assertParsableDateInput(raw.createdAt, `${path}.createdAt`);
    }
    if (raw.updatedAt !== undefined && raw.updatedAt !== null) {
      assertParsableDateInput(raw.updatedAt, `${path}.updatedAt`);
    }

    result.push({
      id: toTaskId(id),
      name,
      start,
      end,
      progress,
      type,
      ...(duration !== undefined ? { duration } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(parent !== undefined ? { parent: toTaskId(parent) } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(constraint !== undefined ? { constraint } : {}),
      ...(resources !== undefined ? { resources } : {}),
      ...(meta !== undefined ? { meta } : {}),
    });
  });

  checkHierarchyDepth(result as ReadonlyArray<{ id: TaskId; parent?: TaskId }>, limits.maxHierarchyDepth);
  return result;
}

function validateResourceAssignments(raw: unknown, path: string, limits: ImportLimits): ResourceAssignment[] {
  if (!Array.isArray(raw)) {
    throw new IoValidationError('resources must be an array', path);
  }
  // Cap per-task assignment count (security review N4) — consistent with every other collection
  // having an explicit cap. Reuses maxMetaKeys as the per-task collection bound.
  if (raw.length > limits.maxMetaKeys) {
    throw new IoValidationError(`resources exceeds maxMetaKeys (${limits.maxMetaKeys})`, path);
  }
  return raw.map((item: unknown, i: number) => {
    const itemPath = `${path}[${i}]`;
    assertPlainObject(item, itemPath);
    const resourceId = assertNonEmptyString(item.resourceId, `${itemPath}.resourceId`, limits.maxIdLength);
    const units = assertFiniteNumberInRange(item.units, 0, 1, `${itemPath}.units`);
    return { resourceId: toResourceId(resourceId), units };
  });
}

function validateAndBuildDependencies(rawDepsIn: unknown, limits: ImportLimits): DependencyInput[] {
  const rawDeps = rawDepsIn === undefined ? [] : rawDepsIn;
  if (!Array.isArray(rawDeps)) {
    throw new IoValidationError('dependencies must be an array', '$.dependencies');
  }
  if (rawDeps.length > limits.maxDependencyCount) {
    throw new IoValidationError(`dependencies exceeds maxDependencyCount (${limits.maxDependencyCount})`, '$.dependencies');
  }

  const result: DependencyInput[] = [];
  rawDeps.forEach((raw: unknown, i: number) => {
    const path = `$.dependencies[${i}]`;
    assertPlainObject(raw, path);

    // `id`, if present, is validated for shape hygiene only — NEVER placed on the returned
    // DependencyInput (DependencyStore.link() always mints a fresh one).
    if (raw.id !== undefined) {
      assertNonEmptyString(raw.id, `${path}.id`, limits.maxIdLength);
    }
    const from = assertNonEmptyString(raw.from, `${path}.from`, limits.maxIdLength);
    const to = assertNonEmptyString(raw.to, `${path}.to`, limits.maxIdLength);
    const type = assertOneOf(raw.type, DEPENDENCY_TYPES, `${path}.type`);
    const lag = raw.lag === undefined ? undefined : assertFiniteNumber(raw.lag, `${path}.lag`);

    result.push({
      from: toTaskId(from),
      to: toTaskId(to),
      type,
      ...(lag !== undefined ? { lag } : {}),
    });
  });
  return result;
}
