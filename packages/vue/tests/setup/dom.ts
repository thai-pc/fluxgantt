import { Temporal } from '@js-temporal/polyfill';

// Mirrors packages/core/tests/setup/temporal.ts and packages/react/tests/setup/dom.ts —
// mount() drives a reactive render effect that calls computeCriticalPath internally, which
// needs globalThis.Temporal.
(globalThis as { Temporal?: typeof Temporal }).Temporal = Temporal;

// No RTL-style global `cleanup()` registration here: `@vue/test-utils`'s `mount()` does NOT
// register an implicit afterEach-cleanup the way `@testing-library/react`'s `render()` does.
// Each test is responsible for calling `wrapper.unmount()` itself when the test's own
// assertions require a real teardown (e.g. the unsubscribe/remount tests); tests that don't
// need to observe teardown can simply let jsdom's per-test document reset (via vitest's
// `environment: 'jsdom'`) reclaim everything.
