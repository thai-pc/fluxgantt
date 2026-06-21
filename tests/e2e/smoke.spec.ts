import { test, expect } from '@playwright/test';

// Sanity: xác nhận harness Playwright + browser chạy được.
// Khi @fluxgantt/core có SVG renderer + mount(), thay page.setContent bằng
// page.goto(demo) rồi test thật: drag move/resize task, tạo dependency, keyboard nav.
test('harness render được DOM cơ bản', async ({ page }) => {
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
