import { test, expect, type Locator, type Page } from '@playwright/test';

// Touch-gesture coverage for `withResponsive()` (spec-responsive-mobile.md §C), running under the
// `mobile` project only — `devices['Pixel 5']`, 393x851, `hasTouch: true`, `(pointer: coarse)`.
//
// WHY SYNTHETIC `pointer*` EVENTS RATHER THAN `page.touchscreen` OR `page.mouse`:
//   - `page.touchscreen` exposes only `tap()`. There is no touch-drag primitive, so a
//     multi-step gesture cannot be expressed with it at all.
//   - `page.mouse` can express the drag, but every event it synthesises reports
//     `pointerType: 'mouse'`. That is precisely the distinction under test: the mixin's pan
//     recognizer and `drag-resize`'s coarse edge zone exist to serve a FINGER, and a
//     mouse-typed gesture would exercise the desktop path while appearing to pass.
// So gestures are dispatched as explicit `pointerdown`/`pointermove`/`pointerup` with
// `pointerType: 'touch'` and `isPrimary: true`, in page coordinates, via `page.evaluate` on the
// real element under the point. `pointermove`/`pointerup` are dispatched on `window`, matching
// where `interaction/pointer-drag.ts` attaches them once a gesture is open.

/** Dispatch a full touch drag from (x, y) by (dx, dy), in viewport CSS pixels. */
async function touchDrag(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
  { steps = 8 }: { steps?: number } = {},
): Promise<void> {
  await page.evaluate(
    async ([startX, startY, deltaX, deltaY, stepCount]) => {
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
      // Every event of the gesture is dispatched on the SAME element the `pointerdown` hit, and
      // all of them bubble. That is what a real touch pointer does: the browser grants IMPLICIT
      // pointer capture to the `pointerdown` target for touch, so subsequent moves keep arriving
      // there regardless of what is under the finger. It also happens to be the only dispatch
      // point that reaches both listener sets — `interaction/pointer-drag.ts` listens on `window`
      // and `responsive/mixin.ts`'s pan recognizer listens on the `<svg>`; bubbling from the
      // element reaches both, whereas dispatching on `window` directly reaches only the former.
      for (let i = 1; i <= stepCount; i++) {
        const t = i / stepCount;
        target.dispatchEvent(
          new PointerEvent('pointermove', init(startX + deltaX * t, startY + deltaY * t)),
        );
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      }
      target.dispatchEvent(
        new PointerEvent('pointerup', {
          ...init(startX + deltaX, startY + deltaY),
          buttons: 0,
        }),
      );
    },
    [x, y, dx, dy, steps] as const,
  );
}

/** Centre of a locator's box, in viewport CSS pixels, after bringing it into view.
 *
 *  The scroll is not optional: the fixture's dataset is deliberately far wider than a 393px
 *  viewport, so most bars sit at a viewport x of 1000+ and `elementFromPoint` at that coordinate
 *  returns `null` — the failure this helper exists to prevent. */
async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('locator has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/responsive.html');
  await expect(page.locator('#gantt svg')).toBeVisible();
});

test('the mixin reports a coarse pointer on a real touch device', async ({ page }) => {
  // Premise check for every other test in this file: if this fails, the device preset is not
  // reporting `(pointer: coarse)` and the rest would pass vacuously against the desktop path.
  await expect
    .poll(() => page.evaluate(() => (window as never as { __gantt: { isCoarsePointer(): boolean } }).__gantt.isCoarsePointer()))
    .toBe(true);
});

test('a touch drag on a task bar moves the task', async ({ page }) => {
  const bar = page.locator('.fg-task[data-task-id="build"]');
  // `Task.start` is a `Temporal.ZonedDateTime`, not a string — it does not survive `page.evaluate`'s
  // structured clone as anything usable, so it is stringified INSIDE the page. The trailing
  // `[Asia/Ho_Chi_Minh]`-style IANA annotation that `ZonedDateTime.toString()` appends is stripped
  // before parsing: it is valid RFC 9557 but `Date.parse` returns `NaN` on it.
  const readStart = (): Promise<string> =>
    page.evaluate(() =>
      String(
        (
          window as never as {
            __gantt: { getTasks(): { id: string; start: { toString(): string } }[] };
          }
        ).__gantt
          .getTasks()
          .find((t) => t.id === 'build')!.start,
      ).replace(/\[.*\]$/, ''),
    );
  const startBefore = await readStart();

  const { x, y } = await centreOf(bar);
  // Grab the CENTRE, well clear of the 24px coarse resize edge zone at either end, so this
  // exercises drag-move rather than drag-resize.
  await touchDrag(page, x, y, 60, 0);

  const startAfter = await readStart();
  expect(startAfter).not.toBe(startBefore);
  // Dragged RIGHT, so the task must have moved LATER, not merely changed.
  expect(Date.parse(startAfter)).toBeGreaterThan(Date.parse(startBefore));
});

test('a touch drag on the chart background pans the chart instead of moving anything', async ({
  page,
}) => {
  const container = page.locator('#gantt');
  const svgBox = (await page.locator('#gantt svg').boundingBox())!;
  const tasksBefore = await page.evaluate(() =>
    JSON.stringify(
      (window as never as { __gantt: { getTasks(): unknown[] } }).__gantt.getTasks(),
    ),
  );

  // The timeline HEADER is the pan target here, not the row grid below it. Two reasons: it is
  // unambiguously not inside any `.fg-task[data-task-id]` at any scroll position, and it is
  // guaranteed to be inside the `<svg>` — the renderer is content-SIZED, so the area below the
  // last row belongs to the container, not to the `<svg>` the pan listener is attached to, and a
  // point there would reach no listener at all.
  const scrollBefore = await container.evaluate((el) => el.scrollLeft);
  await touchDrag(page, svgBox.x + 250, svgBox.y + 16, -120, 0);

  // Dragging LEFT scrolls the content right — the pan is inverted, like dragging paper.
  await expect.poll(() => container.evaluate((el) => el.scrollLeft)).toBeGreaterThan(scrollBefore);
  // And nothing was rescheduled by the pan.
  expect(
    await page.evaluate(() =>
      JSON.stringify(
        (window as never as { __gantt: { getTasks(): unknown[] } }).__gantt.getTasks(),
      ),
    ),
  ).toBe(tasksBefore);
});

test('a touch drag on a task bar does NOT pan the container (the two gestures are disjoint)', async ({
  page,
}) => {
  const container = page.locator('#gantt');
  const { x, y } = await centreOf(page.locator('.fg-task[data-task-id="build"]'));
  // Captured AFTER `centreOf`'s scroll-into-view, so the baseline is the scroll position the
  // gesture actually starts from rather than the initial 0.
  const scrollBefore = await container.evaluate((el) => el.scrollLeft);
  await touchDrag(page, x, y, 60, 0);
  // The pan recognizer declines any pointerdown inside `.fg-task[data-task-id]`, so the drag
  // above must have left the scroll position exactly where it was.
  expect(await container.evaluate((el) => el.scrollLeft)).toBe(scrollBefore);
});
