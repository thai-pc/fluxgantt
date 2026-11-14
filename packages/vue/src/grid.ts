// `@fluxgantt/vue/grid` — `<FluxGanttGrid>`: `<FluxGantt>` composing core's `withGrid` (`@fluxgantt/core/grid`).
// A separate entry so the default `@fluxgantt/vue` bundle carries no grid code. `@beta`, like the core grid.
import { defineComponent, h, onBeforeUnmount, type Ref } from 'vue';
import type { GridCapability } from '@fluxgantt/core/grid';
import type { ColumnResizedPayload, GanttConfig } from '@fluxgantt/core';
import { useGantt, type BaseInstance, type GanttPlugin } from './use-flux-gantt.js';
import { bridgeGantt, exposableInstance, ganttEmits, ganttProps, type Emit } from './FluxGantt.js';
import { composeGrid, gridProps, useGridProps, type GridProps } from './grid-shared.js';
import type { FluxGanttEmits, FluxGanttRef } from './types.js';

/** Config of `useFluxGanttGrid`: every `useFluxGantt` option plus the grid props. @beta */
export type UseFluxGanttGridConfig = GanttConfig & GridProps;

/** Props of `<FluxGanttGrid>`: `GanttConfig` plus `gridColumns` and `gridOptions`. @beta */
export type FluxGanttGridProps = UseFluxGanttGridConfig;

/** The template ref of `<FluxGanttGrid>`: the full instance plus `getGridColumns`, `setGridColumns`,
 *  `resizeGridColumn` and `exportGridCsv`. @beta */
export type FluxGanttGridRef = FluxGanttRef & GridCapability;

/** What `useFluxGanttGrid` returns. @beta */
export interface UseFluxGanttGridResult {
  readonly containerRef: Ref<HTMLDivElement | null>;
  readonly instance: FluxGanttGridRef;
}

/** The extra emit of the grid component. @beta */
export interface FluxGanttGridEmits extends FluxGanttEmits {
  /** After a pointer drag, keyboard resize or `resizeGridColumn()` changed a width. Persist `payload.widths`
   *  yourself and pass them back as `width` in `gridColumns`. */
  (event: 'column-resized', payload: ColumnResizedPayload): void;
}

const plugin: GanttPlugin<UseFluxGanttGridConfig, BaseInstance & GridCapability> = {
  compose: composeGrid,
  label: 'useFluxGanttGrid/<FluxGanttGrid>',
};

/** `useFluxGantt` with the grid composed. @beta */
export function useFluxGanttGrid(config: UseFluxGanttGridConfig): UseFluxGanttGridResult {
  const result = useGantt(config, plugin);
  useGridProps(result.instance, config);
  return result;
}

/**
 * `<FluxGantt>` with the grid columns of `@fluxgantt/core/grid`. Same props, emits and exposed methods as
 * `<FluxGantt>`, plus the `gridColumns` and `gridOptions` props, the `column-resized` emit and
 * `getGridColumns` / `setGridColumns` / `resizeGridColumn` / `exportGridCsv`. A `gridColumns` change is applied
 * with `setGridColumns` (no remount); keep the column `value` / `format` / `editor` functions referentially
 * stable.
 *
 * @beta
 */
export const FluxGanttGrid = defineComponent({
  name: 'FluxGanttGrid',
  props: { ...ganttProps, ...gridProps },
  emits: {
    ...ganttEmits,
    'column-resized': (_payload: ColumnResizedPayload) => true,
  },
  setup(props, { emit, expose }) {
    const { containerRef, instance } = useFluxGanttGrid(props as UseFluxGanttGridConfig);
    // Compile-time tie between the runtime `emits` above and the documented `FluxGanttGridEmits`: this
    // assignment fails to type-check if they drift apart.
    const typedEmit: FluxGanttGridEmits = emit;
    // Subscribed in setup(), before `useGantt`'s onMounted runs `mount()` (see FluxGantt.ts).
    const unsubs = [
      ...bridgeGantt(instance, emit as unknown as Emit),
      instance.on('column:resized', (payload) => typedEmit('column-resized', payload)),
    ];
    onBeforeUnmount(() => {
      for (const unsub of unsubs) unsub();
    });
    expose(exposableInstance(instance));
    return () => h('div', { ref: containerRef, class: 'fg-gantt' });
  },
});

export type { GridProps, FluxGanttRef, GanttConfig };
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
