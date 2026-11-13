// Public types of the grid-columns mixin (spec-grid-columns.md section 2). Type-only: 0 runtime bytes.
import type { Task, WorkingCalendar } from '../types.js';

/**
 * The ids of the built-in columns.
 *
 * @beta
 */
export type BuiltInColumnId = 'name' | 'start' | 'end' | 'duration' | 'progress';

/**
 * Cell alignment. LOGICAL (inline-start / center / inline-end), never left or right, so it follows RTL.
 *
 * @beta
 */
export type ColumnAlign = 'start' | 'center' | 'end';

/**
 * A validated column id (`^[A-Za-z0-9_-]{1,64}$`); create one with `toColumnId`.
 *
 * @beta
 */
export type ColumnId = string & { readonly __brand: 'ColumnId' };

/**
 * What a custom column's `value` and `format` receive besides the task.
 *
 * @beta
 */
export interface GridCellContext {
  /** `GanttConfig.locale`, default `'en'`. */
  readonly locale: string;
  /** The chart's working calendar. */
  readonly calendar: WorkingCalendar;
  /** True for a row that has children. */
  readonly isSummary: boolean;
}

/**
 * Options shared by every column definition.
 *
 * @beta
 */
export interface GridColumnBase {
  /** Header text, at most 200 characters. Built-ins default to English ("Name", "Start", ...). */
  readonly header?: string;
  /** Initial width in px; clamped to `[minWidth, maxWidth]`. */
  readonly width?: number;
  /** Default 48. */
  readonly minWidth?: number;
  /** Default 600. */
  readonly maxWidth?: number;
  /** Default `'start'`; `duration` and `progress` default to `'end'`. */
  readonly align?: ColumnAlign;
}

/**
 * One of the built-in columns. `name` (the task tree) is always first.
 *
 * @beta
 */
export interface BuiltInColumn extends GridColumnBase {
  readonly id: BuiltInColumnId;
}

/**
 * A host-defined column. `value` and `format` output is untrusted text: it is capped at 1000
 * characters, written with `textContent` only, and an exception thrown by either is contained (the
 * cell is blank). Both run once per task per data revision, not per paint.
 *
 * @beta
 */
export interface CustomColumn extends GridColumnBase {
  /** `^[A-Za-z0-9_-]{1,64}$`, not a built-in id. */
  readonly id: string;
  readonly header: string;
  /** The cell value. `null`, `undefined`, a non-finite number or any other type renders blank. */
  readonly value: (task: Readonly<Task>, ctx: GridCellContext) => string | number | null | undefined;
  /** Turns the value into display text. Default `String(value)`. */
  readonly format?: (value: string | number, task: Readonly<Task>, ctx: GridCellContext) => string;
}

/**
 * A column definition accepted by `withGrid` and `setGridColumns`.
 *
 * @beta
 */
export type GridColumnInput = BuiltInColumn | CustomColumn;

/**
 * A resolved column, as `getGridColumns()` reports it.
 *
 * @beta
 */
export interface GridColumn {
  readonly id: ColumnId;
  readonly header: string;
  /** Resolved (clamped) width in px. */
  readonly width: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly align: ColumnAlign;
  /** False for a `CustomColumn`. */
  readonly builtIn: boolean;
}

/**
 * Options of `withGrid`.
 *
 * @beta
 */
export interface GridOptions {
  /** Initial columns. Default `name`, `start`, `end`, `duration`, `progress`. `name` is prepended when
   *  missing and must be first when present. At most 24; invalid input throws a `RangeError`. */
  readonly columns?: readonly GridColumnInput[];
  /** Show only the `name` column while the container is narrower than this many CSS px (with a 16 px
   *  hysteresis). Default 480; `0` disables. Needs `ResizeObserver`. */
  readonly collapseBelow?: number;
  /** Unit of the built-in `duration` column. Default `'days'`. */
  readonly durationUnit?: 'hours' | 'days';
  /** Default true. `false` freezes the widths: no drag handles, Alt+Arrow on a column header does
   *  nothing, the headers take no focus, and `resizeGridColumn` returns false. */
  readonly resizable?: boolean;
}

/**
 * Methods `withGrid` adds.
 *
 * @beta
 */
export interface GridCapability {
  /** The resolved columns in display order (a new array each call), whether or not `collapseBelow`
   *  currently hides all but `name`. */
  getGridColumns(): readonly GridColumn[];
  /** Replaces the columns with one repaint. Throws a `RangeError` for invalid input and then changes nothing. */
  setGridColumns(columns: readonly GridColumnInput[]): void;
  /** Sets one column's width (px, rounded, clamped to its `[minWidth, maxWidth]`) with one repaint and
   *  one `column:resized` event. Returns true when the width changed; false for an unknown id, a
   *  non-finite width, an unchanged width, or when `resizable` is false. Works headless and is not
   *  gated by `readOnly` (widths are view state, not data). Widths are never persisted by the library:
   *  save them from `column:resized` and pass them back as `width` in `columns`. Pointer: drag a header
   *  divider (Escape cancels, the width commits on release). Keyboard: Tab to the column headers,
   *  Left/Right/Home/End move between them, Alt+Left/Right resizes by 16 px (Alt+Shift 2 px; toward
   *  the chart grows, so Alt+Left in RTL). */
  resizeGridColumn(id: string, width: number): boolean;
  /** A CSV report of the configured columns: one row per task in tree order (collapsed rows
   *  included), built-in dates as `YYYY-MM-DD` in the calendar zone, duration in the column unit,
   *  progress as an integer percent, custom columns as the raw `value()`. Every header and cell is
   *  formula-escaped and RFC 4180 quoted. One-way: it is not importable. Works without a DOM. */
  exportGridCsv(): string;
}
