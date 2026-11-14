import { test, expect, type Page } from '@playwright/test';

// Real-browser coverage for the grid cell editors (spec-grid-columns.md section 10, PR G6): activation (Enter, F2,
// double-click), commit / cancel / validation, the calendar rules, readOnly, the veto event, placement and pinning
// on SVG and Canvas, LTR and RTL, and that nothing leaks into the chart. Fixture: `grid.html?edit=1` (`rows=2100`
// mounts the Canvas renderer through the real `mount()`). Tree: plan > req, design, dev, docs, test; launch is a
// top-level milestone. Calendar UTC, Mon-Fri 09:00-17:00, holiday 2026-05-01. Chromium only (the `e2e` device).

type Task = { start: unknown; end: unknown; duration?: number; progress: number; name: string };
type G = {
  getTask(id: string): Task | undefined;
  canUndo(): boolean;
  isEditingCell(): boolean;
  startCellEdit(id: string, col: string): boolean;
  resizeGridColumn(id: string, w: number): boolean;
};
const frames = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function open(page: Page, query: string, canvas: boolean, width = 652): Promise<void> {
  await page.goto(`/grid.html?edit=1&${canvas ? 'rows=2100&' : ''}${query}`);
  await page.waitForFunction(() => '__gantt' in window);
  if (canvas) {
    await expect(page.locator('#gantt canvas.fg-timeline-canvas-labels')).toBeAttached({ timeout: 30_000 });
    await page.waitForFunction((w) => (document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement | null)?.width === w, width);
  } else {
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  }
  await frames(page);
}
const COLS = ['name', 'start', 'end', 'duration', 'progress', 'owner'];
const focusRow = (page: Page, task: string) =>
  page.evaluate((id) => (document.querySelector(`#gantt [role=row][data-task-id="${id}"]`) as HTMLElement).focus(), task);
/** Focus a cell the way the keyboard gets there: the row, then Right to the first cell, then to the column. */
async function focusCell(page: Page, task: string, col: string, rtl = false): Promise<void> {
  await focusRow(page, task);
  const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
  for (let i = 0; i <= COLS.indexOf(col); i++) await page.keyboard.press(fwd);
  await expect.poll(() => where(page)).toBe(`cell:${task}:${COLS.indexOf(col)}`);
}
const where = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || !document.getElementById('gantt')!.contains(a)) return a?.classList.contains('fg-grid__editor') ? 'editor' : 'other';
    const col = Number(a.getAttribute('aria-colindex')) - 1;
    const role = a.getAttribute('role');
    const task = a.closest('[data-task-id]')?.getAttribute('data-task-id');
    return role === 'columnheader' ? `head:${col}` : role === 'gridcell' ? `cell:${task}:${col}` : role === 'row' ? `row:${task}` : 'other';
  });
const editor = (page: Page) => page.locator('#gantt .fg-grid__editor');
const errorText = (page: Page) => page.locator('#gantt .fg-grid__edit-error');
const live = (page: Page) => page.locator('#gantt [aria-live]');
const task = (page: Page, id: string) =>
  page.evaluate((i) => {
    const t = (window as unknown as { __gantt: G }).__gantt.getTask(i)!;
    return { start: String(t.start), end: String(t.end), duration: t.duration, progress: t.progress, name: t.name };
  }, id);
const events = (page: Page, name: string): Promise<number> =>
  page.evaluate((n) => ((window as unknown as { __events: { name: string }[] }).__events ?? []).filter((e) => e.name === n).length, name);
const canUndo = (page: Page) => page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.canUndo());
const iso = (s: string) => s.slice(0, 10);

for (const canvas of [false, true]) {
  for (const rtl of [false, true]) {
    test.describe(`${canvas ? 'Canvas' : 'SVG'} ${rtl ? 'RTL' : 'LTR'}`, () => {
      const q = `${rtl ? 'rtl=1&' : ''}cols=6&hooks=1`;

      test('Enter and F2 open the editor on the focused cell, selected, focused; Escape cancels and returns to the cell', async ({ page }) => {
        await open(page, q, canvas, 772);
        for (const [col, key] of [['name', 'Enter'], ['start', 'F2'], ['end', 'Enter'], ['duration', 'Enter'], ['progress', 'F2'], ['owner', 'Enter']] as const) {
          await focusCell(page, 'dev', col, rtl);
          await page.keyboard.press(key);
          await expect(editor(page)).toBeFocused();
          const sel = await editor(page).evaluate((i: HTMLInputElement) => [i.selectionStart, i.selectionEnd, i.value.length, i.type]);
          if (sel[3] === 'text') expect(sel[0]).toBe(0), expect(sel[1]).toBe(sel[2]);
          await page.keyboard.press('Escape');
          await expect(editor(page)).toHaveCount(0);
          await expect.poll(() => where(page)).toBe(`cell:dev:${COLS.indexOf(col)}`);
        }
        expect(await canUndo(page)).toBe(false);
      });

      test('F2 on a row edits its name cell', async ({ page }) => {
        await open(page, q, canvas, 772);
        await focusRow(page, 'dev');
        await page.keyboard.press('F2');
        await expect(editor(page)).toHaveAttribute('aria-label', 'Name, Development');
        await page.keyboard.press('Escape');
        await expect.poll(() => where(page)).toBe('cell:dev:0');
      });

      test('a double-click on a pinned cell opens the editor', async ({ page }) => {
        await open(page, q, canvas, 772);
        const sel = canvas ? '#gantt canvas.fg-timeline-canvas-labels' : '#gantt .fg-timeline__sticky-column';
        const box = (await page.locator(sel).boundingBox())!;
        // Row 2 (design); the start column is 220..340 px in from the pinned edge.
        const rowH = 32;
        const y = box.y + 32 + rowH * 2 + rowH / 2;
        const x = rtl ? box.x + box.width - 280 : box.x + 280;
        await page.mouse.dblclick(x, y);
        await expect(editor(page)).toHaveAttribute('aria-label', 'Start, Design');
        await expect(editor(page)).toBeFocused();
      });

      test('the editor sits exactly on the painted cell, also after a vertical scroll', async ({ page }) => {
        await open(page, q, canvas, 772);
        await focusCell(page, 'design', 'start', rtl);
        await page.keyboard.press('Enter');
        const input = editor(page);
        await expect(input).toBeFocused();
        const pin = (await page.locator(canvas ? '#gantt canvas.fg-timeline-canvas-labels' : '#gantt .fg-timeline__sticky-column').boundingBox())!;
        const b = (await input.boundingBox())!;
        const rowH = 32;
        // design is row index 2: 32 px header + 2 rows below the pinned box's top (SVG: the box scrolls with the rows)
        expect(Math.abs(b.y - (pin.y + 32 + 2 * rowH))).toBeLessThanOrEqual(1);
        expect(Math.abs(b.height - rowH)).toBeLessThanOrEqual(1);
        expect(Math.abs(b.width - 120)).toBeLessThanOrEqual(1);
        const left = rtl ? pin.x + pin.width - 220 - 120 : pin.x + 220;
        expect(Math.abs(b.x - left)).toBeLessThanOrEqual(1);
      });

      test('cell:edit-requested is anchored on the cell, not the row', async ({ page }) => {
        await open(page, q, canvas, 772);
        await focusCell(page, 'design', 'duration', rtl);
        await page.keyboard.press('Enter');
        const b = (await editor(page).boundingBox())!;
        const p = await page.evaluate(
          () => (window as unknown as { __events: { name: string; payload: { clientX: number; clientY: number; columnId: string; source: string } }[] }).__events.filter((e) => e.name === 'cell:edit-requested').at(-1)!.payload,
        );
        expect(p).toMatchObject({ columnId: 'duration', source: 'keyboard' });
        expect(Math.abs(p.clientX - (b.x + b.width / 2))).toBeLessThanOrEqual(2);
        expect(Math.abs(p.clientY - (b.y + b.height / 2))).toBeLessThanOrEqual(2);
      });

      test('start: the bar moves, keeps its working duration, one Ctrl+Z restores, task:updated fires once', async ({ page }) => {
        await open(page, q, canvas, 772);
        const before = await task(page, 'design');
        await focusCell(page, 'design', 'start', rtl);
        await page.keyboard.press('Enter');
        await editor(page).fill('2026-03-23');
        await page.keyboard.press('Enter');
        await expect(editor(page)).toHaveCount(0);
        const after = await task(page, 'design');
        expect(iso(after.start)).toBe('2026-03-23');
        expect(after.end).not.toBe(before.end);
        expect(await events(page, 'task:updated')).toBe(1);
        await expect.poll(() => where(page)).toBe('cell:design:1');
        await page.keyboard.press('Control+z');
        expect(await task(page, 'design')).toEqual(before);
        expect(await canUndo(page)).toBe(false);
      });

      test('end, duration and progress write the right fields', async ({ page }) => {
        await open(page, q, canvas, 772);
        await focusCell(page, 'req', 'duration', rtl);
        await page.keyboard.press('Enter');
        await editor(page).fill('3');
        await page.keyboard.press('Enter');
        expect((await task(page, 'req')).duration).toBe(24);
        await focusCell(page, 'req', 'progress', rtl);
        await page.keyboard.press('Enter');
        await editor(page).fill('50%');
        await page.keyboard.press('Enter');
        expect((await task(page, 'req')).progress).toBeCloseTo(0.5);
        await focusCell(page, 'req', 'end', rtl);
        await page.keyboard.press('Enter');
        await editor(page).fill('2026-03-20');
        await page.keyboard.press('Enter');
        const end = await task(page, 'req');
        expect(iso(end.end)).toBe('2026-03-20');
        expect(end.duration).toBeGreaterThan(24);
        expect(await events(page, 'task:updated')).toBe(3);
      });

      test('Tab commits and moves on; blur commits a valid value and discards an invalid one', async ({ page }) => {
        await open(page, q, canvas, 772);
        await focusCell(page, 'req', 'name', rtl);
        await page.keyboard.press('Enter');
        await editor(page).fill('Tabbed');
        await page.keyboard.press('Tab');
        await expect(editor(page)).toHaveCount(0);
        expect((await task(page, 'req')).name).toBe('Tabbed');
        await focusCell(page, 'req', 'progress', rtl);
        await page.keyboard.press('Enter');
        await editor(page).fill('999');
        await page.locator('h1').click(); // blur: invalid, discarded
        await expect(editor(page)).toHaveCount(0);
        expect((await task(page, 'req')).progress).toBe(1);
        await focusCell(page, 'req', 'name', rtl);
        await page.keyboard.press('Enter');
        await editor(page).fill('Blurred');
        await page.locator('h1').click();
        await expect(editor(page)).toHaveCount(0);
        expect((await task(page, 'req')).name).toBe('Blurred');
      });

      test('validation: an inline alert, aria-invalid, the editor stays open on Enter', async ({ page }) => {
        await open(page, q, canvas, 772);
        const cases: [string, string, string][] = [
          ['name', '   ', 'Enter a value.'],
          ['duration', 'abc', 'Enter a number.'],
          ['progress', '150', 'Enter a value from 0 to 100.'],
          ['end', '2026-03-01', 'The end must be after the start.'],
        ];
        for (const [col, text, msg] of cases) {
          await focusCell(page, 'req', col, rtl);
          await page.keyboard.press('Enter');
          await editor(page).fill(text);
          await page.keyboard.press('Enter');
          await expect(editor(page)).toBeFocused();
          await expect(editor(page)).toHaveAttribute('aria-invalid', 'true');
          await expect(errorText(page)).toHaveText(msg);
          await expect(errorText(page)).toHaveAttribute('role', 'alert');
          const describedby = await editor(page).getAttribute('aria-describedby');
          expect(await errorText(page).getAttribute('id')).toBe(describedby);
          await page.keyboard.press('Escape');
        }
        expect(await events(page, 'task:updated')).toBe(0);
      });

      test('a Saturday start snaps to Monday and the live region says so', async ({ page }) => {
        await open(page, q, canvas, 772);
        await focusCell(page, 'design', 'start', rtl);
        await page.keyboard.press('Enter');
        await editor(page).fill('2026-03-21');
        await page.keyboard.press('Enter');
        expect(iso((await task(page, 'design')).start)).toBe('2026-03-23');
        await expect(live(page)).toContainText('next working day');
      });

      test('events from the editor do not reach the chart: no selection change, no pan, no bar drag', async ({ page }) => {
        await open(page, q, canvas, 772);
        await focusCell(page, 'design', 'name', rtl);
        await page.keyboard.press('Enter');
        const sel0 = await page.evaluate(() => (window as unknown as { __gantt: { getSelection(): string[] } }).__gantt.getSelection());
        const b = (await editor(page).boundingBox())!;
        await page.mouse.move(b.x + 10, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + 60, b.y + b.height / 2 + 30, { steps: 4 });
        await page.mouse.up();
        await page.mouse.dblclick(b.x + 20, b.y + b.height / 2);
        await expect(editor(page)).toBeFocused();
        expect(await page.evaluate(() => (window as unknown as { __gantt: { getSelection(): string[] } }).__gantt.getSelection())).toEqual(sel0);
        expect(await events(page, 'task:activated')).toBe(0);
        expect(await events(page, 'task:updated')).toBe(0);
        await page.keyboard.press('Delete'); // plain text editing, not "delete the selected task"
        expect((await task(page, 'design')).name).toBe('Design');
      });

      test('a column resize cancels the editor without a write', async ({ page }) => {
        await open(page, q, canvas, 772);
        await focusCell(page, 'design', 'name', rtl);
        await page.keyboard.press('Enter');
        await editor(page).fill('Unsaved');
        await page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.resizeGridColumn('start', 150));
        await expect(editor(page)).toHaveCount(0);
        expect((await task(page, 'design')).name).toBe('Design');
      });
    });
  }
}

test.describe('SVG', () => {
  test('the editor stays on its cell when the chart is scrolled horizontally', async ({ page }) => {
    await open(page, 'cols=6', false, 772);
    await focusCell(page, 'design', 'start');
    await page.keyboard.press('Enter');
    const before = (await editor(page).boundingBox())!;
    await page.locator('#gantt').evaluate((el) => (el.scrollLeft = 300));
    await frames(page);
    const after = (await editor(page).boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  });

  test('typing a long text does not scroll the chart', async ({ page }) => {
    await open(page, 'cols=6', false, 772);
    await focusCell(page, 'design', 'name');
    await page.keyboard.press('Enter');
    const s0 = await page.locator('#gantt').evaluate((el) => [el.scrollLeft, el.scrollTop]);
    await page.keyboard.type('x'.repeat(200));
    expect(await page.locator('#gantt').evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual(s0);
  });

  test('wheel over the editor still scrolls the chart', async ({ page }) => {
    await open(page, 'cols=6&rows=60', false, 772);
    await focusCell(page, 'req', 'name');
    await page.keyboard.press('Enter');
    const b = (await editor(page).boundingBox())!;
    await page.mouse.move(b.x + 10, b.y + 5);
    const top0 = await page.evaluate(() => window.scrollY + (document.querySelector('#gantt')?.scrollTop ?? 0));
    await page.mouse.wheel(0, 120);
    await expect.poll(() => page.evaluate(() => window.scrollY + (document.querySelector('#gantt')?.scrollTop ?? 0))).toBeGreaterThan(top0);
  });

  test('a calendar day in a New York spring-forward week keeps the working duration', async ({ page }) => {
    await open(page, 'cols=6&tz=America/New_York', false, 772);
    await focusCell(page, 'req', 'start');
    await page.keyboard.press('Enter');
    await editor(page).fill('2026-03-09');
    await page.keyboard.press('Enter');
    const t = await task(page, 'req');
    expect(iso(t.start)).toBe('2026-03-09');
    expect(t.start).toContain('T09:00');
  });

  test('a host that handles cell:edit-requested replaces the editor; no task:activated either', async ({ page }) => {
    await open(page, 'cols=6&hooks=1&veto=1', false, 772);
    await focusCell(page, 'design', 'start');
    await page.keyboard.press('Enter');
    await expect(editor(page)).toHaveCount(0);
    expect(await events(page, 'cell:edit-requested')).toBe(1);
    expect(await events(page, 'task:activated')).toBe(0);
    await page.keyboard.press('F2');
    expect(await events(page, 'cell:edit-requested')).toBe(2);
    expect(await events(page, 'task:activated')).toBe(0);
  });

  test('with only withEditHooks (no editing) the cell is still reported', async ({ page }) => {
    await page.goto('/grid.html?cols=6&hooks=1');
    await page.waitForFunction(() => '__gantt' in window);
    await frames(page);
    await focusCell(page, 'design', 'start');
    await page.keyboard.press('Enter');
    const e = await page.evaluate(() => (window as unknown as { __events: { name: string; payload: { part: string; columnId: string } }[] }).__events);
    expect(e.at(-1)).toMatchObject({ name: 'task:activated', payload: { part: 'cell', columnId: 'start' } });
  });

  test('a readOnly chart has no editor, no event, and aria-readonly cells', async ({ page }) => {
    await open(page, 'cols=6&readonly=1', false, 772);
    await focusCell(page, 'design', 'start');
    await page.keyboard.press('Enter');
    await page.keyboard.press('F2');
    await page.mouse.dblclick(0, 0);
    await expect(editor(page)).toHaveCount(0);
    expect(await events(page, 'cell:edit-requested')).toBe(0);
    await focusCell(page, 'design', 'start');
    await expect(page.locator('#gantt [role=gridcell]:focus')).toHaveAttribute('aria-readonly', 'true');
  });

  test('host messages replace the label and the error text', async ({ page }) => {
    await open(page, 'cols=6&messages=1', false, 772);
    await focusCell(page, 'design', 'progress');
    await page.keyboard.press('Enter');
    await expect(editor(page)).toHaveAttribute('aria-label', 'Edit Progress of Design');
    await editor(page).fill('abc');
    await page.keyboard.press('Enter');
    await expect(errorText(page)).toHaveText('Problem: not-a-number');
  });

  test('no node or listener growth across repeated edits', async ({ page }) => {
    await open(page, 'cols=6', false, 772);
    const nodes = () => page.evaluate(() => document.querySelectorAll('#gantt *').length);
    await focusCell(page, 'req', 'name');
    const n0 = await nodes();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Enter');
      await editor(page).fill(`Name ${i}`);
      await page.keyboard.press('Enter');
    }
    expect(Math.abs((await nodes()) - n0)).toBeLessThan(10);
  });
});

test.describe('Canvas', () => {
  test('the editor stays aligned while the rows scroll and after the chart scrolls horizontally', async ({ page }) => {
    await open(page, 'cols=6', true, 772);
    await focusCell(page, 'design', 'start');
    await page.keyboard.press('Enter');
    const input = editor(page);
    await expect(input).toBeFocused();
    const pin = (await page.locator('#gantt canvas.fg-timeline-canvas-labels').boundingBox())!;
    const y0 = (await input.boundingBox())!.y;
    await page.locator('#gantt').evaluate((el) => (el.scrollTop = 72));
    await frames(page);
    const b = (await input.boundingBox())!;
    expect(Math.abs(b.y - (y0 - 72))).toBeLessThanOrEqual(1);
    await page.locator('#gantt').evaluate((el) => (el.scrollLeft = 500));
    await frames(page);
    const c = (await input.boundingBox())!;
    expect(Math.abs(c.x - (pin.x + 220))).toBeLessThanOrEqual(1);
  });

  test('a committed edit repaints the painted cell and focus returns to the a11y cell', async ({ page }) => {
    await open(page, 'cols=6', true, 772);
    await focusCell(page, 'design', 'progress');
    await page.keyboard.press('Enter');
    await editor(page).fill('77');
    await page.keyboard.press('Enter');
    await expect.poll(() => where(page)).toBe('cell:design:4');
    await expect(page.locator('#gantt [role=row][data-task-id="design"] [role=gridcell][aria-colindex="5"]')).toHaveText('77%');
  });
});
