import { test, expect, type CDPSession, type Page } from '@playwright/test';

// Touch coverage for the grid cell editors (spec-grid-columns.md 10.2, 13.4; PR G6): a double-tap on a pinned cell opens
// the editor through the browser's own touch pipeline (CDP `Input.dispatchTouchEvent`: real pointer events with
// `pointerType: 'touch'`), the editor is visible inside the viewport, a long-press in it never reaches the chart, and a
// single tap on a pinned cell does not open it. Fixture: `/grid.html?edit=1&cols=3` (Pixel 5, the only coarse-pointer project).

let cdp: CDPSession;
const touch = (type: 'touchStart' | 'touchEnd', x = 0, y = 0) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function tap(x: number, y: number): Promise<void> {
  await touch('touchStart', x, y);
  await touch('touchEnd');
}

test.beforeEach(async ({ page, context }: { page: Page; context: import('@playwright/test').BrowserContext }) => {
  await page.goto('/grid.html?edit=1&cols=3&collapse=0');
  await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
  await page.waitForFunction(() => '__gantt' in window);
  cdp = await context.newCDPSession(page);
});

/** Centre of a pinned cell in viewport coordinates: row `index` (0 = plan) of column `colIndex`. */
async function cellCentre(page: Page, index: number, colIndex: number) {
  const pin = (await page.locator('#gantt .fg-timeline__sticky-column').boundingBox())!;
  const offs = [0, 220, 340];
  const widths = [220, 120, 96];
  return { x: pin.x + offs[colIndex]! + widths[colIndex]! / 2, y: pin.y + 32 + 32 * index + 16 };
}

test('a double-tap on a pinned cell opens the editor, inside the viewport', async ({ page }) => {
  const { x, y } = await cellCentre(page, 2, 1); // design, start
  await tap(x, y);
  await page.waitForTimeout(80);
  await tap(x, y);
  const input = page.locator('#gantt .fg-grid__editor');
  await expect(input).toHaveAttribute('aria-label', 'Start, Design');
  await expect(input).toBeFocused();
  const box = (await input.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
});

test('a single tap on a pinned cell does not open it', async ({ page }) => {
  const { x, y } = await cellCentre(page, 2, 1);
  await tap(x, y);
  await page.waitForTimeout(500);
  await expect(page.locator('#gantt .fg-grid__editor')).toHaveCount(0);
});

test('two taps far apart or slow are not a double-tap', async ({ page }) => {
  const a = await cellCentre(page, 2, 1);
  const b = await cellCentre(page, 4, 1);
  await tap(a.x, a.y);
  await page.waitForTimeout(80);
  await tap(b.x, b.y);
  await page.waitForTimeout(500);
  await expect(page.locator('#gantt .fg-grid__editor')).toHaveCount(0);
});

test('editing with the soft keyboard commits through the chart', async ({ page }) => {
  const { x, y } = await cellCentre(page, 2, 0);
  await tap(x, y);
  await page.waitForTimeout(80);
  await tap(x, y);
  const input = page.locator('#gantt .fg-grid__editor');
  await expect(input).toBeFocused();
  await input.fill('Touch edited');
  await page.keyboard.press('Enter');
  await expect(input).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __gantt: { getTask(id: string): { name: string } } }).__gantt.getTask('design').name)).toBe('Touch edited');
});
