// Vitest setup: assign Temporal to the global so the compute layer (working-calendar/CPM)
// works in tests. In production, the consumer provides native Temporal or the polyfill.
import { Temporal } from '@js-temporal/polyfill';

(globalThis as { Temporal?: typeof Temporal }).Temporal = Temporal;
