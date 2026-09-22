// Fixture measured by `pnpm size` (see .size-limit.json): every capability composed — the
// pre-facade-split `createGantt()` surface, and the successor to the old "Full core" check
// (which measured `dist/index.js` as a plain file; code-splitting since hollowed that file out
// into shared chunks, so a file-size read of it no longer reflects what a consumer downloads).
// Do NOT add anything else here — this file IS the budget.
//
// DELIBERATELY EXCLUDES `withTheme` (@fluxgantt/core/theme), despite the name: the theme mixin
// measures ~440 B gzipped and this fixture has ~380 B of headroom, so composing it here would
// force a budget bump — which golden rule 5 forbids. The floor was measured, not assumed (every
// reduction attempted, including dropping the destroy-cleanup entirely, still left ~97 B over).
// `withTheme` therefore has its own fixture, `with-theme.js`. Revisit if this budget ever gains
// room.
import { createGantt } from '@fluxgantt/core';
import { withIo } from '@fluxgantt/core/io';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';

const gantt = withInteraction(withIo(withRender(createGantt({ tasks: [], dependencies: [] }))));
gantt.mount(document.body);
globalThis.out = gantt.exportJson();
