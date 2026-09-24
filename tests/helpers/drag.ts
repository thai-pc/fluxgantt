import { type Locator, type Page, expect } from '@playwright/test';

// Shared drag helpers for the desktop `e2e` project (`tests/e2e/drag-*.spec.ts`).
//
// WHY `page.mouse` HERE, WHERE `tests/mobile/touch-gestures.spec.ts` DISPATCHES SYNTHETIC
// `pointer*` EVENTS: that file is testing the coarse-pointer path specifically, and every event
// `page.mouse` synthesises reports `pointerType: 'mouse'` — which would exercise the desktop path
// while appearing to prove the touch one. Here the desktop path IS the subject, so real mouse
// events are the right instrument and the more faithful one.

/** Pixels per calendar day, per `viewMode` — `PIXELS_PER_DAY` in
 *  `packages/core/src/render/renderer-base.ts`. A drag must cross at least this much for
 *  `snapDeltaToDay` (`interaction/pointer-drag.ts`) to round to a non-zero day delta, so it is
 *  the unit every drag distance below is expressed in rather than a bare pixel count. */
export const PIXELS_PER_DAY = {
  day: 60,
  week: 24,
  month: 8,
  quarter: 3,
  year: 1,
} as const;

/** The demo fixtures mount at the `week` default (`examples/plain-html-demo/src/main.ts` passes
 *  no `viewMode`), so one grid day is 24px wide there. */
export const DEFAULT_PIXELS_PER_DAY = PIXELS_PER_DAY.week;

/** Centre of a locator's box, in viewport CSS pixels. Throws rather than returning null so a
 *  missing element fails as itself instead of as a confusing coordinate error downstream. */
export async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('locator has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press, move in `steps` increments, release. The intermediate moves are not cosmetic: the
 *  pointer-drag coordinator only opens a gesture once movement exceeds `dragThresholdPx` (4), and
 *  a single jump from press to release can be delivered as one event that never crosses it. */
export async function mouseDrag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy = 0,
  { steps = 10 }: { steps?: number } = {},
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(from.x + dx * t, from.y + dy * t);
  }
  await page.mouse.up();
}

/** A task's `start`/`end` as a parseable ISO string, read through `window.__gantt`.
 *
 *  `Task.start` is a `Temporal.ZonedDateTime`, which does not survive `page.evaluate`'s
 *  structured clone as anything usable — so it is stringified INSIDE the page. The trailing
 *  `[Asia/Ho_Chi_Minh]`-style IANA annotation `ZonedDateTime.toString()` appends is stripped: it
 *  is valid RFC 9557, but `Date.parse` returns `NaN` on it. */
export async function readTaskDate(
  page: Page,
  taskId: string,
  field: 'start' | 'end',
): Promise<string> {
  return page.evaluate(
    ([id, key]) => {
      const g = (
        window as unknown as {
          __gantt?: { getTasks(): { id: string; start: unknown; end: unknown }[] };
        }
      ).__gantt;
      if (!g) throw new Error('window.__gantt not exposed by the demo');
      const task = g.getTasks().find((t) => t.id === id);
      if (!task) throw new Error(`no task '${id}' in the fixture`);
      return String(task[key]).replace(/\[.*\]$/, '');
    },
    [taskId, field] as const,
  );
}

/** Installs an in-page recorder for one event and returns a reader for what it has captured.
 *
 *  Registered through `window.__gantt.on(...)`, i.e. the same public subscription a host app uses —
 *  nothing test-only reaches into the instance. Each firing is reduced to one identifying string so
 *  it survives `page.evaluate`'s structured clone (a `Task` carries `Temporal.ZonedDateTime`
 *  fields, which do not):
 *    - an edge (`from`/`to`, e.g. `dependency:added`) records `'from->to'`. This is checked FIRST,
 *      and deliberately: a `Dependency` also has an `id`, but it is a generated
 *      `dep-<uuid>` — worthless to assert against, whereas the pair is the thing under test.
 *    - anything else with an `id` (e.g. `task:moved`) records that id.
 *    - a payload with neither records `'fired'`, so a count is still assertable. */
export async function recordEvent(page: Page, event: string): Promise<() => Promise<string[]>> {
  const bucket = `__recorded_${event.replace(/[^a-z]/gi, '_')}`;
  await page.evaluate(
    ([eventName, key]) => {
      const w = window as unknown as {
        __gantt?: { on(e: string, cb: (...args: unknown[]) => void): unknown };
        [k: string]: unknown;
      };
      if (!w.__gantt) throw new Error('window.__gantt not exposed by the demo');
      w[key] = [];
      w.__gantt.on(eventName, (...args: unknown[]) => {
        const first = args[0] as { id?: string; from?: string; to?: string } | undefined;
        (w[key] as string[]).push(
          first?.from !== undefined
            ? `${first.from}->${first.to}`
            : (first?.id ?? 'fired'),
        );
      });
    },
    [event, bucket] as const,
  );
  return () => page.evaluate((key) => (window as never as Record<string, string[]>)[key], bucket);
}

/** Waits for the demo to be mounted and driveable. `#gantt svg` visible alone is not enough —
 *  the specs drive the instance through `window.__gantt`, which `main.ts` assigns after mount. */
export async function waitForMountedDemo(page: Page): Promise<void> {
  await expect(page.locator('#gantt svg')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((window as unknown as { __gantt?: unknown }).__gantt)),
    )
    .toBe(true);
}
