import { test, expect } from '@playwright/test';

// Sample visual regression — currently SKIPPED because the baseline screenshot is
// platform-dependent (macOS dev ≠ Linux CI) and the renderer has no stable output yet.
// Enable when the SVG renderer is done: remove .skip, generate the baseline with
//   pnpm test:visual --update-snapshots
// (run on the same image as CI so the baseline matches).
test.skip('gantt timeline — visual baseline', async ({ page }) => {
  await page.setContent('<div style="width:200px;height:60px;background:#6366f1"></div>');
  await expect(page).toHaveScreenshot('timeline.png');
});
