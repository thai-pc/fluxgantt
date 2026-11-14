// `@fluxgantt/react/grid-editing` — `<FluxGanttGridEditing>`: `<FluxGanttGrid>` plus core's `withGridEditing`
// (`@fluxgantt/core/grid-editing`, composed AFTER `withGrid`). A separate entry so neither the default bundle nor
// the grid entry carries the editing code. `@beta`, like the core grid.
import {
  forwardRef,
  useEffect,
  useRef,
  useImperativeHandle,
  type ReactElement,
  type CSSProperties,
  type RefObject,
} from 'react';
import { withGridEditing } from '@fluxgantt/core/grid-editing';
import type {
  CellEditRequestedPayload,
  GridEditingCapability,
  GridEditingOptions,
} from '@fluxgantt/core/grid-editing';
import type { GridCapability } from '@fluxgantt/core/grid';
import type { UnsubscribeFn } from '@fluxgantt/core';

// See `use-flux-gantt.ts`: no `@types/node` dependency; bundlers replace the expression statically.
declare const process: { readonly env: { readonly NODE_ENV?: string } };
import { useGantt, type BaseInstance, type GanttPlugin } from './use-flux-gantt.js';
import { bridgeGrid, composeGrid, useGridProps } from './grid-shared.js';
import type { UseFluxGanttGridConfig } from './grid.js';
import type { FluxGanttRef } from './types.js';

/** Editing props on top of the grid props. @beta */
export interface GridEditingProps {
  /** `isEditable`, `beforeCommit`, `activate`, `commitOnBlur` of core's `GridEditingOptions`. Construction-time
   *  (`activate`, `commitOnBlur`); `isEditable` and `beforeCommit` follow the latest render once they were
   *  set on the first one, so inline arrows are fine there. */
  readonly gridEditing?: GridEditingOptions;
  /** Fires BEFORE the built-in editor opens (Enter or F2 on an editable cell, double-click). Call
   *  `payload.preventDefault()` synchronously to open your own editor instead. */
  readonly onCellEditRequested?: (payload: CellEditRequestedPayload) => void;
}

/** Config of `useFluxGanttGridEditing`: the grid config plus the editing props. @beta */
export interface UseFluxGanttGridEditingConfig extends UseFluxGanttGridConfig, GridEditingProps {}

/** Props of `<FluxGanttGridEditing>`. @beta */
export interface FluxGanttGridEditingProps extends UseFluxGanttGridEditingConfig {
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** The ref of `<FluxGanttGridEditing>`: the grid ref plus `startCellEdit`, `cancelCellEdit` and
 *  `isEditingCell`. @beta */
export type FluxGanttGridEditingRef = FluxGanttRef & GridCapability & GridEditingCapability;

/** What `useFluxGanttGridEditing` returns. @beta */
export interface UseFluxGanttGridEditingResult {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly instance: FluxGanttGridEditingRef;
}

type Config = UseFluxGanttGridEditingConfig;
type Instance = BaseInstance & GridCapability & GridEditingCapability;

/** The editing options of the FIRST render, with the two host callbacks routed through the latest props. */
function editingOptions(latest: { readonly current: Config }): GridEditingOptions {
  const o = latest.current.gridEditing;
  if (!o) return {};
  const { isEditable, beforeCommit } = o;
  return {
    ...o,
    ...(isEditable && {
      isEditable: (task, columnId) =>
        latest.current.gridEditing?.isEditable?.(task, columnId) ?? true,
    }),
    ...(beforeCommit && {
      beforeCommit: (edit) => latest.current.gridEditing?.beforeCommit?.(edit),
    }),
  };
}

const plugin: GanttPlugin<Config, Instance> = {
  label: 'useFluxGanttGridEditing/<FluxGanttGridEditing>',
  // `withGridEditing` throws when `withGrid` is not applied first.
  compose: (base, latest) => withGridEditing(composeGrid(base, latest), editingOptions(latest)),
  bridge: (instance, latest): UnsubscribeFn[] => [
    ...bridgeGrid(instance, latest),
    instance.on('cell:edit-requested', (p) => latest.current.onCellEditRequested?.(p)),
  ],
};

/** One dev warning when an option that is read once changes, or a latest-following callback appears late. */
function useEditingOptionsWarning(options: GridEditingOptions | undefined): void {
  const first = useRef(options);
  const warned = useRef(false);
  const activate = options?.activate?.join();
  useEffect(() => {
    const o = first.current;
    if (warned.current) return;
    if (
      activate !== o?.activate?.join() ||
      options?.commitOnBlur !== o?.commitOnBlur ||
      (!o?.isEditable && options?.isEditable) ||
      (!o?.beforeCommit && options?.beforeCommit)
    ) {
      warned.current = true;
      try {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '[@fluxgantt/react] gridEditing: `activate` and `commitOnBlur` are construction-time only, and ' +
              '`isEditable` / `beforeCommit` are only honoured when they were set on the first render ' +
              '(after that they follow the latest render). The change is ignored; change `key` to remount.',
          );
        }
      } catch (e) {
        if (!(e instanceof ReferenceError)) throw e;
      }
    }
  }, [activate, options?.commitOnBlur, options?.isEditable, options?.beforeCommit]);
}

/** `useFluxGantt` with the grid and the cell editors composed. @beta */
export function useFluxGanttGridEditing(
  config: UseFluxGanttGridEditingConfig,
): UseFluxGanttGridEditingResult {
  const result = useGantt(config, plugin);
  useGridProps(result.instance, config);
  useEditingOptionsWarning(config.gridEditing);
  return result;
}

/**
 * `<FluxGanttGrid>` with inline cell editing (`@fluxgantt/core/grid-editing`). Adds `gridEditing` and
 * `onCellEditRequested` (call `payload.preventDefault()` to replace the built-in editor) and the ref methods
 * `startCellEdit`, `cancelCellEdit` and `isEditingCell`.
 *
 * @beta
 */
export const FluxGanttGridEditing = forwardRef<FluxGanttGridEditingRef, FluxGanttGridEditingProps>(
  function FluxGanttGridEditing({ className, style, ...config }, forwardedRef): ReactElement {
    const { ref: containerRef, instance } = useFluxGanttGridEditing(config);
    useImperativeHandle(forwardedRef, () => instance, [instance]);
    return (
      <div
        ref={containerRef}
        className={className ? `fg-gantt ${className}` : 'fg-gantt'}
        style={style}
      />
    );
  },
);

export type {
  CellEditRequestedPayload,
  CellEditCommit,
  GridEditingCapability,
  GridEditingOptions,
  CellEditor,
} from '@fluxgantt/core/grid-editing';
export type {
  GridProps,
  UseFluxGanttGridConfig,
  UseFluxGanttConfig,
  FluxGanttRef,
  GridCapability,
  GridColumn,
  GridColumnInput,
  ColumnResizedPayload,
} from './grid.js';
