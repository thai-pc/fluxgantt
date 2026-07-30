import { test, expect } from '@playwright/test';

// Sanity: confirm the Playwright harness + browser run.
// Once @fluxgantt/core has an SVG renderer + mount(), replace page.setContent with
// page.goto(demo) and test for real: drag move/resize task, create dependency, keyboard nav.
test('harness renders basic DOM', async ({ page }) => {
  await page.setContent(`
    <div class="fg-timeline">
      <svg role="img" aria-label="gantt">
        <rect class="fg-task__bar" width="120" height="24"></rect>
      </svg>
    </div>
  `);

  await expect(page.locator('.fg-task__bar')).toBeVisible();
  await expect(page.locator('svg[role="img"]')).toHaveAttribute('aria-label', 'gantt');
});
