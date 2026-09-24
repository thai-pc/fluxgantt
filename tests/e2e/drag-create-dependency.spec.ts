import { test, expect, type Page } from '@playwright/test';
import { mouseDrag, recordEvent, waitForMountedDemo } from '../helpers/drag.js';

// Desktop drag-create-dependency e2e (spec-drag-create-dependency.md §4.2). Drives the quick-start
// demo with real mouse events.
//
// TWO PIECES OF NON-OBVIOUS MECHANICS, both of which this file depends on:
//
// (1) The handles are HOVER-REVEALED. `.fg-task__link-handle` ships `opacity: 0` +
//     `pointer-events: none`, lifted only under `.fg-task:hover` / `:focus-within`
//     (`LINK_HANDLE_STYLE_TEXT`, `svg-renderer.ts`). A `pointerdown` on a handle that has not been
//     hovered is not grabbable at all, so every gesture below hovers the source task first.
//     `mouseDrag` then starts with a `page.mouse.move` to the same point, which keeps the hover
//     alive through the press.
//
// (2) A handle claim always beats move and resize. `LINK_PRIORITY` (-10) is lower than
//     `RESIZE_PRIORITY` (0) and `MOVE_PRIORITY` (10), and recognizers are offered the pointerdown
//     in ascending-priority order (`pointer-drag.ts`) — so pressing squarely on the handle creates
//     a dependency even though the handle sits inside resize's own 8px edge zone. That is what
//     makes `tests/e2e/drag-resize.spec.ts` need a 6px inset; here it is the feature.
//
// Geometry: the handle is a `<circle>`, so its centre is `cx`/`cy` in SVG user space — but the
// press needs client pixels, and the renderer sets a `viewBox`, so user units are not client px
// under any host scaling. `boundingBox()` reads the already-laid-out client rect and sidesteps the
// transform entirely, which is why no viewBox math appears below.

/** Centre of one of a task's link handles, in viewport CSS pixels, after revealing it by hover. */
async function linkHandleOf(
  page: Page,
  taskId: string,
  end: 'start' | 'end',
): Promise<{ x: number; y: number }> {
  const group = page.locator(`.fg-task[data-task-id="${taskId}"]`);
  await group.scrollIntoViewIfNeeded();
  await group.hover();
  const handle = group.locator(`.fg-task__link-handle[data-handle-end="${end}"]`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`no link handle '${end}' on task '${taskId}'`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dependencyCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { getDependencies(): unknown[] } }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    return g.getDependencies().length;
  });
}

/** Drag from one task's handle onto another task's bar and release. */
async function link(
  page: Page,
  from: { taskId: string; end: 'start' | 'end' },
  toTaskId: string,
): Promise<void> {
  const origin = await linkHandleOf(page, from.taskId, from.end);
  const target = page.locator(`[data-task-id="${toTaskId}"] .fg-task__bar`);
  const box = await target.boundingBox();
  if (!box) throw new Error(`no bar for task '${toTaskId}'`);
  await mouseDrag(
    page,
    origin,
    box.x + box.width / 2 - origin.x,
    box.y + box.height / 2 - origin.y,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForMountedDemo(page);
});

test('dragging between two link handles emits dependency:added', async ({ page }) => {
  const added = await recordEvent(page, 'dependency:added');
  const before = await dependencyCount(page);

  // `docs-task` is unlinked in the quick-start fixture, so this pair is neither a duplicate of the
  // two seeded FS edges nor a cycle — both of which the store rejects, and neither of which is
  // what this test is about.
  await link(page, { taskId: 'design', end: 'end' }, 'docs-task');

  await expect.poll(async () => await added()).toContain('design->docs-task');
  expect(await dependencyCount(page)).toBe(before + 1);
});

test('the grabbed handle decides the edge direction', async ({ page }) => {
  // Grabbing the owner's START handle makes the owner the SUCCESSOR, so the edge runs
  // drop -> owner, the reverse of the test above (`LinkState.handleEnd`, `drag-create-dep.ts`).
  const added = await recordEvent(page, 'dependency:added');

  await link(page, { taskId: 'docs-task', end: 'start' }, 'design');

  await expect.poll(async () => await added()).toContain('design->docs-task');
});

test('dropping on empty space creates nothing (silent revert)', async ({ page }) => {
  const added = await recordEvent(page, 'dependency:added');
  const before = await dependencyCount(page);

  // Straight down, off the last row — `resolveDropTarget` finds no `.fg-task` ancestor and the
  // gesture reverts without reaching the facade (decision 2).
  const origin = await linkHandleOf(page, 'design', 'end');
  await mouseDrag(page, origin, 0, 400);

  expect(await added()).toEqual([]);
  expect(await dependencyCount(page)).toBe(before);
});

test('dropping on the source task itself creates nothing (self-link filtered)', async ({ page }) => {
  const added = await recordEvent(page, 'dependency:added');
  const before = await dependencyCount(page);

  await link(page, { taskId: 'design', end: 'end' }, 'design');

  expect(await added()).toEqual([]);
  expect(await dependencyCount(page)).toBe(before);
});
