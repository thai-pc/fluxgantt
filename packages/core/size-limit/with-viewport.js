// Fixture measured by `pnpm size` (see .size-limit.json): base facade + render + the opt-in
// viewport mixin, i.e. a painted chart that can scroll to a task/date and change density at
// runtime. Do NOT add anything else here — this file IS the budget.
import { createGantt } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withViewport } from '@fluxgantt/core/viewport';

const gantt = withViewport(withRender(createGantt({ tasks: [], dependencies: [] })));
gantt.mount(document.body);
gantt.scrollToTask('a');
gantt.scrollToDate('2026-01-01');
gantt.setDensity('compact');
