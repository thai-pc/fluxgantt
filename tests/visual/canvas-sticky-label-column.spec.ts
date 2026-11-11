import { test, expect, type Page } from '@playwright/test';
import { openCanvasDrag } from '../helpers/canvas-drag.js';
import { pinToday } from '../helpers/pin-today.js';

// Pinned Canvas label column (spec-canvas-sticky-label-column.md section 9.5): what no DOM assertion
// can show, the column pinned over a chart that has scrolled under it. Baselines are committed per
// platform (`-darwin.png` here, `-linux.png` from a CI run, never hand-edited; testing.md).
// "Today" is pinned to a date inside the plan so the marker does not depend on the wall clock.

const TODAY = '2026-08-12T12:00:00Z';
const frames = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));

async function open(page: Page, query = ''): Promise<void> {
  await pinToday(page, TODAY);
  await openCanvasDrag(page, query);
  await page.mouse.move(0, 0);
  await frames(page);
}
async function scroll(page: Page, left: number, top = 0): Promise<void> {
  await page.evaluate(([l, t]) => {
    const c = document.getElementById('gantt')!;
    c.scrollLeft = l!;
    c.scrollTop = t!;
  }, [left, top] as const);
  await frames(page);
}

test('scrolled right: the column stays and a bar passes under it', async ({ page }) => {
  await open(page);
  await scroll(page, 250);
  await expect(page.locator('#gantt')).toHaveScreenshot('canvas-sticky-scrolled-right.png');
});

test('scrolled on both axes the corner, band and column are pinned together', async ({ page }) => {
  await open(page);
  await scroll(page, 250, 320);
  await expect(page.locator('#gantt')).toHaveScreenshot('canvas-sticky-scrolled-both.png');
});

test('a hierarchy keeps its toggles and indentation in the pinned column', async ({ page }) => {
  await open(page);
  await scroll(page, 120);
  await expect(page.locator('#gantt')).toHaveScreenshot('canvas-sticky-hierarchy.png');
});

test('a long name is cut at the pinned column edge', async ({ page }) => {
  await open(page, 'longnames=1');
  await scroll(page, 200);
  await expect(page.locator('#gantt')).toHaveScreenshot('canvas-sticky-long-name.png');
});

test('a dark chart scrolled right repaints the pinned column from the dark tokens', async ({ page }) => {
  await open(page, 'theme=dark');
  await scroll(page, 250);
  await expect(page.locator('#gantt')).toHaveScreenshot('canvas-sticky-dark.png');
});
