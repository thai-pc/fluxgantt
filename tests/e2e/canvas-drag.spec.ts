import { test, expect } from '@playwright/test';
import {
  DAY_MS,
  PX_PER_DAY,
  barBox,
  canvasCursor,
  centre,
  dependencyCount,
  events,
  mouseDragTo,
  openCanvasDrag,
  taskMs,
} from '../helpers/canvas-drag.js';

// Desktop Canvas-mode drag (spec-canvas-drag.md §11). Fixture: `examples/plain-html-demo/
// canvas-drag.html` (2100 filler tasks => the Canvas renderer through the real `mount()`). Rows 0-7
// are: a, b, c, d (leaf bars), ms (milestone), sum + x + y (a summary and its two children); c -> d
// is the one existing dependency. One day is 24 px at the default `week` view.

test.describe('drag-move', () => {
  test.beforeEach(async ({ page }) => openCanvasDrag(page));

  test('moves a leaf bar +3 days, preserving duration, as ONE undo step', async ({ page }) => {
    const [s0, e0] = [await taskMs(page, 'a', 'start'), await taskMs(page, 'a', 'end')];
    const c = centre(await barBox(page, 'a'));
    await mouseDragTo(page, c, { x: c.x + 3 * PX_PER_DAY, y: c.y });

    await expect.poll(async () => (await events(page, 'task:moved')).length).toBe(1);
    expect((await events(page, 'task:moved'))[0]!.payload['taskId']).toBe('a');
    expect(await taskMs(page, 'a', 'start')).toBe(s0 + 3 * DAY_MS);
    expect(await taskMs(page, 'a', 'end')).toBe(e0 + 3 * DAY_MS);

    await page.evaluate(() => (window as unknown as { __gantt: { undo(): void } }).__gantt.undo());
    expect(await taskMs(page, 'a', 'start')).toBe(s0);
    expect(await taskMs(page, 'a', 'end')).toBe(e0);
  });

  test('a sub-threshold press-release is a selection click, not a move', async ({ page }) => {
    const c = centre(await barBox(page, 'a'));
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 2, c.y);
    await page.mouse.up();
    await expect.poll(async () => (await events(page, 'selection:changed')).length).toBeGreaterThan(0);
    expect(await events(page, 'task:moved')).toHaveLength(0);
  });

  test('Escape mid-drag commits nothing and leaves the main canvas bitmap untouched', async ({ page }) => {
    const shot = () => page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas')!.toDataURL());
    const before = await shot();
    const s0 = await taskMs(page, 'a', 'start');
    const c = centre(await barBox(page, 'a'));
    await mouseDragTo(page, c, { x: c.x + 100, y: c.y }, { release: false });
    expect(await shot()).toBe(before); // the ghost lives on the overlay: the bar itself never repaints
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await events(page, 'task:moved')).toHaveLength(0);
    expect(await taskMs(page, 'a', 'start')).toBe(s0);
    expect(await shot()).toBe(before);
  });

  test('a child of a summary bar moves independently', async ({ page }) => {
    // No `rollup` is configured in the fixture, so this exercises an ordinary hierarchy leaf.
    const c = centre(await barBox(page, 'x'));
    await mouseDragTo(page, c, { x: c.x + PX_PER_DAY, y: c.y });
    await expect.poll(async () => (await events(page, 'task:moved')).length).toBeGreaterThan(0);
    expect((await events(page, 'task:moved')).map((e) => e.payload['taskId'])).toContain('x');
  });

  test('moves the right task after scrolling the container 38 rows down and across', async ({ page }) => {
    // The filler bars sit in September, to the right of the first screenful: scroll both axes.
    await page.evaluate(() => {
      const g = document.getElementById('gantt')!;
      g.scrollTop = 38 * 32 - 64;
      g.scrollLeft = 700;
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
    const id = 'filler-30'; // row 38
    const s0 = await taskMs(page, id, 'start');
    const c = centre(await barBox(page, id));
    await mouseDragTo(page, c, { x: c.x + 3 * PX_PER_DAY, y: c.y });
    await expect.poll(async () => (await events(page, 'task:moved')).length).toBe(1);
    expect((await events(page, 'task:moved'))[0]!.payload['taskId']).toBe(id);
    expect(await taskMs(page, id, 'start')).toBe(s0 + 3 * DAY_MS);
  });

  test('moves the right task after scrolling horizontally', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('gantt')!.scrollLeft = 200;
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
    const s0 = await taskMs(page, 'b', 'start');
    const c = centre(await barBox(page, 'b'));
    await mouseDragTo(page, c, { x: c.x - 2 * PX_PER_DAY, y: c.y });
    await expect.poll(async () => (await events(page, 'task:moved')).length).toBe(1);
    expect(await taskMs(page, 'b', 'start')).toBe(s0 - 2 * DAY_MS);
  });
});

test.describe('drag-resize', () => {
  test.beforeEach(async ({ page }) => openCanvasDrag(page));

  test('drags the right edge +2 days: end moves, start does not', async ({ page }) => {
    const [s0, e0] = [await taskMs(page, 'b', 'start'), await taskMs(page, 'b', 'end')];
    const b = await barBox(page, 'b');
    const grab = { x: b.x + b.w - 6, y: b.y + b.h / 2 }; // inside the 8 px edge zone, outside the 4 px handle
    await mouseDragTo(page, grab, { x: grab.x + 2 * PX_PER_DAY, y: grab.y });
    await expect.poll(async () => (await events(page, 'task:resized')).length).toBe(1);
    expect((await events(page, 'task:resized'))[0]!.payload['taskId']).toBe('b');
    expect(await taskMs(page, 'b', 'start')).toBe(s0);
    expect(await taskMs(page, 'b', 'end')).toBeGreaterThan(e0);
    expect(await events(page, 'task:moved')).toHaveLength(0);
  });
});

test.describe('drag-create-dependency', () => {
  test.beforeEach(async ({ page }) => openCanvasDrag(page));

  test('the END handle links origin -> drop target (FS)', async ({ page }) => {
    const a = await barBox(page, 'a');
    await mouseDragTo(page, { x: a.x + a.w, y: a.y + a.h / 2 }, centre(await barBox(page, 'b')));
    await expect.poll(async () => (await events(page, 'dependency:added')).length).toBe(1);
    expect((await events(page, 'dependency:added'))[0]!.payload).toMatchObject({ from: 'a', to: 'b' });
    expect(await dependencyCount(page)).toBe(2);
  });

  test('the START handle reverses the direction', async ({ page }) => {
    const b = await barBox(page, 'b');
    await mouseDragTo(page, { x: b.x, y: b.y + b.h / 2 }, centre(await barBox(page, 'a')));
    await expect.poll(async () => (await events(page, 'dependency:added')).length).toBe(1);
    expect((await events(page, 'dependency:added'))[0]!.payload).toMatchObject({ from: 'a', to: 'b' });
  });

  test('invalid drops change nothing: self, empty space, duplicate, cycle', async ({ page }) => {
    const before = await dependencyCount(page);
    const a = await barBox(page, 'a');
    const end = (b: typeof a) => ({ x: b.x + b.w, y: b.y + b.h / 2 });
    await mouseDragTo(page, end(a), centre(a)); // self
    await mouseDragTo(page, end(a), { x: a.x + a.w + 400, y: a.y + a.h / 2 }); // empty space
    const [c, d] = [await barBox(page, 'c'), await barBox(page, 'd')];
    await mouseDragTo(page, end(c), centre(d)); // duplicate c -> d
    await mouseDragTo(page, end(d), centre(c)); // cycle d -> c
    expect(await events(page, 'dependency:added')).toHaveLength(0);
    expect(await dependencyCount(page)).toBe(before);
  });
});

test('a link released outside the visible chart creates nothing (parity with SVG)', async ({ page }) => {
  await openCanvasDrag(page);
  const a = await barBox(page, 'a');
  // The canvas is wider than the container: row 0 continues to the right of the container's edge.
  const right = await page.evaluate(() => document.getElementById('gantt')!.getBoundingClientRect().right);
  await mouseDragTo(page, { x: a.x + a.w, y: a.y + a.h / 2 }, { x: right + 60, y: a.y + a.h / 2 + 32 });
  expect(await events(page, 'dependency:added')).toHaveLength(0);
});

test.describe('cursor feedback', () => {
  test('grab / ew-resize / crosshair over body / edge / handle, cleared elsewhere', async ({ page }) => {
    await openCanvasDrag(page);
    const a = await barBox(page, 'a');
    const my = a.y + a.h / 2;
    await page.mouse.move(a.x + a.w / 2, my);
    await expect.poll(() => canvasCursor(page)).toBe('grab');
    await page.mouse.move(a.x + a.w - 6, my);
    await expect.poll(() => canvasCursor(page)).toBe('ew-resize');
    await page.mouse.move(a.x + a.w, my);
    await expect.poll(() => canvasCursor(page)).toBe('crosshair');
    await page.mouse.move(a.x + a.w + 200, my);
    await expect.poll(() => canvasCursor(page)).toBe('');
  });
});

test.describe('variants', () => {
  test('readonly=1: nothing drags or links, selection still works', async ({ page }) => {
    await openCanvasDrag(page, 'readonly=1');
    const c = centre(await barBox(page, 'a'));
    await mouseDragTo(page, c, { x: c.x + 72, y: c.y });
    const a = await barBox(page, 'a');
    await mouseDragTo(page, { x: a.x + a.w, y: a.y + a.h / 2 }, centre(await barBox(page, 'b')));
    expect(await events(page, 'task:moved')).toHaveLength(0);
    expect(await events(page, 'task:resized')).toHaveLength(0);
    expect(await events(page, 'dependency:added')).toHaveLength(0);
    expect(await canvasCursor(page)).toBe('');
    await page.mouse.click(c.x, c.y);
    await expect.poll(async () => (await events(page, 'selection:changed')).length).toBeGreaterThan(0);
    await expect(page.locator('canvas.fg-timeline-canvas-overlay')).toHaveCount(0);
  });

  test('nodeplink=1: moves still work, but the end handle is just a resize edge', async ({ page }) => {
    await openCanvasDrag(page, 'nodeplink=1');
    const a = await barBox(page, 'a');
    await page.mouse.move(a.x + a.w, a.y + a.h / 2);
    await expect.poll(() => canvasCursor(page)).toBe('ew-resize');
    await mouseDragTo(page, { x: a.x + a.w, y: a.y + a.h / 2 }, centre(await barBox(page, 'b')));
    expect(await events(page, 'dependency:added')).toHaveLength(0);
    const c = centre(await barBox(page, 'b'));
    await mouseDragTo(page, c, { x: c.x + 2 * PX_PER_DAY, y: c.y });
    await expect.poll(async () => (await events(page, 'task:moved')).length).toBe(1);
  });
});

test.describe('dark theme', () => {
  /** RGBA of the overlay pixel at a client point, or null when the overlay does not exist. */
  const overlayPixel = (page: import('@playwright/test').Page, x: number, y: number) =>
    page.evaluate(
      ([cx, cy]) => {
        const o = document.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas-overlay');
        if (!o) return null;
        const r = o.getBoundingClientRect();
        const k = o.width / r.width;
        return [...o.getContext('2d')!.getImageData(Math.round((cx! - r.left) * k), Math.round((cy! - r.top) * k), 1, 1).data];
      },
      [x, y] as const,
    );

  for (const [theme, fill] of [['dark', [24, 24, 27]], ['light', [255, 255, 255]]] as const) {
    test(`link handles take their fill from the ${theme} tokens`, async ({ page }) => {
      await openCanvasDrag(page, `theme=${theme}`);
      const a = await barBox(page, 'a');
      // Hover the bar, then sample just inside the end handle (centre is the 1.5 px stroke ring's hole).
      await page.mouse.move(a.x + a.w / 2, a.y + a.h / 2);
      await expect.poll(() => overlayPixel(page, a.x + a.w - 1.5, a.y + a.h / 2)).toEqual([...fill, 255]);
    });
  }
});
