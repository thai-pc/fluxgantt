import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_PIXELS_PER_DAY, centreOf, mouseDrag, readTaskDate, recordEvent } from '../helpers/drag.js';

// Real-browser coverage for the pinned SVG label column (spec-svg-sticky-label-column.md): the
// chart, the column, the date axis and the corner all live in one `div.fg-timeline__layer`, the
// column and corner are `position: sticky` aria-hidden CLONES, and the REAL labels stay in the
// gridcells (opacity 0 live). Fixtures: `collapse.html?pad=60` (hierarchy + viewport + interaction)
// and `edit-hooks.html` (dblclick / contextmenu events).

const HEADER = 32;
const LABEL_W = 160;
const COLUMN = '#gantt svg.fg-timeline__sticky-column';
const CORNER = '#gantt .fg-timeline__sticky-corner';
const HEADER_OVERLAY = '#gantt svg.fg-timeline__sticky-header';

type G = {
  scrollToTask(id: string, o?: Record<string, unknown>): boolean;
  scrollToDate(d: string, o?: Record<string, unknown>): boolean;
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

/** Container client-area origin (inside its border) in viewport coordinates. */
async function origin(page: Page) {
  return page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    const r = c.getBoundingClientRect();
    return { x: r.left + c.clientLeft, y: r.top + c.clientTop, w: c.clientWidth, h: c.clientHeight };
  });
}

async function setScroll(page: Page, top: number, left: number) {
  await page.evaluate(
    ([t, l]) => {
      const c = document.getElementById('gantt')!;
      c.scrollTop = t as number;
      c.scrollLeft = l as number;
    },
    [top, left] as const,
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

/** Resolved colour of one device pixel, read from a real screenshot (dpr 1 in Desktop Chrome). */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
  }, png.toString('base64'));
}

const narrow = (page: Page, w = 420) =>
  page.evaluate((width) => {
    document.getElementById('gantt')!.style.width = `${width}px`;
  }, w);

test.describe('pinned label column (collapse.html)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html?pad=60');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    await narrow(page);
  });

  test('the column stays at the container edge on horizontal scroll, over the chart, opaque', async ({ page }) => {
    await setScroll(page, 0, 500);
    expect(await page.evaluate(() => document.getElementById('gantt')!.scrollLeft)).toBe(500);
    const c = await origin(page);
    const col = (await page.locator(COLUMN).boundingBox())!;
    expect(Math.abs(col.x - c.x)).toBeLessThanOrEqual(0.5);
    expect(col.width).toBeCloseTo(LABEL_W, 0);

    // Every label clone is inside the column box and is what a pointer hits at its centre.
    const hits = await page.evaluate(
      ({ colRight, colLeft }) => {
        const out: boolean[] = [];
        for (const l of document.querySelectorAll('#gantt .fg-timeline__sticky-column .fg-timeline__row-label')) {
          const r = l.getBoundingClientRect();
          if (r.top < 40 || r.bottom > innerHeight) continue;
          const inside = r.left >= colLeft - 0.5 && r.right <= colRight + 0.5;
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          out.push(inside && top?.closest('.fg-timeline__sticky-column') !== null);
        }
        return out;
      },
      { colLeft: col.x, colRight: col.x + col.width },
    );
    expect(hits.length).toBeGreaterThan(3);
    expect(hits.every(Boolean)).toBe(true);

    // The real labels are in the DOM (accessible names) but painted invisible.
    const real = await page.evaluate(() => {
      const l = document.querySelector('#gantt svg.fg-timeline .fg-timeline__row-label')!;
      return { opacity: getComputedStyle(l).opacity, text: l.textContent };
    });
    expect(real).toEqual({ opacity: '0', text: 'Phase 1' });

    // A bar scrolled under the column must not show through: sample the column's own colour where a
    // real bar's rect overlaps it.
    const probe = await page.evaluate(
      ({ colRight }) => {
        for (const b of document.querySelectorAll('#gantt svg.fg-timeline .fg-task__bar')) {
          const r = b.getBoundingClientRect();
          if (r.left < colRight - 8 && r.right > colRight - 8 && r.top > 80 && r.bottom < innerHeight) {
            return { x: colRight - 6, y: r.top + r.height / 2 };
          }
        }
        return null;
      },
      { colRight: col.x + col.width },
    );
    if (probe) {
      const under = await pixel(page, probe.x, probe.y);
      const ground = await pixel(page, col.x + 100, 600 > c.h ? c.y + c.h - 4 : c.y + 100);
      expect(Math.abs(under[0]! - ground[0]!)).toBeLessThanOrEqual(2);
      expect(Math.abs(under[2]! - ground[2]!)).toBeLessThanOrEqual(2);
    }
  });

  test('both axes at once: the header, the column and the corner stay pinned together', async ({ page }) => {
    await setScroll(page, 400, 500);
    const c = await origin(page);
    const [col, band, corner] = await Promise.all(
      [COLUMN, HEADER_OVERLAY, CORNER].map(async (s) => (await page.locator(s).boundingBox())!),
    );
    expect(Math.abs(col!.x - c.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(band!.y - c.y)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(corner!.x - c.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(corner!.y - c.y)).toBeLessThanOrEqual(0.5);
    expect(corner!.height).toBeCloseTo(HEADER, 0);
    expect(corner!.width).toBeCloseTo(LABEL_W, 0);

    // The corner wins the hit test over the header and the column; the column wins below it.
    const hit = await page.evaluate(
      ([x, y]) => {
        const at = (px: number, py: number) => document.elementFromPoint(px, py)?.closest('[class^="fg-timeline__sticky"]')?.className;
        return { corner: at(x! + 10, y! + 8), below: at(x! + 10, y! + 52), band: at(x! + 250, y! + 8) };
      },
      [c.x, c.y] as const,
    );
    expect(String(hit.corner)).toContain('sticky-corner');
    expect(String(hit.below)).toContain('sticky-column');
    expect(String(hit.band)).toContain('sticky-header');

    // No date label is visible inside the corner and no row label peeks into the band.
    const leaks = await page.evaluate(
      ([cx, cy, w]) => {
        let n = 0;
        for (const t of document.querySelectorAll('#gantt .fg-timeline__sticky-header .fg-timeline__header-label')) {
          const r = t.getBoundingClientRect();
          const mx = r.left + r.width / 2;
          const my = r.top + r.height / 2;
          if (mx > cx! && mx < cx! + w! && my > cy! && my < cy! + 32) {
            if (document.elementFromPoint(mx, my)?.closest('.fg-timeline__sticky-header')) n++;
          }
        }
        return n;
      },
      [c.x, c.y, LABEL_W] as const,
    );
    expect(leaks).toBe(0);
  });

  test('the divider rows are pixel-stable: scrolling does not change the painted line', async ({ page }) => {
    const c = await origin(page);
    await setScroll(page, 0, 0);
    const restHeader = await pixel(page, c.x + LABEL_W + 150, c.y + HEADER - 1);
    const restColumn = await pixel(page, c.x + LABEL_W - 1, c.y + 150);
    await setScroll(page, 400, 500);
    const scrolledHeader = await pixel(page, c.x + LABEL_W + 150, c.y + HEADER - 1);
    const scrolledColumn = await pixel(page, c.x + LABEL_W - 1, c.y + 150);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(restHeader[i]! - scrolledHeader[i]!)).toBeLessThanOrEqual(1);
      expect(Math.abs(restColumn[i]! - scrolledColumn[i]!)).toBeLessThanOrEqual(1);
    }
    // A single crisp line, not two half-covered rows: the row just BELOW the band is not darkened.
    const below = await pixel(page, c.x + LABEL_W + 150, c.y + HEADER);
    expect(below[0]!).toBeGreaterThan(restHeader[0]!);
  });

  test('click, shift/ctrl click and toggle on pinned clones behave like the real labels', async ({ page }) => {
    await setScroll(page, 0, 300);
    const clone = (id: string) => page.locator(`${COLUMN} .fg-timeline__row-label[data-task-id="${id}"]`);
    await clone('leaf-a1').click();
    await expect.poll(() => g(page, (x) => x.getSelection())).toEqual(['leaf-a1']);
    await expect(page.locator('.fg-timeline__row[data-task-id="leaf-a1"]')).toHaveAttribute('aria-selected', 'true');

    await clone('standalone').click({ modifiers: ['Control'] });
    await expect.poll(() => g(page, (x) => x.getSelection())).toEqual(['leaf-a1', 'standalone']);

    await clone('leaf-a1').click();
    await clone('leaf-b').click({ modifiers: ['Shift'] });
    await expect
      .poll(async () => (await g(page, (x) => x.getSelection())).sort())
      .toEqual(['leaf-a1', 'leaf-a2', 'leaf-b']);

    // The toggle glyph collapses and does not change the selection.
    const before = await g(page, (x) => x.getSelection());
    await page.locator(`${COLUMN} .fg-timeline__row-toggle[data-task-id="group-a"]`).click();
    await expect(page.locator('.fg-timeline__row[data-task-id="group-a"]')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(`${COLUMN} .fg-timeline__row-label[data-task-id="leaf-a1"]`)).toHaveCount(0);
    expect(await g(page, (x) => x.getSelection())).toEqual(before);
  });

  test('clicking the blank column or the header band clears the selection', async ({ page }) => {
    await setScroll(page, 0, 300);
    const c = await origin(page);
    await page.locator(`${COLUMN} .fg-timeline__row-label[data-task-id="standalone"]`).click();
    await expect.poll(() => g(page, (x) => x.getSelection())).toEqual(['standalone']);
    await page.mouse.click(c.x + 3, c.y + 200); // blank part of the column
    await expect.poll(() => g(page, (x) => x.getSelection())).toEqual([]);
    await page.locator(`${COLUMN} .fg-timeline__row-label[data-task-id="standalone"]`).click();
    await page.mouse.click(c.x + 300, c.y + 10); // the date band
    await expect.poll(() => g(page, (x) => x.getSelection())).toEqual([]);
  });

  test('drag with a pinned column: exact dates; nothing starts under the column; a link released on it is ignored', async ({
    page,
  }) => {
    await g(page, (x) => x.scrollToTask('filler-5', { align: 'start' }));
    const c = await origin(page);
    const barBox = (await page.locator('.fg-task[data-task-id="filler-5"] .fg-task__bar').boundingBox())!;
    // `start` parks the bar directly right of the column, never under it.
    expect(barBox.x).toBeGreaterThanOrEqual(c.x + LABEL_W - 1);

    const moved = await recordEvent(page, 'task:moved');
    const before = Date.parse(await readTaskDate(page, 'filler-5', 'start'));
    await mouseDrag(
      page,
      await centreOf(page.locator('.fg-task[data-task-id="filler-5"] .fg-task__bar')),
      DEFAULT_PIXELS_PER_DAY * 2,
    );
    await expect.poll(async () => await moved()).toContain('filler-5');
    const after = Date.parse(await readTaskDate(page, 'filler-5', 'start'));
    expect(Math.round((after - before) / 86_400_000)).toBe(2);

    // Scroll 12px further so the bar's left edge is under the column; pressing there starts nothing.
    const sl = await page.evaluate(() => document.getElementById('gantt')!.scrollLeft);
    await setScroll(page, await page.evaluate(() => document.getElementById('gantt')!.scrollTop), sl + 12);
    const b2 = (await page.locator('.fg-task[data-task-id="filler-5"] .fg-task__bar').boundingBox())!;
    const probeX = c.x + LABEL_W - 4;
    expect(b2.x).toBeLessThan(probeX);
    const startDate = await readTaskDate(page, 'filler-5', 'start');
    await mouseDrag(page, { x: probeX, y: b2.y + b2.height / 2 }, 3 * DEFAULT_PIXELS_PER_DAY);
    expect(await readTaskDate(page, 'filler-5', 'start')).toBe(startDate);

    // A dependency drag released over the column creates nothing.
    const added = await recordEvent(page, 'dependency:added');
    await g(page, (x) => x.scrollToTask('filler-30', { align: 'start' }));
    const src = page.locator('.fg-task[data-task-id="filler-30"]');
    await src.hover();
    const hb = (await src.locator('.fg-task__link-handle[data-handle-end="end"]').boundingBox())!;
    const o = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    const row31 = (await page.locator('.fg-timeline__row[data-task-id="filler-31"] .fg-task__bar').boundingBox())!;
    await mouseDrag(page, o, c.x + 40 - o.x, row31.y + row31.height / 2 - o.y);
    expect(await added()).toEqual([]);
  });

  test("scrollToTask / scrollToDate keep the target out from under the column for every align", async ({ page }) => {
    const c = await origin(page);
    for (const align of ['start', 'center', 'end', 'nearest'] as const) {
      await setScroll(page, 0, 0);
      await g(page, (x, a) => x.scrollToTask('filler-45', { align: a }), align);
      const b = (await page.locator('.fg-task[data-task-id="filler-45"] .fg-task__bar').boundingBox())!;
      expect(b.x, align).toBeGreaterThanOrEqual(c.x + LABEL_W - 1);
      expect(b.x + b.width, align).toBeLessThanOrEqual(c.x + c.w + 1);
      if (align === 'start') expect(Math.abs(b.x - (c.x + LABEL_W))).toBeLessThanOrEqual(1);
    }
    await setScroll(page, 0, 0);
    await g(page, (x) => x.scrollToDate('2026-09-10', { align: 'center' }));
    const sl = await page.evaluate(() => document.getElementById('gantt')!.scrollLeft);
    expect(sl).toBeGreaterThan(0);
  });

  test('long names are truncated at the column edge live, and the export keeps the full name', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __gantt: { updateTask(id: string, p: object): void } }).__gantt.updateTask('standalone', {
        name: 'An unreasonably long task name that would run far across the grid and the bars',
      });
    });
    const c = await origin(page);
    for (const left of [0, 300]) {
      await setScroll(page, 0, left);
      const colRight = c.x + LABEL_W;
      const visible = await page.evaluate((edge) => {
        const l = document.querySelector('#gantt .fg-timeline__sticky-column .fg-timeline__row-label[data-task-id="standalone"]')!;
        const r = l.getBoundingClientRect();
        // The clone is wider than the column; whatever lies beyond the edge must hit something else.
        const beyond = document.elementFromPoint(edge + 6, r.top + r.height / 2);
        return { wider: r.right > edge, beyondIsClone: beyond?.closest('.fg-timeline__sticky-column') !== null };
      }, colRight);
      expect(visible.wider).toBe(true);
      expect(visible.beyondIsClone).toBe(false);
    }
    const xml = await page.evaluate(() => (window as unknown as { __gantt: { exportSvg(): string } }).__gantt.exportSvg());
    expect(xml).toContain('An unreasonably long task name that would run far across the grid and the bars');
    expect(xml).not.toContain('opacity');
  });

  test('one tab stop and no duplicate names: the clones are invisible to the accessibility tree', async ({ page }) => {
    const names = await page.evaluate(() => {
      const hidden = document.querySelectorAll('#gantt [aria-hidden="true"] .fg-timeline__row-label').length;
      const exposed = document.querySelectorAll('#gantt svg.fg-timeline .fg-timeline__row-label').length;
      const focusable = document.querySelectorAll('#gantt .fg-timeline__sticky-column [tabindex], #gantt .fg-timeline__sticky-header [tabindex]').length;
      return { hidden, exposed, focusable };
    });
    expect(names.hidden).toBe(names.exposed);
    expect(names.focusable).toBe(0);
  });
});

test.describe('host containers (the structural fix)', () => {
  const HOST = (style: string) => (page: Page) =>
    page.evaluate((css) => {
      const c = document.getElementById('gantt')!;
      c.setAttribute('style', css);
    }, style);

  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html?pad=60');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
  });

  const pins = async (page: Page) => {
    await setScroll(page, 300, 300);
    const c = await origin(page);
    const band = (await page.locator(HEADER_OVERLAY).boundingBox())!;
    const col = (await page.locator(COLUMN).boundingBox())!;
    expect(Math.abs(band.y - c.y), 'band at the container top').toBeLessThanOrEqual(0.5);
    expect(Math.abs(col.x - c.x), 'column at the container left').toBeLessThanOrEqual(0.5);
  };

  test('flex column, auto height: the container is as tall as the chart (no ~32px collapse)', async ({ page }) => {
    await HOST('display:flex;flex-direction:column;width:420px;height:auto')(page);
    const m = await page.evaluate(() => {
      const c = document.getElementById('gantt')!;
      return { h: c.getBoundingClientRect().height, chart: document.querySelector('svg.fg-timeline')!.getBoundingClientRect().height };
    });
    expect(Math.abs(m.h - m.chart)).toBeLessThanOrEqual(3); // border
    expect(m.h).toBeGreaterThan(200);
  });

  test('flex row with a fixed height pins on both axes (align-self:start guard)', async ({ page }) => {
    await HOST('display:flex;flex-direction:row;width:420px;height:420px;overflow:auto')(page);
    await pins(page);
  });

  test('display:grid host with a fixed height pins on both axes', async ({ page }) => {
    await HOST('display:grid;width:420px;height:420px;overflow:auto')(page);
    await pins(page);
  });

  test('block host (baseline) pins on both axes', async ({ page }) => {
    await HOST('width:420px;height:420px;overflow:auto')(page);
    await pins(page);
  });

  test('container padding: no strip above the band and no gap beside the column once scrolled', async ({ page }) => {
    await HOST('width:420px;height:420px;overflow:auto;padding:24px')(page);
    const c0 = await origin(page);
    await setScroll(page, 0, 0);
    const band0 = (await page.locator(HEADER_OVERLAY).boundingBox())!;
    expect(Math.abs(band0.y - (c0.y + 24))).toBeLessThanOrEqual(1);
    await pins(page);
  });

  test('under dir="rtl" the layer sits at the inline-start edge and the column sticks to the right', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
    });
    await narrow(page);
    await page.evaluate(() => {
      const c = document.getElementById('gantt')!;
      c.scrollLeft = -200;
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const m = await page.evaluate(() => {
      const c = document.getElementById('gantt')!;
      const r = c.getBoundingClientRect();
      const col = c.querySelector('svg.fg-timeline__sticky-column')!.getBoundingClientRect();
      const band = c.querySelector('svg.fg-timeline__sticky-header')!.getBoundingClientRect();
      const chart = c.querySelector('svg.fg-timeline')!.getBoundingClientRect();
      return { colRightGap: Math.abs(col.right - (r.right - c.clientLeft)), bandDx: band.left - chart.left };
    });
    expect(m.colRightGap).toBeLessThanOrEqual(1.5);
    expect(Math.abs(m.bandDx)).toBeLessThanOrEqual(0.5);
  });
});

test.describe('pinned label clones raise the host edit events (edit-hooks.html)', () => {
  interface Entry {
    name: string;
    payload: Record<string, unknown>;
  }
  const events = (page: Page, name: string) =>
    page.evaluate((n) => (window as unknown as { __events: Entry[] }).__events.filter((e) => e.name === n), name);

  test.beforeEach(async ({ page }) => {
    await page.goto('/edit-hooks.html');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    await narrow(page, 360);
    await setScroll(page, 0, 120);
  });

  test('dblclick on a pinned label: task:activated part label with client coordinates inside the column', async ({
    page,
  }) => {
    await page.locator(`${COLUMN} .fg-timeline__row-label[data-task-id="c"]`).dblclick();
    const [ev] = await events(page, 'task:activated');
    expect(ev!.payload).toMatchObject({ taskId: 'c', part: 'label', source: 'pointer' });
    const col = (await page.locator(COLUMN).boundingBox())!;
    expect(ev!.payload['clientX'] as number).toBeGreaterThanOrEqual(col.x);
    expect(ev!.payload['clientX'] as number).toBeLessThanOrEqual(col.x + col.width);
  });

  test('contextmenu on a pinned label: task:context-requested part label, default prevented', async ({ page }) => {
    await page.locator(`${COLUMN} .fg-timeline__row-label[data-task-id="d"]`).click({ button: 'right' });
    const [ev] = await events(page, 'task:context-requested');
    expect(ev!.payload).toMatchObject({ taskId: 'd', part: 'label', source: 'pointer' });
    const native = await events(page, 'native:contextmenu');
    expect(native.at(-1)!.payload['defaultPrevented']).toBe(true);
  });

  test('a pinned toggle does not activate; a blank column and the band emit nothing', async ({ page }) => {
    const c = await origin(page);
    await page.locator(`${COLUMN} .fg-timeline__row-toggle[data-task-id="sum"]`).dblclick();
    await page.mouse.dblclick(c.x + 3, c.y + 300);
    await page.mouse.dblclick(c.x + 300, c.y + 10);
    expect(await events(page, 'task:activated')).toHaveLength(0);
  });
});
