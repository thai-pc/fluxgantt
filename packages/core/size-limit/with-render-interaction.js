// Fixture measured by `pnpm size` (see .size-limit.json): base facade + render + interaction,
// i.e. the fully editable chart most consumers actually want, minus IO. Do NOT add anything
// else here — this file IS the budget.
import { createGantt } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';

withInteraction(withRender(createGantt({ tasks: [], dependencies: [] }))).mount(document.body);
