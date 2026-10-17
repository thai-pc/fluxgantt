import { test, expect, type Page } from '@playwright/test';
import { pinToday } from '../helpers/pin-today.js';

// RTL visual regression (spec-rtl-chart.md section 14.2): the whole mirrored chart, SVG and Canvas,
// light and dark, Arabic and Hebrew. Covers what no DOM assertion can: the arrowheads and the toggle
// glyph point the right way, the today line and the weekend washes sit on the right columns, glyphs
// are upright, the pinned header lines up. Baselines are committed per platform (`-darwin.png` here,
// `-linux.png` from a CI run, never hand-edited; testing.md).
// "Today" is pinned to the second week of the plan so the today marker is in the first screenful.

const TODAY = '2026-03-10T12:00:00Z';

async function open(page: Page, query = ''): Promise<void> {
  await pinToday(page, TODAY);
  await page.goto(`/rtl.html${query ? `?${query}` : ''}`);
  await expect(page.locator(query.includes('pad=2100') ? '#gantt canvas.fg-timeline-canvas' : '#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => '__fx' in window);
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
}

const scroll = (page: Page, left: number): Promise<void> =>
  page.evaluate(
    (l) =>
      new Promise<void>((r) => {
        document.getElementById('gantt')!.scrollLeft = l;
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      }),
    left,
  );

test('SVG, Arabic, light: label column at the right, earliest date at the right, today marker', async ({ page }) => {
  await open(page);
  await expect(page.locator('#gantt')).toHaveScreenshot('rtl-svg-light.png');
});

test('SVG, Arabic, scrolled left: the pinned header stays aligned with the day columns', async ({ page }) => {
  await open(page);
  await scroll(page, -900);
  await expect(page.locator('#gantt')).toHaveScreenshot('rtl-svg-scrolled.png');
});

test('SVG, Arabic, dark', async ({ page }) => {
  await open(page, 'theme=dark');
  await expect(page.locator('#gantt')).toHaveScreenshot('rtl-svg-dark.png');
});

test('SVG, Hebrew', async ({ page }) => {
  await open(page, 'lang=he');
  await expect(page.locator('#gantt')).toHaveScreenshot('rtl-svg-hebrew.png');
});

test('SVG, a selected and keyboard-focused critical task keeps both rings and the dashed outline', async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as never as { __gantt: { select(id: string): void } }).__gantt.select('design'));
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await scroll(page, -300);
  await expect(page.locator('#gantt')).toHaveScreenshot('rtl-svg-selected-focused.png');
});

test('Canvas, Arabic, light (>= 2000 tasks)', async ({ page }) => {
  await open(page, 'pad=2100');
  await expect(page.locator('#gantt')).toHaveScreenshot('rtl-canvas-light.png');
});

test('Canvas, Arabic, scrolled left and dark', async ({ page }) => {
  await open(page, 'pad=2100&theme=dark');
  await scroll(page, -900);
  await expect(page.locator('#gantt')).toHaveScreenshot('rtl-canvas-dark-scrolled.png');
});

test('Canvas, a held move gesture: the ghost is drawn mirrored, 3 days to the visual left', async ({ page }) => {
  await open(page, 'pad=2100');
  const b = await page.evaluate(() => (window as never as { __fx: { barBox(id: string): { x: number; y: number; w: number; h: number } } }).__fx.barBox('design'));
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(c.x - (72 * i) / 10, c.y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
  await expect(page.locator('#gantt')).toHaveScreenshot('rtl-canvas-drag-ghost.png');
  await page.keyboard.press('Escape');
  await page.mouse.up();
});
