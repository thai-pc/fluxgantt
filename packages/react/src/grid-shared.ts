// Internal glue shared by `@fluxgantt/react/grid` and `/grid-editing`; NOT exported from any package entry.
// The default `@fluxgantt/react` entry never imports this file, so a chart without a grid pays 0 bytes.
//
// Contract (spec-grid-columns.md section 15):
//   - `gridColumns` / `gridOptions` are read at construction (`withGrid`); a LATER change of `gridColumns` is
//     applied with `setGridColumns` (one repaint, no remount) when the columns differ STRUCTURALLY: ids, widths,
//     headers, bounds, alignment and the IDENTITY of the `value` / `format` / `editor` functions.
//   - `gridOptions` (`collapseBelow`, `durationUnit`, `resizable`) are construction-only in core (no setter), so a
//     later change is dev-warned once and ignored; remount with `key` to apply it.
//   - A new `value` / `format` / `editor` function identity on every render is the inline-lambda mistake: it
//     re-applies the columns on every render. One dev warning per component (wrap in `useCallback` or define
//     the functions outside the component).
import { useEffect, useRef, type MutableRefObject } from 'react';
import { withGrid, DEFAULT_GRID_COLUMNS } from '@fluxgantt/core/grid';
import type { GridCapability, GridColumnInput, GridOptions } from '@fluxgantt/core/grid';
import type { ColumnResizedPayload, UnsubscribeFn } from '@fluxgantt/core';
import { useIsomorphicLayoutEffect, type BaseInstance } from './use-flux-gantt.js';

// See `use-flux-gantt.ts`: no `@types/node` dependency, bundlers replace the expression statically.
declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** Grid props shared by `FluxGanttGrid` and `FluxGanttGridEditing`. @beta */
export interface GridProps {
  /** Grid columns. Applied with `setGridColumns` when they change structurally (see the module comment of
   *  `grid-shared.ts`); keep the `value` / `format` / `editor` functions referentially stable. Default
   *  `name`, `start`, `end`, `duration`, `progress`. Invalid columns throw a `RangeError`. */
  readonly gridColumns?: readonly GridColumnInput[];
  /** `collapseBelow`, `durationUnit` and `resizable` of core's `GridOptions`. Construction-time only. */
  readonly gridOptions?: Omit<GridOptions, 'columns'>;
  /** Fires after a pointer drag, keyboard resize or `resizeGridColumn()` changed a width. Persist
   *  `payload.widths` yourself and pass them back as `width` in `gridColumns`. */
  readonly onColumnResized?: (payload: ColumnResizedPayload) => void;
}

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

/** `withGrid` for the hook's plugin: the options come from the FIRST render's props. */
export function composeGrid(
  base: BaseInstance,
  latest: { readonly current: GridProps },
): BaseInstance & GridCapability {
  const { gridColumns, gridOptions } = latest.current;
  return withGrid(base, { ...gridOptions, ...(gridColumns ? { columns: gridColumns } : {}) });
}

/** Subscribes `column:resized` (before `mount()`); the callback is always the latest prop. */
export function bridgeGrid(
  instance: GridCapability & BaseInstance,
  latest: { readonly current: GridProps },
): UnsubscribeFn[] {
  return [instance.on('column:resized', (p) => latest.current.onColumnResized?.(p))];
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
 *   reset a user resize; call `setGridColumns` on the ref, or change the widths, to reset);
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
          '[@fluxgantt/react] gridColumns: a column `value`, `format` or `editor` function changed identity ' +
            'on its own, so the columns are re-applied on every render: that repaints the grid each time, ' +
            'and an open cell editor is held back until it closes. Wrap the functions in `useCallback` or ' +
            'define them outside the component.',
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
      // `ref.current.destroy()`) is not worth taking the tree down for, as for `theme`.
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
 * remount, see `createColumnSync`), plus the one-shot dev warning for `gridOptions`.
 */
export function useGridProps(
  instance: GridCapability & { isEditingCell?: () => boolean },
  props: GridProps,
): void {
  const { gridColumns, gridOptions } = props;
  const sync: MutableRefObject<ColumnSync | null> = useRef(null);
  sync.current ??= createColumnSync(
    instance,
    () => instance.isEditingCell?.() ?? false,
    gridColumns,
  );
  useIsomorphicLayoutEffect(() => {
    const s = sync.current!;
    s.update(gridColumns);
    return () => s.stop();
  }, [instance, gridColumns]);

  const initialOptions = useRef(gridOptions);
  const warnedOptions = useRef(false);
  useEffect(() => {
    const first = initialOptions.current;
    if (warnedOptions.current) return;
    if (
      gridOptions?.collapseBelow !== first?.collapseBelow ||
      gridOptions?.durationUnit !== first?.durationUnit ||
      gridOptions?.resizable !== first?.resizable
    ) {
      warnedOptions.current = true;
      try {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '[@fluxgantt/react] gridOptions changed after the instance was created. `collapseBelow`, ' +
              '`durationUnit` and `resizable` are construction-time only (change `key` to remount).',
          );
        }
      } catch (e) {
        if (!(e instanceof ReferenceError)) throw e;
      }
    }
  }, [gridOptions?.collapseBelow, gridOptions?.durationUnit, gridOptions?.resizable]);
}
