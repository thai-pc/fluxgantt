import { test, expect } from '@playwright/test';
import {
  DEFAULT_PIXELS_PER_DAY,
  centreOf,
  mouseDrag,
  readTaskDate,
  recordEvent,
  waitForMountedDemo,
} from '../helpers/drag.js';

// Desktop drag-move e2e (spec-drag-move.md §10). Drives the quick-start demo
// (`examples/plain-html-demo/index.html`, `window.__gantt`) with real mouse events.
//
// GEOMETRY, which is why this was a stub for so long: a drag only commits if it crosses at least
// one snapped day (`snapDeltaToDay` in `interaction/pointer-drag.ts` ROUNDS `dx / pixelsPerDay`,
// so anything under half a day rounds to 0 and the gesture is a no-op by design). The demo mounts
// at the `week` default, so one day is 24px — every distance below is expressed in days via
// `DEFAULT_PIXELS_PER_DAY` rather than as a bare pixel count, so a change to `PIXELS_PER_DAY`
// surfaces as one failing constant instead of four mystifying assertion failures.
//
// The grab point is the bar CENTRE, deliberately clear of the 8px right-edge resize zone
// (`DEFAULT_EDGE_HIT_ZONE_PX`, `interaction/drag-resize.ts`) — a grab inside that zone would be
// claimed by the resize recognizer, which has the higher priority for that band.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForMountedDemo(page);
});

test('dragging a task bar horizontally emits task:moved', async ({ page }) => {
  const moved = await recordEvent(page, 'task:moved');
  const startBefore = await readTaskDate(page, 'build', 'start');

  await mouseDrag(page, await centreOf(page.locator('[data-task-id="build"] .fg-task__bar')), DEFAULT_PIXELS_PER_DAY * 3);

  await expect.poll(async () => await moved()).toContain('build');
  const startAfter = await readTaskDate(page, 'build', 'start');
  // Dragged RIGHT, so the task must have moved LATER — not merely changed.
  expect(Date.parse(startAfter)).toBeGreaterThan(Date.parse(startBefore));
});

test('a drag preserves duration — both ends move by the same amount', async ({ page }) => {
  // The whole point of drag-move as distinct from drag-resize: `computeDraggedDates` adds the same
  // calendar delta to `start` and `end` (`interaction/drag-move.ts`, decision Q4).
  const [startBefore, endBefore] = [
    await readTaskDate(page, 'build', 'start'),
    await readTaskDate(page, 'build', 'end'),
  ];

  await mouseDrag(page, await centreOf(page.locator('[data-task-id="build"] .fg-task__bar')), DEFAULT_PIXELS_PER_DAY * 2);

  const [startAfter, endAfter] = [
    await readTaskDate(page, 'build', 'start'),
    await readTaskDate(page, 'build', 'end'),
  ];
  expect(Date.parse(startAfter)).toBeGreaterThan(Date.parse(startBefore));
  expect(Date.parse(endAfter) - Date.parse(startAfter)).toBe(
    Date.parse(endBefore) - Date.parse(startBefore),
  );
});

test('dragging left moves the task earlier', async ({ page }) => {
  const startBefore = await readTaskDate(page, 'build', 'start');

  await mouseDrag(page, await centreOf(page.locator('[data-task-id="build"] .fg-task__bar')), -DEFAULT_PIXELS_PER_DAY * 2);

  await expect
    .poll(async () => Date.parse(await readTaskDate(page, 'build', 'start')))
    .toBeLessThan(Date.parse(startBefore));
});

test('a sub-threshold press-and-release is a click, not a move', async ({ page }) => {
  // Two separate suppressions stack here, and this asserts the pair: 2px never crosses
  // `DEFAULT_DRAG_THRESHOLD_PX` (4), so no gesture opens at all — and even if one had, 2px is far
  // under half a grid day, so `snapDeltaToDay` would round it to 0 days.
  const moved = await recordEvent(page, 'task:moved');
  const startBefore = await readTaskDate(page, 'build', 'start');

  await mouseDrag(page, await centreOf(page.locator('[data-task-id="build"] .fg-task__bar')), 2, 0, { steps: 2 });

  expect(await moved()).toEqual([]);
  expect(await readTaskDate(page, 'build', 'start')).toBe(startBefore);
});

test('a read-only chart does not move on drag', async ({ page }) => {
  await page.goto('/read-only.html');
  await waitForMountedDemo(page);
  const moved = await recordEvent(page, 'task:moved');
  const startBefore = await readTaskDate(page, 'build', 'start');

  await mouseDrag(page, await centreOf(page.locator('[data-task-id="build"] .fg-task__bar')), DEFAULT_PIXELS_PER_DAY * 3);

  expect(await moved()).toEqual([]);
  expect(await readTaskDate(page, 'build', 'start')).toBe(startBefore);
});
