// `@fluxgantt/react/grid` — `<FluxGanttGrid>`: `<FluxGantt>` composing core's `withGrid` (`@fluxgantt/core/grid`).
// A separate entry so the default `@fluxgantt/react` bundle carries no grid code. `@beta`, like the core grid.
import {
  forwardRef,
  useImperativeHandle,
  type ReactElement,
  type CSSProperties,
  type RefObject,
} from 'react';
import type { GridCapability } from '@fluxgantt/core/grid';
import { useGantt, type BaseInstance, type GanttPlugin } from './use-flux-gantt.js';
import { bridgeGrid, composeGrid, useGridProps, type GridProps } from './grid-shared.js';
import type { FluxGanttRef, UseFluxGanttConfig } from './types.js';

/** Config of `useFluxGanttGrid`: every `useFluxGantt` option plus the grid props. @beta */
export interface UseFluxGanttGridConfig extends UseFluxGanttConfig, GridProps {}

/** Props of `<FluxGanttGrid>`. @beta */
export interface FluxGanttGridProps extends UseFluxGanttGridConfig {
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** The ref of `<FluxGanttGrid>`: the full instance plus `getGridColumns`, `setGridColumns`,
 *  `resizeGridColumn` and `exportGridCsv`. @beta */
export type FluxGanttGridRef = FluxGanttRef & GridCapability;

/** What `useFluxGanttGrid` returns. @beta */
export interface UseFluxGanttGridResult {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly instance: FluxGanttGridRef;
}

const plugin: GanttPlugin<UseFluxGanttGridConfig, BaseInstance & GridCapability> = {
  compose: composeGrid,
  bridge: bridgeGrid,
  label: 'useFluxGanttGrid/<FluxGanttGrid>',
};

/** `useFluxGantt` with the grid composed. @beta */
export function useFluxGanttGrid(config: UseFluxGanttGridConfig): UseFluxGanttGridResult {
  const result = useGantt(config, plugin);
  useGridProps(result.instance, config);
  return result;
}

/**
 * `<FluxGantt>` with the grid columns of `@fluxgantt/core/grid`. Same props and ref as `<FluxGantt>`, plus
 * `gridColumns`, `gridOptions` and `onColumnResized`. A `gridColumns` change is applied with `setGridColumns`
 * (no remount); keep the column `value` / `format` / `editor` functions referentially stable.
 *
 * @beta
 */
export const FluxGanttGrid = forwardRef<FluxGanttGridRef, FluxGanttGridProps>(
  function FluxGanttGrid({ className, style, ...config }, forwardedRef): ReactElement {
    const { ref: containerRef, instance } = useFluxGanttGrid(config);
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

export type { GridProps, FluxGanttRef, UseFluxGanttConfig };
export type {
  GridCapability,
  GridColumn,
  GridColumnInput,
  BuiltInColumn,
  BuiltInColumnId,
  CustomColumn,
  CellEditor,
  ColumnAlign,
  ColumnId,
  GridCellContext,
  GridOptions,
} from '@fluxgantt/core/grid';
export type { ColumnResizedPayload } from '@fluxgantt/core';
