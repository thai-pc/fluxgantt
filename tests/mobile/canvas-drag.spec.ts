import { test, expect, type CDPSession, type Page } from '@playwright/test';
import { DAY_MS, PX_PER_DAY, barBox, centre, dependencyCount, events, openCanvasDrag, taskMs } from '../helpers/canvas-drag.js';

// Touch Canvas-mode drag (spec-canvas-drag.md §11), `mobile` project only (Pixel 5, the only
// `hasTouch`/coarse-pointer project). Fixture: `canvas-drag.html?responsive=1`. Gestures go through
// CDP `Input.dispatchTouchEvent`, i.e. the browser's own touch pipeline (real `pointerType: 'touch'`
// events, implicit capture, `touch-action`) rather than synthetic events, the same instrument
// `edit-hooks.spec.ts` uses.

let cdp: CDPSession;
const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function touchDrag(from: { x: number; y: number }, to: { x: number; y: number }, steps = 8): Promise<void> {
  await touch('touchStart', from.x, from.y);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await touch('touchMove', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
  }
  await touch('touchEnd');
}
const scrollLeft = (page: Page): Promise<number> => page.evaluate(() => document.getElementById('gantt')!.scrollLeft);
async function scrollTo(page: Page, left: number): Promise<void> {
  await page.evaluate((l) => {
    document.getElementById('gantt')!.scrollLeft = l;
  }, left);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
}

test.describe('Canvas touch drag', () => {
  test.beforeEach(async ({ page, context }) => {
    await openCanvasDrag(page, 'responsive=1');
    await expect
      .poll(() => page.evaluate(() => (window as never as { __gantt: { isCoarsePointer(): boolean } }).__gantt.isCoarsePointer()))
      .toBe(true);
    cdp = await context.newCDPSession(page);
  });

  test('touch-dragging a bar moves it and the container does not scroll', async ({ page }) => {
    await scrollTo(page, 200);
    const s0 = await taskMs(page, 'a', 'start');
    const c = centre(await barBox(page, 'a'));
    await touchDrag(c, { x: c.x + 3 * PX_PER_DAY, y: c.y });
    await expect.poll(async () => (await events(page, 'task:moved')).length).toBe(1);
    expect(await taskMs(page, 'a', 'start')).toBe(s0 + 3 * DAY_MS);
    expect(await scrollLeft(page)).toBe(200);
  });

  test('touch-dragging empty chart area still pans', async ({ page }) => {
    const b = await barBox(page, 'a');
    await touchDrag({ x: 20, y: b.y + b.h / 2 }, { x: -80 + 20, y: b.y + b.h / 2 }); // label column, away from every bar
    await expect.poll(() => scrollLeft(page)).toBeGreaterThan(40);
    expect(await events(page, 'task:moved')).toHaveLength(0);
  });

  test('tapping a bar selects it and reveals link handles on the overlay', async ({ page }) => {
    await scrollTo(page, 200);
    const c = centre(await barBox(page, 'a'));
    await page.touchscreen.tap(c.x, c.y);
    await expect.poll(async () => (await events(page, 'selection:changed')).length).toBeGreaterThan(0);
    await expect(page.locator('canvas.fg-timeline-canvas-overlay')).toHaveCount(1);
    const painted = await page.evaluate(() => {
      const o = document.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas-overlay')!;
      const d = o.getContext('2d')!.getImageData(0, 0, o.width, o.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) return true;
      return false;
    });
    expect(painted).toBe(true);
  });

  test('a link drag from a selected bar\'s handle creates the dependency', async ({ page }) => {
    await scrollTo(page, 250);
    const a = await barBox(page, 'a');
    await page.touchscreen.tap(a.x + a.w / 2, a.y + a.h / 2);
    await expect.poll(async () => (await events(page, 'selection:changed')).length).toBeGreaterThan(0);
    await touchDrag({ x: a.x + a.w, y: a.y + a.h / 2 }, centre(await barBox(page, 'b')));
    await expect.poll(async () => (await events(page, 'dependency:added')).length).toBe(1);
    expect((await events(page, 'dependency:added'))[0]!.payload).toMatchObject({ from: 'a', to: 'b' });
    expect(await dependencyCount(page)).toBe(2);
  });

  test('without selecting first, the end of a bar is a resize edge, not a link handle', async ({ page }) => {
    await scrollTo(page, 250);
    const a = await barBox(page, 'a');
    const e0 = await taskMs(page, 'a', 'end');
    await touchDrag({ x: a.x + a.w - 18, y: a.y + a.h / 2 }, { x: a.x + a.w - 18 + 2 * PX_PER_DAY, y: a.y + a.h / 2 });
    await expect.poll(async () => (await events(page, 'task:resized')).length).toBe(1);
    expect(await taskMs(page, 'a', 'end')).toBeGreaterThan(e0);
    expect(await events(page, 'dependency:added')).toHaveLength(0);
  });
});

test.describe('Canvas touch drag with edit hooks', () => {
  test.beforeEach(async ({ page, context }) => {
    await openCanvasDrag(page, 'responsive=1&edithooks=1');
    await expect
      .poll(() => page.evaluate(() => (window as never as { __gantt: { isCoarsePointer(): boolean } }).__gantt.isCoarsePointer()))
      .toBe(true);
    cdp = await context.newCDPSession(page);
    await scrollTo(page, 200);
  });

  test('a long-press on a bar emits task:context-requested and the gesture is cancelled', async ({ page }) => {
    const c = centre(await barBox(page, 'a'));
    await touch('touchStart', c.x, c.y);
    await page.waitForTimeout(800);
    await touch('touchMove', c.x + 3 * PX_PER_DAY, c.y);
    await touch('touchEnd');
    const ctx = await events(page, 'task:context-requested');
    expect(ctx).toHaveLength(1);
    expect(ctx[0]!.payload).toMatchObject({ taskId: 'a', source: 'long-press', part: 'row' });
    expect(await events(page, 'task:moved')).toHaveLength(0);
  });

  test('a 5 px drift then a rest does NOT fire the long-press and the drag still commits', async ({ page }) => {
    const c = centre(await barBox(page, 'a'));
    await touch('touchStart', c.x, c.y);
    await touch('touchMove', c.x + 5, c.y); // past the 4 px drag threshold, inside the 8 px touch slop
    await page.waitForTimeout(800);
    expect(await events(page, 'task:context-requested')).toHaveLength(0);
    await touch('touchMove', c.x + 3 * PX_PER_DAY, c.y);
    await touch('touchEnd');
    await expect.poll(async () => (await events(page, 'task:moved')).length).toBe(1);
  });
});
