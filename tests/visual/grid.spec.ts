import { test, expect, type Page } from '@playwright/test';
import { pinToday } from '../helpers/pin-today.js';

// Visual regression for `withGrid()` on the SVG renderer (spec-grid-columns.md 13.7): the header band,
// the dividers, the cell alignment, truncation, dark and RTL. Baselines are committed per platform
// (`-darwin.png` here, `-linux.png` from a CI run, never hand-edited; testing.md). "Today" is pinned
// before the plan so the today marker cannot drift.

const TODAY = '2026-02-10T12:00:00Z';

async function open(page: Page, query = ''): Promise<void> {
  await pinToday(page, TODAY);
  await page.goto(`/grid.html${query ? `?${query}` : ''}`);
  await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => '__gantt' in window);
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
}

test('default five columns, light', async ({ page }) => {
  await open(page);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-default.png');
});

test('truncated names and an extra custom column', async ({ page }) => {
  await open(page, 'long=1&cols=6');
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-truncated.png');
});

test('dark theme', async ({ page }) => {
  await open(page, 'theme=dark');
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-dark.png');
});

test('RTL: the grid at the right edge with mirrored cell alignment', async ({ page }) => {
  await open(page, 'rtl=1');
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-rtl.png');
});

test('RTL, truncated', async ({ page }) => {
  await open(page, 'rtl=1&long=1&cols=6');
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-rtl-truncated.png');
});

test('scrolled horizontally: the grid stays pinned, the header lines up with the day columns', async ({ page }) => {
  await open(page);
  await page.evaluate(() => new Promise<void>((r) => { document.getElementById('gantt')!.scrollLeft = 300; requestAnimationFrame(() => requestAnimationFrame(() => r())); }));
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-scrolled.png');
});

test('a selected row', async ({ page }) => {
  await open(page);
  await page.locator('#gantt svg.fg-timeline__sticky-column g[data-task-id="design"] text').first().click();
  await page.mouse.move(0, 0);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-selected.png');
});

test('collapsed to the name column on a narrow container', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await open(page);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-narrow.png');
});

test('hours unit and a German locale', async ({ page }) => {
  await open(page, 'hours=1&locale=de');
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-hours-de.png');
});

test('a column header focused with the keyboard shows its frame', async ({ page }) => {
  await open(page);
  await page.locator('#gantt [role=columnheader][data-column-id=start]').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('.fg-grid__ring')).toHaveCount(1); // drawn by the lazy half
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-header-focus.png');
});

test('RTL: the focused header frame', async ({ page }) => {
  await open(page, 'rtl=1');
  await page.locator('#gantt [role=columnheader][data-column-id=start]').focus();
  await expect(page.locator('.fg-grid__ring')).toHaveCount(1);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-header-focus-rtl.png');
});
