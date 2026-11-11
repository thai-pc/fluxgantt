import { test, expect, type Page } from '@playwright/test';

// `g` (go to bar) and Home/End/PageDown (spec-keyboard-horizontal-reveal.md §7). Fixture:
// `collapse.html?pad=200` — rows 0-5 are the named August tasks, followed by 200 September filler
// rows in a 420px-high `#gantt` scroller (withViewport + withInteraction composed).

const HEADER_HEIGHT = 32;

const scroll = (page: Page) =>
  page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    return { top: c.scrollTop, left: c.scrollLeft, w: c.clientWidth, sw: c.scrollWidth };
  });

test.beforeEach(async ({ page }) => {
  await page.goto('/collapse.html?pad=200');
  await page.locator('svg.fg-timeline [tabindex="0"]').first().focus();
});

test('arrows keep scrollLeft; g brings the focused bar into view beside the label column', async ({ page }) => {
  // Park the chart at its far right end, so the August bars are off-screen to the left.
  const max = await page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    c.scrollLeft = c.scrollWidth;
    return c.scrollLeft;
  });
  expect(max).toBeGreaterThan(0);

  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  expect((await scroll(page)).left).toBe(max);

  // Focus is on row 3 (leaf-a2, August). Its bar must be off-screen before `g`.
  const bar = page.locator('.fg-timeline__row[data-task-id="leaf-a2"] .fg-task__bar').first();
  const box = () => page.locator('#gantt').boundingBox();
  const before = (await bar.boundingBox())!;
  expect(before.x + before.width).toBeLessThan((await box())!.x + 160);

  await page.keyboard.press('g');
  const after = (await bar.boundingBox())!;
  const c = (await box())!;
  const labelW = await page.evaluate(
    () => (window as unknown as { __gantt: { getLabelColumnWidth?: () => number } }).__gantt.getLabelColumnWidth?.() ?? 160,
  );
  expect(after.x).toBeGreaterThanOrEqual(c.x + labelW - 1);
  expect(after.x + after.width).toBeLessThanOrEqual(c.x + c.width + 1);
  // Focus and selection did not move.
  await expect(page.locator('.fg-timeline__row[data-task-id="leaf-a2"]')).toBeFocused();
});

test('End / Home / PageDown move focus and keep the focused row below the header', async ({ page }) => {
  await page.keyboard.press('PageDown');
  const focused = page.locator('.fg-timeline__row:focus');
  await expect(focused).toHaveCount(1);
  const idx = Number(await focused.getAttribute('data-row-index'));
  expect(idx).toBeGreaterThan(1);

  await page.keyboard.press('End');
  await expect(page.locator('.fg-timeline__row[data-task-id="filler-199"]')).toBeFocused();
  const row = (await page.locator('.fg-timeline__row[data-task-id="filler-199"]').boundingBox())!;
  const c = (await page.locator('#gantt').boundingBox())!;
  expect(row.y).toBeGreaterThanOrEqual(c.y + HEADER_HEIGHT - 1);
  expect(row.y + row.height).toBeLessThanOrEqual(c.y + c.height + 1);

  await page.keyboard.press('Home');
  await expect(page.locator('.fg-timeline__row[data-task-id="phase-1"]')).toBeFocused();
  expect((await scroll(page)).top).toBe(0);
});
