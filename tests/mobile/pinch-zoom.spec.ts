import { test, expect, type CDPSession, type Page } from '@playwright/test';

// Two-finger pinch zoom for `withResponsive()` (spec-pinch-zoom.md), `mobile` project only
// (Pixel 5, `(pointer: coarse)`). Two tiers, because the repo's own evidence is mixed:
//
//   Tier A: synthetic multi-pointer events (`PointerEvent`, `pointerType: 'touch'`, ids 1 and 2,
//   `isPrimary` on id 1 only), dispatched on the element under each finger, bubbling. Caveat:
//   synthetic events skip `touch-action` and implicit pointer capture, so Tier A proves the
//   RECOGNIZER, not the browser pipeline. Must pass on macOS and Linux CI.
//
//   Tier B: CDP `Input.dispatchTouchEvent` with two `touchPoints`, i.e. the browser's own touch
//   pipeline (touch-action, implicit capture, native pinch suppression). Two-point delivery on
//   headless Linux is expected to work but was unverified when this was written, so Tier B starts
//   with a probe and SKIPS with an explicit message (never a silent pass) if two distinct
//   `pointerdown`s do not arrive.

interface Gantt {
  getViewMode(): string;
  getTask(id: string): { start: unknown };
  on(event: string, cb: () => void): () => void;
}
const gantt = (page: Page) => ({
  mode: () => page.evaluate(() => (window as never as { __gantt: Gantt }).__gantt.getViewMode()),
  start: (id: string) =>
    page.evaluate(
      (i) => String((window as never as { __gantt: Gantt }).__gantt.getTask(i).start),
      id,
    ),
});

/** Dispatches a full two-finger gesture. Each finger's events go to the element under its
 *  `pointerdown` (what implicit capture does for a real touch). `cy` is the finger row. */
async function syntheticPinch(
  page: Page,
  o: { cx: number; cy: number; from: number; to: number; steps?: number; liftOutside?: boolean },
): Promise<void> {
  await page.evaluate(
    async ({ cx, cy, from, to, steps = 6, liftOutside = false }) => {
      const init = (id: number, x: number, y: number, buttons = 1): PointerEventInit => ({
        pointerId: id,
        pointerType: 'touch',
        isPrimary: id === 1,
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
      });
      const at = (x: number, y: number): Element => {
        const el = document.elementFromPoint(x, y);
        if (!el) throw new Error(`no element at (${x}, ${y})`);
        return el;
      };
      // Targets are RE-RESOLVED per event (what a browser does once a zoom repaint removed the
      // element the finger first touched: capture is lost and events follow hit-testing). That
      // is only the in-page half of the real routing: a finger that ends OUTSIDE the chart sends
      // its `pointerup` to whatever is under it, which `liftOutside` reproduces for finger 1 by
      // dispatching it on `document.body`. Tier A without that option cannot see a lost
      // `pointerup`, so the regression test for it passes the option.
      const send = (type: string, id: number, x: number, y: number, buttons = 1): void => {
        const target =
          liftOutside && id === 1 && type === 'pointerup' ? document.body : at(x, y);
        target.dispatchEvent(new PointerEvent(type, init(id, x, y, buttons)));
      };
      send('pointerdown', 1, cx - from / 2, cy);
      send('pointerdown', 2, cx + from / 2, cy);
      for (let i = 1; i <= steps; i++) {
        const span = from + ((to - from) * i) / steps;
        send('pointermove', 1, cx - span / 2, cy);
        send('pointermove', 2, cx + span / 2, cy);
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      }
      send('pointerup', 1, cx - to / 2, cy, 0);
      send('pointerup', 2, cx + to / 2, cy, 0);
    },
    o,
  );
}

async function waitCoarse(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as never as { __gantt: { isCoarsePointer(): boolean } }).__gantt.isCoarsePointer(),
      ),
    )
    .toBe(true);
}

/** A y inside the first row band of the chart `<svg>` (empty grid at the x we pinch over). */
async function rowY(page: Page): Promise<number> {
  const box = (await page.locator('#gantt svg.fg-timeline').boundingBox())!;
  return box.y + 32 + 16;
}

test.describe('Tier A: synthetic pointer events (responsive.html)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/responsive.html');
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
    await waitCoarse(page);
  });

  test('spreading steps toward day, pinching in steps toward year', async ({ page }) => {
    const g = gantt(page);
    const before = await g.mode();
    expect(before).toBe('week');
    const cy = await rowY(page);
    await syntheticPinch(page, { cx: 200, cy, from: 100, to: 160 });
    expect(await g.mode()).toBe('day');
    await syntheticPinch(page, { cx: 200, cy, from: 160, to: 100 });
    expect(await g.mode()).toBe('week');
    await syntheticPinch(page, { cx: 200, cy, from: 160, to: 90 });
    expect(await g.mode()).toBe('month');
  });

  test('the date under the fingers midpoint stays under the midpoint', async ({ page }) => {
    const bar = page.locator('.fg-task[data-task-id="build"] .fg-task__bar');
    await bar.scrollIntoViewIfNeeded();
    const box0 = (await bar.boundingBox())!;
    const mid = box0.x + box0.width / 2;
    const cy = await rowY(page);
    await syntheticPinch(page, { cx: mid, cy, from: 100, to: 160 });
    expect(await gantt(page).mode()).toBe('day');
    const box1 = (await bar.boundingBox())!;
    // The bar's centre date was under the midpoint, so its centre must still be (within a few
    // px of rounding; the browser clamps scrollLeft only near the chart edges).
    expect(Math.abs(box1.x + box1.width / 2 - mid)).toBeLessThan(4);
  });

  test('a single-finger pan still scrolls and does not zoom', async ({ page }) => {
    const container = page.locator('#gantt');
    const before = await container.evaluate((el) => el.scrollLeft);
    const svgBox = (await page.locator('#gantt svg.fg-timeline').boundingBox())!;
    await page.evaluate(
      async ([x, y]) => {
        const init = (cx: number): PointerEventInit => ({
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: cx,
          clientY: y!,
        });
        const t = document.elementFromPoint(x!, y!)!;
        t.dispatchEvent(new PointerEvent('pointerdown', init(x!)));
        t.dispatchEvent(new PointerEvent('pointermove', init(x! - 120)));
        t.dispatchEvent(new PointerEvent('pointerup', { ...init(x! - 120), buttons: 0 }));
      },
      [svgBox.x + 3, svgBox.y + 48] as const,
    );
    await expect.poll(() => container.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
    expect(await gantt(page).mode()).toBe('week');
  });

  test('a finger on a bar then a second finger: nothing is dragged or moved', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as never as { __moved: number; __gantt: Gantt };
      w.__moved = 0;
      w.__gantt.on('task:moved', () => (w.__moved += 1));
    });
    const startBefore = await gantt(page).start('build');
    const bar = page.locator('.fg-task[data-task-id="build"]');
    await bar.scrollIntoViewIfNeeded();
    const b = (await bar.boundingBox())!;
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    const cy = await rowY(page);
    await page.evaluate(
      async ([x, y, y2]) => {
        const init = (id: number, cx: number, cyy: number, buttons = 1): PointerEventInit => ({
          pointerId: id,
          pointerType: 'touch',
          isPrimary: id === 1,
          bubbles: true,
          cancelable: true,
          buttons,
          clientX: cx,
          clientY: cyy,
        });
        const barEl = document.elementFromPoint(x!, y!)!;
        const other = document.elementFromPoint(40, y2!)!;
        barEl.dispatchEvent(new PointerEvent('pointerdown', init(1, x!, y!)));
        barEl.dispatchEvent(new PointerEvent('pointermove', init(1, x! + 30, y!))); // past 4 px
        other.dispatchEvent(new PointerEvent('pointerdown', init(2, 40, y2!)));
        barEl.dispatchEvent(new PointerEvent('pointermove', init(1, x! + 80, y!)));
        barEl.dispatchEvent(new PointerEvent('pointerup', init(1, x! + 80, y!, 0)));
        other.dispatchEvent(new PointerEvent('pointerup', init(2, 40, y2!, 0)));
      },
      [bx, by, cy] as const,
    );
    expect(await page.evaluate(() => (window as never as { __moved: number }).__moved)).toBe(0);
    expect(await gantt(page).start('build')).toBe(startBefore);
  });
});

test.describe('Tier A: review regressions (responsive.html)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/responsive.html');
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
    await waitCoarse(page);
  });

  test('B1: a finger lifted OUTSIDE the chart after a zoom step leaves no ghost: single-finger pan works and one finger cannot zoom', async ({
    page,
  }) => {
    const cy = await rowY(page);
    await syntheticPinch(page, { cx: 200, cy, from: 100, to: 160, liftOutside: true });
    expect(await gantt(page).mode()).toBe('day');
    const container = page.locator('#gantt');
    const before = await container.evaluate((el) => el.scrollLeft);
    const svgBox = (await page.locator('#gantt svg.fg-timeline').boundingBox())!;
    // One primary finger: drag toward where the ghost used to be (well past the 1.4x ratio).
    await page.evaluate(
      async ([x, y]) => {
        const init = (cx: number, buttons = 1): PointerEventInit => ({
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          buttons,
          clientX: cx,
          clientY: y!,
        });
        const t = document.elementFromPoint(x!, y!)!;
        t.dispatchEvent(new PointerEvent('pointerdown', init(x!)));
        for (let i = 1; i <= 6; i++) {
          t.dispatchEvent(new PointerEvent('pointermove', init(x! - i * 20)));
        }
        t.dispatchEvent(new PointerEvent('pointerup', init(x! - 120, 0)));
      },
      [svgBox.x + 3, svgBox.y + 48] as const,
    );
    await expect.poll(() => container.evaluate((el) => el.scrollLeft)).not.toBe(before);
    expect(await gantt(page).mode()).toBe('day');
  });

  test('B2: finger 2 on a bar does not start a drag: a sub-threshold pinch commits no task:moved', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const w = window as never as { __moved: number; __gantt: Gantt };
      w.__moved = 0;
      w.__gantt.on('task:moved', () => (w.__moved += 1));
    });
    const startBefore = await gantt(page).start('build');
    const bar = page.locator('.fg-task[data-task-id="build"]');
    await bar.scrollIntoViewIfNeeded();
    const b = (await bar.boundingBox())!;
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    const cy = await rowY(page);
    await page.evaluate(
      async ([x, y, y1]) => {
        const init = (id: number, cx: number, cyy: number, buttons = 1): PointerEventInit => ({
          pointerId: id,
          pointerType: 'touch',
          isPrimary: id === 1,
          bubbles: true,
          cancelable: true,
          buttons,
          clientX: cx,
          clientY: cyy,
        });
        // Finger 1 on empty grid, finger 2 on the bar; finger 2 slides 24 px (ratio < 1.4).
        const f1 = document.elementFromPoint(x! - 150, y1!)!;
        const f2 = document.elementFromPoint(x!, y!)!;
        f1.dispatchEvent(new PointerEvent('pointerdown', init(1, x! - 150, y1!)));
        f2.dispatchEvent(new PointerEvent('pointerdown', init(2, x!, y!)));
        for (const dx of [8, 16, 24]) {
          f2.dispatchEvent(new PointerEvent('pointermove', init(2, x! + dx, y!)));
        }
        f2.dispatchEvent(new PointerEvent('pointerup', init(2, x! + 24, y!, 0)));
        f1.dispatchEvent(new PointerEvent('pointerup', init(1, x! - 150, y1!, 0)));
      },
      [bx, by, cy] as const,
    );
    expect(await page.evaluate(() => (window as never as { __moved: number }).__moved)).toBe(0);
    expect(await gantt(page).start('build')).toBe(startBefore);
  });
});

for (const [label, url] of [
  ['readOnly', '/edit-hooks.html?touch=1&readonly=1'],
  ['Canvas (>= 2000 tasks)', '/edit-hooks.html?touch=1&pad=2100'],
] as const) {
  test(`Tier A: ${label} still zooms`, async ({ page }) => {
    await page.goto(url);
    await waitCoarse(page);
    if (label.startsWith('Canvas')) {
      await expect(page.locator('canvas.fg-timeline-canvas')).toBeVisible();
    } else {
      await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
    }
    const g = gantt(page);
    const before = await g.mode();
    await page.evaluate(() => {
      const el = document.querySelector('#gantt')!;
      el.scrollIntoView();
    });
    const surface = page.locator(label.startsWith('Canvas') ? 'canvas.fg-timeline-canvas' : '#gantt svg.fg-timeline');
    const box = (await surface.boundingBox())!;
    await syntheticPinch(page, { cx: box.x + 200, cy: box.y + 120, from: 100, to: 160 });
    const after = await g.mode();
    expect(after).not.toBe(before);
  });
}

test('Tier A: Canvas anchoring keeps the date under the midpoint', async ({ page }) => {
  await page.goto('/edit-hooks.html?touch=1&pad=2100');
  await waitCoarse(page);
  await expect(page.locator('canvas.fg-timeline-canvas')).toBeVisible();
  // Content-x of a date, read through the public `scrollToDate` (centre-aligned, so
  // content-x = scrollLeft + clientWidth / 2); then place that date at a NON-centre offset `m`
  // so the centre-anchored zoom alone would be wrong and only midpoint anchoring passes.
  const m = await page.evaluate(() => {
    const w = window as never as { __gantt: { scrollToDate(d: string, o: { align: string }): void } };
    const c = document.querySelector('#gantt')!;
    w.__gantt.scrollToDate('2026-08-24', { align: 'center' });
    (window as never as { __xD0: number }).__xD0 = c.scrollLeft + c.clientWidth / 2;
    const m = c.clientWidth / 2 - 80;
    c.scrollLeft = (window as never as { __xD0: number }).__xD0 - m;
    return m;
  });
  const rect = (await page.locator('#gantt').boundingBox())!;
  await syntheticPinch(page, { cx: rect.x + m, cy: rect.y + 120, from: 100, to: 160 });
  const drift = await page.evaluate((offset) => {
    const w = window as never as { __gantt: { scrollToDate(d: string, o: { align: string }): void } };
    const c = document.querySelector('#gantt')!;
    const sl = c.scrollLeft;
    w.__gantt.scrollToDate('2026-08-24', { align: 'center' });
    const xD1 = c.scrollLeft + c.clientWidth / 2;
    return xD1 - sl - offset;
  }, m);
  expect(Math.abs(drift)).toBeLessThan(4);
});

test.describe('Tier B: CDP two-point touch (browser pipeline)', () => {
  let cdp: CDPSession;
  const pt = (x: number, id: number, y: number) => ({ x, y, id });

  test.beforeEach(async ({ page, context }) => {
    await page.goto('/responsive.html');
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
    await waitCoarse(page);
    cdp = await context.newCDPSession(page);
  });

  /** Starts a two-finger touch at `y` and probes that two distinct pointerdowns arrived; skips
   *  (loudly, never a silent pass) when this platform does not deliver them. */
  async function startTwoFingers(page: Page, y: number): Promise<void> {
    await page.evaluate(() => {
      const w = window as never as { __ids: Set<number> };
      w.__ids = new Set();
      window.addEventListener('pointerdown', (e) => w.__ids.add(e.pointerId), true);
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [pt(150, 1, y), pt(250, 2, y)],
    });
    const delivered = await page.evaluate(() => (window as never as { __ids: Set<number> }).__ids.size);
    if (delivered < 2) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      test.skip(
        true,
        `two-point dispatchTouchEvent not delivered on this platform (${process.platform}, saw ${delivered} pointerdown id(s))`,
      );
    }
  }

  async function spread(y: number): Promise<void> {
    for (let i = 1; i <= 8; i++) {
      const half = 50 + i * 8;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [pt(200 - half, 1, y), pt(200 + half, 2, y)],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  test('a real two-finger spread steps the zoom and the chart touch-action is none', async ({
    page,
  }, testInfo) => {
    const y = await rowY(page);
    await startTwoFingers(page, y);
    await spread(y);
    testInfo.annotations.push({ type: 'tier-b', description: `ran on ${process.platform}` });

    expect(await gantt(page).mode()).toBe('day');
    // No `visualViewport.scale` assertion: this fixture sets `user-scalable=no`, so the page can
    // never scale and the check would pass whatever the chart's `touch-action` is. The computed
    // `touch-action: none` below is the real check that native pinch is suppressed on the chart.
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('#gantt svg.fg-timeline')!).touchAction),
    ).toBe('none');
  });

  test('both fingers on the sticky header band: JS does not zoom (band is touch-action auto, the browser owns it)', async ({
    page,
  }) => {
    // Documents the open-question-1 decision against the real pipeline; delete if the band's
    // touch-action ever changes.
    const header = page.locator('#gantt svg.fg-timeline__sticky-header').first();
    await expect(header).toBeVisible();
    const hb = (await header.boundingBox())!;
    await startTwoFingers(page, hb.y + 8);
    await spread(hb.y + 8);
    expect(await gantt(page).mode()).toBe('week');
  });
});
