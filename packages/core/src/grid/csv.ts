// `exportGridCsv` (spec-grid-columns.md section 8.3). Pure and DOM-free. A one-way report of what the
// grid shows, NOT the interchange format (that is `exportCsv`, which round-trips through `importCsv`).
// Every header and cell goes through the same formula-injection escape and RFC 4180 quoting as the
// interchange export (security.md section 2).
import { writeRow } from '../io/csv.js';
import { layoutRows } from '../render/renderer-base.js';
import type { Task } from '../types.js';
import type { Column } from './columns.js';
import type { GridValues } from './values.js';

/** `tasks` as a CSV report of `cols`, one row per task in tree order (collapsed rows included). */
export function gridCsv(tasks: readonly Task[], cols: readonly Column[], values: GridValues): string {
  let ordered: readonly Task[] = tasks;
  try {
    ordered = layoutRows(tasks, 'default', undefined).map((r) => r.task);
  } catch {
    // a cyclic parent chain: fall back to insertion order rather than refuse the export
  }
  return [writeRow(cols.map((c) => c.header)), ...ordered.map((t) => writeRow(values.raw(t, cols)))].join(
    '\r\n',
  );
}
