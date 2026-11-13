import { test, expect, type Page } from '@playwright/test';

// Real-browser coverage for the grid keyboard model (spec-grid-columns.md section 9, PR G4): the APG treegrid
// pattern with row, cell and header modes, SVG and Canvas, LTR and RTL. Fixture: `grid.html` (`?rows=2100` mounts
// the Canvas renderer through the real `mount()`). The tree is plan > req, design, dev, docs, test; launch is a
// top-level leaf. Chromium only (the project's `e2e` device).

type G = {
  getSelection(): string[];
  isCollapsed(id: string): boolean;
  getTask(id: string): { start: unknown; end: unknown } | undefined;
};
const frames = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function open(page: Page, query: string, canvas: boolean, width = 652): Promise<void> {
  await page.goto(`/grid.html?${canvas ? 'rows=2100&' : ''}${query}`);
  await page.waitForFunction(() => '__gantt' in window);
  if (canvas) {
    await expect(page.locator('#gantt canvas.fg-timeline-canvas-labels')).toBeAttached({ timeout: 30_000 });
    await page.waitForFunction((w) => (document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement | null)?.width === w, width);
  } else {
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  }
  await frames(page);
}

/** Where focus is: `row:<id>`, `cell:<id>:<col>`, `head:<col>` or `other`. */
const where = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || !document.getElementById('gantt')!.contains(a)) return 'other';
    const col = Number(a.getAttribute('aria-colindex')) - 1;
    const role = a.getAttribute('role');
    const task = a.closest('[data-task-id]')?.getAttribute('data-task-id');
    return role === 'columnheader' ? `head:${col}` : role === 'gridcell' ? `cell:${task}:${col}` : role === 'row' ? `row:${task}` : 'other';
  });
const focusRow = (page: Page, task: string) =>
  page.evaluate((id) => (document.querySelector(`#gantt [role=row][data-task-id="${id}"]`) as HTMLElement).focus(), task);
const expectWhere = async (page: Page, w: string) => {
  await expect.poll(() => where(page)).toBe(w);
};
const g = (page: Page) => ({
  collapsed: (id: string) => page.evaluate((i) => (window as unknown as { __gantt: G }).__gantt.isCollapsed(i), id),
  selection: () => page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.getSelection()),
  start: (id: string) => page.evaluate((i) => String((window as unknown as { __gantt: G }).__gantt.getTask(i)?.start), id),
});

for (const canvas of [false, true]) {
  for (const rtl of [false, true]) {
    test.describe(`${canvas ? 'Canvas' : 'SVG'} ${rtl ? 'RTL' : 'LTR'}`, () => {
      const q = rtl ? 'rtl=1' : '';
      const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
      const back = rtl ? 'ArrowRight' : 'ArrowLeft';

      test('Right enters the first cell, then walks the cells; Left walks back and returns to the row', async ({ page }) => {
        await open(page, q, canvas);
        await focusRow(page, 'launch');
        await page.keyboard.press(fwd);
        await expectWhere(page, 'cell:launch:0');
        await page.keyboard.press(fwd);
        await expectWhere(page, 'cell:launch:1');
        await page.keyboard.press('End');
        await expectWhere(page, 'cell:launch:4');
        await page.keyboard.press(fwd); // clamped
        await expectWhere(page, 'cell:launch:4');
        await page.keyboard.press('Home');
        await expectWhere(page, 'cell:launch:0');
        await page.keyboard.press(back);
        await expectWhere(page, 'row:launch');
        await page.keyboard.press(fwd);
        await page.keyboard.press('Escape');
        await expectWhere(page, 'row:launch');
      });

      test('Left collapses an expanded parent and Right expands it again; Left on a child selects the parent', async ({ page }) => {
        await open(page, q, canvas);
        await focusRow(page, 'plan');
        await page.keyboard.press(back);
        await expect.poll(() => g(page).collapsed('plan')).toBe(true);
        await expectWhere(page, 'row:plan');
        await page.keyboard.press(fwd);
        await expect.poll(() => g(page).collapsed('plan')).toBe(false);
        await expectWhere(page, 'row:plan');
        await focusRow(page, 'design');
        await page.keyboard.press(back);
        await expectWhere(page, 'row:plan');
        expect(await g(page).selection()).toContain('plan');
        await page.keyboard.press('ArrowDown'); // keyboard-nav continues from the parent
        await expectWhere(page, 'row:req');
      });

      test('Up and Down keep the column; Ctrl+Home/End keep it too', async ({ page }) => {
        await open(page, q, canvas);
        await focusRow(page, 'req');
        await page.keyboard.press(fwd);
        await page.keyboard.press(fwd);
        await page.keyboard.press(fwd);
        await expectWhere(page, 'cell:req:2');
        await page.keyboard.press('ArrowDown');
        await expectWhere(page, 'cell:design:2');
        expect(await g(page).selection()).toEqual(['design']);
        await page.keyboard.press('ArrowUp');
        await expectWhere(page, 'cell:req:2');
        await page.keyboard.press('Control+Home');
        await expectWhere(page, 'cell:plan:2');
        await page.keyboard.press('Control+End');
        await page.waitForTimeout(100);
        expect((await where(page)).endsWith(':2')).toBe(true);
        expect((await where(page)).startsWith('cell:')).toBe(true);
        if (canvas) expect(await where(page)).toBe('cell:filler-2092:2');
      });

      test('Up from a cell of the first row enters that column\'s header, Down returns to the cell', async ({ page }) => {
        await open(page, q, canvas);
        await focusRow(page, 'plan');
        await page.keyboard.press(fwd);
        await page.keyboard.press(fwd);
        await page.keyboard.press(fwd);
        await page.keyboard.press('ArrowUp');
        await expectWhere(page, 'head:2');
        await page.keyboard.press(fwd);
        await expectWhere(page, 'head:3');
        await page.keyboard.press('ArrowDown');
        await expectWhere(page, 'cell:plan:3');
      });

      test('Alt+Arrow still moves the task from a focused cell, and Enter on a parent still toggles it', async ({ page }) => {
        await open(page, q, canvas);
        await focusRow(page, 'launch');
        await page.keyboard.press(fwd);
        await page.keyboard.press(fwd);
        const before = await g(page).start('launch');
        await page.keyboard.press(`Alt+${fwd}`);
        await expect.poll(() => g(page).start('launch')).not.toBe(before);
        await expectWhere(page, 'cell:launch:1'); // focus stayed on the cell
        await focusRow(page, 'plan');
        await page.keyboard.press(fwd);
        await page.keyboard.press('Enter'); // keyboard-nav: toggles the parent
        await expect.poll(() => g(page).collapsed('plan')).toBe(true);
      });

      test('the chart is one Tab stop in cell mode: a cell is never a stop, the next Tab leaves the chart', async ({ page }) => {
        await open(page, q, canvas);
        await focusRow(page, 'launch');
        await page.keyboard.press(fwd);
        await page.keyboard.press(fwd);
        expect(await page.locator('#gantt [tabindex="0"]').count()).toBe(1);
        await page.keyboard.press('Tab'); // the fixture has nothing after the chart: the browser wraps to the one stop or leaves
        expect(await where(page)).not.toMatch(/^(cell|head):/);
        await page.keyboard.press('Tab');
        expect(await where(page)).not.toMatch(/^(cell|head):/);
      });

      test('a host-driven repaint keeps the focused cell', async ({ page }) => {
        await open(page, q, canvas);
        await focusRow(page, 'launch');
        await page.keyboard.press(fwd);
        await page.keyboard.press(fwd);
        await page.keyboard.press(fwd);
        await expectWhere(page, 'cell:launch:2');
        await page.evaluate(() => (window as unknown as { __gantt: { zoomTo(m: string): void } }).__gantt.zoomTo('month'));
        await frames(page);
        await expectWhere(page, 'cell:launch:2');
      });

      test('the focused cell shows a ring that follows it', async ({ page }) => {
        await open(page, q, canvas);
        await focusRow(page, 'launch');
        await page.keyboard.press(fwd);
        await page.keyboard.press(fwd);
        await frames(page);
        if (canvas) return; // the Canvas ring is pixels: covered by the visual baseline
        const ring = page.locator('#gantt .fg-grid__ring');
        await expect(ring).toHaveCount(1);
        const rb = (await ring.boundingBox())!;
        const cb = (await page.locator('#gantt [role=row][data-task-id=launch]').boundingBox())!;
        expect(rb.y).toBeGreaterThanOrEqual(cb.y - 1);
        expect(rb.y + rb.height).toBeLessThanOrEqual(cb.y + cb.height + 1);
        expect(Math.round(rb.width)).toBe(120 - 8);
        await page.keyboard.press('Escape');
        await expect(page.locator('#gantt .fg-grid__ring')).toHaveCount(0);
      });
    });
  }

  test.describe(canvas ? 'Canvas' : 'SVG', () => {
    test('resizable:false: no handles, Alt+Arrow on a header is inert, the headers are still navigable', async ({ page }) => {
      await open(page, 'resizable=0', canvas);
      await expect(page.locator('.fg-grid__sizer')).toHaveCount(0);
      await focusRow(page, 'plan');
      await page.keyboard.press('ArrowUp');
      await expectWhere(page, 'head:0');
      await page.keyboard.press('ArrowRight');
      await expectWhere(page, 'head:1');
      await page.keyboard.press('Alt+ArrowRight');
      const w = await page.evaluate(() => (window as unknown as { __gantt: { getGridColumns(): { id: string; width: number }[] } }).__gantt.getGridColumns().find((c) => c.id === 'start')!.width);
      expect(w).toBe(120);
    });

    test('collapseBelow leaves one column: cell mode is the name cell only', async ({ page }) => {
      await open(page, 'cols=1', canvas, 220);
      await focusRow(page, 'launch');
      await page.keyboard.press('ArrowRight');
      await expectWhere(page, 'cell:launch:0');
      await page.keyboard.press('ArrowRight');
      await expectWhere(page, 'cell:launch:0');
      await page.keyboard.press('ArrowLeft');
      await expectWhere(page, 'row:launch');
    });
  });
}

for (const canvas of [false, true]) {
  test(`${canvas ? 'Canvas' : 'SVG'}: Left on a child whose parent is hundreds of rows above selects it, focuses it and scrolls it into view`, async ({ page }) => {
    await open(page, 'kids=300', canvas); // the last child is far below its parent (outside the Canvas a11y window)
    await page.evaluate(() => (window as unknown as { __gantt: { scrollToTask(id: string): boolean } }).__gantt.scrollToTask('kid-299'));
    await frames(page);
    await page.waitForFunction(() => document.querySelector('#gantt [role=row][data-task-id="kid-299"]'));
    await focusRow(page, 'kid-299');
    await page.keyboard.press('ArrowLeft');
    await expectWhere(page, 'row:plan');
    expect(await g(page).selection()).toContain('plan');
    await frames(page);
    // the parent row is in the viewport, below the pinned header
    const box = await page.evaluate(() => {
      const c = document.getElementById('gantt')!;
      return { top: c.scrollTop, height: c.clientHeight };
    });
    expect(box.top).toBeLessThan(200);
  });
}
