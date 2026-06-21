import { test, expect } from '@playwright/test';

// Visual regression mẫu — đang SKIP vì baseline screenshot phụ thuộc nền tảng
// (macOS dev ≠ Linux CI) và renderer chưa có output ổn định.
// Bật khi SVG renderer xong: bỏ .skip, sinh baseline bằng
//   pnpm test:visual --update-snapshots
// (nên chạy trên cùng image với CI để baseline khớp).
test.skip('gantt timeline — visual baseline', async ({ page }) => {
  await page.setContent('<div style="width:200px;height:60px;background:#6366f1"></div>');
  await expect(page).toHaveScreenshot('timeline.png');
});
