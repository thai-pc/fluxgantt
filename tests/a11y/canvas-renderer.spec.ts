import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for the Canvas renderer's hidden ARIA grid layer + click-select/
// keyboard-nav parity (spec-canvas-renderer-ticket2.md §12.5, WCAG 2.1 AA per testing.md).
// Fixture: examples/plain-html-demo/canvas-a11y-harness.html — a TEMPORARY, Ticket-2-only page
// (1,000 tasks — a large-N a11y-grid smoke fixture; see that file's header comment for why it's
// 1,000 and not the architecture.md `>2000` Canvas-switch figure — a real browser per-canvas-
// dimension size limit, not scope) wiring `enableClickSelect`/`enableKeyboardNav` directly against
// a real `createCanvasRenderer()` handle, since Canvas mode isn't wired into `createGantt().mount()`
// yet (Ticket 3 scope). Expected to be deleted/rewritten once Ticket 3 lands.

// The 1,000-row hidden ARIA grid (spec §12.5's harness) means axe-core has roughly 4k elements to
// walk (row + gridcell + label + task per row) — comfortably under 30s in practice, but the
// timeout is still bumped defensively on the two axe-scanning tests below (axe-core's scan time
// scales with DOM size, and this fixture's row count may change); the DOM-assertion tests stay at
// the default.
const AXE_SCAN_TIMEOUT_MS = 90_000;

test('no detectable axe violations', async ({ page }) => {
  test.setTimeout(AXE_SCAN_TIMEOUT_MS);
  await page.goto('/canvas-a11y-harness.html');
  const results = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(results.violations).toEqual([]);
});

test('every row is reachable via native Tab order (single grid stop, roving tabindex)', async ({
  page,
}) => {
  await page.goto('/canvas-a11y-harness.html');
  await page.keyboard.press('Tab');
  const focusedTaskId = await page.evaluate(
    () => document.activeElement?.getAttribute('data-task-id') ?? null,
  );
  expect(focusedTaskId).not.toBeNull();
  expect(await page.locator('.fg-timeline-a11y-layer [tabindex="0"]').count()).toBe(1);
});

test('ArrowDown moves focus to the next row and updates aria-selected', async ({ page }) => {
  await page.goto('/canvas-a11y-harness.html');
  await page.locator('.fg-timeline-a11y-layer [tabindex="0"]').first().focus();
  const before = await page.evaluate(() => document.activeElement?.getAttribute('data-task-id'));
  await page.keyboard.press('ArrowDown');
  const after = await page.evaluate(() => document.activeElement?.getAttribute('data-task-id'));
  expect(after).not.toBe(before);
  // Attribute-only selector (not `.fg-timeline-canvas__row[...]`) — `data-task-id` is the
  // renderer-agnostic contract; the Canvas hidden layer's own `fg-timeline-canvas__*` classes
  // (spec-canvas-renderer-ticket2.md §5.2) are deliberately not part of it.
  await expect(page.locator(`[data-task-id="${after}"][role="row"]`)).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('the canvas bitmap itself is hidden from the accessibility tree', async ({ page }) => {
  await page.goto('/canvas-a11y-harness.html');
  await expect(page.locator('.fg-timeline-canvas')).toHaveAttribute('aria-hidden', 'true');
});

test('a real mouse click on the visible canvas selects the task under the cursor', async ({
  page,
}) => {
  await page.goto('/canvas-a11y-harness.html');
  const canvas = page.locator('.fg-timeline-canvas');
  const box = await canvas.boundingBox();
  // Click inside the first row's band (header height + half a row height down from the top).
  await page.mouse.click(box!.x + 100, box!.y + 32 + 14);
  const selectedRow = page.locator('[role="row"][aria-selected="true"]');
  await expect(selectedRow).toHaveCount(1);
});

test('reduced motion: no violations (Canvas mode has no animation)', async ({ page }) => {
  test.setTimeout(AXE_SCAN_TIMEOUT_MS);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/canvas-a11y-harness.html');
  const results = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(results.violations).toEqual([]);
});

// --- Row-band virtualization (fix #37, spec-canvas-row-virtualization.md §5.2) -----------------
//
// This is the empirical re-verification the `a11yLayer`'s `position: sticky` decision needed
// (see that layer's own construction comment in `canvas-renderer.ts` for why `sticky`, not
// `absolute`, was chosen: an `absolute`-positioned hidden layer would scroll away with
// `container`'s content as `scrollTop` increases, which could make the browser's own native
// "scroll the newly focused element into view" behavior fight `ensureFocusedRowVisible()`'s
// explicit `container.scrollTop` writes). The harness's default 600px viewport (`HEADER_HEIGHT`
// 32px + `ROW_HEIGHT.default` 32px ⇒ a 568px row band ⇒ 17 whole rows fully visible before any
// scroll is needed) means row index 25 is comfortably past the initial window — this test
// deliberately targets that boundary, not an arbitrary large jump.
test('ArrowDown past the bottom of the initial viewport scrolls the container to the correct offset, keeps the sticky canvas pinned in place (no jump/fight from native focus-scroll-into-view), and focus lands on the right row', async ({
  page,
}) => {
  await page.goto('/canvas-a11y-harness.html');
  const container = page.locator('#gantt');
  const canvas = page.locator('.fg-timeline-canvas');

  // Establish the initial Tab stop (roving tabindex starts on the first row, t0 — spec §4.2).
  await page.locator('.fg-timeline-a11y-layer [tabindex="0"]').first().focus();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-task-id')))
    .toBe('t0');
  expect(await container.evaluate((el) => el.scrollTop)).toBe(0);

  const canvasTopBefore = (await canvas.boundingBox())!.y;

  // 25 real ArrowDown keydowns — each one drives a full `handle.update({ focusedTaskId })` in
  // the harness (mirroring `gantt.ts`'s real keyboard-nav wiring), so this exercises the exact
  // `ensureFocusedRowVisible()` code path frame by frame, not a single synthetic jump.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('ArrowDown');
  }

  const focusedTaskId = await page.evaluate(
    () => document.activeElement?.getAttribute('data-task-id') ?? null,
  );
  expect(focusedTaskId).toBe('t25');
  await expect(page.locator('[data-task-id="t25"][role="row"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Exact expected scroll offset (not just "some positive number"): row 25's band is
  // `[800, 832)` (`rowIndex * 32`), the visible row band is 568px tall (600px viewport minus the
  // 32px header) — `ensureFocusedRowVisible()` scrolls the minimum amount so the row's bottom
  // edge lines up with the bottom of the view: `832 - 568 = 264`. An unexpected value here would
  // mean either `ensureFocusedRowVisible()`'s math regressed, OR (the specific risk `sticky`
  // guards against) the browser's native focus-scroll-into-view fought it mid-sequence.
  const scrollTop = await container.evaluate((el) => el.scrollTop);
  expect(scrollTop).toBe(264);

  // The `<canvas>` itself never moves in viewport-relative coordinates, despite `container`
  // having scrolled 264px internally — this is `position: sticky` doing its job.
  const canvasTopAfter = (await canvas.boundingBox())!.y;
  expect(canvasTopAfter).toBe(canvasTopBefore);

  // Symmetric return trip: ArrowUp back to the top scrolls the container back to 0, with no
  // residual offset left behind by the forward journey.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('ArrowUp');
  }
  expect(await container.evaluate((el) => el.scrollTop)).toBe(0);
  const focusedAfterReturn = await page.evaluate(
    () => document.activeElement?.getAttribute('data-task-id') ?? null,
  );
  expect(focusedAfterReturn).toBe('t0');
});
