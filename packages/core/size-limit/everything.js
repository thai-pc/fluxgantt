// Fixture measured by `pnpm size` (see .size-limit.json): EVERY capability composed, the honest
// "install it all" number and the 4th HARD gate (owner decision, 2026-11-13; spec-grid-columns.md 11.2).
// `kitchen-sink.js` is unchanged and stays the pre-facade-split base surface (io + render +
// interaction) WITHOUT the opt-in mixins.
//
// ADD EVERY NEW PUBLIC MIXIN HERE when it ships (`withGrid` and `withGridEditing` join in their own
// PRs, at the marked spots). Each capability must stay REFERENCED below or the bundler shakes it away
// and the gate under-measures (`tooling/scripts/__tests__/size-gates.test.mjs` asserts that every
// mixin subpath is imported here).
// Dynamic `import()` chunks (Canvas) stay `external` and unmeasured, as in every fixture.
import { createGantt } from '@fluxgantt/core';
import { withIo } from '@fluxgantt/core/io';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withTheme } from '@fluxgantt/core/theme';
import { withViewport } from '@fluxgantt/core/viewport';
import { withConflicts } from '@fluxgantt/core/conflicts';
import { withEditHooks } from '@fluxgantt/core/edit-hooks';
import { withRtl } from '@fluxgantt/core/rtl';
import { withResponsive } from '@fluxgantt/core/responsive';
// import { withGrid } from '@fluxgantt/core/grid';                  // joins in the grid PR
// import { withGridEditing } from '@fluxgantt/core/grid-editing';   // joins in the grid-editing PR

const gantt = withRtl(withResponsive(withEditHooks(withConflicts(withViewport(withTheme(
  withInteraction(withIo(withRender(createGantt({ tasks: [], dependencies: [], rtl: true }))))))))));
gantt.mount(document.body);
gantt.on('conflict:detected', () => {});
gantt.on('task:activated', (p) => p.taskId);
gantt.setTheme('dark');
gantt.setDensity('compact');
gantt.scrollToTask('a');
gantt.detectConflicts();
globalThis.out = [gantt.exportJson(), gantt.isCoarsePointer()];
