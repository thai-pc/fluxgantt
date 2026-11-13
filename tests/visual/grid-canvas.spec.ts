import { test, expect, type Page } from '@playwright/test';
import { pinToday } from '../helpers/pin-today.js';

// Visual regression for `withGrid()` on the CANVAS renderer (spec-grid-columns.md 13.7; PR G2): the header
// band in the pinned corner, the dividers, the cell alignment, truncation, dark, RTL and the pinned column
// over a scrolled chart. Fixture: `grid.html?rows=2100` (Canvas through the real mount(); the container is
// the fixed 600 px viewport, so the screenshot is deterministic). Baselines are committed per platform
// (`-darwin.png` here, `-linux.png` from a CI run, never hand-edited; testing.md). "Today" is pinned first.

const TODAY = '2026-02-10T12:00:00Z';
const frames = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));

async function open(page: Page, query = '', width = 652): Promise<void> {
  await pinToday(page, TODAY);
  await page.goto(`/grid.html?rows=2100${query ? `&${query}` : ''}`);
  await expect(page.locator('#gantt canvas.fg-timeline-canvas-labels')).toBeAttached({ timeout: 30_000 });
  await page.waitForFunction((w) => (document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement | null)?.width === w, width);
  await page.mouse.move(0, 0);
  await frames(page);
}
const scroll = async (page: Page, left: number, top = 0): Promise<void> => {
  await page.evaluate(([l, t]) => {
    const c = document.getElementById('gantt')!;
    c.scrollLeft = l!;
    c.scrollTop = t!;
  }, [left, top] as const);
  await frames(page);
};

test('canvas: default five columns, light', async ({ page }) => {
  await open(page);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-canvas-default.png');
});

test('canvas: truncated names and an extra custom column', async ({ page }) => {
  await open(page, 'long=1&cols=6', 772);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-canvas-truncated.png');
});

test('canvas: dark theme', async ({ page }) => {
  await open(page, 'theme=dark');
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-canvas-dark.png');
});

test('canvas: RTL, the grid at the right edge with mirrored cell alignment', async ({ page }) => {
  await open(page, 'rtl=1');
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-canvas-rtl.png');
});

test('canvas: RTL, truncated', async ({ page }) => {
  await open(page, 'rtl=1&long=1&cols=6', 772);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-canvas-rtl-truncated.png');
});

test('canvas: scrolled on both axes the grid and its header stay pinned', async ({ page }) => {
  await open(page);
  await scroll(page, 300, 3200);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-canvas-scrolled.png');
});

test('canvas: collapsed to the name column on a narrow container', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await open(page, '', 220);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-canvas-narrow.png');
});

test('canvas: a column header focused with the keyboard shows its frame', async ({ page }) => {
  await open(page);
  await page.locator('#gantt [role=columnheader][data-column-id=start]').focus();
  await frames(page);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-canvas-header-focus.png');
});

test('canvas: a cell focused with the keyboard shows its ring', async ({ page }) => {
  await open(page);
  await page.locator('#gantt [role=row][data-task-id=design]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await frames(page);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-canvas-cell-focus.png');
});
