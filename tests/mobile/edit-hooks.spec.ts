import { test, expect, type CDPSession, type Page } from '@playwright/test';

// Touch coverage for `withEditHooks()` long-press (spec-host-edit-hooks.md §3.6; review-host-
// edit-hooks.md finding 1). Fixture: `/edit-hooks.html?touch=1` (withResponsive composed, as the
// docs tell hosts to). Gestures go through CDP `Input.dispatchTouchEvent`, i.e. the browser's own
// touch pipeline (real pointer events with `pointerType: 'touch'`, implicit capture, touch-action),
// which is the only way to reproduce the long-press-then-drag defect: the synthetic `PointerEvent`
// dispatch used by `touch-gestures.spec.ts` bypasses touch-action and pointer capture.
//
// Chromium touch emulation never fires a native touch `contextmenu`, so the Android "native menu
// beats the timer" path (review finding 7) is covered by unit tests only.

interface LogEntry {
  name: string;
  payload: Record<string, unknown>;
}

async function events(page: Page, name: string): Promise<LogEntry[]> {
  const all = await page.evaluate(() => (window as unknown as { __events: LogEntry[] }).__events.slice());
  return all.filter((e) => e.name === name);
}
// Raw value: a drag that snaps to zero days must not even re-store the start in another form.
async function startOf(page: Page, id: string): Promise<string> {
  return page.evaluate((i) => String((window as never as { __gantt: { getTask(id: string): { start: unknown } } }).__gantt.getTask(i).start), id);
}

let cdp: CDPSession;
const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

test.beforeEach(async ({ page, context }) => {
  await page.goto('/edit-hooks.html?touch=1');
  await expect(page.locator('#gantt svg')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as never as { __gantt: { isCoarsePointer(): boolean } }).__gantt.isCoarsePointer()))
    .toBe(true);
  cdp = await context.newCDPSession(page);
});

/** Centre of task `c`'s bar in viewport coordinates, after scrolling it into view. */
async function barCentre(page: Page, id = 'c') {
  const bar = page.locator(`.fg-task[data-task-id="${id}"] .fg-task__bar`);
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('long-press on a bar emits task:context-requested (source long-press, part bar) and opens the host menu', async ({ page }) => {
  const { x, y } = await barCentre(page);
  await touch('touchStart', x, y);
  await page.waitForTimeout(800);
  await touch('touchEnd');
  const ctx = await events(page, 'task:context-requested');
  expect(ctx).toHaveLength(1);
  expect(ctx[0]!.payload).toMatchObject({ taskId: 'c', part: 'bar', source: 'long-press' });
  expect(Math.abs((ctx[0]!.payload['clientX'] as number) - x)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('menu', { name: 'Task actions' })).toBeVisible();
  expect(await events(page, 'task:moved')).toHaveLength(0);
});

test('long-press, then moving the finger 40 px does NOT move the task (review Blocking #1)', async ({ page }) => {
  const { x, y } = await barCentre(page);
  const before = await startOf(page, 'c');
  await touch('touchStart', x, y);
  await page.waitForTimeout(700);
  for (let i = 1; i <= 8; i++) await touch('touchMove', x + i * 5, y);
  await touch('touchEnd');
  await page.waitForTimeout(100);
  expect(await events(page, 'task:context-requested')).toHaveLength(1);
  expect(await events(page, 'task:moved')).toHaveLength(0);
  expect(await events(page, 'task:resized')).toHaveLength(0);
  expect(await startOf(page, 'c')).toBe(before);
});

test('a quick touch drag on a bar still moves the task and fires no context request', async ({ page }) => {
  const { x, y } = await barCentre(page);
  const before = await startOf(page, 'c');
  await touch('touchStart', x, y);
  for (let i = 1; i <= 8; i++) await touch('touchMove', x + i * 8, y);
  await touch('touchEnd');
  await page.waitForTimeout(700); // would have fired by now if the press had not been cancelled
  await expect.poll(async () => (await events(page, 'task:moved')).length).toBeGreaterThan(0);
  expect(await startOf(page, 'c')).not.toBe(before);
  expect(await events(page, 'task:context-requested')).toHaveLength(0);
});

test('5 px of jitter during the hold fires nothing and moves nothing', async ({ page }) => {
  const { x, y } = await barCentre(page);
  const before = await startOf(page, 'c');
  await touch('touchStart', x, y);
  await touch('touchMove', x + 5, y);
  await page.waitForTimeout(800);
  await touch('touchEnd');
  await page.waitForTimeout(100);
  expect(await events(page, 'task:context-requested')).toHaveLength(0);
  expect(await events(page, 'task:moved')).toHaveLength(0);
  expect(await startOf(page, 'c')).toBe(before);
});

test('a short tap does not fire the long-press', async ({ page }) => {
  const { x, y } = await barCentre(page);
  await touch('touchStart', x, y);
  await page.waitForTimeout(100);
  await touch('touchEnd');
  await page.waitForTimeout(600);
  expect(await events(page, 'task:context-requested')).toHaveLength(0);
});
