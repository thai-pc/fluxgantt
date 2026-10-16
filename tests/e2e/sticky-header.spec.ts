import { test, expect, type Page } from '@playwright/test';
import { expectHeaderLabelsDisjoint } from '../helpers/header-labels.js';
import { DEFAULT_PIXELS_PER_DAY, centreOf, mouseDrag, readTaskDate, recordEvent } from '../helpers/drag.js';

// Real-browser coverage for the pinned SVG date axis (spec-svg-sticky-header.md): the header is a
// `position: sticky` aria-hidden replica (`svg.fg-timeline__sticky-header`) placed after the chart
// svg, so it must stay at the top of the scroll container however far the rows scroll, while the
// chart's own geometry (drag, hit-testing, export) is untouched.
//
// Fixture: `examples/plain-html-demo/collapse.html?pad=60` (420px `overflow: auto` container, the
// SVG-mode precondition). `window.__gantt` composes render + interaction + viewport.

const HEADER_HEIGHT = 32;
const OVERLAY = '#gantt svg.fg-timeline__sticky-header';

type G = {
  scrollToTask(id: string, o?: Record<string, unknown>): boolean;
  getSelection(): string[];
  getDependencies(): unknown[];
};

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

/** Container client-area origin (inside its 1px border) in viewport coordinates. */
async function clientOrigin(page: Page) {
  return page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    const r = c.getBoundingClientRect();
    return { x: r.left + c.clientLeft, y: r.top + c.clientTop, w: c.clientWidth, h: c.clientHeight };
  });
}

async function setScroll(page: Page, top: number, left = 0) {
  await page.evaluate(
    ([t, l]) => {
      const c = document.getElementById('gantt')!;
      c.scrollTop = t as number;
      c.scrollLeft = l as number;
    },
    [top, left] as const,
  );
  // One frame so sticky positioning has been composited before geometry is read.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/collapse.html?pad=60');
  await expect(page.locator('svg.fg-timeline')).toBeVisible();
});

test('the date axis stays pinned to the top of the container after a vertical scroll', async ({ page }) => {
  await setScroll(page, 400);
  const c = await clientOrigin(page);
  const band = (await page.locator(OVERLAY).boundingBox())!;
  expect(Math.abs(band.y - c.y)).toBeLessThanOrEqual(0.5);
  expect(band.height).toBeCloseTo(HEADER_HEIGHT, 0);

  // The band, not a scrolled row, is what the pointer hits near the top edge.
  const hit = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x as number, y as number);
      return el?.closest('.fg-timeline__sticky-header') !== null;
    },
    [c.x + 200, c.y + 8] as const,
  );
  expect(hit).toBe(true);

  // Labels are visible (inside the container) and do not overlap each other.
  await expectHeaderLabelsDisjoint(page, OVERLAY);
  const label = (await page.locator(`${OVERLAY} .fg-timeline__header-label`).first().boundingBox())!;
  expect(label.y).toBeGreaterThanOrEqual(c.y - 1.5);
  expect(label.y + label.height).toBeLessThanOrEqual(c.y + HEADER_HEIGHT + 1);
});

test('the pinned band scrolls horizontally with the content, still covers it, and its corner is opaque', async ({
  page,
}) => {
  await setScroll(page, 400, 150);
  const c = await clientOrigin(page);
  const scrollLeft = await page.evaluate(() => document.getElementById('gantt')!.scrollLeft);
  expect(scrollLeft).toBeGreaterThan(0);
  const band = (await page.locator(OVERLAY).boundingBox())!;
  const chart = (await page.locator('svg.fg-timeline').boundingBox())!;
  expect(Math.abs(band.x - (c.x - scrollLeft))).toBeLessThanOrEqual(0.5);
  expect(Math.abs(band.width - chart.width)).toBeLessThanOrEqual(0.5);

  // Opaque band: whatever is painted at the top-left of the band is the band, with a real fill.
  const bg = await page.locator(OVERLAY).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('transparent');
});

test("scrollToTask(align 'start') lands the target row directly under the band, never beneath it", async ({
  page,
}) => {
  await g(page, (x) => x.scrollToTask('filler-30', { align: 'start' }));
  const c = await clientOrigin(page);
  const bar = (await page.locator('.fg-task[data-task-id="filler-30"] .fg-task__bar').boundingBox())!;
  expect(bar.y).toBeGreaterThanOrEqual(c.y + HEADER_HEIGHT - 1);
  // Bar is vertically centred in a 32px row, so its top sits a few px under the row top.
  expect(bar.y).toBeLessThanOrEqual(c.y + HEADER_HEIGHT + 8);

  for (const align of ['nearest', 'center', 'end'] as const) {
    await setScroll(page, 0);
    await g(page, (x, a) => x.scrollToTask('filler-45', { align: a }), align);
    const b = (await page.locator('.fg-task[data-task-id="filler-45"] .fg-task__bar').boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(c.y + HEADER_HEIGHT - 1);
    expect(b.y + b.height).toBeLessThanOrEqual(c.y + c.h + 1);
  }
});

test('a drag after scrolling moves the task by exactly the dragged number of days', async ({ page }) => {
  await g(page, (x) => x.scrollToTask('filler-30', { align: 'start' }));
  const moved = await recordEvent(page, 'task:moved');
  const before = Date.parse(await readTaskDate(page, 'filler-30', 'start'));

  await mouseDrag(
    page,
    await centreOf(page.locator('.fg-task[data-task-id="filler-30"] .fg-task__bar')),
    DEFAULT_PIXELS_PER_DAY * 3,
  );

  await expect.poll(async () => await moved()).toContain('filler-30');
  const after = Date.parse(await readTaskDate(page, 'filler-30', 'start'));
  expect(Math.round((after - before) / 86_400_000)).toBe(3);
});

test('drag-create-dependency after scrolling links the right rows; releasing over the band links nothing', async ({
  page,
}) => {
  await g(page, (x) => x.scrollToTask('filler-30', { align: 'start' }));
  const added = await recordEvent(page, 'dependency:added');
  const source = page.locator('.fg-task[data-task-id="filler-30"]');
  const handleCentre = async () => {
    await source.hover();
    const box = (await source.locator('.fg-task__link-handle[data-handle-end="end"]').boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // Released over the pinned band: it hides the rows beneath it, so there is no drop target.
  const c = await clientOrigin(page);
  const origin = await handleCentre();
  await mouseDrag(page, origin, 0, c.y + 10 - origin.y);
  expect(await added()).toEqual([]);
  expect(await g(page, (x) => x.getDependencies().length)).toBe(0);

  // Released on the visible row below: the dependency is created between exactly those two rows.
  const origin2 = await handleCentre();
  const target = (await page.locator('.fg-task[data-task-id="filler-31"] .fg-task__bar').boundingBox())!;
  await mouseDrag(page, origin2, target.x + target.width / 2 - origin2.x, target.y + target.height / 2 - origin2.y);
  await expect.poll(async () => await added()).toContain('filler-30->filler-31');
});

test('clicking the pinned band does nothing; clicking a visible row selects it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await g(page, (x) => x.scrollToTask('filler-30', { align: 'start' }));
  await page.locator('.fg-task[data-task-id="filler-30"] .fg-task__bar').click();
  await expect.poll(() => g(page, (x) => x.getSelection())).toEqual(['filler-30']);

  const c = await clientOrigin(page);
  await page.mouse.click(c.x + 300, c.y + 10);
  expect(await g(page, (x) => x.getSelection())).toEqual(['filler-30']);
  expect(errors).toEqual([]);
});

test('native focus scrolling keeps a focused row out from under the band (scroll-padding-top)', async ({
  page,
}) => {
  expect(await page.evaluate(() => document.getElementById('gantt')!.style.scrollPaddingTop)).toBe('32px');
  // Row 15 sits at y = (6 + 15) * 32 = 672. Scroll past it, then focus it natively.
  await setScroll(page, 760);
  await page.evaluate(() => {
    document.querySelector<SVGGElement>('.fg-timeline__row[data-task-id="filler-15"]')!.focus();
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  const c = await clientOrigin(page);
  const row = (await page.locator('.fg-timeline__row[data-task-id="filler-15"]').boundingBox())!;
  expect(row.y).toBeGreaterThanOrEqual(c.y + HEADER_HEIGHT - 1.5);
});

test('Ctrl+wheel over the pinned band still zooms the chart', async ({ page }) => {
  await setScroll(page, 400);
  const c = await clientOrigin(page);
  const modeOf = () =>
    page.evaluate(() => (window as unknown as { __gantt: { getViewMode(): string } }).__gantt.getViewMode());
  const before = await modeOf();
  await page.mouse.move(c.x + 300, c.y + 10);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect.poll(modeOf).not.toBe(before);
});

test('the export while scrolled equals the unscrolled export: header at y 0, one <svg, no overlay', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('svg.fg-timeline')).toBeVisible();
  const run = (top: number) =>
    page.evaluate((t) => {
      const c = document.getElementById('gantt')!;
      c.style.height = '100px';
      c.scrollTop = t;
      return (window as unknown as { __gantt: { exportSvg(): string } }).__gantt.exportSvg();
    }, top);
  const unscrolled = await run(0);
  const scrolled = await run(400);
  expect(scrolled).toBe(unscrolled);
  expect(scrolled.match(/<svg/g)).toHaveLength(1);
  expect(scrolled).not.toContain('sticky');
  expect(scrolled).toMatch(/<g class="fg-timeline__header"><rect x="160" y="0"/);
});

// RTL host page: the chart svg sits at the inline-start (right) edge of an RTL block, so a
// physically-left float would drift off the day columns. The band must track the chart's columns
// with 0 px offset, for a chart wider than its scroller and for one narrower than its container.
for (const [label, width] of [
  ['wider than the scroller', 700],
  ['narrower than the container', 5000],
] as const) {
  test(`under dir="rtl" the band stays aligned with the chart columns (chart ${label})`, async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
    });
    await page.evaluate((w) => {
      document.getElementById('gantt')!.style.width = `${w}px`;
    }, width);
    for (const [top, left] of [[0, 0], [150, 0], [150, 120]] as const) {
      await page.evaluate(
        ([t, l]) => {
          const c = document.getElementById('gantt')!;
          c.scrollTop = t as number;
          // RTL scrollLeft is zero or negative; only meaningful when the content overflows.
          c.scrollLeft = -(l as number);
        },
        [top, left] as const,
      );
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      const dx = await page.evaluate(() => {
        const c = document.getElementById('gantt')!;
        const band = c.querySelector('svg.fg-timeline__sticky-header')!.getBoundingClientRect();
        const chart = c.querySelector('svg.fg-timeline')!.getBoundingClientRect();
        return band.left - chart.left;
      });
      expect(Math.abs(dx)).toBeLessThanOrEqual(0.5);
    }
  });
}

// The float must add no scroll size: the scroller's scrollable area is exactly the chart's.
test('the band adds no scroll height or width (the float is out of flow)', async ({ page }) => {
  const m = await page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    const chart = c.querySelector('svg.fg-timeline')!.getBoundingClientRect();
    return {
      scrollHeight: c.scrollHeight,
      scrollWidth: c.scrollWidth,
      clientWidth: c.clientWidth,
      chartHeight: chart.height,
      chartWidth: chart.width,
    };
  });
  expect(m.scrollHeight).toBe(Math.round(m.chartHeight));
  expect(m.scrollWidth).toBe(Math.max(Math.round(m.chartWidth), m.clientWidth));
});
