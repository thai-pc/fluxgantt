import { test, expect } from '@playwright/test';

// Keyboard reveal under `withResponsive` (coarse pointer -> automatic 'touch' density, 48px rows,
// set AFTER mount). The arrow-key scroll must use the live density, or the focused row ends up
// below the viewport (review finding B1). Fixture: `responsive.html?pad=40`.
test('ArrowDown keeps the focused row inside the band after the automatic touch density', async ({ page }) => {
  await page.goto('/responsive.html?pad=40');
  await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
  await page.evaluate(() => {
    document.getElementById('gantt')!.style.height = '300px';
  });
  await page.locator('#gantt svg.fg-timeline [tabindex="0"]').first().focus();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('ArrowDown');
    const ok = await page.evaluate(() => {
      const c = document.getElementById('gantt')!;
      const r = c.getBoundingClientRect();
      const top = r.top + c.clientTop;
      const row = document.activeElement!.getBoundingClientRect();
      return row.top >= top + 32 - 0.5 && row.bottom <= top + c.clientHeight + 0.5;
    });
    expect(ok).toBe(true);
  }
});
