// Fixture measured by `pnpm size` (see .size-limit.json). Deliberately mirrors the smallest
// realistic real-world usage: import the facade, construct an instance with an empty dataset.
// Do NOT add anything else here — this file IS the "hello world" bundle-size budget.
import { createGantt } from '@fluxgantt/core';

createGantt({ tasks: [], dependencies: [] });
