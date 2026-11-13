import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Keyboard move/resize/link (WCAG 2.1.1 Keyboard, spec-keyboard-move-resize.md): after a keyboard move
// the chart stays axe-clean, focus stays on the same row, the row's accessible name carries the new
// date, and no new Tab stop appears. Fixture: `canvas-drag.html?pad=0` (SVG twin).

test('axe is clean after a keyboard move; focus, tab stops and the accessible name follow the task', async ({ page }) => {
  await page.goto('/canvas-drag.html?pad=0');
  await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
  const row = page.locator('[role="row"][data-task-id="a"]');
  const name = () => row.locator('.fg-task').getAttribute('aria-label');
  await row.focus();
  const before = await name();

  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+Shift+ArrowLeft');

  await expect(row).toBeFocused();
  expect(await name()).not.toBe(before);
  expect(await name()).toContain('Aug 4'); // started Aug 3, moved one day
  await expect(page.locator('svg.fg-timeline [tabindex="0"]')).toHaveCount(1);

  const results = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(results.violations).toEqual([]);
});
