// Temporal bootstrap. `@fluxgantt/core` does all date math with the Temporal API but bundles no
// polyfill: it reads `globalThis.Temporal`, and throws "Temporal API is not available" without it.
// Browsers that ship Temporal natively need nothing; the rest (Safari, older Chromium and Firefox)
// need `@js-temporal/polyfill` installed before the first chart is created. Import this module
// FIRST in every entry. The `??=` makes it a no-op wherever Temporal is native. The cast goes
// through `unknown` because TypeScript 6's `lib: ["ESNext"]` declares a built-in global Temporal
// whose types do not overlap the polyfill's.
import { Temporal } from '@js-temporal/polyfill';

(globalThis as unknown as { Temporal?: typeof Temporal }).Temporal ??= Temporal;
