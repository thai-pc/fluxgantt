import { test, expect, type Page } from '@playwright/test';

// RTL under `withResponsive()` (spec-rtl-chart.md section 7.5), `mobile` project only (Pixel 5, the
// only coarse-pointer project). Fixture: `examples/plain-html-demo/rtl.html?responsive=1`. The
// responsive pan writes `scrollLeft = pan.left - dx`; under a RTL scroll container that is already
// sign-correct (scrollLeft runs 0 down to negative), so these specs pin the behaviour rather than a
// fix: dragging the content LEFT reveals the start (right) side, i.e. `scrollLeft` moves toward 0.

async function touchDrag(page: Page, x: number, y: number, dx: number, dy: number, steps = 8): Promise<void> {
  await page.evaluate(
    async ([startX, startY, deltaX, deltaY, n]) => {
      const init = (clientX: number, clientY: number): PointerEventInit => ({
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        clientX,
        clientY,
      });
      const target = document.elementFromPoint(startX, startY);
      if (!target) throw new Error(`no element at (${startX}, ${startY})`);
      target.dispatchEvent(new PointerEvent('pointerdown', init(startX, startY)));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        target.dispatchEvent(new PointerEvent('pointermove', init(startX + deltaX * t, startY + deltaY * t)));
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      }
      target.dispatchEvent(new PointerEvent('pointerup', { ...init(startX + deltaX, startY + deltaY), buttons: 0 }));
    },
    [x, y, dx, dy, steps] as const,
  );
}

const scrollLeft = (page: Page): Promise<number> => page.evaluate(() => document.getElementById('gantt')!.scrollLeft);
const frames = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
async function setScrollLeft(page: Page, left: number): Promise<void> {
  await page.evaluate((l) => (document.getElementById('gantt')!.scrollLeft = l), left);
  await frames(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/rtl.html?responsive=1');
  await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
  await page.waitForFunction(() => '__fx' in window);
  // Premise: the device preset reports a coarse pointer, or everything below passes vacuously.
  await expect
    .poll(() => page.evaluate(() => (window as never as { __gantt: { isCoarsePointer(): boolean } }).__gantt.isCoarsePointer()))
    .toBe(true);
});

test('the container is a RTL scroll container with a narrowed label column at the right edge', async ({ page }) => {
  expect(await page.evaluate(() => document.getElementById('gantt')!.getAttribute('dir'))).toBe('rtl');
  const w = await page.evaluate(() => (window as never as { __gantt: { getLabelColumnWidth(): number } }).__gantt.getLabelColumnWidth());
  expect(w).toBeLessThan(160);
  const geo = await page.evaluate(() => {
    const svg = document.querySelector('#gantt svg.fg-timeline')!.getBoundingClientRect();
    const label = document.querySelector('.fg-timeline__row[data-task-id="req"] text')!.getBoundingClientRect();
    return { right: svg.right, labelLeft: label.left, labelRight: label.right };
  });
  expect(geo.labelRight).toBeLessThanOrEqual(geo.right + 1);
  expect(geo.labelLeft).toBeGreaterThanOrEqual(geo.right - w - 1);
});

test('a touch drag on the chart background pans: content dragged LEFT moves scrollLeft toward 0', async ({ page }) => {
  await setScrollLeft(page, -600);
  const target = await page.evaluate(() => {
    const svg = document.querySelector('#gantt svg.fg-timeline')!.getBoundingClientRect();
    const g = (window as never as { __gantt: { getLabelColumnWidth(): number } }).__gantt;
    const cr = document.getElementById('gantt')!.getBoundingClientRect();
    // the launch row (7th row, touch density 44 px), in the timeline just left of the label column
    return { x: cr.right - g.getLabelColumnWidth() - 40, y: svg.top + 32 + 6 * 44 + 22 };
  });
  const tasksBefore = await page.evaluate(() => JSON.stringify((window as never as { __gantt: { getTasks(): unknown[] } }).__gantt.getTasks()));
  const before = await scrollLeft(page);
  await touchDrag(page, target.x, target.y, -100, 0);
  const after = await scrollLeft(page);
  expect(after - before).toBeGreaterThan(80); // toward 0: less negative
  expect(after).toBeLessThanOrEqual(0);
  await touchDrag(page, target.x, target.y, 150, 0);
  expect(await scrollLeft(page)).toBeLessThan(after - 120); // dragged RIGHT: further negative
  expect(await page.evaluate(() => JSON.stringify((window as never as { __gantt: { getTasks(): unknown[] } }).__gantt.getTasks()))).toBe(tasksBefore);
});

test('a touch drag on a bar moves it (visually left = later) and does not scroll the container', async ({ page }) => {
  // `req` is the earliest task, so at scrollLeft 0 it sits just left of the label column.
  const probe = await page.evaluate(() => {
    const b = (window as never as { __fx: { barBox(id: string): { x: number; y: number; w: number; h: number } } }).__fx.barBox('req');
    const vw = document.documentElement.clientWidth;
    const left = Math.max(b.x, 0);
    const right = Math.min(b.x + b.w, vw);
    return { x: (left + right) / 2, y: b.y + b.h / 2, visible: right - left };
  });
  expect(probe.visible).toBeGreaterThan(60);
  const read = (): Promise<string> =>
    page.evaluate(() =>
      String((window as never as { __gantt: { getTasks(): { id: string; start: { toString(): string } }[] } }).__gantt.getTasks().find((t) => t.id === 'req')!.start).replace(/\[.*\]$/, ''),
    );
  const startBefore = await read();
  const scrollBefore = await scrollLeft(page);
  await touchDrag(page, probe.x, probe.y, -72, 0); // visually LEFT: 3 days later
  expect(Date.parse(await read())).toBeGreaterThan(Date.parse(startBefore));
  expect(await scrollLeft(page)).toBe(scrollBefore);
});

test('pinch zoom keeps the date under the fingers midpoint in place (RTL scroll model)', async ({ page }) => {
  const edge = (): Promise<number> =>
    // the START edge of `dev` is its visually-right edge
    page.evaluate(() => document.querySelector('.fg-task[data-task-id="dev"] .fg-task__bar')!.getBoundingClientRect().right);
  // park the START edge of `dev` about 170 px in from the left of the screen
  await setScrollLeft(page, 0);
  await setScrollLeft(page, -Math.max(0, 170 - (await edge())));
  const e0 = await edge();
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  expect(e0).toBeGreaterThan(60);
  expect(e0).toBeLessThan(vw - 60);
  const mode0 = await page.evaluate(() => (window as never as { __gantt: { getViewMode(): string } }).__gantt.getViewMode());
  await page.evaluate(
    async ([cx, cy]) => {
      const init = (id: number, x: number, y: number, buttons = 1): PointerEventInit => ({
        pointerId: id, pointerType: 'touch', isPrimary: id === 1, bubbles: true, cancelable: true, composed: true, button: 0, buttons, clientX: x, clientY: y,
      });
      const send = (type: string, id: number, x: number, y: number, buttons = 1): void =>
        void (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(new PointerEvent(type, init(id, x, y, buttons)));
      const from = 40;
      const to = 140; // fingers spread => zoom in one step
      send('pointerdown', 1, cx! - from / 2, cy!);
      send('pointerdown', 2, cx! + from / 2, cy!);
      for (let i = 1; i <= 6; i++) {
        const span = from + ((to - from) * i) / 6;
        send('pointermove', 1, cx! - span / 2, cy!);
        send('pointermove', 2, cx! + span / 2, cy!);
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      }
      send('pointerup', 1, cx! - to / 2, cy!, 0);
      send('pointerup', 2, cx! + to / 2, cy!, 0);
    },
    [e0, await page.evaluate(() => document.getElementById('gantt')!.getBoundingClientRect().top + 32 + 60)] as const,
  );
  await frames(page);
  const mode1 = await page.evaluate(() => (window as never as { __gantt: { getViewMode(): string } }).__gantt.getViewMode());
  expect(mode1).not.toBe(mode0);
  expect(await scrollLeft(page)).toBeLessThanOrEqual(0);
  expect(Math.abs((await edge()) - e0)).toBeLessThanOrEqual(3);
});
