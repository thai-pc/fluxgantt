// `@fluxgantt/vue/grid-editing` — `<FluxGanttGridEditing>`: `<FluxGanttGrid>` plus core's `withGridEditing`
// (`@fluxgantt/core/grid-editing`, composed AFTER `withGrid`). A separate entry so neither the default bundle nor
// the grid entry carries the editing code. `@beta`, like the core grid.
import { defineComponent, h, onBeforeUnmount, type PropType, type Ref } from 'vue';
import { withGridEditing } from '@fluxgantt/core/grid-editing';
import type {
  CellEditRequestedPayload,
  GridEditingCapability,
  GridEditingOptions,
} from '@fluxgantt/core/grid-editing';
import type { GridCapability } from '@fluxgantt/core/grid';
import type { ColumnResizedPayload } from '@fluxgantt/core';
import { useGantt, type BaseInstance, type GanttPlugin } from './use-flux-gantt.js';
import { bridgeGantt, exposableInstance, ganttEmits, ganttProps, type Emit } from './FluxGantt.js';
import { composeGrid, gridProps, useGridProps } from './grid-shared.js';
import type { UseFluxGanttGridConfig } from './grid.js';
import type { FluxGanttRef } from './types.js';

/** Editing props on top of the grid props. @beta */
export interface GridEditingProps {
  /** `isEditable`, `beforeCommit`, `activate`, `commitOnBlur` of core's `GridEditingOptions`. Construction-time
   *  (`activate`, `commitOnBlur`); `isEditable` and `beforeCommit` follow the latest prop value once they were
   *  set at construction. */
  readonly gridEditing?: GridEditingOptions;
}

/** Config of `useFluxGanttGridEditing`: the grid config plus the editing props. @beta */
export type UseFluxGanttGridEditingConfig = UseFluxGanttGridConfig & GridEditingProps;

/** Props of `<FluxGanttGridEditing>`. @beta */
export type FluxGanttGridEditingProps = UseFluxGanttGridEditingConfig;

/** The template ref of `<FluxGanttGridEditing>`: the grid ref plus `startCellEdit`, `cancelCellEdit` and
 *  `isEditingCell`. @beta */
export type FluxGanttGridEditingRef = FluxGanttRef & GridCapability & GridEditingCapability;

/** What `useFluxGanttGridEditing` returns. @beta */
export interface UseFluxGanttGridEditingResult {
  readonly containerRef: Ref<HTMLDivElement | null>;
  readonly instance: FluxGanttGridEditingRef;
}

/** The emits the editing component adds to the grid component's. @beta */
export interface FluxGanttGridEditingEmits {
  /** After a pointer drag, keyboard resize or `resizeGridColumn()` changed a width. */
  (event: 'column-resized', payload: ColumnResizedPayload): void;
  /** Fires BEFORE the built-in editor opens (Enter or F2 on an editable cell, double-click). Call
   *  `payload.preventDefault()` synchronously to open your own editor instead. */
  (event: 'cell-edit-requested', payload: CellEditRequestedPayload): void;
}

type Config = UseFluxGanttGridEditingConfig;

/** The editing options at construction, with the two host callbacks read from the latest props. */
function editingOptions(config: Config): GridEditingOptions {
  const o = config.gridEditing;
  if (!o) return {};
  const { isEditable, beforeCommit } = o;
  return {
    ...o,
    ...(isEditable && {
      isEditable: (task, columnId) => config.gridEditing?.isEditable?.(task, columnId) ?? true,
    }),
    ...(beforeCommit && {
      beforeCommit: (edit) => config.gridEditing?.beforeCommit?.(edit),
    }),
  };
}

const plugin: GanttPlugin<Config, BaseInstance & GridCapability & GridEditingCapability> = {
  // `withGridEditing` throws when `withGrid` is not applied first.
  compose: (base, config) => withGridEditing(composeGrid(base, config), editingOptions(config)),
};

/** `useFluxGantt` with the grid and the cell editors composed. @beta */
export function useFluxGanttGridEditing(
  config: UseFluxGanttGridEditingConfig,
): UseFluxGanttGridEditingResult {
  const result = useGantt(config, plugin);
  useGridProps(result.instance, config);
  return result;
}

/**
 * `<FluxGanttGrid>` with inline cell editing (`@fluxgantt/core/grid-editing`). Adds the `gridEditing` prop, the
 * `cell-edit-requested` emit (call `payload.preventDefault()` to replace the built-in editor) and the exposed
 * methods `startCellEdit`, `cancelCellEdit` and `isEditingCell`.
 *
 * @beta
 */
export const FluxGanttGridEditing = defineComponent({
  name: 'FluxGanttGridEditing',
  props: {
    ...ganttProps,
    ...gridProps,
    gridEditing: { type: Object as PropType<GridEditingOptions>, required: false },
  },
  emits: {
    ...ganttEmits,
    'column-resized': (_payload: ColumnResizedPayload) => true,
    'cell-edit-requested': (_payload: CellEditRequestedPayload) => true,
  },
  setup(props, { emit, expose }) {
    const { containerRef, instance } = useFluxGanttGridEditing(
      props as UseFluxGanttGridEditingConfig,
    );
    const unsubs = [
      ...bridgeGantt(instance, emit as unknown as Emit),
      instance.on('column:resized', (payload) => emit('column-resized', payload)),
      instance.on('cell:edit-requested', (payload) => emit('cell-edit-requested', payload)),
    ];
    onBeforeUnmount(() => {
      for (const unsub of unsubs) unsub();
    });
    expose(exposableInstance(instance));
    return () => h('div', { ref: containerRef, class: 'fg-gantt' });
  },
});

export type {
  CellEditRequestedPayload,
  CellEditCommit,
  GridEditingCapability,
  GridEditingOptions,
  CellEditor,
} from '@fluxgantt/core/grid-editing';
export type { GridProps } from './grid-shared.js';
export type { UseFluxGanttGridConfig } from './grid.js';
export type { FluxGanttRef } from './types.js';
export type { GridCapability, GridColumn, GridColumnInput, ColumnResizedPayload } from './grid.js';
