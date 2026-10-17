// Fixture measured by `pnpm size` (see .size-limit.json): base facade + render + the opt-in rtl
// mixin, i.e. a painted chart mirrored for a right-to-left locale. Not in the kitchen sink.
// Do NOT add anything else here — this file IS the budget.
import { createGantt } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withRtl } from '@fluxgantt/core/rtl';

const gantt = withRtl(withRender(createGantt({ tasks: [], dependencies: [], rtl: true })));
gantt.mount(document.body);
