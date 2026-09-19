import { test, expect } from '@playwright/test';

// --- Canvas row/viewport virtualization visual regression (spec-canvas-row-virtualization.md,
// fix #37) ----------------------------------------------------------------------------------
//
// Complements `tests/visual/canvas-renderer.spec.ts` (small-N, scroll-position-independent paint
// correctness) and `tests/a11y/canvas-renderer.spec.ts`'s new scroll/focus test (behavioral
// correctness of `ensureFocusedRowVisible()` + `position: sticky`). This spec's own job is purely
// visual: prove a genuinely LARGE (well past the pre-fix ~2,047-row ceiling) Canvas mount still
// paints a plausible, reviewable chart once scrolled to an arbitrary mid-content position — the
// header stays frozen at the top (`position: sticky`) while only the row band intersecting the
// scroll position is drawn.
//
// Uses `canvas-mount-perf-harness.html` (real `createGantt().mount()`, published package surface,
// `?taskCount=5000`) rather than the Ticket-1-era `canvas-harness.html` fixture — that harness's
// tiny, hand-authored dataset has nowhere near enough rows to exercise scrolling at all. See that
// harness's own header comment for the exact dataset shape (rolling 30-working-day window, ~30%
// FS-chained dependencies) and why it keeps the derived canvas WIDTH small and constant regardless
// of `taskCount` (isolating this test to the height/row-virtualization axis fix #37 targets).

declare global {
  interface Window {
    __mountAndTime?: () => Promise<{ ms: number }>;
  }
}

test('canvas renderer at 5,000 tasks (row-band virtualization, fix #37) paints correctly at a mid-scroll position, header frozen at the top', async ({
  page,
}) => {
  await page.goto('/canvas-mount-perf-harness.html?taskCount=5000');
  await page.evaluate(() => window.__mountAndTime!());

  const container = page.locator('#gantt');
  // Scroll deep into the middle of the (unbounded) content height — 5,000 rows × 32px + a 32px
  // header ≈ 160,032px total; 50,000px lands well past the first several thousand rows, nowhere
  // near either scroll edge (so this is genuinely testing mid-scroll repaint, not an edge case
  // `computeVisibleWindow`'s clamping already covers elsewhere).
  await container.evaluate((el) => {
    el.scrollTop = 50_000;
  });
  // The scroll-triggered repaint is rAF-throttled (`scheduleRender()`) — wait two animation
  // frames so the scroll event has fired and the scheduled `render()` has actually run before
  // screenshotting, not just that `scrollTop` was assigned.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  await expect(container).toHaveScreenshot('canvas-large-mid-scroll.png');
});
