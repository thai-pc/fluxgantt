import { test, expect, type Page } from '@playwright/test';

// Real-browser coverage for `withGrid()` on the CANVAS renderer (spec-grid-columns.md, PR G2). jsdom has no
// 2D context and no layout, so the painted pixels, the sticky pinning on horizontal scroll, the click through
// the pointer-transparent label canvas and the exports are only provable here. Fixture:
// `examples/plain-html-demo/grid.html?rows=2100` (more than 2000 tasks mounts the Canvas renderer through the
// real `mount()`; query params in `src/grid.ts`). Chromium only (the project's `e2e` device, dpr 1).

const LABELS = '#gantt canvas.fg-timeline-canvas-labels';
const COLS_W = 220 + 120 + 120 + 96 + 96; // 652
const ROW = 32;
const HEADER = 32;

async function open(page: Page, query = '', width = COLS_W): Promise<void> {
  await page.goto(`/grid.html?rows=2100${query ? `&${query}` : ''}`);
  await expect(page.locator(LABELS)).toBeAttached({ timeout: 30_000 });
  await page.waitForFunction(() => '__gantt' in window);
  // the painter chunk is fetched after the Canvas mount: the pinned width and the colcount mark it as painted
  await page.waitForFunction((w) => (document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement | null)?.width === w, width);
  await frames(page);
}
const frames = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Number of non-transparent pixels of the label canvas inside a box (CSS px == bitmap px at dpr 1). */
const ink = (page: Page, x: number, y: number, w: number, h: number): Promise<number> =>
  page.evaluate(
    ([bx, by, bw, bh]) => {
      const c = document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(bx!, by!, bw!, bh!).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
      return n;
    },
    [x, y, w, h] as const,
  );

const containerBox = (page: Page) =>
  page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    const r = c.getBoundingClientRect();
    return { left: r.left + c.clientLeft, right: r.left + c.clientLeft + c.clientWidth, top: r.top + c.clientTop };
  });

const labelRect = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector('canvas.fg-timeline-canvas-labels')!.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, top: r.top };
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

const selection = (page: Page) => page.evaluate(() => (window as unknown as { __gantt: { getSelection(): string[] } }).__gantt.getSelection());

for (const rtl of [false, true]) {
  test.describe(rtl ? 'RTL' : 'LTR', () => {
    const q = (extra = '') => [rtl ? 'rtl=1' : '', extra].filter(Boolean).join('&');

    test('the label canvas is the sum of the widths, pinned at the inline-start edge on horizontal scroll', async ({ page }) => {
      await open(page, q());
      const box = await containerBox(page);
      for (const sx of [0, rtl ? -400 : 400]) {
        await setScroll(page, sx);
        const r = await labelRect(page);
        expect(Math.abs(r.width - COLS_W)).toBeLessThanOrEqual(1);
        expect(Math.abs(rtl ? box.right - r.right : r.left - box.left)).toBeLessThanOrEqual(1);
      }
    });

    test('the header band, the cells and the dividers are painted on the label canvas', async ({ page }) => {
      await open(page, q());
      expect(await ink(page, 0, 0, COLS_W, HEADER)).toBeGreaterThan(2000); // band + five headers
      // the column header of `Start` (layout x 220..340) and its cells on the first rows
      const startX = rtl ? COLS_W - 340 : 220;
      expect(await ink(page, startX + 4, 4, 112, 24)).toBeGreaterThan(0);
      for (let row = 0; row < 3; row++) expect(await ink(page, startX + 4, HEADER + row * ROW + 4, 112, ROW - 8)).toBeGreaterThan(0);
      // a divider line at the Start/End boundary runs down the whole canvas, in the row band too
      expect(await ink(page, rtl ? COLS_W - 220 : 219, 300, 1, 200)).toBeGreaterThan(150);
    });

    test('cells are aligned by their LOGICAL column alignment (Progress is end-aligned)', async ({ page }) => {
      await open(page, q());
      // the Progress column (96 px) is the last in LTR and the first in the mirrored bitmap in RTL; scan the
      // interior only (the column dividers are ink too) for the text's horizontal extent on the `design` row
      const x0 = rtl ? 0 : COLS_W - 96;
      const { min, max } = await page.evaluate(
        ([bx, by]) => {
          const c = document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement;
          const d = c.getContext('2d')!.getImageData(bx!, by!, 96, 16).data;
          let lo = 96;
          let hi = -1;
          for (let i = 3; i < 93; i++) for (let j = 0; j < 16; j++) if (d[(j * 96 + i) * 4 + 3]! > 40) { lo = Math.min(lo, i); hi = Math.max(hi, i); }
          return { min: lo, max: hi };
        },
        [x0, HEADER + ROW * 2 + 8] as const,
      );
      // the padded inline-end edge: the right edge (88) in LTR, the left edge (8) in RTL
      if (rtl) expect(Math.abs(min - 8)).toBeLessThanOrEqual(4);
      else expect(Math.abs(max - 88)).toBeLessThanOrEqual(4);
      expect(max - min).toBeLessThan(40); // a short value never fills the column
    });

    test('a click on a grid cell selects the row exactly like a label click, and does not toggle', async ({ page }) => {
      await open(page, q());
      const box = await containerBox(page);
      const y = box.top + HEADER + ROW * 1 + 16; // `req`
      const x = (off: number): number => (rtl ? box.right - off : box.left + off);
      await page.mouse.click(x(30), y); // the label
      const byLabel = await selection(page);
      await page.mouse.click(x(10), box.top + HEADER + ROW * 3 + 16); // another row first
      await page.mouse.click(x(COLS_W - 40), y); // the Progress cell
      expect(await selection(page)).toEqual(byLabel);
      expect(byLabel).toEqual(['req']);
      // the summary's toggle still works at the name column, and a cell of the same row does not toggle it
      await page.mouse.click(x(400), box.top + HEADER + 16);
      expect(await page.locator('#gantt .fg-timeline-a11y-layer [data-task-id="req"][role=row]').count()).toBe(1);
      await page.mouse.click(x(14), box.top + HEADER + 16); // the toggle glyph of `plan`
      await frames(page);
      expect(await page.locator('#gantt .fg-timeline-a11y-layer [data-task-id="req"][role=row]').count()).toBe(0);
    });

    test('vertical scroll repaints the cells of the new window and keeps the header', async ({ page }) => {
      await open(page, q());
      await setScroll(page, 0, 1000 * ROW);
      // the layer also keeps the roving-tabindex row (0) outside the window, so look at the last row
      const last = await page.evaluate(() => [...document.querySelectorAll('#gantt .fg-timeline-a11y-layer [data-row-index]')].at(-1)?.getAttribute('data-row-index'));
      expect(Number(last)).toBeGreaterThan(1000);
      const startX = rtl ? COLS_W - 340 : 220;
      expect(await ink(page, startX + 4, HEADER + 4, 112, ROW - 8)).toBeGreaterThan(0); // a cell right under the header
      expect(await ink(page, startX + 4, 4, 112, 24)).toBeGreaterThan(0); // and the header is still there
    });

    test('exports include the grid: exportSvg, exportPng and exportGridCsv', async ({ page }) => {
      await open(page, q());
      const svg = await page.evaluate(() => (window as unknown as { __gantt: { exportSvg(): string } }).__gantt.exportSvg());
      for (const s of ['>Name<', '>Start<', '>Progress<', 'Mar 2, 2026', '68d', '100%']) expect(svg).toContain(s);
      expect(svg).not.toContain('opacity:0');
      const csv = await page.evaluate(() => (window as unknown as { __gantt: { exportGridCsv(): string } }).__gantt.exportGridCsv());
      expect(csv.split('\r\n')[0]).toBe('Name,Start,End,Duration,Progress');
      expect(csv.split('\r\n')[1]).toBe('Project plan,2026-03-02,2026-06-05,68,34');
      expect(csv.split('\r\n')).toHaveLength(2100 + 1);
    });
  });
}

test('exportPng paints the grid: the header band over the label column and the cell text', async ({ page }) => {
  await open(page);
  // 2100 rows at the default density is taller than the per-side cap at scale 1 (see canvas-export.spec.ts)
  const sample = await page.evaluate(async () => {
    const blob = await (window as unknown as { __gantt: { exportPng(o: { scale: number }): Promise<Blob> } }).__gantt.exportPng({ scale: 0.5 });
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = 326;
    c.height = 120;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, 326, 120, 0, 0, 326, 120);
    const px = (x: number, y: number): number[] => [...ctx.getImageData(x, y, 1, 1).data];
    const d = ctx.getImageData(110, 20, 50, 40).data; // the Start column's cells (layout x 220..320, y 40..120)
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 120) dark++;
    return { band: px(5, 3), cells: dark, w: bmp.width };
  });
  // --fg-bg-subtle (243, 244, 246), not the page ground (250, 250, 250), is the header band
  expect(sample.band.slice(0, 3)).toEqual([243, 244, 246]);
  expect(sample.cells).toBeGreaterThan(20); // text pixels
});

test('collapseBelow and durationUnit behave as on SVG', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await open(page, '', 220);
  expect(await page.locator('#gantt .fg-timeline-a11y-layer').getAttribute('aria-colcount')).toBe('1');
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForFunction((w) => (document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement).width === w, COLS_W);
  await open(page, 'hours=1');
  const dur = page.locator('#gantt .fg-timeline-a11y-layer [data-task-id="req"][role=row] [data-column-id=duration]');
  await expect(dur).toHaveText(/\dh$/);
});
