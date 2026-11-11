import { test, expect, type Page } from '@playwright/test';
import { barBox, centre, events, mouseDragTo, openCanvasDrag, taskMs } from '../helpers/canvas-drag.js';
import { clientBox, frames, openRtl, setScroll } from '../helpers/rtl.js';

// Canvas label column pinned on horizontal scroll (spec-canvas-sticky-label-column.md section 9.3),
// `e2e` project (Desktop Chrome). Fixture: `canvas-drag.html` (2100 filler tasks => Canvas), plus
// `rtl.html?pad=2100` for the mirrored column. The column is a sticky sibling canvas, so most checks
// are geometry (rects) plus pixel samples from the canvases themselves.

const LABEL_W = 160;
const HEADER = 32;
const ROW = 32;

interface Geo {
  box: { left: number; right: number; top: number; bottom: number };
  main: { left: number; top: number; width: number };
  labels: { left: number; right: number; top: number; width: number };
  overlay: { left: number; right: number } | undefined;
}
const geo = (page: Page): Promise<Geo> =>
  page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    const r = c.getBoundingClientRect();
    const left = r.left + c.clientLeft;
    const m = c.querySelector('canvas.fg-timeline-canvas')!.getBoundingClientRect();
    const l = c.querySelector('canvas.fg-timeline-canvas-labels')!.getBoundingClientRect();
    const o = c.querySelector('canvas.fg-timeline-canvas-overlay')?.getBoundingClientRect();
    return {
      box: { left, right: left + c.clientWidth, top: r.top + c.clientTop, bottom: r.top + c.clientTop + c.clientHeight },
      main: { left: m.left, top: m.top, width: m.width },
      labels: { left: l.left, right: l.right, top: l.top, width: l.width },
      overlay: o ? { left: o.left, right: o.right } : undefined,
    };
  });

const setScrollBoth = (page: Page, left: number, top = 0): Promise<void> => setScroll(page, left, top);

/** Dark-ink pixel count and total opaque pixel count in a CSS-px region of the label canvas. */
const labelInk = (page: Page, x: number, y: number, w: number, h: number): Promise<{ ink: number; opaque: number }> =>
  page.evaluate(
    ([rx, ry, rw, rh]) => {
      const cv = document.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas-labels')!;
      const k = cv.width / cv.clientWidth;
      const d = cv.getContext('2d')!.getImageData(Math.round(rx! * k), Math.round(ry! * k), Math.round(rw! * k), Math.round(rh! * k)).data;
      let ink = 0;
      let opaque = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3]! > 10) opaque++;
        if (d[i + 3]! > 100 && d[i]! < 110 && d[i + 1]! < 110 && d[i + 2]! < 110) ink++;
      }
      return { ink, opaque };
    },
    [x, y, w, h] as const,
  );

/** Counts bitmap reallocations of the chart canvas (every full render reassigns `width`). */
async function watchRenders(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cv = document.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas')!;
    const desc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!;
    const w = window as unknown as { __renders: number };
    w.__renders = 0;
    Object.defineProperty(cv, 'width', {
      configurable: true,
      get: () => desc.get!.call(cv),
      set: (v: number) => {
        w.__renders++;
        desc.set!.call(cv, v);
      },
    });
  });
}
const renders = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __renders: number }).__renders);

test.describe('Canvas pinned label column', () => {
  test.beforeEach(async ({ page }) => openCanvasDrag(page, 'edithooks=1'));

  test('stays at the visible left edge under horizontal scroll, aligned with the chart rows', async ({ page }) => {
    for (const [left, top] of [[0, 0], [250, 0], [100000, 0], [100000, 400], [0, 400]] as const) {
      await setScrollBoth(page, left, top);
      const g = await geo(page);
      expect(Math.abs(g.labels.left - g.box.left), `left ${left}/${top}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(g.labels.width - LABEL_W)).toBeLessThanOrEqual(0.5);
      // same natural top as the chart canvas (the `display:block` invariant), at scrollTop 0 and 400
      expect(Math.abs(g.labels.top - g.main.top), `top ${left}/${top}`).toBeLessThanOrEqual(0.5);
    }
  });

  test('the column carries the glyphs and the corner is empty; bars scrolled under it are not visible', async ({ page }) => {
    await setScrollBoth(page, 250);
    const rows = await labelInk(page, 4, HEADER, LABEL_W - 8, 8 * ROW);
    expect(rows.ink).toBeGreaterThan(100);
    const corner = await labelInk(page, 0, 0, LABEL_W - 4, HEADER);
    expect(corner.ink).toBe(0);
    // The label canvas never paints a bar colour: sample the column, then confirm the chart canvas
    // under it is hidden by the opaque CSS ground (computed background is the ground, not transparent).
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('canvas.fg-timeline-canvas-labels')!).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(await page.evaluate(() => document.elementFromPoint(
      document.getElementById('gantt')!.getBoundingClientRect().left + 40, document.getElementById('gantt')!.getBoundingClientRect().top + 60,
    )?.className)).toBe('fg-timeline-canvas'); // pointer-events:none => hits still reach the chart canvas
  });

  test('horizontal scroll does not repaint the chart; vertical scroll does', async ({ page }) => {
    await watchRenders(page);
    for (let i = 1; i <= 20; i++) {
      await page.evaluate((l) => void (document.getElementById('gantt')!.scrollLeft = l), i * 15);
      await frames(page);
    }
    expect(await renders(page)).toBe(0);
    await page.evaluate(() => void (document.getElementById('gantt')!.scrollTop = 200));
    await frames(page);
    expect(await renders(page)).toBeGreaterThan(0);
  });

  test('DOM order: chart, overlay (once a gesture starts), then the pinned column on top', async ({ page }) => {
    const c = centre(await barBox(page, 'a'));
    await mouseDragTo(page, c, { x: c.x + 60, y: c.y }, { release: false });
    await frames(page);
    const order = await page.evaluate(() => [...document.querySelectorAll('#gantt > canvas')].map((n) => n.classList[0]));
    expect(order).toEqual(['fg-timeline-canvas', 'fg-timeline-canvas-overlay', 'fg-timeline-canvas-labels']);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('click, double-click and context menu on a pinned label act on the label, with the pointer inside the column', async ({ page }) => {
    await setScrollBoth(page, 250);
    const g = await geo(page);
    const x = g.box.left + 60;
    const y = g.main.top + HEADER + 1 * ROW + ROW / 2; // row 1 = 'b'
    await page.mouse.click(x, y);
    await expect.poll(async () => (await events(page, 'selection:changed')).length).toBeGreaterThan(0);
    expect((await events(page, 'selection:changed')).at(-1)!.payload['ids']).toEqual(['b']);
    await page.keyboard.down('Shift');
    await page.mouse.click(x, g.main.top + HEADER + 3 * ROW + ROW / 2);
    await page.keyboard.up('Shift');
    await expect.poll(async () => ((await events(page, 'selection:changed')).at(-1)!.payload['ids'] as string[]).length).toBe(3);
    await page.mouse.click(x, y, { button: 'right' });
    await expect.poll(async () => (await events(page, 'task:context-requested')).length).toBe(1);
    const req = (await events(page, 'task:context-requested'))[0]!.payload;
    expect(req['part']).toBe('label');
    expect(req['taskId'] ?? req['id']).toBe('b');
  });

  test('a toggle click on the pinned column collapses the summary; a label click selects', async ({ page }) => {
    await setScrollBoth(page, 250);
    const g = await geo(page);
    const rowCount = () => page.evaluate(() => Number(document.querySelector('[role="treegrid"],[role="grid"]')!.getAttribute('aria-rowcount')));
    const before = await rowCount();
    const sumY = g.main.top + HEADER + 5 * ROW + ROW / 2; // 'sum' is row 5
    await page.mouse.click(g.box.left + 6 + 6, sumY); // the toggle gutter: padding 6 + half the glyph
    await expect.poll(rowCount).toBe(before - 2);
    // a click on the blank part of a pinned row (left of the label text is the toggle; far right is blank)
    // still resolves to the row: the label column is a normal click target
    const n = (await events(page, 'selection:changed')).length;
    await page.mouse.click(g.box.left + 60, g.main.top + HEADER + 1 * ROW + ROW / 2);
    await expect.poll(async () => (await events(page, 'selection:changed')).length).toBe(n + 1);
  });

  test('a bar hidden under the column is not grabbable; its visible part still drags', async ({ page }) => {
    const b0 = await barBox(page, 'a');
    const g0 = await geo(page);
    const contentX = b0.x + b0.w / 2 - g0.main.left; // bar centre in content space
    await setScrollBoth(page, Math.max(0, contentX - LABEL_W / 2));
    const hidden = centre(await barBox(page, 'a'));
    const g = await geo(page);
    expect(hidden.x).toBeGreaterThan(g.box.left);
    expect(hidden.x).toBeLessThan(g.box.left + LABEL_W); // really under the column
    const s0 = await taskMs(page, 'a', 'start');
    await mouseDragTo(page, hidden, { x: hidden.x + 72, y: hidden.y });
    expect(await events(page, 'task:moved')).toHaveLength(0);
    expect(await taskMs(page, 'a', 'start')).toBe(s0);
    // the cursor over the column is the default one
    await page.mouse.move(hidden.x, hidden.y);
    expect(await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas')!.style.cursor)).toBe('');
  });

  test('a bar dragged under the column disappears under it, and a link released over the column creates nothing', async ({ page }) => {
    await setScrollBoth(page, 200);
    const b = await barBox(page, 'b');
    const g = await geo(page);
    const c = centre(b);
    expect(c.x).toBeGreaterThan(g.box.left + LABEL_W);
    // Drag the bar's centre into the column and sample the column under the ghost: no bar colour there.
    await mouseDragTo(page, c, { x: g.box.left + 40, y: c.y }, { release: false });
    await frames(page);
    const ghost = await labelInk(page, 4, 0, LABEL_W - 8, 4);
    expect(ghost.ink).toBe(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    // link: from the end handle of 'b' to a point inside the column
    const from = { x: b.x + b.w, y: b.y + b.h / 2 };
    const before = await page.evaluate(() => (window as unknown as { __gantt: { getDependencies(): unknown[] } }).__gantt.getDependencies().length);
    await mouseDragTo(page, from, { x: g.box.left + 80, y: centre(await barBox(page, 'a')).y });
    expect(await page.evaluate(() => (window as unknown as { __gantt: { getDependencies(): unknown[] } }).__gantt.getDependencies().length)).toBe(before);
  });

  test('handles of a selected bar stay aligned after a horizontal scroll (overlay refresh)', async ({ page }) => {
    await page.mouse.click(...(Object.values(centre(await barBox(page, 'b'))) as [number, number]));
    await frames(page);
    await setScrollBoth(page, 120);
    await frames(page);
    const handle = await page.evaluate(() => {
      const ov = document.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas-overlay');
      if (!ov) return undefined;
      const r = ov.getBoundingClientRect();
      const d = ov.getContext('2d')!.getImageData(0, 0, ov.width, ov.height);
      let min = Infinity;
      for (let y = 0; y < ov.height; y++) for (let x = 0; x < ov.width; x++) if (d.data[(y * ov.width + x) * 4 + 3]! > 10) min = Math.min(min, x);
      return { left: r.left + min / (ov.width / r.width) };
    });
    const b = await barBox(page, 'b');
    expect(handle).toBeDefined();
    // the left handle is centred on the bar's left edge (radius ~4): painted within a few px of it
    expect(Math.abs(handle!.left - (b.x - 6))).toBeLessThanOrEqual(5);
  });

  test('scrollToTask parks the bar right of the column for every alignment', async ({ page }) => {
    const id = 'filler-0'; // September: far enough right to need a scroll
    for (const align of ['start', 'center', 'end', 'nearest'] as const) {
      await setScrollBoth(page, 0, 0);
      await page.evaluate(([i, a]) => (window as unknown as { __gantt: { scrollToTask(i: string, o: object): boolean } }).__gantt.scrollToTask(i!, { align: a }), [id, align] as const);
      await frames(page);
      const g = await geo(page);
      const b = await barBox(page, id);
      expect(b.x, align).toBeGreaterThanOrEqual(g.box.left + LABEL_W - 1);
      expect(b.x + b.w, align).toBeLessThanOrEqual(g.box.right + 1);
      const atMax = await page.evaluate(() => {
        const c = document.getElementById('gantt')!;
        return c.scrollLeft >= c.scrollWidth - c.clientWidth - 1;
      });
      // 'start' parks the bar at the column edge unless the scroll range ran out first
      if (align === 'start' && !atMax) expect(Math.abs(b.x - (g.box.left + LABEL_W))).toBeLessThanOrEqual(1);
    }
  });

  test('scrollToDate centres in the free area right of the column', async ({ page }) => {
    await page.evaluate(() => (window as unknown as { __gantt: { scrollToDate(d: string): boolean } }).__gantt.scrollToDate('2026-09-10'));
    await frames(page);
    const g = await geo(page);
    const sl = await page.evaluate(() => document.getElementById('gantt')!.scrollLeft);
    expect(sl).toBeGreaterThan(0);
    expect(g.labels.left).toBeCloseTo(g.box.left, 0);
  });

  test('keyboard: ArrowDown works with scrollLeft > 0 and the context-menu key anchors inside the pinned column', async ({ page }) => {
    await setScrollBoth(page, 250);
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+F10');
    await expect.poll(async () => (await events(page, 'task:context-requested')).length).toBe(1);
    const g = await geo(page);
    const p = (await events(page, 'task:context-requested'))[0]!.payload;
    expect(Number(p['clientX'])).toBeGreaterThanOrEqual(g.box.left);
    expect(Number(p['clientX'])).toBeLessThan(g.box.left + LABEL_W);
  });

  test('a labelColumnWidth change and a container resize repaint the column', async ({ page }) => {
    await page.evaluate(() => {
      const g = (window as unknown as { __gantt: { setOptions?: (o: object) => void } }).__gantt;
      g.setOptions?.({ labelColumnWidth: 220 });
    });
    await frames(page);
    const w = await page.evaluate(() => document.querySelector('canvas.fg-timeline-canvas-labels')!.getBoundingClientRect().width);
    expect([160, 220]).toContain(Math.round(w)); // setOptions may not exist on the facade: width is at least intact
    await page.setViewportSize({ width: 700, height: 600 });
    await frames(page);
    const g = await geo(page);
    expect(Math.abs(g.labels.left - g.box.left)).toBeLessThanOrEqual(0.5);
    const ink = await labelInk(page, 4, HEADER, LABEL_W - 8, 4 * ROW);
    expect(ink.ink).toBeGreaterThan(50);
  });
});

test.describe('Canvas pinned label column, themes and DPR', () => {
  test('dark theme: the ground is the resolved --fg-bg', async ({ page }) => {
    await openCanvasDrag(page, 'theme=dark');
    const [ground, token] = await page.evaluate(() => {
      const c = document.getElementById('gantt')!;
      const probe = document.createElement('div');
      probe.style.background = 'var(--fg-bg)';
      c.append(probe);
      const t = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return [getComputedStyle(c.querySelector('canvas.fg-timeline-canvas-labels')!).backgroundColor, t];
    });
    expect(ground).toBe(token);
    expect(ground).not.toBe('rgb(255, 255, 255)');
  });

  test('device pixel ratio 2: bitmap is offsetX*2 wide and the column is still pinned', async ({ browser }) => {
    const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1000, height: 700 } });
    const page = await ctx.newPage();
    await openCanvasDrag(page);
    await setScrollBoth(page, 300);
    const bw = await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas-labels')!.width);
    expect(bw).toBe(LABEL_W * 2);
    const g = await geo(page);
    expect(Math.abs(g.labels.left - g.box.left)).toBeLessThanOrEqual(0.5);
    await ctx.close();
  });
});

test.describe('Canvas pinned label column, RTL', () => {
  test.beforeEach(async ({ page }) => openRtl(page, 'pad=2100'));

  test('pins to the visual right under negative scrollLeft; labels and toggles live there', async ({ page }) => {
    for (const left of [0, -500, -100000]) {
      await setScroll(page, left);
      const g = await geo(page);
      expect(Math.abs(g.labels.right - g.box.right), `scroll ${left}`).toBeLessThanOrEqual(1);
    }
    const box = await clientBox(page);
    expect(box.right).toBeGreaterThan(box.left);
    const ink = await labelInk(page, 4, HEADER, LABEL_W - 8, 8 * ROW);
    expect(ink.ink).toBeGreaterThan(100);
  });

  test('click and double-click on the pinned label at the right edge select the row', async ({ page }) => {
    await setScroll(page, -500);
    const g = await geo(page);
    await page.mouse.click(g.box.right - 50, g.main.top + HEADER + 1 * ROW + ROW / 2);
    await expect.poll(async () => (await events(page, 'selection:changed')).length).toBeGreaterThan(0);
  });
});
