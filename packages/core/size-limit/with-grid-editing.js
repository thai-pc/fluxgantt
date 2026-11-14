// Fixture measured by `pnpm size` (see .size-limit.soft.json): an editable chart (render + interaction) with the
// opt-in grid and its inline cell editors, i.e. the eager shell only (the editor code is a lazy chunk, `external`
// like the Canvas chunks).
// Do NOT add anything else here — this file IS the budget.
import { createGantt } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withGrid } from '@fluxgantt/core/grid';
import { withGridEditing } from '@fluxgantt/core/grid-editing';

const gantt = withGridEditing(
  withGrid(withInteraction(withRender(createGantt({ tasks: [], dependencies: [] }))), {
    columns: [{ id: 'name' }, { id: 'start' }, { id: 'owner', header: 'Owner', value: (t) => t.meta?.owner }],
  }),
);
gantt.mount(document.body);
globalThis.out = [gantt.getGridColumns(), gantt.exportGridCsv(), gantt.setGridColumns, gantt.startCellEdit, gantt.cancelCellEdit, gantt.isEditingCell];
