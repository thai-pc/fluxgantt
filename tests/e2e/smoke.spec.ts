import { test, expect } from '@playwright/test';

// Real smoke test against the plain-html-demo host app (see playwright.config.ts webServer).
// Replaces the old page.setContent placeholder now that examples/plain-html-demo exists.
test('renders the demo chart', async ({ page }) => {
  await page.goto('/');

  // The SVG renderer's root <svg> carries role="grid" (svg-renderer.ts, keyboard-nav ARIA shape).
  const svg = page.locator('svg[role="grid"]');
  await expect(svg).toBeVisible();

  // The demo has 5 tasks → 5 task bars.
  await expect(page.locator('.fg-task__bar')).toHaveCount(5);
});

test('marks the critical path (color-independent, dashed outline)', async ({ page }) => {
  await page.goto('/');
  // At least one task is on the critical path (design → build → review chain).
  await expect(page.locator('.fg-task--critical').first()).toBeVisible();
});
