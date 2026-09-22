// Fixture measured by `pnpm size` (see .size-limit.json): base facade + render + the opt-in
// theme mixin, i.e. a painted chart that can switch light/dark at runtime. Do NOT add anything
// else here — this file IS the budget.
import { createGantt } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withTheme } from '@fluxgantt/core/theme';

const gantt = withTheme(withRender(createGantt({ tasks: [], dependencies: [] })));
gantt.mount(document.body);
gantt.setTheme('dark');
