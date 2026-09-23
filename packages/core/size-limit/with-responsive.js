// Fixture measured by `pnpm size` (see .size-limit.json): base facade + render + interaction +
// the opt-in responsive mixin, i.e. the full touch-adapted editable chart a phone consumer ships.
// Composed on TOP of `with-render-interaction.js`'s shape deliberately — this mixin only earns its
// bytes alongside the drag recognizers whose touch arbitration it fixes, so measuring it against
// `withRender` alone would understate what a real consumer downloads. The delta between this
// fixture and that one IS the price of `@fluxgantt/core/responsive`.
// Do NOT add anything else here — this file IS the budget.
import { createGantt } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withResponsive } from '@fluxgantt/core/responsive';

const gantt = withResponsive(withInteraction(withRender(createGantt({ tasks: [], dependencies: [] }))));
gantt.mount(document.body);
globalThis.out = gantt.isCoarsePointer();
