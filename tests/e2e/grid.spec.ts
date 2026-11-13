import { test, expect, type Page } from '@playwright/test';

// Real-browser coverage for `withGrid()` on the SVG renderer (spec-grid-columns.md, PR G1): jsdom has
// no layout, so pinning, truncation fit, RTL text placement and the responsive collapse are only
// provable here. Fixture: `examples/plain-html-demo/grid.html` (query params in `src/grid.ts`).
// Chromium only (the project's `e2e` device).

const COLUMN = '#gantt svg.fg-timeline__sticky-column';
const CORNER = '#gantt .fg-timeline__sticky-corner';

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/grid.html${query ? `?${query}` : ''}`);
  await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => '__gantt' in window);
  await frames(page);
}
const frames = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Client rect of every pinned-column clone text of one row, with its column index. */
const cloneCells = (page: Page, id: string) =>
  page.evaluate(
    ([sel, i]) =>
      [...document.querySelectorAll(`${sel} g[data-task-id="${i}"] text`)].map((t) => {
        const r = t.getBoundingClientRect();
        return { text: t.textContent!, left: r.left, right: r.right, anchor: t.getAttribute('text-anchor') };
      }),
    [COLUMN, id] as const,
  );

const rect = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
  }, sel);

const containerBox = (page: Page) =>
  page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    const r = c.getBoundingClientRect();
    return { left: r.left + c.clientLeft, right: r.left + c.clientLeft + c.clientWidth, top: r.top + c.clientTop };
  });

const setScroll = (page: Page, left: number, top = 0) =>
  page.evaluate(
    ([l, t]) =>
      new Promise<void>((r) => {
        const c = document.getElementById('gantt')!;
        c.scrollLeft = l as number;
        c.scrollTop = t as number;
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      }),
    [left, top] as const,
  );

const COLS_W = 220 + 120 + 120 + 96 + 96; // 652

for (const rtl of [false, true]) {
  test.describe(rtl ? 'RTL' : 'LTR', () => {
    const q = (extra = '') => [rtl ? 'rtl=1' : '', extra].filter(Boolean).join('&');

    test('the pinned column is the sum of the widths, sits at the inline-start edge and stays there when scrolled', async ({ page }) => {
      await open(page, q());
      const box = await containerBox(page);
      for (const sx of [0, rtl ? -400 : 400]) {
        await setScroll(page, sx);
        const col = await rect(page, COLUMN);
        expect(Math.abs(col.width - COLS_W)).toBeLessThanOrEqual(1);
        expect(Math.abs((rtl ? box.right - col.right : col.left - box.left))).toBeLessThanOrEqual(1);
      }
    });

    test('the corner shows the five column headers and stays pinned on both axes', async ({ page }) => {
      await open(page, q('rows=60'));
      await setScroll(page, rtl ? -300 : 300, 200);
      const box = await containerBox(page);
      const corner = await rect(page, CORNER);
      expect(Math.abs(corner.top - box.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(rtl ? box.right - corner.right : corner.left - box.left)).toBeLessThanOrEqual(1);
      await expect(page.locator(`${CORNER} text`)).toHaveText(['Name', 'Start', 'End', 'Duration', 'Progress']);
    });

    test('cell text is laid out inside its own column (no spill into the neighbour)', async ({ page }) => {
      await open(page, q('long=1&cols=6'));
      // column boundaries, in viewport x, from the pinned column's own geometry
      const col = await rect(page, COLUMN);
      const widths = [220, 120, 120, 96, 96, 120];
      const edges: [number, number][] = [];
      let off = 0;
      for (const w of widths) {
        edges.push(rtl ? [col.right - off - w, col.right - off] : [col.left + off, col.left + off + w]);
        off += w;
      }
      for (const id of ['plan', 'req', 'design', 'launch']) {
        const cells = await cloneCells(page, id);
        expect(cells).toHaveLength(5); // start, end, duration, progress, owner (the name is the column's label)
        cells.forEach((c, i) => {
          const [lo, hi] = edges[i + 1]!;
          expect(c.left, `${id} ${c.text}`).toBeGreaterThanOrEqual(lo - 0.5);
          expect(c.right, `${id} ${c.text}`).toBeLessThanOrEqual(hi + 0.5);
        });
      }
      // the name label too: its right (LTR) / left (RTL) end stays inside column 1
      const name = await page.evaluate((sel) => {
        return [...document.querySelectorAll(`${sel} .fg-timeline__row-label`)].map((t) => {
          const r = t.getBoundingClientRect();
          return { left: r.left, right: r.right, text: t.textContent! };
        });
      }, COLUMN);
      expect(name.some((n) => n.text.includes('…'))).toBe(true);
      for (const n of name) {
        expect(rtl ? n.left >= edges[0]![0] - 0.5 : n.right <= edges[0]![1] + 0.5, n.text).toBe(true);
      }
    });

    test('[verify] align:end cells hug the inline-end edge of their column (text-anchor under the mirror)', async ({ page }) => {
      await open(page, q());
      const col = await rect(page, COLUMN);
      const cells = await cloneCells(page, 'launch');
      const [, , durationCell, progressCell] = cells;
      // duration spans 120+120 .. +96 after the name column: its inline-END edge is the far side in LTR (right)
      // and, mirrored, the near side in RTL (left); either way the text touches it with an 8 px pad.
      const durEdge = rtl ? col.right - (220 + 120 + 120 + 96) : col.left + 220 + 120 + 120 + 96;
      const progEdge = rtl ? col.right - COLS_W : col.left + COLS_W;
      if (rtl) {
        expect(Math.abs(durationCell!.left - (durEdge + 8))).toBeLessThanOrEqual(2);
        expect(Math.abs(progressCell!.left - (progEdge + 8))).toBeLessThanOrEqual(2);
      } else {
        expect(Math.abs(durationCell!.right - (durEdge - 8))).toBeLessThanOrEqual(2);
        expect(Math.abs(progressCell!.right - (progEdge - 8))).toBeLessThanOrEqual(2);
      }
    });

    test('clicking a grid cell selects the row; shift+click and keyboard keep working', async ({ page }) => {
      await open(page, q());
      const cell = page.locator(`${COLUMN} g[data-task-id="design"] text`).nth(1); // the End cell
      await cell.click();
      expect(await page.evaluate(() => (window as unknown as { __gantt: { getSelection(): string[] } }).__gantt.getSelection())).toEqual(['design']);
      await page.locator(`${COLUMN} g[data-task-id="dev"] text`).first().click({ modifiers: ['Shift'] });
      expect(await page.evaluate(() => (window as unknown as { __gantt: { getSelection(): string[] } }).__gantt.getSelection())).toEqual(['design', 'dev']);
    });

    test('a selection keeps every cell (row patch) and does not move the pinned column', async ({ page }) => {
      await open(page, q());
      const before = await rect(page, COLUMN);
      await page.locator(`${COLUMN} g[data-task-id="req"] text`).first().click();
      await frames(page);
      expect(await page.locator('#gantt svg.fg-timeline .fg-timeline__row').first().locator('[role=gridcell]').count()).toBe(5);
      expect(await page.locator('#gantt svg.fg-timeline [role=gridcell][data-column-id=duration]').count()).toBe(7);
      expect(await rect(page, COLUMN)).toEqual(before);
    });

    test('the header stays pinned while rows scroll, and the real cells are invisible', async ({ page }) => {
      await open(page, q('rows=80'));
      await setScroll(page, 0, 300);
      const box = await containerBox(page);
      expect(Math.abs((await rect(page, CORNER)).top - box.top)).toBeLessThanOrEqual(1);
      const opacity = await page.evaluate(() => getComputedStyle(document.querySelector('#gantt svg.fg-timeline .fg-grid__cells')!).opacity);
      expect(opacity).toBe('0');
    });

    test('zoom and collapse repaint without losing the grid', async ({ page }) => {
      await open(page, q());
      await page.evaluate(() => {
        const g = (window as unknown as { __gantt: { zoomTo(m: string): void; toggleCollapse(id: string): void } }).__gantt;
        g.zoomTo('month');
        g.toggleCollapse('plan');
      });
      await frames(page);
      expect(await page.locator('#gantt svg.fg-timeline .fg-timeline__row').count()).toBe(2); // plan + launch
      expect(await page.locator('#gantt svg.fg-timeline [role=columnheader]').count()).toBe(5);
      expect((await rect(page, COLUMN)).width).toBeCloseTo(COLS_W, 0);
    });
  });
}

test('collapseBelow: a narrow viewport shows only the name column, a wide one all of them', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 700 });
  await open(page);
  await expect.poll(async () => (await rect(page, COLUMN)).width).toBeCloseTo(220, 0);
  expect(await page.locator('#gantt svg.fg-timeline [role=columnheader]').count()).toBe(1);
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect.poll(async () => (await rect(page, COLUMN)).width).toBeCloseTo(COLS_W, 0);
  expect(await page.locator('#gantt svg.fg-timeline [role=columnheader]').count()).toBe(5);
});

test('collapse=0 never collapses', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 700 });
  await open(page, 'collapse=0');
  expect((await rect(page, COLUMN)).width).toBeCloseTo(COLS_W, 0);
});

test('exports include the grid: SVG has header, cells and the cut name; CSV lists every task', async ({ page }) => {
  await open(page, 'long=1');
  const { svg, csv } = await page.evaluate(() => {
    const g = (window as unknown as { __gantt: { exportSvg(): string; exportGridCsv(): string } }).__gantt;
    return { svg: g.exportSvg(), csv: g.exportGridCsv() };
  });
  for (const s of ['>Name<', '>Duration<', 'Mar 2, 2026', '…']) expect(svg).toContain(s);
  expect(svg).not.toMatch(/opacity/);
  const lines = csv.split('\r\n');
  expect(lines[0]).toBe('Name,Start,End,Duration,Progress');
  expect(lines).toHaveLength(8);
  expect(lines[2]).toMatch(/^Requirements: .*,2026-03-02,2026-03-13,9,100$/);
});

test('exported PNG decodes (the grid is part of the picture)', async ({ page }) => {
  await open(page);
  const size = await page.evaluate(async () => {
    const g = (window as unknown as { __gantt: { exportPng(): Promise<Blob> } }).__gantt;
    const blob = await g.exportPng();
    const bmp = await createImageBitmap(blob);
    return { w: bmp.width, h: bmp.height, bytes: blob.size };
  });
  expect(size.w).toBeGreaterThan(COLS_W);
  expect(size.bytes).toBeGreaterThan(1000);
});

test('summary rows show the rolled-up span and duration', async ({ page }) => {
  await open(page);
  const cells = await cloneCells(page, 'plan');
  expect(cells.map((c) => c.text)).toEqual(['Mar 2, 2026', 'Jun 5, 2026', '68d', '34%']);
});

test('a calendar zone changes the displayed date but not the grid layout', async ({ page }) => {
  await open(page, 'tz=Pacific/Auckland');
  expect((await rect(page, COLUMN)).width).toBeCloseTo(COLS_W, 0);
  expect((await cloneCells(page, 'req'))[0]!.text).toBe('Mar 2, 2026');
});
