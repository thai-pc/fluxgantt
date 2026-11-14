// Public types of the grid cell editors (spec-grid-columns.md section 2.2). Type-only: 0 runtime bytes.
import type { TaskPatch } from '../store/index.js';
import type { Task, TaskId } from '../types.js';

/**
 * What `GridEditingOptions.beforeCommit` sees: the edit that is about to be written.
 *
 * @beta
 */
export interface CellEditCommit {
  readonly taskId: TaskId;
  readonly columnId: string;
  /** The parsed input: text for `name` and text editors, `YYYY-MM-DD` for dates, a number for `duration`,
   *  `progress` (percent) and number editors. */
  readonly input: string | number;
  /** The fields the write changes (`start`/`end` for a start edit, `end`/`duration` for an end or duration edit,
   *  `progress` as a fraction). Informational: the write is one `updateTask`, `resizeTask` or `setProgress`. */
  readonly patch: Readonly<TaskPatch>;
}

/**
 * Options of `withGridEditing`.
 *
 * @beta
 */
export interface GridEditingOptions {
  /** Per-cell gate, evaluated when an edit is requested, on top of the built-in rules (a summary's start, end,
   *  duration and progress are rolled up and never editable; a milestone has no end or duration). It can only
   *  narrow. Default: every editable cell. */
  readonly isEditable?: (task: Readonly<Task>, columnId: string) => boolean;
  /** Host validation before the write. Return a message to block the commit and show it as the inline error
   *  (capped at 200 characters, shown as text); return nothing to allow. Must not mutate the store. */
  readonly beforeCommit?: (edit: CellEditCommit) => string | void;
  /** The gestures that start an edit. Default `['enter', 'f2', 'dblclick']` (`dblclick` is a double-click or a
   *  double-tap on a pinned cell). */
  readonly activate?: readonly ('enter' | 'f2' | 'dblclick')[];
  /** Commit when the field loses focus and holds a valid value (default true). An invalid value is discarded
   *  and announced. `false` discards on blur. */
  readonly commitOnBlur?: boolean;
}

/**
 * Methods `withGridEditing` adds.
 *
 * @beta
 */
export interface GridEditingCapability {
  /** Opens the editor on a cell of the mounted chart. Returns false when the cell is not editable (unknown task
   *  or column, a `readOnly` chart, a column hidden by `collapseBelow`, a rolled-up summary cell, `isEditable`)
   *  or the chart is not mounted. The editor code loads on first use, so the first call returns true before
   *  `cell:edit-requested` has fired; once it has loaded, a veto by the host (`preventDefault()`) or a row that
   *  is not on screen (Canvas) returns false. Closes an open editor first, committing it. */
  startCellEdit(taskId: TaskId, columnId: string): boolean;
  /** Closes the open editor without writing. */
  cancelCellEdit(): void;
  /** True while an editor is open. */
  isEditingCell(): boolean;
}
