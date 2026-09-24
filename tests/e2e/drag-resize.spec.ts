import { test, expect } from '@playwright/test';
import {
  DEFAULT_PIXELS_PER_DAY,
  mouseDrag,
  readTaskDate,
  recordEvent,
  waitForMountedDemo,
} from '../helpers/drag.js';

// Desktop drag-resize e2e (spec-drag-resize.md). Drives the quick-start demo with real mouse
// events; see `tests/e2e/drag-move.spec.ts`' header for the shared day-snap geometry note.
//
// THE GEOMETRY THIS FILE NEEDS, and the non-obvious half of it.
//
// Resize is claimed only by a pointerdown inside the bar's RIGHT-edge hit zone —
// `DEFAULT_EDGE_HIT_ZONE_PX` = 8px measured inward from the rendered right edge
// (`interaction/drag-resize.ts`; the 24px coarse value applies only under `(pointer: coarse)`,
// which this Desktop Chrome project is not). A grab at the bar centre is claimed by drag-move,
// which wins everywhere outside that band.
//
// But the OUTERMOST part of the band is not resize's either, and this cost real debugging time:
// the `.fg-task__link-handle` circle sits ON the bar's end anchor with `r: 4px`
// (`var(--fg-link-handle-radius, 4px)`, `svg-renderer.ts`) and is hover-revealed — and the mouse
// must hover the bar to press it. Once revealed it takes `pointer-events: all`, and
// drag-create-dep's `LINK_PRIORITY` (-10) is LOWER than `RESIZE_PRIORITY` (0), so it is offered
// the pointerdown first and claims it. A 3px inset therefore silently exercises
// drag-create-dependency: the gesture opens, no `task:resized` ever fires, and the dates do not
// move.
//
// So the press point must clear the handle radius while staying inside the 8px zone: 4 < inset
// <= 8. 6px sits in the middle of that 4px-wide band. Widen the handle radius or narrow the edge
// zone and this constant has to be re-derived — the two are already documented as a pair in
// `drag-resize.ts`'s `COARSE_EDGE_HIT_ZONE_PX` comment.
const EDGE_GRAB_INSET_PX = 6;

/** Press point inside a bar's right-edge resize zone. */
async function rightEdgeOf(
  page: import('@playwright/test').Page,
  taskId: string,
): Promise<{ x: number; y: number }> {
  const bar = page.locator(`[data-task-id="${taskId}"] .fg-task__bar`);
  await bar.scrollIntoViewIfNeeded();
  const box = await bar.boundingBox();
  if (!box) throw new Error(`no bounding box for task '${taskId}'`);
  return { x: box.x + box.width - EDGE_GRAB_INSET_PX, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForMountedDemo(page);
});

test('dragging a task edge emits task:resized', async ({ page }) => {
  const resized = await recordEvent(page, 'task:resized');
  const endBefore = await readTaskDate(page, 'build', 'end');

  await mouseDrag(page, await rightEdgeOf(page, 'build'), DEFAULT_PIXELS_PER_DAY * 3);

  await expect.poll(async () => await resized()).toContain('build');
  expect(Date.parse(await readTaskDate(page, 'build', 'end'))).toBeGreaterThan(
    Date.parse(endBefore),
  );
});

test('a resize moves only the end — `start` is kept', async ({ page }) => {
  // Resolution #1 of the spec, and the whole distinction from drag-move: `x` is never written.
  const startBefore = await readTaskDate(page, 'build', 'start');

  await mouseDrag(page, await rightEdgeOf(page, 'build'), DEFAULT_PIXELS_PER_DAY * 2);

  await expect
    .poll(() => readTaskDate(page, 'build', 'start'))
    .toBe(startBefore);
});

test('dragging the edge inward shortens the task', async ({ page }) => {
  const endBefore = await readTaskDate(page, 'build', 'end');

  await mouseDrag(page, await rightEdgeOf(page, 'build'), -DEFAULT_PIXELS_PER_DAY * 2);

  await expect
    .poll(async () => Date.parse(await readTaskDate(page, 'build', 'end')))
    .toBeLessThan(Date.parse(endBefore));
});

test('a resize cannot invert the bar — the end is floored at start + 1 day', async ({ page }) => {
  // `computeClampedResizedEnd`'s floor (resolution #3). A drag far past the bar's own start must
  // leave a task that still ends after it begins, not a negative-duration one.
  await mouseDrag(page, await rightEdgeOf(page, 'build'), -DEFAULT_PIXELS_PER_DAY * 30);

  const [start, end] = [
    await readTaskDate(page, 'build', 'start'),
    await readTaskDate(page, 'build', 'end'),
  ];
  expect(Date.parse(end)).toBeGreaterThan(Date.parse(start));
});

test('a read-only chart does not resize on drag', async ({ page }) => {
  await page.goto('/read-only.html');
  await waitForMountedDemo(page);
  const resized = await recordEvent(page, 'task:resized');
  const endBefore = await readTaskDate(page, 'build', 'end');

  await mouseDrag(page, await rightEdgeOf(page, 'build'), DEFAULT_PIXELS_PER_DAY * 3);

  expect(await resized()).toEqual([]);
  expect(await readTaskDate(page, 'build', 'end')).toBe(endBefore);
});
