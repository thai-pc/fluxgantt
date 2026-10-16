// Fixture measured by `pnpm size` (see .size-limit.json): every capability composed — the
// pre-facade-split `createGantt()` surface, and the successor to the old "Full core" check
// (which measured `dist/index.js` as a plain file; code-splitting since hollowed that file out
// into shared chunks, so a file-size read of it no longer reflects what a consumer downloads).
// Do NOT add anything else here — this file IS the budget.
//
// DELIBERATELY EXCLUDES `withTheme` (@fluxgantt/core/theme), despite the name: the theme mixin
// measures ~440 B gzipped. When this was written the fixture had ~380 B of headroom, so composing
// it would have forced a budget bump (golden rule 5 forbids that); after the 2026-10 headroom pass
// there is ~850 B, kept as a buffer rather than spent. `withTheme` therefore still has its own
// fixture, `with-theme.js`. `withViewport` and `withConflicts` are excluded for the same reason and
// have their own fixtures (`with-viewport.js`, `with-conflicts.js`).
import { createGantt } from '@fluxgantt/core';
import { withIo } from '@fluxgantt/core/io';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';

const gantt = withInteraction(withIo(withRender(createGantt({ tasks: [], dependencies: [] }))));
gantt.mount(document.body);
globalThis.out = gantt.exportJson();
