import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { Temporal } from '@js-temporal/polyfill';
import '@testing-library/jest-dom/vitest';

// Mirrors packages/core/tests/setup/temporal.ts — mount() drives a reactive render effect
// that calls computeCriticalPath internally, which needs globalThis.Temporal.
(globalThis as { Temporal?: typeof Temporal }).Temporal = Temporal;

afterEach(() => {
  cleanup();
});
