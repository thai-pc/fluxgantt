// Fixture measured by `pnpm size` (see .size-limit.json): base facade + render + the opt-in
// edit-hooks mixin, i.e. a painted chart that emits task:activated / task:context-requested.
// Do NOT add anything else here — this file IS the budget.
import { createGantt } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withEditHooks } from '@fluxgantt/core/edit-hooks';

const gantt = withEditHooks(withRender(createGantt({ tasks: [], dependencies: [] })));
gantt.on('task:activated', (p) => p.taskId);
gantt.on('task:context-requested', (p) => p.preventDefault());
gantt.mount(document.body);
