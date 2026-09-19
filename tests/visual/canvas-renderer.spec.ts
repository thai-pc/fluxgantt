import { test, expect } from '@playwright/test';

// --- Canvas renderer visual regression (spec-canvas-renderer-ticket1.md §9.2) --------------
//
// Scope reconciliation: this is NOT about the real `mount()`-driven SVG↔Canvas auto-switch
// behavior (that's Ticket 3's job). This ticket's own test is narrower: prove
// `createCanvasRenderer()` paints a plausible, reviewable chart at a small task count,
// independent of any `mount()`/switching logic — via the dedicated `canvas-harness.html`
// fixture (see `examples/plain-html-demo/src/canvas-harness.ts`'s header comment for why it
// imports workspace source directly rather than the published `@fluxgantt/core` package).

test('canvas renderer paints grid/bars/dependencies/critical/selection at small N', async ({
  page,
}) => {
  await page.goto('/canvas-harness.html');
  const chart = page.locator('.fg-timeline-canvas');
  await expect(chart).toBeVisible();
  await expect(chart).toHaveScreenshot('canvas-small.png');
});
