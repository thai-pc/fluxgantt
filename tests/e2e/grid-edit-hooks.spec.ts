import { test, expect, type Page } from '@playwright/test';

// Real-browser coverage for `withEditHooks` + `withGrid` (spec-grid-columns.md 4.4, PR G5): a double-click, a
// context menu and F2 on a grid cell report `part: 'cell'` + `columnId`; the name column keeps `label`. SVG and
// Canvas, LTR and RTL. Fixture: `grid.html?hooks=1` (`?rows=2100` mounts the Canvas renderer through mount()).

interface Logged {
  name: string;
  payload: { taskId: string; part: string; columnId?: string; source: string; clientX: number; clientY: number };
}
const events = (page: Page): Promise<Logged[]> => page.evaluate(() => (window as unknown as { __events: Logged[] }).__events.slice());
const frames = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function open(page: Page, query: string, canvas: boolean): Promise<void> {
  await page.goto(`/grid.html?hooks=1&${canvas ? 'rows=2100&' : ''}${query}`);
  await page.waitForFunction(() => '__gantt' in window);
  if (canvas) {
    await expect(page.locator('#gantt canvas.fg-timeline-canvas-labels')).toBeAttached({ timeout: 30_000 });
    await page.waitForFunction(() => (document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement | null)?.width === 652);
  } else {
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  }
  await frames(page);
}

/** Viewport point `offset` px from the inline-start edge of the pinned column, vertically centred on row `req`. */
async function pinnedPoint(page: Page, offset: number, canvas: boolean, rtl: boolean): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([off, cv, rt]) => {
      const box = document.getElementById('gantt')!.getBoundingClientRect();
      const pin = (cv ? document.getElementById('gantt') : document.querySelector('.fg-timeline__sticky-column'))!.getBoundingClientRect();
      // Canvas rows are 24 px below a 32 px header; SVG rows are read from the DOM.
      const row = cv ? undefined : document.querySelector('.fg-timeline__row[data-task-id="req"]')!.getBoundingClientRect();
      return { x: rt ? pin.right - (off as number) : pin.left + (off as number), y: row ? row.top + row.height / 2 : box.top + 32 + 24 + 12 };
    },
    [offset, canvas, rtl] as const,
  );
}

for (const canvas of [false, true]) {
  for (const rtl of [false, true]) {
    test.describe(`${canvas ? 'Canvas' : 'SVG'} ${rtl ? 'RTL' : 'LTR'}`, () => {
      const q = rtl ? 'rtl=1' : '';

      test('double-click and right-click on a cell report the cell; the name column keeps label', async ({ page }) => {
        await open(page, q, canvas);
        const start = await pinnedPoint(page, 220 + 60, canvas, rtl); // `start` column: 220 .. 340
        await page.mouse.dblclick(start.x, start.y);
        const progress = await pinnedPoint(page, 220 + 120 + 120 + 96 + 40, canvas, rtl);
        await page.mouse.click(progress.x, progress.y, { button: 'right' });
        const name = await pinnedPoint(page, 150, canvas, rtl);
        await page.mouse.dblclick(name.x, name.y);
        await expect.poll(async () => (await events(page)).length).toBe(3);
        const [a, c, n] = await events(page);
        expect(a).toMatchObject({ name: 'task:activated', payload: { taskId: 'req', part: 'cell', columnId: 'start', source: 'pointer' } });
        expect(c).toMatchObject({ name: 'task:context-requested', payload: { taskId: 'req', part: 'cell', columnId: 'progress' } });
        expect(n!.payload.part).toBe('label');
        expect('columnId' in n!.payload).toBe(false);
      });

      test('F2 and the context-menu key from a focused cell report the cell', async ({ page }) => {
        await open(page, q, canvas);
        await page.evaluate(() => (document.querySelector('#gantt [role=row][data-task-id="launch"]') as HTMLElement).focus());
        await page.keyboard.press(rtl ? 'ArrowLeft' : 'ArrowRight'); // the name cell
        await page.keyboard.press(rtl ? 'ArrowLeft' : 'ArrowRight'); // `start`
        await page.keyboard.press(rtl ? 'ArrowLeft' : 'ArrowRight'); // `end`
        await expect
          .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-column-id')))
          .toBe('end');
        await page.keyboard.press('F2');
        await page.keyboard.press('ContextMenu');
        await expect.poll(async () => (await events(page)).length).toBe(2);
        const [a, c] = await events(page);
        expect(a).toMatchObject({ name: 'task:activated', payload: { taskId: 'launch', part: 'cell', columnId: 'end', source: 'keyboard' } });
        expect(c).toMatchObject({ name: 'task:context-requested', payload: { taskId: 'launch', part: 'cell', columnId: 'end', source: 'keyboard' } });
        expect(Number.isFinite(a!.payload.clientX) && Number.isFinite(a!.payload.clientY)).toBe(true);
        // From the name cell the report stays the row.
        await page.keyboard.press('Home');
        await page.keyboard.press('F2');
        await expect.poll(async () => (await events(page)).length).toBe(3);
        const last = (await events(page))[2]!;
        expect(last.payload.part).toBe('row');
        expect('columnId' in last.payload).toBe(false);
      });
    });
  }
}
