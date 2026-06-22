// Vitest setup: gán Temporal vào global để compute layer (working-calendar/CPM)
// chạy được trong test. Ở production, consumer cung cấp Temporal native hoặc polyfill.
import { Temporal } from '@js-temporal/polyfill';

(globalThis as { Temporal?: typeof Temporal }).Temporal = Temporal;
