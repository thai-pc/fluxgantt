import { test, expect } from '@playwright/test';

// The demo's /read-only.html mounts the same data with `readOnly: true`. In read-only mode the
// renderer is told `showLinkHandles: false`, so the `.fg-task__link-handle` connector handles
// are never rendered (rendering them would be a misleading dead control). This is the
// observable, reliable difference between the interactive and read-only charts.

test('interactive chart renders link handles', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.fg-task__link-handle').first()).toBeAttached();
});

test('read-only chart renders no link handles', async ({ page }) => {
  await page.goto('/read-only.html');
  await expect(page.locator('svg[role="img"]')).toBeVisible();
  await expect(page.locator('.fg-task__link-handle')).toHaveCount(0);
});
