import { test, expect, type Page } from '@playwright/test';

// Real-browser coverage for grid column resize (spec-grid-columns.md section 7, PR G3), SVG and Canvas,
// LTR and RTL: the drag handles, the guide, Escape, the keyboard path on a focused column header (WCAG 2.1.1; the single-pointer alternative is the host's `resizeGridColumn()`),
// the focus frame, the announcement, and that nothing leaks to selection. Fixture: `grid.html` (`?rows=2100`
// mounts the Canvas renderer through the real `mount()`). Chromium only (the project's `e2e` device).

type G = { getGridColumns(): { id: string; width: number }[]; getSelection(): string[] };
const widths = (page: Page) =>
  page.evaluate(() => Object.fromEntries((window as unknown as { __gantt: G }).__gantt.getGridColumns().map((c) => [c.id, c.width])));
const frames = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function open(page: Page, query: string, canvas: boolean): Promise<void> {
  await page.goto(`/grid.html?${canvas ? 'rows=2100&' : ''}${query}`);
  await page.waitForFunction(() => '__gantt' in window);
  if (canvas) {
    await expect(page.locator('#gantt canvas.fg-timeline-canvas-labels')).toBeAttached({ timeout: 30_000 });
    await page.waitForFunction(() => (document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement | null)?.width === 652);
  } else {
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  }
  await frames(page);
}

const labelsBox = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector('canvas.fg-timeline-canvas-labels')!.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top };
  });
/** Viewport point of the divider at layout offset `off` in the header band (SVG sizer or Canvas band). */
async function divider(page: Page, canvas: boolean, rtl: boolean, off: number, index: number): Promise<{ x: number; y: number }> {
  if (!canvas) {
    const b = (await page.locator('.fg-grid__sizer').nth(index).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  const l = await labelsBox(page);
  return { x: rtl ? l.right - off : l.left + off, y: l.top + 14 };
}

for (const canvas of [false, true]) {
  for (const rtl of [false, true]) {
    test.describe(`${canvas ? 'Canvas' : 'SVG'} ${rtl ? 'RTL' : 'LTR'}`, () => {
      const q = rtl ? 'rtl=1' : '';
      const grow = rtl ? -1 : 1; // toward the chart

      test('dragging a divider toward the chart grows the column and commits on release', async ({ page }) => {
        await open(page, q, canvas);
        const p = await divider(page, canvas, rtl, 340, 1);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x + grow * 25, p.y, { steps: 3 });
        await page.mouse.move(p.x + grow * 40, p.y, { steps: 3 });
        await expect(page.locator('#gantt .fg-grid__guide')).toHaveCount(1);
        expect((await widths(page))['start']).toBe(120); // nothing is written while dragging
        await page.mouse.up();
        await frames(page);
        await expect(page.locator('#gantt .fg-grid__guide')).toHaveCount(0);
        expect((await widths(page))['start']).toBe(160);
        const w = await page.evaluate(() => document.querySelector<HTMLElement>('.fg-timeline__sticky-column, canvas.fg-timeline-canvas-labels')!.getBoundingClientRect().width);
        expect(Math.round(w)).toBe(652 + 40);
        expect(await page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.getSelection())).toEqual([]);
      });

      test('dragging away from the chart shrinks, clamped to the minimum width', async ({ page }) => {
        await open(page, q, canvas);
        const p = await divider(page, canvas, rtl, 340, 1);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x - grow * 500, p.y, { steps: 4 });
        await page.mouse.up();
        await frames(page);
        expect((await widths(page))['start']).toBe(48);
      });

      test('Escape cancels the drag', async ({ page }) => {
        await open(page, q, canvas);
        const p = await divider(page, canvas, rtl, 340, 1);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x + grow * 40, p.y, { steps: 3 });
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await frames(page);
        await expect(page.locator('#gantt .fg-grid__guide')).toHaveCount(0);
        expect((await widths(page))['start']).toBe(120);
      });

      test('Alt+Arrow on a focused column header resizes by 16 px (2 px with Shift), toward the chart grows', async ({ page }) => {
        await open(page, q, canvas);
        const head = page.locator('#gantt [role=columnheader][data-column-id=start]');
        await head.focus();
        const toward = rtl ? 'ArrowLeft' : 'ArrowRight';
        const away = rtl ? 'ArrowRight' : 'ArrowLeft';
        await page.keyboard.press(`Alt+${toward}`);
        await frames(page);
        expect((await widths(page))['start']).toBe(136);
        await expect(head).toBeFocused(); // the repaint replaced the header; focus was put back
        await page.keyboard.press(`Alt+Shift+${toward}`);
        expect((await widths(page))['start']).toBe(138);
        await page.keyboard.press(`Alt+${away}`);
        expect((await widths(page))['start']).toBe(122);
        await expect(head).toBeFocused();
      });

      test('the focused header shows a frame, and moves with Left/Right', async ({ page }) => {
        await open(page, q, canvas);
        await page.locator('#gantt [role=columnheader][data-column-id=name]').focus();
        if (!canvas) await expect(page.locator('.fg-grid__ring')).toHaveCount(1);
        await page.keyboard.press(rtl ? 'ArrowLeft' : 'ArrowRight');
        await expect(page.locator('#gantt [role=columnheader][data-column-id=start]')).toBeFocused();
        if (!canvas) {
          const ring = (await page.locator('.fg-grid__ring').boundingBox())!;
          expect(Math.round(ring.width)).toBe(120);
        }
      });

      test('a keyboard resize is announced in the live region', async ({ page }) => {
        await open(page, q, canvas);
        await page.locator('#gantt [role=columnheader][data-column-id=end]').focus();
        await page.keyboard.press(`Alt+${rtl ? 'ArrowLeft' : 'ArrowRight'}`);
        await expect(page.locator('#gantt [aria-live=polite]')).toHaveText(/^End: 136 pixels wide/);
      });
    });
  }

  test.describe(canvas ? 'Canvas' : 'SVG', () => {
    test('the chart is one Tab stop (the row), ArrowUp from row 0 enters the headers, ArrowDown and Escape return', async ({ page }) => {
      await open(page, 'rows=60', canvas);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Tab');
      const focused = page.locator('#gantt [role=row]:focus');
      await expect(focused).toHaveCount(1); // Tab lands on the row, not on a header
      await page.evaluate(() => (document.querySelector('#gantt [role=row][data-row-index="0"]') as HTMLElement).focus());
      await page.keyboard.press('ArrowUp');
      await expect(page.locator('#gantt [role=columnheader][data-column-id=name]')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('#gantt [role=row][data-row-index="0"]')).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Escape');
      await expect(page.locator('#gantt [role=row]:focus')).toHaveCount(1);
      // a second Tab leaves the chart: no second stop
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.getElementById('gantt')!.contains(document.activeElement))).toBe(false);
    });

    test('a host-driven repaint keeps focus on the focused header', async ({ page }) => {
      await open(page, q, canvas);
      const head = page.locator('#gantt [role=columnheader][data-column-id=end]');
      await head.focus();
      await page.evaluate(() => (window as unknown as { __gantt: { zoomTo(m: string): void } }).__gantt.zoomTo('month'));
      await frames(page);
      await expect(head).toBeFocused();
    });

    test('resizable:false: no handles, headers are not focusable and the keys do nothing', async ({ page }) => {
      await open(page, 'resizable=0', canvas);
      await expect(page.locator('.fg-grid__sizer')).toHaveCount(0);
      const head = page.locator('#gantt [role=columnheader][data-column-id=start]');
      expect(await head.getAttribute('tabindex')).toBeNull();
      await head.focus().catch(() => undefined);
      await page.keyboard.press('Alt+ArrowRight');
      expect((await widths(page))['start']).toBe(120);
    });
  });
}

test('SVG: the sizers sit inside the header band', async ({ page }) => {
  await open(page, '', false);
  const sizer = (await page.locator('.fg-grid__sizer').nth(1).boundingBox())!;
  const corner = (await page.locator('.fg-timeline__sticky-corner').boundingBox())!;
  expect(sizer.y).toBeLessThanOrEqual(corner.y + 1);
  expect(sizer.height).toBeLessThanOrEqual(33);
});

test('SVG: zoom and a selection repaint keep one set of handles', async ({ page }) => {
  await open(page, '', false);
  await page.evaluate(() => (window as unknown as { __gantt: { zoomTo(m: string): void } }).__gantt.zoomTo('month'));
  await frames(page);
  await expect(page.locator('.fg-grid__sizer')).toHaveCount(5);
});

test('Canvas: the resize cursor shows over a divider with withInteraction composed (canvas-drag resets it elsewhere)', async ({ page }) => {
  await open(page, '', true);
  const l = await labelsBox(page);
  await page.mouse.move(l.left + 100, l.top + 14);
  await page.mouse.move(l.left + 340, l.top + 14);
  await frames(page);
  await page.mouse.move(l.left + 341, l.top + 14);
  await frames(page);
  expect(await page.evaluate(() => (document.querySelector('canvas.fg-timeline-canvas') as HTMLCanvasElement).style.cursor)).toBe('col-resize');
  await page.mouse.move(l.left + 100, l.top + 14);
  await frames(page);
  expect(await page.evaluate(() => (document.querySelector('canvas.fg-timeline-canvas') as HTMLCanvasElement).style.cursor)).not.toBe('col-resize');
});
