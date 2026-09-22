import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for the i18n scaffold (WCAG 2.1 AA per testing.md). The strings this
// feature touches are accessible NAMES — text only a screen reader ever receives — so the
// assertions below read the browser's computed accessibility tree rather than the attribute
// string. An attribute assertion would pass even if the name were computed from something else
// entirely; unit tests already cover the attribute itself.

test('a chart with host-supplied messages has no detectable axe violations', async ({ page }) => {
  await page.goto('/i18n.html');
  const results = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(results.violations).toEqual([]);
});

test("the host's ariaLabel is the chart's computed accessible name", async ({ page }) => {
  await page.goto('/i18n.html');
  await expect(page.locator('#gantt svg')).toHaveAccessibleName('Kế hoạch dự án');
});

test("a task's computed accessible name is the host sentence, in the host's clause order", async ({
  page,
}) => {
  await page.goto('/i18n.html');
  const bar = page.locator('.fg-task[data-task-id="thiet-ke"]');
  // Both fixture tasks are on the critical path (a 2-task FS chain), so the flag clause is
  // present — and it LEADS, which is the whole assertion: the pre-scaffold label appended
  // ', critical path' at the end and no host could move it.
  await expect(bar).toHaveAccessibleName(
    /^\[đường găng\] Thiết kế giao diện — .+ đến .+, hoàn thành 50%$/,
  );
  await expect(bar).not.toHaveAccessibleName(/complete/);
});

test('selecting a task moves the state clause to the FRONT of its accessible name', async ({ page }) => {
  await page.goto('/i18n.html');
  await page.locator('.fg-task[data-task-id="thiet-ke"]').click();
  await expect(page.locator('.fg-task[data-task-id="thiet-ke"]')).toHaveAccessibleName(
    /^\[đang chọn, đường găng\] Thiết kế giao diện — /,
  );
});
