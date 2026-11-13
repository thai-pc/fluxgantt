// Fixture measured by `pnpm size` (see .size-limit.soft.json): base facade + render + the opt-in grid
// mixin, i.e. a painted chart with configurable columns and the CSV report.
// Do NOT add anything else here — this file IS the budget.
import { createGantt } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withGrid } from '@fluxgantt/core/grid';

const gantt = withGrid(withRender(createGantt({ tasks: [], dependencies: [] })), {
  columns: [{ id: 'name' }, { id: 'start' }, { id: 'owner', header: 'Owner', value: (t) => t.meta?.owner }],
});
gantt.mount(document.body);
globalThis.out = [gantt.getGridColumns(), gantt.exportGridCsv(), gantt.setGridColumns];
