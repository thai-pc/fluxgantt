// Internal glue shared by `@fluxgantt/vue/grid` and `/grid-editing`; NOT exported from any package entry.
// The default `@fluxgantt/vue` entry never imports this file, so a chart without a grid pays 0 bytes.
//
// Contract (spec-grid-columns.md section 15; a sibling copy lives in the React package, duplicating ~60 lines is
// cheaper than a new shared export):
//   - `gridColumns` / `gridOptions` are read at construction (`withGrid`); a LATER change of `gridColumns` (a new
//     array, or an in-place mutation of a reactive one) is applied with `setGridColumns` (one repaint, no remount)
//     when the columns differ STRUCTURALLY: ids, widths, headers, bounds, alignment and the IDENTITY of the
//     `value` / `format` / `editor` functions.
//   - `gridOptions` (`collapseBelow`, `durationUnit`, `resizable`) are construction-only in core (no setter), so a
//     later change is dev-warned once and ignored; remount with `:key` to apply it.
//   - A new `value` / `format` / `editor` function identity on every change is the inline-lambda mistake: one dev
//     warning per component (define the functions outside `setup` / outside the template expression).
import {
  onBeforeUnmount,
  toRaw,
  watch,
  type ComponentObjectPropsOptions,
  type PropType,
} from 'vue';
import { withGrid, DEFAULT_GRID_COLUMNS } from '@fluxgantt/core/grid';
import type { GridCapability, GridColumnInput, GridOptions } from '@fluxgantt/core/grid';
import type { BaseInstance } from './use-flux-gantt.js';

// See `use-flux-gantt.ts`: no `@types/node` dependency, bundlers replace the expression statically.
declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** Grid props shared by `FluxGanttGrid` and `FluxGanttGridEditing`. @beta */
export interface GridProps {
  /** Grid columns. Applied with `setGridColumns` when they change structurally; keep the `value` / `format` /
   *  `editor` functions referentially stable. Default `name`, `start`, `end`, `duration`, `progress`. */
  readonly gridColumns?: readonly GridColumnInput[];
  /** `collapseBelow`, `durationUnit` and `resizable` of core's `GridOptions`. Construction-time only. */
  readonly gridOptions?: Omit<GridOptions, 'columns'>;
}

/** Props the grid components add to `<FluxGantt>`'s. */
export const gridProps = {
  gridColumns: { type: Array as PropType<readonly GridColumnInput[]>, required: false },
  gridOptions: { type: Object as PropType<NonNullable<GridProps['gridOptions']>>, required: false },
} satisfies ComponentObjectPropsOptions;

export type ColumnsDiff = 'same' | 'changed' | 'functions';

const DATA_KEYS = ['id', 'header', 'width', 'minWidth', 'maxWidth', 'align'] as const;
const EDITOR_DATA_KEYS = ['type', 'maxLength', 'min', 'max'] as const;
type Rec = Readonly<Record<string, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;

function diffColumn(a: GridColumnInput, b: GridColumnInput): ColumnsDiff {
  const x = a as unknown as Rec;
  const y = b as unknown as Rec;
  for (const k of DATA_KEYS) if (x[k] !== y[k]) return 'changed';
  let fn = x['value'] !== y['value'] || x['format'] !== y['format'];
  const ea = x['editor'];
  const eb = y['editor'];
  if (ea !== eb) {
    if (!isRec(ea) || !isRec(eb)) return 'changed';
    for (const k of EDITOR_DATA_KEYS) if (ea[k] !== eb[k]) return 'changed';
    if (ea['initial'] !== eb['initial'] || ea['commit'] !== eb['commit']) fn = true;
  }
  return fn ? 'functions' : 'same';
}

/**
 * Structural comparison of two column lists: `'changed'` when anything but a function identity differs (the
 * list length, an id, a width, a header, a bound, the alignment, an editor's data), `'functions'` when only a
 * `value` / `format` / `editor` function identity differs, else `'same'`.
 */
export function diffColumns(
  a: readonly GridColumnInput[] | undefined,
  b: readonly GridColumnInput[] | undefined,
): ColumnsDiff {
  const prev = a ?? DEFAULT_GRID_COLUMNS;
  const next = b ?? DEFAULT_GRID_COLUMNS;
  if (prev === next) return 'same';
  if (prev.length !== next.length) return 'changed';
  let out: ColumnsDiff = 'same';
  for (let i = 0; i < prev.length; i++) {
    const d = diffColumn(prev[i]!, next[i]!);
    if (d === 'changed') return d;
    if (d === 'functions') out = d;
  }
  return out;
}

/**
 * A plain one-level copy of the columns (and of each editor), so a later in-place mutation of a reactive
 * source cannot change what was last applied.
 */
export function snapshotColumns(
  columns: readonly GridColumnInput[] | undefined,
): readonly GridColumnInput[] | undefined {
  return columns?.map((c) => {
    const copy = { ...toRaw(c) } as Record<string, unknown>;
    if (isRec(copy['editor'])) copy['editor'] = { ...copy['editor'] };
    return copy as unknown as GridColumnInput;
  });
}

/** `withGrid` for the composable's plugin: the options come from the props at construction. */
export function composeGrid(base: BaseInstance, props: GridProps): BaseInstance & GridCapability {
  const { gridColumns, gridOptions } = props;
  return withGrid(base, {
    ...(gridOptions && toRaw(gridOptions)),
    ...(gridColumns ? { columns: snapshotColumns(gridColumns)! } : {}),
  });
}

/** Reads the live widths so a re-apply never throws away what the user dragged (see `createColumnSync`). */
function withLiveWidths(
  instance: GridCapability,
  prev: readonly GridColumnInput[] | undefined,
  next: readonly GridColumnInput[] | undefined,
): readonly GridColumnInput[] {
  const before = prev ?? DEFAULT_GRID_COLUMNS;
  const live = new Map(instance.getGridColumns().map((c) => [c.id as string, c.width]));
  return (next ?? DEFAULT_GRID_COLUMNS).map((col) => {
    const old = before.find((c) => c.id === col.id);
    const width = live.get(col.id);
    // The prop's declared width wins only when the HOST changed it; otherwise the live width stays.
    return old && old.width === col.width && width !== undefined ? { ...col, width } : col;
  });
}

/** True when `setGridColumns` would throw because the host destroyed the instance. */
function isDestroyed(instance: GridCapability): boolean {
  try {
    instance.resizeGridColumn('', 0); // asserts alive first, then returns false for the unknown id
    return false;
  } catch {
    return true;
  }
}

export interface ColumnSync {
  update(columns: readonly GridColumnInput[] | undefined): void;
  stop(): void;
}

/**
 * Applies `gridColumns` changes to a live grid without losing user state:
 * - a re-apply keeps the LIVE width of every column whose declared `width` did not change; a column
 *   whose declared width changed takes the new one (re-passing the original columns therefore does not
 *   reset a user resize; call `setGridColumns` on the exposed instance, or change the widths, to reset);
 * - while a cell is being edited the re-apply waits (`setGridColumns` would close the editor and drop
 *   the typed text) and happens once, with the latest columns, when the edit ends;
 * - one dev warning when only a function identity changed (the inline-lambda mistake).
 */
export function createColumnSync(
  instance: GridCapability,
  isEditing: () => boolean,
  initial: readonly GridColumnInput[] | undefined,
): ColumnSync {
  let applied = initial;
  let latest = initial;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let warned = false;
  const flush = (): void => {
    timer = undefined;
    const diff = diffColumns(applied, latest);
    if (diff === 'same') return;
    try {
      if (diff === 'functions' && !warned && process.env.NODE_ENV !== 'production') {
        warned = true;
        console.warn(
          '[@fluxgantt/vue] gridColumns: a column `value`, `format` or `editor` function changed identity ' +
            'on its own, so the columns are re-applied on every change: that repaints the grid each time, ' +
            'and an open cell editor is held back until it closes. Define the functions once, outside ' +
            '`setup` and outside the template expression.',
        );
      }
    } catch (e) {
      if (!(e instanceof ReferenceError)) throw e;
    }
    if (isEditing()) {
      timer = setTimeout(flush, 50);
      return;
    }
    const prev = applied;
    applied = latest;
    try {
      instance.setGridColumns(withLiveWidths(instance, prev, latest));
    } catch (err) {
      // Invalid columns are the host's bug and must surface; a destroyed instance (the host called
      // `destroy()` on the exposed ref) is not worth taking the tree down for, as for `theme`.
      if (!isDestroyed(instance)) throw err;
    }
  };
  return {
    update(columns) {
      latest = columns;
      if (timer === undefined) flush();
    },
    stop() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/**
 * Keeps the grid in step with the props after construction: `gridColumns` through `setGridColumns` (never a
 * remount, see `createColumnSync`), plus the one-shot dev warning for `gridOptions`. Call from `setup()`.
 */
export function useGridProps(
  instance: GridCapability & { isEditingCell?: () => boolean },
  props: GridProps,
): void {
  const sync = createColumnSync(
    instance,
    () => instance.isEditingCell?.() ?? false,
    snapshotColumns(props.gridColumns),
  );
  watch(
    () => props.gridColumns,
    (columns) => sync.update(snapshotColumns(columns)),
    { deep: true },
  );
  onBeforeUnmount(() => sync.stop());

  try {
    if (process.env.NODE_ENV !== 'production') {
      const first = props.gridOptions;
      let warned = false;
      watch(
        () => [
          props.gridOptions?.collapseBelow,
          props.gridOptions?.durationUnit,
          props.gridOptions?.resizable,
        ],
        ([collapseBelow, durationUnit, resizable]) => {
          if (
            warned ||
            (collapseBelow === first?.collapseBelow &&
              durationUnit === first?.durationUnit &&
              resizable === first?.resizable)
          )
            return;
          warned = true;
          console.warn(
            '[@fluxgantt/vue] gridOptions changed after the instance was created. `collapseBelow`, ' +
              '`durationUnit` and `resizable` are construction-time only (change `:key` to remount).',
          );
        },
      );
    }
  } catch (e) {
    if (!(e instanceof ReferenceError)) throw e;
  }
}
