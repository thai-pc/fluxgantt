import { test, expect, type Page } from '@playwright/test';
import { pinToday } from '../helpers/pin-today.js';

// Visual regression for the grid cell editors (spec-grid-columns.md 13.7; PR G6): the open editor on a text cell, a
// date cell and a progress cell, the inline error, RTL, and the Canvas overlay. Baselines are committed per platform
// (`-darwin.png` from a local run, `-linux.png` from a CI run, never hand-edited; testing.md). "Today" is pinned.
// Fixture: `grid.html?edit=1`.

const TODAY = '2026-02-10T12:00:00Z';

async function open(page: Page, query: string, canvas = false): Promise<void> {
  await pinToday(page, TODAY);
  await page.goto(`/grid.html?edit=1&cols=6&${canvas ? 'rows=2100&' : ''}${query}`);
  await page.waitForFunction(() => '__gantt' in window);
  if (canvas) {
    await expect(page.locator('#gantt canvas.fg-timeline-canvas-labels')).toBeAttached({ timeout: 30_000 });
    await page.waitForFunction(() => (document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement | null)?.width === 772);
  } else {
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  }
  await page.mouse.move(0, 0);
}
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
async function edit(page: Page, task: string, steps: number, rtl: boolean, text?: string): Promise<void> {
  await page.locator(`#gantt [role=row][data-task-id=${task}]`).focus();
  for (let i = 0; i < steps; i++) await page.keyboard.press(rtl ? 'ArrowLeft' : 'ArrowRight');
  await expect(page.locator('#gantt [role=gridcell]:focus')).toHaveAttribute('aria-colindex', String(steps)); // the cell moves are lazy
  await page.keyboard.press('Enter');
  await expect(page.locator('#gantt .fg-grid__editor')).toBeFocused();
  if (text !== undefined) await page.locator('#gantt .fg-grid__editor').fill(text);
  await page.mouse.move(0, 0);
  await frames(page);
}

test('the editor open on a text cell', async ({ page }) => {
  await open(page, '');
  await edit(page, 'design', 1, false);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-editor-text.png');
});

test('the editor open on a date cell', async ({ page }) => {
  await open(page, '');
  await edit(page, 'design', 2, false);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-editor-date.png');
});

test('the editor open on a progress cell', async ({ page }) => {
  await open(page, '');
  await edit(page, 'design', 5, false);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-editor-progress.png');
});

test('the inline error', async ({ page }) => {
  await open(page, '');
  await edit(page, 'design', 5, false, '150');
  await page.keyboard.press('Enter');
  await expect(page.locator('#gantt .fg-grid__edit-error')).toBeVisible();
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-editor-error.png');
});

test('RTL: the editor open on the progress cell', async ({ page }) => {
  await open(page, 'rtl=1');
  await edit(page, 'design', 5, true);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-editor-rtl.png');
});

test('dark theme: the editor in error', async ({ page }) => {
  await open(page, 'theme=dark');
  await edit(page, 'design', 4, false, 'abc');
  await page.keyboard.press('Enter');
  await expect(page.locator('#gantt .fg-grid__edit-error')).toBeVisible();
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-editor-dark-error.png');
});

test('Canvas: the overlay over the painted cell', async ({ page }) => {
  await open(page, '', true);
  await edit(page, 'design', 2, false);
  await expect(page.locator('#gantt')).toHaveScreenshot('grid-editor-canvas.png');
});
