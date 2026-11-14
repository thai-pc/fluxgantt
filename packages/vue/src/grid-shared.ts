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
import { toRaw, watch, type ComponentObjectPropsOptions, type PropType } from 'vue';
import { withGrid, DEFAULT_GRID_COLUMNS } from '@fluxgantt/core/grid';
import type { GridCapability, GridColumnInput, GridOptions } from '@fluxgantt/core/grid';
import type { BaseInstance } from './use-flux-gantt.js';

// See `use-flux-gantt.ts`: no `@types/node` dependency, bundlers replace the expression statically.
declare const process: { readonly env?: { readonly NODE_ENV?: string } } | undefined;
const isDev = (): boolean =>
  !(typeof process !== 'undefined' && process.env?.NODE_ENV === 'production');

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

/**
 * Keeps the grid in step with the props after construction: `gridColumns` through `setGridColumns` (never a
 * remount), plus the one-shot dev warnings. Call from `setup()`.
 */
export function useGridProps(instance: GridCapability, props: GridProps): void {
  let applied = snapshotColumns(props.gridColumns);
  let warnedFns = false;
  watch(
    () => props.gridColumns,
    (columns) => {
      const next = snapshotColumns(columns);
      const diff = diffColumns(applied, next);
      applied = next;
      if (diff === 'same') return;
      if (diff === 'functions' && !warnedFns && isDev()) {
        warnedFns = true;
        console.warn(
          '[@fluxgantt/vue] gridColumns: a column `value`, `format` or `editor` function changed identity ' +
            'while everything else stayed the same, so the columns are re-applied on every change. Define ' +
            'the functions once, outside `setup` and outside the template expression.',
        );
      }
      try {
        instance.setGridColumns(next ?? DEFAULT_GRID_COLUMNS);
      } catch (err) {
        // Invalid columns are the host's bug and must surface; a destroyed instance (the host called
        // `destroy()` on the exposed ref) is not worth taking the tree down for, as for `theme`.
        if (err instanceof RangeError) throw err;
      }
    },
    { deep: true },
  );

  if (isDev()) {
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
}
