import { test, expect } from '@playwright/test';
import { PX_PER_DAY, barBox, centre, mouseDragTo, openCanvasDrag } from '../helpers/canvas-drag.js';

// Mid-gesture appearance of the Canvas drag overlay (spec-canvas-drag.md §11): the ghost for a move
// and a resize, the link rubber band, and the hover-revealed handles. The gesture is HELD (no
// `mouse.up`) so the snapshot captures the overlay. Baselines are per platform; see testing.md.
// Clip: the header band plus the first eight rows, label column included.
const CLIP_HEIGHT = 32 + 8 * 32 + 8;
const clipOf = async (page: import('@playwright/test').Page) => {
  const box = (await page.locator('#gantt canvas.fg-timeline-canvas').boundingBox())!;
  return { x: box.x, y: box.y, width: Math.min(box.width, 960), height: CLIP_HEIGHT };
};

test.beforeEach(async ({ page }) => {
  await openCanvasDrag(page);
  await page.mouse.move(0, 0);
});

test('move: a translucent ghost 3 days to the right, original bar still painted', async ({ page }) => {
  const c = centre(await barBox(page, 'b'));
  await mouseDragTo(page, c, { x: c.x + 3 * PX_PER_DAY, y: c.y }, { release: false });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
  expect(await page.screenshot({ clip: await clipOf(page) })).toMatchSnapshot('canvas-drag-move-ghost.png');
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('resize: the ghost is 2 days wider', async ({ page }) => {
  const b = await barBox(page, 'b');
  const grab = { x: b.x + b.w - 6, y: b.y + b.h / 2 };
  await mouseDragTo(page, grab, { x: grab.x + 2 * PX_PER_DAY, y: grab.y }, { release: false });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
  expect(await page.screenshot({ clip: await clipOf(page) })).toMatchSnapshot('canvas-drag-resize-ghost.png');
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('link: a dashed rubber band with an arrowhead and the candidate target outlined', async ({ page }) => {
  const a = await barBox(page, 'a');
  const target = centre(await barBox(page, 'c'));
  await mouseDragTo(page, { x: a.x + a.w, y: a.y + a.h / 2 }, target, { release: false });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
  expect(await page.screenshot({ clip: await clipOf(page) })).toMatchSnapshot('canvas-drag-link-rubber-band.png');
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('hover reveals the two link handles on the hovered bar', async ({ page }) => {
  const c = centre(await barBox(page, 'b'));
  await page.mouse.move(c.x, c.y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
  expect(await page.screenshot({ clip: await clipOf(page) })).toMatchSnapshot('canvas-drag-hover-handles.png');
});

test('dark theme: ghost, rubber band and target outline use the dark tokens', async ({ page }) => {
  await openCanvasDrag(page, 'theme=dark');
  await page.mouse.move(0, 0);
  const a = await barBox(page, 'a');
  await mouseDragTo(page, { x: a.x + a.w, y: a.y + a.h / 2 }, centre(await barBox(page, 'c')), { release: false });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
  expect(await page.screenshot({ clip: await clipOf(page) })).toMatchSnapshot('canvas-drag-link-dark.png');
  await page.keyboard.press('Escape');
  await page.mouse.up();
});
