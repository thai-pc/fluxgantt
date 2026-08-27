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
    // The a11y layer windows DOM row construction to the SAME scroll-position-derived row band
    // `computeVisibleWindow()` paints (issue #37, superseding issue #36's old focus-centered
    // `A11Y_WINDOW_OVERSCAN` scheme — see canvas-renderer.ts's top-of-file comment) — NOT every
    // row in the project; `aria-rowcount` above still reports the true full count. Before any
    // scroll/keyboard interaction, `container.scrollTop === 0` and the default 600px viewport
    // (`resolveViewportHeightPx()`) minus the 32px header leaves a 568px row band: at the
    // default 32px row height that's `ceil(568/32) = 18` rows raw, padded by
    // `CANVAS_VIRTUALIZATION_OVERSCAN_ROWS` (20) on each side (only the bottom side has room to
    // expand into at the very top of the list) = window `[0, 38]` = 39 rows. Matches
    // `canvas-renderer.test.ts`'s identical computation for the same inputs.
    await expect(page.locator('#gantt [role="row"]')).toHaveCount(39);
    // Roving tabindex: exactly one focusable row.
    await expect(page.locator('#gantt .fg-timeline-a11y-layer [tabindex="0"]')).toHaveCount(1);
    // The canvas bitmap itself stays out of the accessibility tree.
    await expect(page.locator('#gantt .fg-timeline-canvas')).toHaveAttribute('aria-hidden', 'true');
  });
});

test.describe('oversized canvasViewportHeight: falls back to SVG via the dimension guard', () => {
  // HISTORICAL NOTE (see `tests/performance/canvas-mount.spec.ts`'s module comment, finding (2),
  // for the full writeup): this test used to reach `CanvasDimensionExceededError` with a flat
  // 5,000-task dataset alone — before issue #37, Canvas's backing-store height scaled with
  // `taskCount` (`rowCount × rowHeight`), so a large enough flat dataset always exceeded
  // `MAX_CANVAS_DIMENSION_PX` at default density. Issue #37 deliberately decoupled Canvas's
  // height from `taskCount` entirely (that decoupling IS the fix — see
  // `canvas-mount-perf-harness.ts`'s `generateDataset()` doc comment) — a 5,000-task mount now
  // succeeds via Canvas (covered by the `boundary`/performance specs elsewhere), so it can no
  // longer exercise this fallback path. An explicit, oversized `canvasViewportHeight` (forwarded
  // to `GanttConfig.canvasViewportHeight` via the harness's query param, see its own doc comment)
  // is the only remaining way to force the SAME `CanvasDimensionExceededError` → SVG-fallback
  // codepath through the real `mount()` facade, independent of `taskCount` — a real, working-
  // as-designed safety net, exercised here rather than only through
  // `tests/visual/canvas-renderer-webkit-dimension-guard.spec.ts`'s direct-construction harness.
  test('renders via SVG with canvasFallbackReason="dimension-exceeded"', async ({ page }) => {
    // taskCount stays comfortably above CANVAS_AUTO_SWITCH_THRESHOLD (so mount() picks Canvas at
    // all) but is otherwise incidental now — `canvasViewportHeight` alone (× default DPR 1 in
    // this Chromium-only `visual` project) is what pushes the physical backing-store height past
    // `MAX_CANVAS_DIMENSION_PX` (65,535px).
    await page.goto(
      '/canvas-mount-perf-harness.html?taskCount=2500&canvasViewportHeight=70000',
    );
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
