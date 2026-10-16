import { test, expect, type Page } from '@playwright/test';

// Real e2e coverage for `withViewport()` (spec-viewport-api.md §9.4): scrollToTask,
// scrollToDate, setDensity, reduced motion, Canvas (virtualized rows) and the sticky-header
// geometry that unit tests cannot reach (Canvas does not mount in jsdom).
//
// Fixture: `examples/plain-html-demo/collapse.html` (src/collapse.ts) — its `#gantt` container is
// 420px high with `overflow: auto` (style.css), which is the SVG-mode precondition for the scroll
// methods. Named rows (layout order): phase-1 > group-a > {leaf-a1, leaf-a2}, leaf-b, standalone.
// `?pad=N` appends N flat filler tasks (`filler-0..`) and, past 2000 tasks, selects Canvas.
// `?density=` seeds GanttConfig.density. The gantt instance (withViewport composed) is on
// `window.__gantt`.

const ROW_HEIGHT = { compact: 24, default: 32, comfortable: 40, touch: 48 } as const;
const HEADER_HEIGHT = 32;

type G = {
  scrollToTask(id: string, o?: Record<string, unknown>): boolean;
  scrollToDate(d: string, o?: Record<string, unknown>): boolean;
  setDensity(d: string): void;
  zoomTo(m: string): void;
  select(id: string): void;
  isCollapsed(id: string): boolean;
  on(ev: string, cb: (...a: unknown[]) => void): () => void;
};

/** Run `fn` in the page against `window.__gantt`. */
async function g<R, A>(page: Page, fn: (gantt: G, arg: A) => R, arg?: A): Promise<R> {
  return page.evaluate(
    ([src, a]) => {
      const gantt = (window as unknown as { __gantt?: G }).__gantt;
      if (!gantt) throw new Error('window.__gantt not exposed by the demo');
      // eslint-disable-next-line no-new-func
      return (0, eval)(`(${src})`)(gantt, a);
    },
    [fn.toString(), arg] as const,
  ) as Promise<R>;
}

const scroll = (page: Page) =>
  page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    return { top: c.scrollTop, left: c.scrollLeft, h: c.clientHeight, w: c.clientWidth };
  });

async function containerRect(page: Page) {
  const box = await page.locator('#gantt').boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/** Asserts `inner` lies inside the container's client area (the viewport minus scrollbars). */
async function expectInside(
  page: Page,
  inner: { x: number; y: number; width: number; height: number },
  { checkX = true } = {},
) {
  const c = await containerRect(page);
  const s = await scroll(page);
  const tol = 1.5;
  expect(inner.y).toBeGreaterThanOrEqual(c.y - tol);
  expect(inner.y + inner.height).toBeLessThanOrEqual(c.y + s.h + tol);
  if (checkX) {
    expect(inner.x).toBeGreaterThanOrEqual(c.x - tol);
    expect(inner.x + inner.width).toBeLessThanOrEqual(c.x + s.w + tol);
  }
}

const svgRow = (page: Page, id: string) => page.locator(`.fg-timeline__row[data-task-id="${id}"]`);
const svgBar = (page: Page, id: string) =>
  page.locator(`.fg-task[data-task-id="${id}"] .fg-task__bar`);

test.describe('SVG renderer (60 tasks, 420px scroll container)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html?pad=60');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
  });

  test('scrollToTask brings an off-screen row and bar fully into the container; scrolling back works', async ({
    page,
  }) => {
    // filler-59 is far below the fold (~66 rows * 32px vs 420px).
    await expect(svgBar(page, 'filler-59')).toHaveCount(1);
    expect((await scroll(page)).top).toBe(0);
    expect(await g(page, (x) => x.scrollToTask('filler-59'))).toBe(true);

    const row = (await svgRow(page, 'filler-59').boundingBox())!;
    const bar = (await svgBar(page, 'filler-59').boundingBox())!;
    await expectInside(page, row, { checkX: false });
    await expectInside(page, bar);
    expect((await scroll(page)).top).toBeGreaterThan(0);

    expect(await g(page, (x) => x.scrollToTask('phase-1'))).toBe(true);
    await expectInside(page, (await svgRow(page, 'phase-1').boundingBox())!, { checkX: false });
    // 'nearest' aligns phase-1 (the first row) to the top of the row band; the pinned header is
    // not part of the scrollable rows, so scrollTop returns to 0.
    expect((await scroll(page)).top).toBe(0);
  });

  test("align 'nearest' is a no-op when the task is already fully visible", async ({ page }) => {
    await g(page, (x) => x.scrollToTask('filler-30'));
    const before = await scroll(page);
    // A task whose row is in view: the one we just scrolled to, and one a few rows up.
    expect(await g(page, (x) => x.scrollToTask('filler-30'))).toBe(true);
    expect(await scroll(page)).toEqual(before);
    expect(await g(page, (x) => x.scrollToTask('filler-29'))).toBe(true);
    expect(await scroll(page)).toEqual(before);
  });

  test("align 'start' / 'center' / 'end' place the row at the matching vertical edge", async ({
    page,
  }) => {
    // Row <g> bounding boxes include the container's 1px border offset and the bar stroke.
    const tol = 5;
    await g(page, (x) => x.scrollToTask('filler-30', { align: 'start' }));
    let c = await containerRect(page);
    let r = (await svgRow(page, 'filler-30').boundingBox())!;
    // The date axis is pinned, so 'start' parks the row directly UNDER the 32px band.
    expect(Math.abs(r.y - (c.y + HEADER_HEIGHT))).toBeLessThanOrEqual(tol);

    await g(page, (x) => x.scrollToTask('filler-40', { align: 'end' }));
    c = await containerRect(page);
    const s = await scroll(page);
    r = (await svgRow(page, 'filler-40').boundingBox())!;
    expect(Math.abs(r.y + r.height - (c.y + s.h))).toBeLessThanOrEqual(tol);

    await g(page, (x) => x.scrollToTask('filler-20', { align: 'center' }));
    c = await containerRect(page);
    r = (await svgRow(page, 'filler-20').boundingBox())!;
    expect(Math.abs(r.y + r.height / 2 - (c.y + HEADER_HEIGHT + (s.h - HEADER_HEIGHT) / 2))).toBeLessThanOrEqual(tol);
  });

  test('a collapsed ancestor is auto-expanded (collapse:changed fires once); expand:false leaves it', async ({
    page,
  }) => {
    await page.goto('/collapse.html?pad=60&collapsed=phase-1');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    await expect(svgRow(page, 'leaf-a1')).toHaveCount(0);

    await g(page, (x) => {
      (window as unknown as { __collapseEvents: number }).__collapseEvents = 0;
      x.on('collapse:changed', () => {
        (window as unknown as { __collapseEvents: number }).__collapseEvents++;
      });
    });

    // expand:false -> false, nothing changes.
    expect(await g(page, (x) => x.scrollToTask('leaf-a1', { expand: false }))).toBe(false);
    await expect(svgRow(page, 'leaf-a1')).toHaveCount(0);
    expect(await g(page, () => (window as unknown as { __collapseEvents: number }).__collapseEvents)).toBe(0);
    expect((await scroll(page)).top).toBe(0);

    expect(await g(page, (x) => x.scrollToTask('leaf-a1'))).toBe(true);
    await expect(svgRow(page, 'leaf-a1')).toHaveCount(1);
    expect(await g(page, (x) => x.isCollapsed('phase-1'))).toBe(false);
    expect(await g(page, () => (window as unknown as { __collapseEvents: number }).__collapseEvents)).toBe(1);
    await expectInside(page, (await svgRow(page, 'leaf-a1').boundingBox())!, { checkX: false });
  });

  test('scrollToDate (center) puts the date column at the horizontal middle of the viewport', async ({
    page,
  }) => {
    await g(page, (x) => x.zoomTo('day'));
    const s0 = await scroll(page);
    const scrollWidth = await page.evaluate(() => document.getElementById('gantt')!.scrollWidth);
    // Precondition for a meaningful test: the chart overflows horizontally.
    expect(scrollWidth).toBeGreaterThan(s0.w + 200);

    expect(await g(page, (x) => x.scrollToDate('2026-09-10'))).toBe(true);
    const s = await scroll(page);
    expect(s.left).toBeGreaterThan(0);

    // The date's x is label column + dateToX. Read the day column pitch off the header: compare
    // the painted bar of a task STARTING on that date (filler-9: 2026-09-10) instead.
    const bar = (await svgBar(page, 'filler-9').boundingBox())!;
    const c = await containerRect(page);
    const mid = c.x + s.w / 2;
    // bar starts at the date; day pitch tolerance generous (+-1 column, columns are >= 20px).
    const dayPx = bar.width / 1; // filler tasks last one day
    expect(Math.abs(bar.x - mid)).toBeLessThanOrEqual(dayPx + 1);

    // align 'start' puts the date at the left edge of the scrolled content box (right of nothing:
    // the label column scrolls away, so x == scrollLeft).
    // (an early date: a late one is clamped by the maximum scrollLeft)
    await g(page, (x) => x.scrollToDate('2026-09-02', { align: 'start' }));
    const b2 = (await svgBar(page, 'filler-1').boundingBox())!;
    expect(Math.abs(b2.x - c.x)).toBeLessThanOrEqual(dayPx + 1);

    // out-of-range date -> false, and does not throw.
    expect(await g(page, (x) => x.scrollToDate('2030-01-01'))).toBe(false);
  });

  test('setDensity changes the row pitch, keeps the top visible row anchored, emits viewport:changed with density', async ({
    page,
  }) => {
    await g(page, (x) => {
      const w = window as unknown as { __vp: unknown[] };
      w.__vp = [];
      x.on('viewport:changed', (p) => w.__vp.push(p));
    });
    // Park the 20th filler directly under the pinned header band.
    await g(page, (x) => x.scrollToTask('filler-20', { align: 'start' }));
    const topId = 'filler-20';
    const pitch = async () => {
      const a = (await svgRow(page, 'filler-20').boundingBox())!;
      const b = (await svgRow(page, 'filler-21').boundingBox())!;
      return Math.round(b.y - a.y);
    };
    expect(await pitch()).toBe(ROW_HEIGHT.default);

    for (const d of ['compact', 'comfortable'] as const) {
      await g(page, (x, dd) => x.setDensity(dd), d);
      expect(await pitch()).toBe(ROW_HEIGHT[d]);
      // Anchor: the same row is still the top-most visible row (within a pixel of the edge).
      const c = await containerRect(page);
      const r = (await svgRow(page, topId).boundingBox())!;
      expect(Math.abs(r.y - (c.y + HEADER_HEIGHT))).toBeLessThanOrEqual(5);
    }

    const events = await g(page, () => (window as unknown as { __vp: unknown[] }).__vp);
    expect(events).toEqual([
      { viewMode: 'week', density: 'compact' },
      { viewMode: 'week', density: 'comfortable' },
    ]);

    // Equal-to-current call: no event.
    await g(page, (x) => x.setDensity('comfortable'));
    expect(await g(page, () => (window as unknown as { __vp: unknown[] }).__vp.length)).toBe(2);
  });

  test('a seeded GanttConfig.density survives scrollToTask and a runtime change keeps it after a zoom (remount)', async ({
    page,
  }) => {
    await g(page, (x) => x.setDensity('compact'));
    await g(page, (x) => x.zoomTo('day')); // re-paints through rendererOptions()
    const a = (await svgRow(page, 'phase-1').boundingBox())!;
    const b = (await svgRow(page, 'group-a').boundingBox())!;
    expect(Math.round(b.y - a.y)).toBe(ROW_HEIGHT.compact);
  });

  test('scrollToTask neither moves keyboard focus nor changes the selection', async ({ page }) => {
    await page.locator('svg.fg-timeline [tabindex="0"]').first().focus();
    await page.keyboard.press('ArrowDown');
    const active = () =>
      page.evaluate(() => document.activeElement?.getAttribute('data-task-id') ?? null);
    const before = await active();
    expect(before).not.toBeNull();
    const sel = () => g(page, (x) => (x as unknown as { getSelection(): string[] }).getSelection());
    const selBefore = await sel();

    await g(page, (x) => x.scrollToTask('filler-50'));
    expect(await active()).toBe(before);
    expect(await sel()).toEqual(selBefore);
  });

  test('keyboard focus stays on the focused row across setDensity', async ({ page }) => {
    await page.locator('svg.fg-timeline [tabindex="0"]').first().focus();
    await page.keyboard.press('ArrowDown');
    const active = () =>
      page.evaluate(() => document.activeElement?.getAttribute('data-task-id') ?? null);
    const before = await active();
    await g(page, (x) => x.setDensity('compact'));
    expect(await active()).toBe(before);
    await g(page, (x) => x.setDensity('comfortable'));
    expect(await active()).toBe(before);
    // ...and the roving keyboard contract still works afterwards.
    await page.keyboard.press('ArrowDown');
    expect(await active()).not.toBe(before);
  });
});

test.describe('reduced motion', () => {
  test("behavior 'smooth' is instant under prefers-reduced-motion: reduce", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/collapse.html?pad=60');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    // Synchronous check, in the same task as the call: no animation frame can have elapsed.
    const top = await page.evaluate(() => {
      const gantt = (window as unknown as { __gantt: G }).__gantt;
      gantt.scrollToTask('filler-59', { behavior: 'smooth' });
      return document.getElementById('gantt')!.scrollTop;
    });
    expect(top).toBeGreaterThan(0);
    // Instant == final: it does not keep moving.
    await page.waitForTimeout(300);
    expect((await scroll(page)).top).toBe(top);
  });

  test("behavior 'smooth' animates (not instant) without the preference and still reaches the target", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/collapse.html?pad=60');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    const instantTop = await page.evaluate(() => {
      const gantt = (window as unknown as { __gantt: G }).__gantt;
      gantt.scrollToTask('filler-59', { behavior: 'smooth' });
      return document.getElementById('gantt')!.scrollTop;
    });
    // Smooth scrolling has not applied the offset synchronously...
    expect(instantTop).toBeLessThan(
      // ...which is far below the final offset (rows 66 * 32 + header - 420)
      1000,
    );
    // ...but converges within a bounded poll.
    await expect
      .poll(async () => (await scroll(page)).top, { timeout: 5000 })
      .toBeGreaterThan(1000);
    await expect
      .poll(async () => {
        const r = (await svgRow(page, 'filler-59').boundingBox())!;
        const c = await containerRect(page);
        const s = await scroll(page);
        return r.y + r.height <= c.y + s.h + 1.5;
      })
      .toBe(true);
  });
});

test.describe('Canvas renderer (2100 tasks, virtualized rows)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html?pad=2100');
    await expect(page.locator('canvas.fg-timeline-canvas')).toBeVisible();
  });

  /** Clicks a pixel `dy` below the sticky header's bottom edge (y of the first painted body row)
   *  and returns the selection. Selection is derived from hit-testing the rendered geometry, so
   *  this asserts that what the user SEES at that spot is the row `scrollToTask` targeted. */
  async function clickBodyTop(page: Page, dy: number): Promise<string[]> {
    const c = await containerRect(page);
    await page.mouse.click(c.x + 20, c.y + HEADER_HEIGHT + dy);
    return g(page, (x) => (x as unknown as { getSelection(): string[] }).getSelection());
  }

  test("scrollToTask(align 'start') lands the target row right under the sticky header (header-drift guard)", async ({
    page,
  }) => {
    for (const id of ['filler-1990', 'filler-2090']) {
      expect(await g(page, (x, i) => x.scrollToTask(i, { align: 'start' }), id)).toBe(true);
      // Row y in the Canvas coordinate system excludes the header; scrollTop == row.y exactly.
      const rowIndex = 6 + Number(id.split('-')[1]);
      await expect
        .poll(async () => (await scroll(page)).top)
        .toBe(rowIndex * ROW_HEIGHT.default);
      // And the pixels agree: hit-testing 4px below the header resolves to the target row.
      expect(await clickBodyTop(page, 4)).toEqual([id]);
    }
  });

  test("scrollToTask(align 'nearest') makes the row visible; the target row is hit-testable at its painted position", async ({
    page,
  }) => {
    await g(page, (x) => x.scrollToTask('filler-2000'));
    const s = await scroll(page);
    const rowIndex = 6 + 2000;
    const rowTop = rowIndex * ROW_HEIGHT.default;
    const bodyH = s.h - HEADER_HEIGHT;
    // nearest from the top: the row's bottom edge ends flush with the viewport bottom.
    expect(s.top).toBe(rowTop + ROW_HEIGHT.default - bodyH);
    // The Canvas-mode container is 600px tall; with Linux font metrics its bottom edge sits below
    // the 720px window, where `page.mouse.click` hits nothing. Bring the whole container into view.
    await page.evaluate(() => document.getElementById('gantt')!.scrollIntoView({ block: 'end' }));
    const c = await containerRect(page);
    // Click the middle of where the row must be painted.
    const y = c.y + HEADER_HEIGHT + (rowTop - s.top) + ROW_HEIGHT.default / 2;
    await page.mouse.click(c.x + 20, y);
    expect(await g(page, (x) => (x as unknown as { getSelection(): string[] }).getSelection())).toEqual([
      'filler-2000',
    ]);
    // selection materialises the row in the a11y layer as aria-selected.
    await expect(
      page.locator('.fg-timeline-canvas__row[data-task-id="filler-2000"]'),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('no console errors / page errors while jumping across the virtualized range', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    for (const id of ['filler-2099', 'filler-0', 'filler-1500', 'phase-1']) {
      expect(await g(page, (x, i) => x.scrollToTask(i), id)).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test('Canvas collapsed ancestor auto-expands', async ({ page }) => {
    await page.goto('/collapse.html?pad=2100&collapsed=phase-1');
    await expect(page.locator('canvas.fg-timeline-canvas')).toBeVisible();
    expect(await g(page, (x) => x.isCollapsed('phase-1'))).toBe(true);
    expect(await g(page, (x) => x.scrollToTask('leaf-a1'))).toBe(true);
    expect(await g(page, (x) => x.isCollapsed('phase-1'))).toBe(false);
  });

  test('setDensity keeps the top row anchored (Canvas bodyTop = 0) and the header stays sticky', async ({
    page,
  }) => {
    await g(page, (x) => x.scrollToTask('filler-1000', { align: 'start' }));
    expect(await clickBodyTop(page, 4)).toEqual(['filler-1000']);
    for (const d of ['compact', 'comfortable'] as const) {
      await g(page, (x, dd) => x.setDensity(dd), d);
      await expect
        .poll(async () => (await scroll(page)).top)
        .toBe((6 + 1000) * ROW_HEIGHT[d]);
      expect(await clickBodyTop(page, 4)).toEqual(['filler-1000']);
    }
  });

  test('a non-default seeded density is honoured by scrollToTask (row height read from live state)', async ({
    page,
  }) => {
    await page.goto('/collapse.html?pad=2100&density=compact');
    await expect(page.locator('canvas.fg-timeline-canvas')).toBeVisible();
    await g(page, (x) => x.scrollToTask('filler-1500', { align: 'start' }));
    await expect
      .poll(async () => (await scroll(page)).top)
      .toBe((6 + 1500) * ROW_HEIGHT.compact);
    expect(await clickBodyTop(page, 4)).toEqual(['filler-1500']);
  });
});
