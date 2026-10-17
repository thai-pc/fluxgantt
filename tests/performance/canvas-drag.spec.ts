import { test, expect } from '@playwright/test';
import { PX_PER_DAY, barBox, centre, openCanvasDrag } from '../helpers/canvas-drag.js';

// Canvas drag cost at 5,000 tasks (spec-canvas-drag.md §7/§11). The design promise: a gesture never
// repaints the main canvas (`canvas.width` is never re-assigned: that reallocates a ~tens-of-MB
// bitmap) and a frame costs the same at 5,000 rows as at 50, because only the viewport-sized
// overlay is painted. Under the `performance` project alone (see the other specs here for why).
//
// Frame cost is read from every `requestAnimationFrame` callback's own duration (a wrapper
// installed before the page script runs): during a gesture the only rAF work is the overlay paint.

test('a 60-move drag at 5,000 tasks never touches the main canvas width and paints frames fast', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __widthWrites: number; __frameMs: number[] };
    w.__widthWrites = 0;
    w.__frameMs = [];
    const desc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!;
    Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
      ...desc,
      set(this: HTMLCanvasElement, v: number) {
        if (this.classList.contains('fg-timeline-canvas')) w.__widthWrites++;
        desc.set!.call(this, v);
      },
    });
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        const s = performance.now();
        cb(t);
        w.__frameMs.push(performance.now() - s);
      });
  });
  await openCanvasDrag(page, 'pad=4992');
  const info = await page.evaluate(() => (window as unknown as { __gantt: { getTasks(): unknown[] } }).__gantt.getTasks().length);
  expect(info).toBe(5000);

  await page.evaluate(() => {
    const w = window as unknown as { __widthWrites: number; __frameMs: number[] };
    w.__widthWrites = 0;
    w.__frameMs = [];
  });
  const c = centre(await barBox(page, 'a'));
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(c.x + i * (PX_PER_DAY / 6), c.y);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
  }
  const stats = await page.evaluate(() => {
    const w = window as unknown as { __widthWrites: number; __frameMs: number[] };
    const sorted = [...w.__frameMs].sort((a, b) => a - b);
    return { writes: w.__widthWrites, frames: sorted.length, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0 };
  });
  await page.mouse.up();

  expect(stats.writes).toBe(0);
  expect(stats.frames).toBeGreaterThan(10);
  // Target p95 < 4 ms; asserted loosely so a shared CI runner cannot flake it.
  expect(stats.p95).toBeLessThan(16);
});
