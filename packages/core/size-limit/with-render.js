// Fixture measured by `pnpm size` (see .size-limit.json): base facade + the opt-in render
// mixin, i.e. a static, non-interactive painted chart. Do NOT add anything else here — this
// file IS the budget.
import { createGantt } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';

withRender(createGantt({ tasks: [], dependencies: [] })).mount(document.body);
