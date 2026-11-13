// Column resolution and validation (spec-grid-columns.md sections 2.3, 14). Pure and DOM-free.
// Column definitions come from host code, but `header`, `id` and the `value()` results can be derived
// from user content, so everything is validated here and a bad definition throws a `RangeError`
// before anything changes.
import type {
  BuiltInColumnId,
  ColumnAlign,
  ColumnId,
  CustomColumn,
  GridColumn,
  GridColumnInput,
} from './types.js';

/**
 * Most columns a grid can hold (the `name` column included).
 *
 * @beta
 */
export const MAX_COLUMN_COUNT = 24;
/** Longest header, in characters. */
export const MAX_HEADER_CHARS = 200;
/** Longest cell text, in characters; longer `value()`/`format()` output is cut. */
export const MAX_CELL_CHARS = 1000;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BUILT_INS: readonly BuiltInColumnId[] = ['name', 'start', 'end', 'duration', 'progress'];
const DEFAULT_HEADERS: Record<BuiltInColumnId, string> = {
  name: 'Name',
  start: 'Start',
  end: 'End',
  duration: 'Duration',
  progress: 'Progress',
};
const DEFAULT_WIDTHS: Record<BuiltInColumnId, number> = {
  name: 220,
  start: 120,
  end: 120,
  duration: 96,
  progress: 96,
};
const ALIGNS: readonly string[] = ['start', 'center', 'end'];
// Characters that are not valid in XML 1.0 (C0 controls except tab, U+FFFE, U+FFFF, lone surrogates: an
// export would not parse), C1 controls, line/paragraph separators and the bidi override/isolate characters:
// a cell is one line of plain text. Tab is allowed (valid in XML, and the text collapses it anyway).
// eslint-disable-next-line no-control-regex
export const UNSAFE_TEXT = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** A resolved column plus the host callbacks of a custom one. Internal. */
export interface Column extends GridColumn {
  readonly value?: CustomColumn['value'];
  readonly format?: CustomColumn['format'];
}

/**
 * Brands `id` as a `ColumnId`; throws a `RangeError` unless it matches `^[A-Za-z0-9_-]{1,64}$`.
 *
 * @beta
 */
export function toColumnId(id: string): ColumnId {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new RangeError('column id must match ^[A-Za-z0-9_-]{1,64}$');
  }
  return id as ColumnId;
}

/**
 * The default columns: name, start, end, duration, progress.
 *
 * @beta
 */
export const DEFAULT_GRID_COLUMNS: readonly GridColumnInput[] = BUILT_INS.map((id) => ({ id }));

const finite = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`${what} must be a finite number`);
  return v;
};

/**
 * Validates `input` and resolves every default. `name` is prepended when absent and must come first
 * when present. Throws a `RangeError` on a bad id, a duplicate, a reserved id on a custom column, a
 * bad width or alignment, an over-long header, a missing `value` function or more than 24 columns.
 */
export function resolveColumns(input: readonly GridColumnInput[] | undefined): readonly Column[] {
  if (input !== undefined && !Array.isArray(input)) throw new RangeError('columns must be an array');
  const list: readonly GridColumnInput[] = input ?? DEFAULT_GRID_COLUMNS;
  const defs = list.some((c) => c?.id === 'name') ? list : [{ id: 'name' } as GridColumnInput, ...list];
  if (defs.length > MAX_COLUMN_COUNT) throw new RangeError(`at most ${MAX_COLUMN_COUNT} columns`);
  const seen = new Set<string>();
  return defs.map((def, i): Column => {
    if (typeof def !== 'object' || def === null) throw new RangeError(`column ${i} must be an object`);
    const id = toColumnId(def.id);
    if (seen.has(id)) throw new RangeError(`duplicate column id "${id}"`);
    seen.add(id);
    if ((id === 'name') !== (i === 0)) throw new RangeError('the "name" column must be first');
    const builtIn = (BUILT_INS as readonly string[]).includes(id);
    const custom = def as CustomColumn;
    if (builtIn ? custom.value !== undefined : typeof custom.value !== 'function') {
      throw new RangeError(
        builtIn
          ? `"${id}" is a built-in column id; pick another id for a custom column`
          : `column "${id}" needs a value function`,
      );
    }
    if (custom.format !== undefined && typeof custom.format !== 'function') {
      throw new RangeError(`format of "${id}" must be a function`);
    }
    if (!builtIn && typeof custom.header !== 'string') throw new RangeError(`column "${id}" needs a header`);
    const header = def.header ?? DEFAULT_HEADERS[id as BuiltInColumnId];
    if (typeof header !== 'string' || header.length > MAX_HEADER_CHARS) {
      throw new RangeError(`header of "${id}" must be a string of at most ${MAX_HEADER_CHARS} characters`);
    }
    const align = def.align ?? (id === 'duration' || id === 'progress' ? 'end' : 'start');
    if (!ALIGNS.includes(align)) throw new RangeError(`align of "${id}" must be start, center or end`);
    const minWidth = def.minWidth === undefined ? 48 : Math.max(0, finite(def.minWidth, 'minWidth'));
    const maxWidth = def.maxWidth === undefined ? 600 : Math.max(minWidth, finite(def.maxWidth, 'maxWidth'));
    const width =
      def.width === undefined
        ? builtIn
          ? DEFAULT_WIDTHS[id as BuiltInColumnId]
          : 120 // never a lookup by a host id: `__proto__` would hit Object.prototype
        : finite(def.width, 'width');
    return {
      id,
      header: header.replace(UNSAFE_TEXT, ' '),
      width: Math.min(maxWidth, Math.max(minWidth, width)),
      minWidth,
      maxWidth,
      align: align as ColumnAlign,
      builtIn,
      ...(builtIn ? {} : { value: custom.value, ...(custom.format ? { format: custom.format } : {}) }),
    };
  });
}

/** The public view of a resolved column (no host callbacks). */
export const publicColumn = ({ id, header, width, minWidth, maxWidth, align, builtIn }: Column): GridColumn => ({
  id,
  header,
  width,
  minWidth,
  maxWidth,
  align,
  builtIn,
});
