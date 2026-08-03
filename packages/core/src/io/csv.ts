// CSV export/import (spec-io-json-csv.md §6). Headless, pure-data, no DOM. Does NOT import
// anything from json.ts — tree-shakable: a consumer who imports only
// `{ exportCsv, importCsv }` never pulls in the JSON envelope validator.
//
// Tasks-only, flat scalar columns. `constraint`, `resources`, `meta`, and dependencies are
// NOT representable in CSV at all — export silently drops them (documented, intentional
// lossiness, not an oversight: this is JSON's job, see spec §6.2).
import { toTaskId, type Task, type TaskId } from '../types.js';
import type { TaskInput } from '../store/index.js';
import { dateInputToIso, assertParsableDateInput } from './date.js';
import { IoValidationError } from './errors.js';
import { DEFAULT_IMPORT_LIMITS } from './limits.js';
import type { CsvColumn, ExportCsvOptions, ImportCsvOptions, ImportCsvResult, ImportLimits } from './types.js';
import {
  TASK_KINDS,
  assertFiniteNumber,
  assertFiniteNumberInRange,
  assertNonEmptyString,
  assertOneOf,
  assertString,
  checkHierarchyDepth,
  validateColor,
} from './validate.js';

export const DEFAULT_CSV_COLUMNS: readonly CsvColumn[] = [
  'id',
  'name',
  'start',
  'end',
  'duration',
  'progress',
  'type',
  'parent',
  'notes',
  'color',
];

const REQUIRED_CSV_COLUMNS: readonly CsvColumn[] = ['id', 'name', 'start', 'end', 'progress', 'type'];

/** Cell first-character trigger set for CSV formula-injection escaping (security.md §2,
 *  spec §5.2). Always-on, no opt-out. */
const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r'];

/** Prefix a literal `'` so Excel/Sheets treats the cell as text, never a formula. */
export function escapeCsvValue(value: string): string {
  if (value.length > 0 && FORMULA_TRIGGER_CHARS.includes(value[0]!)) {
    return `'${value}`;
  }
  return value;
}

// NOTE (security review B1): there is deliberately NO `unescapeCsvValue`. Import takes every
// CSV cell value LITERALLY. Blindly stripping a leading `'` + trigger char would corrupt a
// third-party CSV whose cell genuinely starts with that sequence (e.g. a user/tool that
// hand-escaped `'=SUM(...)` as a literal string) — silently turning it into the live formula
// string `=SUM(...)`. `importCsv` accepts arbitrary CSVs, not just fluxgantt's own exports,
// so it must not assume the `'` guard is ours to remove. Consequence, by design: round-tripping
// a task name that starts with a formula trigger through CSV is NOT identity (export adds one
// `'`, import keeps it) — CSV is intentionally lossy for spreadsheet interop; JSON is the
// lossless format. The `'` accretion is one-time and stable (a value already starting with `'`
// is not a trigger char, so it is not re-escaped on a later export).

// --- Export ------------------------------------------------------------------------------

/**
 * Tasks-only flat CSV. Comma delimiter, RFC-4180 quoting, `\r\n` row terminator.
 * Formula-injection escaping is applied to every exported cell unconditionally.
 */
export function exportCsv(tasks: readonly Task[], options?: ExportCsvOptions): string {
  const columns = options?.columns ?? DEFAULT_CSV_COLUMNS;
  for (const col of columns) {
    if (!DEFAULT_CSV_COLUMNS.includes(col)) {
      throw new Error(
        `exportCsv: unknown column "${col}" — must be one of ${DEFAULT_CSV_COLUMNS.join(', ')}`,
      );
    }
  }
  const timezone = options?.timezone ?? 'UTC';

  const rows: string[] = [writeRow(columns)];
  for (const task of tasks) {
    rows.push(writeRow(columns.map((col) => cellValue(task, col, timezone))));
  }
  return rows.join('\r\n');
}

function cellValue(task: Task, col: CsvColumn, timezone: string): string {
  switch (col) {
    case 'id':
      return task.id;
    case 'name':
      return task.name;
    case 'start':
      return dateInputToIso(task.start, timezone);
    case 'end':
      return dateInputToIso(task.end, timezone);
    case 'duration':
      return task.duration === undefined ? '' : String(task.duration);
    case 'progress':
      return String(task.progress);
    case 'type':
      return task.type;
    case 'parent':
      return task.parent === undefined ? '' : task.parent;
    case 'notes':
      return task.notes === undefined ? '' : task.notes;
    case 'color':
      return task.color === undefined ? '' : task.color;
  }
}

function writeRow(cells: readonly string[]): string {
  return cells.map((c) => rfc4180Quote(escapeCsvValue(c))).join(',');
}

function rfc4180Quote(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// --- Import ------------------------------------------------------------------------------

/**
 * Validates a CSV string and returns `{ tasks }` ready to feed `createGantt({ tasks })`.
 * Header row required, order-independent; unknown extra columns are silently ignored;
 * missing required columns (`id,name,start,end,progress,type`) throw. Throws
 * `IoValidationError` on anything malformed — atomically (see spec §3.2's "reject, not
 * best-effort" contract, same posture as `importJson`).
 */
export function importCsv(csv: string, options?: ImportCsvOptions): ImportCsvResult {
  const limits: ImportLimits = { ...DEFAULT_IMPORT_LIMITS, ...options?.limits };
  if (csv.length > limits.maxInputLengthChars) {
    throw new IoValidationError(`csv exceeds maxInputLengthChars (${limits.maxInputLengthChars})`, '$');
  }

  const rows = parseRfc4180(csv);
  if (rows.length === 0) {
    throw new IoValidationError('csv has no header row', '$');
  }

  const header = rows[0]!;
  const columnIndex = new Map<CsvColumn, number>();
  header.forEach((name, i) => {
    if ((DEFAULT_CSV_COLUMNS as readonly string[]).includes(name)) {
      columnIndex.set(name as CsvColumn, i);
    }
    // unknown header name: silently ignored (lenient), no entry added
  });

  for (const col of REQUIRED_CSV_COLUMNS) {
    if (!columnIndex.has(col)) {
      throw new IoValidationError(`missing required CSV column "${col}"`, '$.header');
    }
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > limits.maxTaskCount) {
    throw new IoValidationError(`csv rows exceed maxTaskCount (${limits.maxTaskCount})`, '$');
  }

  const seenIds = new Set<string>();
  const result: TaskInput[] = [];
  dataRows.forEach((row, i) => {
    const path = `$.rows[${i + 2}]`; // +2: 1-based, plus the header row itself
    if (row.length !== header.length) {
      throw new IoValidationError(`row has ${row.length} columns, expected ${header.length}`, path);
    }

    const cell = (col: CsvColumn): string | undefined => {
      const idx = columnIndex.get(col);
      return idx === undefined ? undefined : row[idx];
    };
    // Values are taken literally — NO unescape (security review B1; see the note above).
    const get = (col: CsvColumn): string | undefined => cell(col);

    const id = assertNonEmptyString(get('id'), `${path}.id`, limits.maxIdLength);
    if (seenIds.has(id)) {
      throw new IoValidationError(`duplicate task id "${id}" within import`, `${path}.id`);
    }
    seenIds.add(id);

    const name = assertString(get('name'), `${path}.name`, limits.maxNameLength);
    const start = assertParsableDateInput(get('start'), `${path}.start`);
    const end = assertParsableDateInput(get('end'), `${path}.end`);
    const progressCell = get('progress');
    const progress = assertFiniteNumberInRange(
      progressCell === undefined ? NaN : Number(progressCell),
      0,
      1,
      `${path}.progress`,
    );
    const type = assertOneOf(get('type'), TASK_KINDS, `${path}.type`);

    const durationCell = get('duration');
    const duration =
      durationCell === undefined || durationCell === ''
        ? undefined
        : assertFiniteNumber(Number(durationCell), `${path}.duration`, { min: 0 });
    const parentCell = get('parent');
    const parent =
      parentCell === undefined || parentCell === ''
        ? undefined
        : assertNonEmptyString(parentCell, `${path}.parent`, limits.maxIdLength);
    const notesCell = get('notes');
    const notes =
      notesCell === undefined || notesCell === '' ? undefined : assertString(notesCell, `${path}.notes`, limits.maxStringLength);
    const colorCell = get('color');
    const color =
      colorCell === undefined || colorCell === ''
        ? undefined
        : validateColor(colorCell, `${path}.color`, limits.maxStringLength);

    result.push({
      id: toTaskId(id),
      name,
      start,
      end,
      progress,
      type,
      ...(duration !== undefined ? { duration } : {}),
      ...(parent !== undefined ? { parent: toTaskId(parent) } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(color !== undefined ? { color } : {}),
    });
  });

  checkHierarchyDepth(result as ReadonlyArray<{ id: TaskId; parent?: TaskId }>, limits.maxHierarchyDepth);
  return { tasks: result };
}

/**
 * Hand-rolled RFC-4180 state machine — handles quoted fields with embedded
 * commas/quotes/newlines. Accepts both `\r\n` and bare `\n` row separators (lenient-in).
 */
function parseRfc4180(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = csv.length;

  while (i < len) {
    const ch = csv[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += ch === '\r' && csv[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Final field/row, if any content remains without a trailing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
