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
