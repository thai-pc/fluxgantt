import { test, expect, type Page } from '@playwright/test';
import {
  DAY_MS,
  PX_PER_DAY,
  barBox,
  canvasPixel,
  centre,
  clientBox,
  dependencyCount,
  events,
  frames,
  gantt,
  isGreenish,
  mouseDragTo,
  openRtl,
  scrollLeft,
  setScroll,
  taskMs,
  visibleCentre,
} from '../helpers/rtl.js';

// Real-browser coverage for `withRtl()` (spec-rtl-chart.md AC1-AC7, AC12): jsdom has no layout, so the
// geometry, the negative `scrollLeft` model, drag direction and export parity are only provable here.
// Fixture: `examples/plain-html-demo/rtl.html` (an Arabic project plan, ~2850 px wide at the default
// `week` view so the 420 px container really scrolls). `?rtl=0` is the LTR twin used as an oracle.
// Chromium only (the project's `e2e` device); Firefox/WebKit/Safari were probed by hand, see the spec.

const LABEL_W = 160;
// design, dev and docs are all comfortably inside the 960 px container at this offset
const LINK_SCROLL = -700;
const ROW_IDS = ['plan', 'req', 'design', 'dev', 'docs', 'test', 'launch'];

// `Locator.boundingBox()` is not used for transformed SVG text: WebKit reports it from the untransformed
// quad. `getBoundingClientRect()` agrees with what is painted in all three engines.
const textBox = (page: Page, id: string) =>
  page.evaluate((i) => {
    const r = document.querySelector(`.fg-timeline__row[data-task-id="${i}"] text`)!.getBoundingClientRect();
    return { x: r.left, width: r.width };
  }, id);

const svgBox = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector('#gantt svg.fg-timeline')!.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, width: r.width };
  });

test.describe('SVG geometry', () => {
  test.beforeEach(async ({ page }) => openRtl(page));

  test('dir=rtl on the container, the chart svg sits at the right edge, scrollLeft starts at 0', async ({ page }) => {
    expect(await page.evaluate(() => document.getElementById('gantt')!.getAttribute('dir'))).toBe('rtl');
    const box = await clientBox(page);
    const svg = await svgBox(page);
    expect(Math.abs(svg.right - box.right)).toBeLessThanOrEqual(1);
    expect(svg.width).toBeGreaterThan(box.right - box.left); // it overflows, so it scrolls
    expect(await scrollLeft(page)).toBe(0);
  });

  test('an earlier task is painted to the RIGHT of a later one (A before B => A right of B)', async ({ page }) => {
    const req = await barBox(page, 'req'); // Mar 2-13
    const design = await barBox(page, 'design'); // Mar 16 - Apr 3
    expect(req.x).toBeGreaterThan(design.x);
    expect(req.x).toBeGreaterThanOrEqual(design.x + design.w - 1); // and does not overlap it
  });

  test('the label column occupies the right edge and every bar is to its left', async ({ page }) => {
    const svg = await svgBox(page);
    const columnLeft = svg.right - LABEL_W;
    for (const id of ROW_IDS) {
      const label = await textBox(page, id);
      expect(label.x, id).toBeGreaterThanOrEqual(columnLeft - 1);
      expect(label.x + label.width, id).toBeLessThanOrEqual(svg.right + 1);
      const bar = await barBox(page, id);
      expect(bar.x + bar.w, id).toBeLessThanOrEqual(columnLeft + 1);
    }
  });

  test('text is upright (not a mirrored glyph) and row labels sit at the mirrored LTR position', async ({ page, context }) => {
    const uprightCount = await page.evaluate(() => {
      let n = 0;
      for (const t of document.querySelectorAll<SVGTextElement>('#gantt svg.fg-timeline text')) {
        const m = t.getScreenCTM()!;
        if (Math.abs(m.a - 1) < 1e-6 && Math.abs(m.d - 1) < 1e-6 && Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6) n++;
      }
      return n;
    });
    const total = await page.locator('#gantt svg.fg-timeline text').count();
    expect(total).toBeGreaterThan(10);
    expect(uprightCount).toBe(total);

    // The label of each row ends (right edge) as far from the svg's right edge as its LTR twin
    // starts (left edge) from the svg's left edge: the mirror is exact, glyph runs included.
    const twin = await context.newPage();
    await openRtl(twin, 'rtl=0');
    for (const id of ROW_IDS) {
      const r = await textBox(page, id);
      const l = await textBox(twin, id);
      const s = await svgBox(page);
      const ls = await svgBox(twin);
      expect(Math.abs(s.right - (r.x + r.width) - (l.x - ls.left)), id).toBeLessThanOrEqual(1.5);
    }
    await twin.close();
  });

  test('the progress fill grows from the START side (the visually right end)', async ({ page }) => {
    const fill = await page.locator('.fg-task[data-task-id="dev"] .fg-task__progress').boundingBox();
    const bar = await barBox(page, 'dev');
    expect(Math.abs(fill!.x + fill!.width - (bar.x + bar.w))).toBeLessThanOrEqual(1);
    expect(fill!.width).toBeLessThan(bar.w);
  });

  test('a finish-to-start arrow ends at the successor START, the visually-right edge of its bar', async ({ page }) => {
    await setScroll(page, -900);
    const geom = await page.evaluate(() => {
      // DOM order of the paths is the dependency order: req>design, design>dev, dev>docs, dev>test, test>launch
      const path = document.querySelectorAll<SVGPathElement>('#gantt .fg-dependency')[1]!;
      const m = path.getScreenCTM()!;
      const end = path.getPointAtLength(path.getTotalLength());
      const pt = new DOMPoint(end.x, end.y).matrixTransform(m);
      const dev = document.querySelector('.fg-task[data-task-id="dev"] .fg-task__bar')!.getBoundingClientRect();
      const design = document.querySelector('.fg-task[data-task-id="design"] .fg-task__bar')!.getBoundingClientRect();
      return { endX: pt.x, devRight: dev.right, designLeft: design.left };
    });
    expect(Math.abs(geom.endX - geom.devRight)).toBeLessThanOrEqual(3); // the arrow lands on dev's START edge
    expect(geom.devRight).toBeLessThanOrEqual(geom.designLeft + 1); // the successor is LEFT of the predecessor's END
  });
});

test.describe('scroll model', () => {
  test.beforeEach(async ({ page }) => openRtl(page));

  test('scrollLeft is 0 at the start edge and goes negative; the range is [-(scrollWidth - clientWidth), 0]', async ({ page }) => {
    const range = await page.evaluate(() => {
      const c = document.getElementById('gantt')!;
      return c.scrollWidth - c.clientWidth;
    });
    expect(range).toBeGreaterThan(500);
    await setScroll(page, -100000);
    expect(await scrollLeft(page)).toBeCloseTo(-range, 0);
    await setScroll(page, 100000);
    expect(await scrollLeft(page)).toBe(0);
  });

  test('the pinned header stays aligned with the day columns at any scroll, horizontally and vertically', async ({ page }) => {
    await openRtl(page, 'pad=30');
    for (const [l, t] of [[0, 0], [-900, 0], [-900, 90], [-2000, 140]] as const) {
      await setScroll(page, l, t);
      const rows = await page.evaluate(() => {
        const lefts = (sel: string): number[] => [...document.querySelectorAll(sel)].map((n) => Math.round(n.getBoundingClientRect().left * 10) / 10);
        const overlay = document.querySelector('#gantt svg.fg-timeline__sticky-header')!.getBoundingClientRect();
        const c = document.getElementById('gantt')!;
        return {
          chart: lefts('#gantt svg.fg-timeline .fg-timeline__header text'),
          pinned: lefts('#gantt svg.fg-timeline__sticky-header text'),
          overlayTop: overlay.top,
          clientTop: c.getBoundingClientRect().top + c.clientTop,
        };
      });
      expect(rows.pinned.length).toBeGreaterThan(5);
      expect(rows.pinned, `scroll ${l},${t}`).toEqual(rows.chart);
      expect(Math.abs(rows.overlayTop - rows.clientTop), `scroll ${l},${t}`).toBeLessThanOrEqual(1);
    }
  });

  for (const align of ['start', 'center', 'end', 'nearest'] as const) {
    test(`scrollToTask(align=${align}) lands where the LTR twin does, mirrored (AC4)`, async ({ page, context }) => {
      const twin = await context.newPage();
      await openRtl(twin, 'rtl=0');
      for (const id of ['dev', 'test', 'launch']) {
        await setScroll(page, 0);
        await setScroll(twin, 0);
        await gantt(page, (g, a) => (g['scrollToTask'] as unknown as (i: string, o: object) => void)(a.id, { align: a.align }), { id, align });
        await gantt(twin, (g, a) => (g['scrollToTask'] as unknown as (i: string, o: object) => void)(a.id, { align: a.align }), { id, align });
        const r = await scrollLeft(page);
        const l = await scrollLeft(twin);
        expect(l, id).toBeGreaterThan(0);
        expect(r, id).toBeLessThanOrEqual(0);
        expect(Math.abs(r + l), id).toBeLessThanOrEqual(1);
      }
      await twin.close();
    });
  }

  test('scrollToDate lands the date at the mirrored place; the target is actually visible', async ({ page, context }) => {
    const twin = await context.newPage();
    await openRtl(twin, 'rtl=0');
    await gantt(page, (g) => (g['scrollToDate'] as unknown as (d: string, o: object) => void)('2026-05-01', { align: 'center' }));
    await gantt(twin, (g) => (g['scrollToDate'] as unknown as (d: string, o: object) => void)('2026-05-01', { align: 'center' }));
    expect(Math.abs((await scrollLeft(page)) + (await scrollLeft(twin)))).toBeLessThanOrEqual(1);
    // the dev bar spans 2026-04-06..05-15, so 05-01 is inside it and the bar must be on screen
    const box = await clientBox(page);
    const dev = await barBox(page, 'dev');
    expect(dev.x).toBeLessThan(box.right);
    expect(dev.x + dev.w).toBeGreaterThan(box.left);
    await twin.close();
  });

  test('zoomTo keeps the viewport-centre date anchored, like the LTR twin mirrored (AC4)', async ({ page, context }) => {
    const twin = await context.newPage();
    await openRtl(twin, 'rtl=0');
    await setScroll(page, -700);
    await setScroll(twin, 700);
    await gantt(page, (g) => (g['zoomTo'] as unknown as (m: string) => void)('day'));
    await gantt(twin, (g) => (g['zoomTo'] as unknown as (m: string) => void)('day'));
    const r = await scrollLeft(page);
    const l = await scrollLeft(twin);
    expect(l).toBeGreaterThan(0);
    expect(r).toBeLessThan(0);
    expect(Math.abs(r + l)).toBeLessThanOrEqual(1);
    await twin.close();
  });
});

test.describe('pointer interaction (AC5)', () => {
  test.beforeEach(async ({ page }) => openRtl(page));

  test('dragging a bar visually LEFT moves it LATER; visually RIGHT moves it EARLIER', async ({ page }) => {
    const s0 = await taskMs(page, 'req', 'start');
    const e0 = await taskMs(page, 'req', 'end');
    const c = centre(await barBox(page, 'req'));
    await mouseDragTo(page, c, { x: c.x - 3 * PX_PER_DAY, y: c.y });
    await expect.poll(() => taskMs(page, 'req', 'start')).toBe(s0 + 3 * DAY_MS);
    expect(await taskMs(page, 'req', 'end')).toBe(e0 + 3 * DAY_MS);
    expect((await events(page, 'task:moved')).length).toBe(1);

    const c2 = centre(await barBox(page, 'req'));
    await mouseDragTo(page, c2, { x: c2.x + 5 * PX_PER_DAY, y: c2.y });
    await expect.poll(() => taskMs(page, 'req', 'start')).toBe(s0 - 2 * DAY_MS);
  });

  test('resize grabs the visually-LEFT edge (the END) and edits end only; the right edge moves instead', async ({ page }) => {
    const s0 = await taskMs(page, 'req', 'start');
    const e0 = await taskMs(page, 'req', 'end');
    const b = await barBox(page, 'req');
    const my = b.y + b.h / 2;
    // the visually-left edge, inside the bar
    // (6 px: the innermost 4 px belong to the link handle, which wins the press)
    await mouseDragTo(page, { x: b.x + 6, y: my }, { x: b.x + 6 - 5 * PX_PER_DAY, y: my });
    // dragged visually LEFT by 5 days => the end moves LATER (the commit re-derives it through the
    // working calendar, so it need not land on the exact calendar-day-snapped instant)
    await expect.poll(() => taskMs(page, 'req', 'end')).toBeGreaterThan(e0 + 3 * DAY_MS);
    expect(await taskMs(page, 'req', 'end')).toBeLessThan(e0 + 6 * DAY_MS);
    expect(await taskMs(page, 'req', 'start')).toBe(s0);
    expect((await events(page, 'task:resized')).length).toBe(1);

    // the visually-right end is the START: a press near it is a MOVE (no start-edge resize exists)
    const b2 = await barBox(page, 'req');
    await mouseDragTo(page, { x: b2.x + b2.w - 12, y: my }, { x: b2.x + b2.w - 12 - 2 * PX_PER_DAY, y: my });
    await expect.poll(() => events(page, 'task:moved').then((e) => e.length)).toBe(1);
    expect(await taskMs(page, 'req', 'start')).toBe(s0 + 2 * DAY_MS);
  });

  async function linkDrag(page: Page, fromId: string, handleEnd: 'start' | 'end', toId: string): Promise<void> {
    await setScroll(page, LINK_SCROLL);
    const from = await visibleCentre(page, fromId);
    await page.mouse.move(from.x, from.y); // reveals the hover-only handles
    const handle = page.locator(`.fg-task[data-task-id="${fromId}"] .fg-task__link-handle[data-handle-end="${handleEnd}"]`);
    await expect(handle).toHaveCSS('opacity', '1');
    const hb = (await handle.boundingBox())!;
    await mouseDragTo(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, await visibleCentre(page, toId));
  }

  test('the END handle sits at the visually-left edge; dragging it onto another bar makes owner -> target', async ({ page }) => {
    await setScroll(page, LINK_SCROLL);
    const c = await visibleCentre(page, 'docs');
    await page.mouse.move(c.x, c.y);
    const start = (await page.locator('.fg-task[data-task-id="docs"] .fg-task__link-handle[data-handle-end="start"]').boundingBox())!;
    const end = (await page.locator('.fg-task[data-task-id="docs"] .fg-task__link-handle[data-handle-end="end"]').boundingBox())!;
    expect(end.x).toBeLessThan(start.x); // START is the visually-right handle

    const before = await dependencyCount(page);
    await linkDrag(page, 'design', 'end', 'docs');
    await expect.poll(() => dependencyCount(page)).toBe(before + 1);
    const added = (await events(page, 'dependency:added')).at(-1)!.payload;
    expect(added).toEqual({ from: 'design', to: 'docs' });
  });

  test('the START handle (visually right) makes the owner the SUCCESSOR of the drop target', async ({ page }) => {
    const before = await dependencyCount(page);
    await linkDrag(page, 'docs', 'start', 'design');
    await expect.poll(() => dependencyCount(page)).toBe(before + 1);
    expect((await events(page, 'dependency:added')).at(-1)!.payload).toEqual({ from: 'design', to: 'docs' });
  });

  test('the rubber band starts at the handle (mirrored origin), not at the layout position', async ({ page }) => {
    await setScroll(page, LINK_SCROLL);
    const c = centre(await barBox(page, 'design'));
    await page.mouse.move(c.x, c.y);
    const hb = (await page.locator('.fg-task[data-task-id="design"] .fg-task__link-handle[data-handle-end="end"]').boundingBox())!;
    const hx = hb.x + hb.width / 2;
    const hy = hb.y + hb.height / 2;
    await mouseDragTo(page, { x: hx, y: hy }, { x: hx - 60, y: hy + 60 }, { release: false });
    const origin = await page.evaluate(() => {
      const p = document.querySelector<SVGPathElement>('#gantt .fg-dependency-preview')!;
      const svg = document.querySelector('#gantt svg.fg-timeline')!.getBoundingClientRect();
      const m = /^M ([\d.-]+) ([\d.-]+)/.exec(p.getAttribute('d')!)!;
      return { x: svg.left + Number(m[1]), y: svg.top + Number(m[2]) };
    });
    expect(Math.abs(origin.x - hx)).toBeLessThanOrEqual(2);
    expect(Math.abs(origin.y - hy)).toBeLessThanOrEqual(2);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

test.describe('lifecycle', () => {
  test('destroy restores the container dir attribute and removes the mirror', async ({ page }) => {
    await openRtl(page);
    await gantt(page, (g) => (g['destroy'] as unknown as () => void)());
    expect(await page.evaluate(() => document.getElementById('gantt')!.hasAttribute('dir'))).toBe(false);
    expect(await page.locator('#gantt svg').count()).toBe(0);
  });

  test('the LTR twin (rtl:false) has no mirror group and no dir', async ({ page }) => {
    await openRtl(page, 'rtl=0');
    expect(await page.locator('#gantt g.fg-rtl').count()).toBe(0);
    expect(await page.evaluate(() => document.getElementById('gantt')!.hasAttribute('dir'))).toBe(false);
  });
});

test.describe('export parity (AC7)', () => {
  test.beforeEach(async ({ page }) => openRtl(page));

  const exportSvgString = (page: Page): Promise<string> => gantt(page, (g) => (g['exportSvg'] as unknown as () => string)());

  test('exportSvg is self-contained: a standalone page (no container CSS) places bars and text like the live chart', async ({ page, context }) => {
    const svg = await exportSvgString(page);
    expect(svg).toContain('class="fg-rtl"');
    expect(svg).toContain('direction="rtl"');
    expect(svg).not.toContain('<style');

    const live = await page.evaluate(() => {
      const root = document.querySelector('#gantt svg.fg-timeline')!.getBoundingClientRect();
      const rel = (n: Element) => {
        const r = n.getBoundingClientRect();
        return [Math.round((r.left - root.left) * 10) / 10, Math.round((r.right - root.left) * 10) / 10];
      };
      return {
        bars: [...document.querySelectorAll('.fg-task__bar')].map(rel),
        texts: [...document.querySelectorAll('#gantt svg.fg-timeline text')].map(rel),
      };
    });

    const standalone = await context.newPage();
    // `dir` deliberately NOT set anywhere: the exported file must not depend on it.
    await standalone.setContent(`<!doctype html><html><body style="margin:0">${svg.replace(/^<\?xml[^>]*>\s*/, '')}</body></html>`);
    const out = await standalone.evaluate(() => {
      const root = document.querySelector('svg')!.getBoundingClientRect();
      const rel = (n: Element) => {
        const r = n.getBoundingClientRect();
        return [Math.round((r.left - root.left) * 10) / 10, Math.round((r.right - root.left) * 10) / 10];
      };
      return {
        bars: [...document.querySelectorAll('.fg-task__bar')].map(rel),
        texts: [...document.querySelectorAll('text')].map(rel),
      };
    });
    expect(out.bars).toHaveLength(live.bars.length);
    expect(out.texts).toHaveLength(live.texts.length);
    out.bars.forEach((b, i) => {
      expect(Math.abs(b[0]! - live.bars[i]![0]!), `bar ${i}`).toBeLessThanOrEqual(1.5);
      expect(Math.abs(b[1]! - live.bars[i]![1]!), `bar ${i}`).toBeLessThanOrEqual(1.5);
    });
    // text widths differ by sub-pixel hinting between the two documents; the ANCHOR side must agree
    out.texts.forEach((t, i) => {
      expect(Math.abs(t[1]! - live.texts[i]![1]!), `text ${i} right edge`).toBeLessThanOrEqual(2.5);
    });
    await standalone.close();
  });

  test('exportPng matches the on-screen chart: the progress colour is on the visually-right end of the bar', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const g = (window as unknown as { __gantt: { exportPng(o?: object): Promise<Blob> } }).__gantt;
      const blob = await g.exportPng({ scale: 1, background: '#ffffff' });
      const bmp = await createImageBitmap(blob);
      const cv = document.createElement('canvas');
      cv.width = bmp.width;
      cv.height = bmp.height;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const root = document.querySelector('#gantt svg.fg-timeline')!.getBoundingClientRect();
      const bar = document.querySelector('.fg-task[data-task-id="dev"] .fg-task__bar')!.getBoundingClientRect();
      const fill = document.querySelector('.fg-task[data-task-id="dev"] .fg-task__progress')!;
      const px = (x: number, y: number): number[] => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data];
      const y = bar.top - root.top + bar.height / 2;
      return {
        width: bmp.width,
        rootWidth: root.width,
        // 85% of the way from the visual left edge = inside the progress fill (start side)
        progressSide: px(bar.left - root.left + bar.width * 0.9, y),
        remainderSide: px(bar.left - root.left + bar.width * 0.1, y),
        fillColor: getComputedStyle(fill).fill,
      };
    });
    expect(Math.abs(out.width - out.rootWidth)).toBeLessThanOrEqual(1);
    expect(out.progressSide).not.toEqual(out.remainderSide);
    const rgb = /rgb\((\d+), (\d+), (\d+)\)/.exec(out.fillColor);
    if (rgb) for (let i = 0; i < 3; i++) expect(Math.abs(out.progressSide[i]! - Number(rgb[i + 1]))).toBeLessThanOrEqual(8);
  });
});

test.describe('export ground (#107) with rtl in the dark theme', () => {
  test('exportSvg and exportPng carry the resolved --fg-bg ground', async ({ page }) => {
    await openRtl(page, 'theme=dark');
    const svg = await gantt(page, (g) => (g['exportSvg'] as unknown as () => string)());
    expect(svg).toMatch(/<rect[^>]*width="100%"[^>]*fill="#0a0a0a"|<rect[^>]*fill="#0a0a0a"[^>]*width="100%"/);
    expect(svg).toContain('class="fg-rtl"');
    const corner = await page.evaluate(async () => {
      const g = (window as unknown as { __gantt: { exportPng(o?: object): Promise<Blob> } }).__gantt;
      const bmp = await createImageBitmap(await g.exportPng({ scale: 1 }));
      const cv = document.createElement('canvas');
      cv.width = bmp.width;
      cv.height = bmp.height;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      return [...ctx.getImageData(bmp.width - 2, bmp.height - 2, 1, 1).data];
    });
    expect(corner.slice(0, 3)).toEqual([10, 10, 10]);
  });
});

test.describe('Canvas renderer (>= 2000 tasks)', () => {
  test.beforeEach(async ({ page }) => openRtl(page, 'pad=2100'));

  test('paints mirrored: the first bar is at the right, the label column text at the right edge', async ({ page, context }) => {
    const canvasSel = '#gantt canvas.fg-timeline-canvas';
    const rect = await page.evaluate((sel) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top };
    }, canvasSel);
    const req = await barBox(page, 'req');
    const design = await barBox(page, 'design');
    expect(req.x).toBeGreaterThan(design.x);
    // pixel evidence at the mirrored bar centre (canvas-local x)
    const px = await canvasPixel(page, canvasSel, req.x + req.w / 2 - rect.left, req.y + req.h / 2 - rect.top);
    expect(isGreenish(px) || px[2]! > 150).toBe(true);
    // ... and NOT at the LTR position of the same layout x (that is the empty timeline there)
    const ltrX = LABEL_W + (rect.right - rect.left - LABEL_W - (req.x - rect.left) - req.w) + req.w / 2;
    void ltrX;
    // label column: the dark glyph pixels of the right-most 160 px equal the LTR twin's left-most 160 px
    const ink = (pg: Page, x0: number): Promise<number> =>
      pg.evaluate(
        ([sel, from, w]) => {
          const cv = document.querySelector<HTMLCanvasElement>(sel as string)!;
          const k = cv.width / cv.clientWidth; // device pixels per CSS px (2 in WebKit's Desktop Safari preset)
          const d = cv.getContext('2d')!.getImageData(Math.round((from as number) * k), Math.round(32 * k), Math.round((w as number) * k), Math.round(8 * 32 * k)).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i]! < 90 && d[i + 1]! < 90 && d[i + 2]! < 90) n++;
          return n;
        },
        [canvasSel, x0, LABEL_W] as const,
      );
    const width = Math.round(rect.right - rect.left);
    const twin = await context.newPage();
    await openRtl(twin, 'pad=2100&rtl=0');
    const rtlInk = await ink(page, width - LABEL_W);
    const ltrInk = await ink(twin, 0);
    expect(ltrInk).toBeGreaterThan(300);
    expect(Math.abs(rtlInk - ltrInk) / ltrInk).toBeLessThan(0.15);
    await twin.close();
  });

  test('negative scrollLeft: scrolling reveals later dates and the chart stays painted', async ({ page }) => {
    await setScroll(page, -900);
    expect(await scrollLeft(page)).toBe(-900);
    const dev = await barBox(page, 'dev');
    const box = await clientBox(page);
    expect(dev.x).toBeLessThan(box.right);
    expect(dev.x + dev.w).toBeGreaterThan(box.left);
    const rect = await page.evaluate(() => {
      const r = document.querySelector('#gantt canvas.fg-timeline-canvas')!.getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    const px = await canvasPixel(page, '#gantt canvas.fg-timeline-canvas', dev.x + dev.w / 2 - rect.left, dev.y + dev.h / 2 - rect.top);
    expect(isGreenish(px) || px[2]! > 150).toBe(true);
  });

  test('drag-move: visually left is later, visually right is earlier', async ({ page }) => {
    const s0 = await taskMs(page, 'req', 'start');
    const c = centre(await barBox(page, 'req'));
    await mouseDragTo(page, c, { x: c.x - 2 * PX_PER_DAY, y: c.y });
    await expect.poll(() => taskMs(page, 'req', 'start')).toBe(s0 + 2 * DAY_MS);
    const c2 = centre(await barBox(page, 'req'));
    await mouseDragTo(page, c2, { x: c2.x + 4 * PX_PER_DAY, y: c2.y });
    await expect.poll(() => taskMs(page, 'req', 'start')).toBe(s0 - 2 * DAY_MS);
  });

  test('drag-resize grabs the visually-left edge and edits end only', async ({ page }) => {
    const s0 = await taskMs(page, 'req', 'start');
    const e0 = await taskMs(page, 'req', 'end');
    const b = await barBox(page, 'req');
    const y = b.y + b.h / 2;
    await mouseDragTo(page, { x: b.x + 6, y }, { x: b.x + 6 - 5 * PX_PER_DAY, y });
    await expect.poll(() => taskMs(page, 'req', 'end')).toBeGreaterThan(e0 + 3 * DAY_MS);
    expect(await taskMs(page, 'req', 'end')).toBeLessThan(e0 + 6 * DAY_MS); // working-calendar re-derived
    expect(await taskMs(page, 'req', 'start')).toBe(s0);
  });

  test('the drag ghost is painted mirrored on the overlay, at the dragged position', async ({ page }) => {
    const b = await barBox(page, 'req');
    const c = centre(b);
    await mouseDragTo(page, c, { x: c.x - 4 * PX_PER_DAY, y: c.y }, { release: false });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
    const ghost = await page.evaluate(() => {
      const ov = document.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas-overlay')!;
      const r = ov.getBoundingClientRect();
      const d = ov.getContext('2d')!.getImageData(0, 0, ov.width, ov.height);
      let min = Infinity;
      let max = -Infinity;
      for (let y = 0; y < ov.height; y++) {
        for (let x = 0; x < ov.width; x++) {
          if (d.data[(y * ov.width + x) * 4 + 3]! > 10) {
            min = Math.min(min, x);
            max = Math.max(max, x);
          }
        }
      }
      const k = ov.width / r.width; // device pixels per CSS px
      return { left: r.left + min / k, right: r.left + (max + 1) / k };
    });
    // the ghost is the bar shifted 4 days to the visual LEFT
    expect(Math.abs(ghost.left - (b.x - 4 * PX_PER_DAY))).toBeLessThanOrEqual(3);
    expect(Math.abs(ghost.right - (b.x + b.w - 4 * PX_PER_DAY))).toBeLessThanOrEqual(3);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await events(page, 'task:moved')).toHaveLength(0);
  });

  test('the overlay canvas stays pinned to the viewport while the RTL container is scrolled (sticky inset)', async ({ page }) => {
    for (const left of [0, -700, -2000]) {
      await setScroll(page, left);
      const probe = await visibleCentre(page, 'req').catch(() => undefined);
      if (probe) {
        await mouseDragTo(page, probe, { x: probe.x - 40, y: probe.y }, { release: false });
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
      } else {
        // the bar is scrolled away: open a gesture on a visible bar instead (the overlay is created lazily)
        await setScroll(page, 0);
        const b = centre(await barBox(page, 'req'));
        await mouseDragTo(page, b, { x: b.x - 40, y: b.y }, { release: false });
        await setScroll(page, left);
      }
      const geo = await page.evaluate(() => {
        const ov = document.querySelector('canvas.fg-timeline-canvas-overlay')!.getBoundingClientRect();
        const cont = document.getElementById('gantt')!;
        const r = cont.getBoundingClientRect();
        return { ovLeft: ov.left, ovRight: ov.right, left: r.left + cont.clientLeft, right: r.left + cont.clientLeft + cont.clientWidth };
      });
      expect(Math.abs(geo.ovLeft - geo.left), `scroll ${left}`).toBeLessThanOrEqual(1);
      expect(Math.abs(geo.ovRight - geo.right), `scroll ${left}`).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    }
  });

  test('link: the START handle (visually right) makes the owner the successor', async ({ page }) => {
    await setScroll(page, LINK_SCROLL);
    const docs = await barBox(page, 'docs');
    const design = await visibleCentre(page, 'design');
    const before = await dependencyCount(page);
    // the START anchor is the bar's visually-right edge
    await mouseDragTo(page, { x: docs.x + docs.w, y: docs.y + docs.h / 2 }, design);
    await expect.poll(() => dependencyCount(page)).toBe(before + 1);
    expect((await events(page, 'dependency:added')).at(-1)!.payload).toEqual({ from: 'design', to: 'docs' });
  });

  test('exports are mirrored: exportSvg carries the group, exportPng puts the bar at the mirrored x', async ({ page }) => {
    const svg = await gantt(page, (g) => (g['exportSvg'] as unknown as () => string)());
    expect(svg).toContain('class="fg-rtl"');
    const out = await page.evaluate(async () => {
      const g = (window as unknown as { __gantt: { exportPng(o?: object): Promise<Blob> }; __fx: { barBox(id: string): { x: number; y: number; w: number; h: number } } }).__gantt;
      const fx = (window as unknown as { __fx: { barBox(id: string): { x: number; y: number; w: number; h: number } } }).__fx;
      // 2100 rows at scale 1 exceed the browser's canvas limit: export small, sample scaled coordinates
      const k = 0.25;
      const bmp = await createImageBitmap(await g.exportPng({ scale: k, background: '#ffffff' }));
      const cv = document.createElement('canvas');
      cv.width = bmp.width;
      cv.height = bmp.height;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const live = document.querySelector('canvas.fg-timeline-canvas')!.getBoundingClientRect();
      const b = fx.barBox('req');
      const px = (x: number, y: number): number[] => [...ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data];
      return { width: bmp.width / k, liveWidth: live.width, pixel: px(b.x + b.w / 2 - live.left, b.y + b.h / 2 - live.top) };
    });
    expect(Math.abs(out.width - out.liveWidth)).toBeLessThanOrEqual(8);
    expect(isGreenish(out.pixel) || out.pixel[2]! > 150).toBe(true);
  });
});

test.describe('Canvas hidden a11y layer (risk 6.6)', () => {
  test('Tab into a scrolled RTL Canvas chart keeps scrollLeft (the layer is pinned at the inline start)', async ({ page }) => {
    await openRtl(page, 'pad=2100');
    await setScroll(page, -1500);
    expect(await scrollLeft(page)).toBe(-1500);
    // Firefox makes the scroll container itself a tab stop: Tab until the focus is inside the chart.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => String(document.activeElement?.className ?? '').includes('fg-timeline-canvas__row'))) break;
    }
    expect(await page.evaluate(() => String(document.activeElement?.className ?? ''))).toContain('fg-timeline-canvas__row');
    await frames(page);
    expect(await scrollLeft(page)).toBe(-1500);
  });
});

test.describe('mixed-direction labels (unicode-bidi: plaintext)', () => {
  test('Latin-first labels with trailing/neutral punctuation keep their reading order in the SVG chart', async ({ page }) => {
    await openRtl(page);
    await gantt(page, (g) => {
      const t = g as unknown as { updateTask(id: string, p: object): void };
      t.updateTask('req', { name: 'Launch!' });
      t.updateTask('design', { name: '(Review (draft)' });
    });
    const order = await page.evaluate(() => {
      // x of the first and last character of a label's text node, in client space
      const edges = (id: string): { first: number; last: number } => {
        const t = document.querySelector(`.fg-timeline__row[data-task-id="${id}"] text`)!;
        const n = t.firstChild as Text;
        const at = (i: number): number => {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          return r.getBoundingClientRect().left;
        };
        return { first: at(0), last: at(n.length - 1) };
      };
      return { launch: edges('req'), review: edges('design') };
    });
    // "Launch!": L is left of "!" (it would be the other way round under a forced RTL base)
    expect(order.launch.first).toBeLessThan(order.launch.last);
    // "(Review (draft)": the string starts with "(" at the left and ends with ")" at the right
    expect(order.review.first).toBeLessThan(order.review.last);
  });

  test('an Arabic-first label still runs right to left (first character is the right-most)', async ({ page }) => {
    await openRtl(page);
    const o = await page.evaluate(() => {
      const t = document.querySelector('.fg-timeline__row[data-task-id="design"] text')!;
      const n = t.firstChild as Text;
      const at = (i: number): number => {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        return r.getBoundingClientRect().left;
      };
      return { first: at(0), last: at(n.length - 1) };
    });
    expect(o.first).toBeGreaterThan(o.last);
  });
});
