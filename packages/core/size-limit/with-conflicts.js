// Fixture measured by `pnpm size` (see .size-limit.json): base facade + the opt-in conflicts
// mixin, headless (no render). Do NOT add anything else here — this file IS the budget.
import { createGantt } from '@fluxgantt/core';
import { withConflicts } from '@fluxgantt/core/conflicts';

const gantt = withConflicts(createGantt({ tasks: [], dependencies: [] }));
gantt.on('conflict:detected', () => {});
gantt.detectConflicts();
