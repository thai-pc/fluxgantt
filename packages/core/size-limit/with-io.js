// Fixture measured by `pnpm size` (see .size-limit.json): base facade + the opt-in IO mixin,
// i.e. what a consumer pays to import/export JSON/CSV/SVG/PNG without ever rendering.
// Do NOT add anything else here — this file IS the budget.
import { createGantt } from '@fluxgantt/core';
import { withIo } from '@fluxgantt/core/io';

globalThis.out = withIo(createGantt({ tasks: [], dependencies: [] })).exportJson();
