import { test, expect } from '@playwright/test';

// --- Canvas auto-switch boundary — real `mount()` path -----------------------------------------
// (spec-canvas-auto-switch.md §9.2/§10, Ticket 3 of `.claude/work/plan-canvas-renderer.md`)
//
// Runs under the `visual` Playwright project (Chromium). Drives
// `examples/plain-html-demo/canvas-mount-perf-harness.html` (see its own header comment and
// `tests/performance/canvas-mount.spec.ts`'s module comment for the full dataset shape and the
// two empirically-confirmed findings this ticket surfaced). Confirms the `CANVAS_AUTO_SWITCH_
// THRESHOLD` boundary itself — `taskCount <= 2000` stays on SVG, `taskCount > 2000` switches to
// Canvas — through the real, public `createGantt().mount()` path (not a direct
// `createCanvasRenderer()`/`createSvgRenderer()` call, unlike the Ticket 1/2 harnesses), and that
// Ticket 2's hidden ARIA a11y grid layer is present with the right shape once Canvas is chosen
// this way.
//
// Deliberately NOT a pixel-snapshot test: at 2000-2001 tasks, a full-page (or even
// scrolled-viewport) snapshot of a Gantt chart is enormous, slow to diff, and flakes on
// anti-aliasing/font-rendering noise across CI runners — the same reasoning
// `canvas-renderer.spec.ts`'s existing "small" snapshot fixture already applies at a much smaller
// scale. Structural DOM/attribute assertions are the right tool for "did the auto-switch decide
// correctly and build the expected structure", not "does every pixel match a golden image".

test.describe('boundary: taskCount=2000 stays on SVG, taskCount=2001 switches to Canvas', () => {
  test('taskCount=2000 (at threshold): renders via SVG, no fallback reason', async ({ page }) => {
    await page.goto('/canvas-mount-perf-harness.html?taskCount=2000');
    await page.evaluate(() => (window as unknown as { __mountAndTime: () => Promise<unknown> }).__mountAndTime());

    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'svg');
    await expect(page.locator('body')).not.toHaveAttribute('data-canvas-fallback-reason');
    await expect(page.locator('#gantt svg')).toBeVisible();
    await expect(page.locator('#gantt .fg-timeline-canvas')).toHaveCount(0);
  });

  test('taskCount=2001 (just over threshold): renders via Canvas', async ({ page }) => {
    await page.goto('/canvas-mount-perf-harness.html?taskCount=2001');
    await page.evaluate(() => (window as unknown as { __mountAndTime: () => Promise<unknown> }).__mountAndTime());

    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'canvas');
    await expect(page.locator('body')).not.toHaveAttribute('data-canvas-fallback-reason');
    await expect(page.locator('#gantt .fg-timeline-canvas')).toBeVisible();
    await expect(page.locator('#gantt svg')).toHaveCount(0);
  });
});

test.describe('hidden ARIA a11y grid layer, reached via the real mount() path', () => {
  test('Canvas mount at taskCount=2001 builds the expected a11y grid structure', async ({
    page,
  }) => {
    await page.goto('/canvas-mount-perf-harness.html?taskCount=2001');
    await page.evaluate(() => (window as unknown as { __mountAndTime: () => Promise<unknown> }).__mountAndTime());
    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'canvas');

    await expect(page.locator('#gantt .fg-timeline-a11y-layer')).toHaveAttribute('role', 'grid');
    await expect(page.locator('#gantt .fg-timeline-a11y-layer')).toHaveAttribute(
      'aria-rowcount',
      '2001',
    );
    // The a11y layer windows DOM row construction to `A11Y_WINDOW_OVERSCAN + 1` rows centered
    // on the focused row (canvas-renderer.ts, issue #36) — NOT every row in the project;
    // `aria-rowcount` above still reports the true full count. Before any keyboard interaction,
    // `focusedTaskId` falls back to row 0, so the window is exactly `A11Y_WINDOW_OVERSCAN + 1`
    // rows (no rows exist below index 0).
    const A11Y_WINDOW_OVERSCAN = 50; // must match canvas-renderer.ts's own constant
    await expect(page.locator('#gantt [role="row"]')).toHaveCount(A11Y_WINDOW_OVERSCAN + 1);
    // Roving tabindex: exactly one focusable row.
    await expect(page.locator('#gantt .fg-timeline-a11y-layer [tabindex="0"]')).toHaveCount(1);
    // The canvas bitmap itself stays out of the accessibility tree.
    await expect(page.locator('#gantt .fg-timeline-canvas')).toHaveAttribute('aria-hidden', 'true');
  });
});

test.describe('large flat dataset (taskCount=5000): falls back to SVG via the dimension guard', () => {
  // See `tests/performance/canvas-mount.spec.ts`'s module comment, finding (2), for the full
  // writeup: a flat 5,000-task dataset always exceeds Canvas's `MAX_CANVAS_DIMENSION_PX` guard at
  // default density, so `mount()` picks Canvas (taskCount > threshold), the construction attempt
  // throws `CanvasDimensionExceededError` internally, and it silently (bar a `console.warn`)
  // falls back to SVG instead — a real, working-as-designed safety net, exercised here through
  // the real `mount()` path rather than only through
  // `tests/visual/canvas-renderer-webkit-dimension-guard.spec.ts`'s direct-construction harness.
  test('renders via SVG with canvasFallbackReason="dimension-exceeded"', async ({ page }) => {
    await page.goto('/canvas-mount-perf-harness.html?taskCount=5000');
    await page.evaluate(() => (window as unknown as { __mountAndTime: () => Promise<unknown> }).__mountAndTime());

    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'svg');
    await expect(page.locator('body')).toHaveAttribute(
      'data-canvas-fallback-reason',
      'dimension-exceeded',
    );
    await expect(page.locator('#gantt svg')).toBeVisible();
    await expect(page.locator('#gantt .fg-timeline-canvas')).toHaveCount(0);
  });
});
