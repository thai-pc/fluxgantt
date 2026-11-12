import { test, expect, type Page } from '@playwright/test';
import { ACCENT, HEADER, LABEL_W, ROW, accentShare, containerBox, openFocusFixture, scrollFar } from '../helpers/focus-frame.js';

// Row focus frame (spec-focus-visible-offscreen.md, WCAG 2.4.7 / 2.4.11): keyboard focus stays visible
// when the focused bar is scrolled away or under the pinned label column. `e2e` project (Desktop Chrome).
// Fixture: `collapse.html?pad=N`; N = 60 is SVG, N = 2100 is Canvas.

type Mode = 'svg' | 'canvas';
const MODES: Array<[Mode, number]> = [
  ['svg', 60],
  ['canvas', 2100],
];

const selection = (page: Page) =>
  page.evaluate(() => (window as unknown as { __gantt: { getSelection(): string[] } }).__gantt.getSelection());

for (const [mode, pad] of MODES) {
  test.describe(`${mode} renderer`, () => {
    test.beforeEach(async ({ page }) => {
      await openFocusFixture(page, pad);
      await scrollFar(page);
    });

    test('frame is visible in the column and the chart while the focused bar is off screen', async ({ page }) => {
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); // row 3, an August bar
      const c = await containerBox(page);
      expect(c.scrollTop).toBe(0);
      // Scenario is real: the August bars are scrolled away to the left of the container's content edge.
      if (mode === 'svg') {
        const bar = (await page.locator('.fg-timeline__row[data-task-id="leaf-a2"] .fg-task__bar').first().boundingBox())!;
        expect(bar.x + bar.width).toBeLessThan(c.left + LABEL_W);
      }
      const top = c.top + HEADER + 3 * ROW;
      // Column: top stroke is accent ink across the label cell.
      expect(await accentShare(page, { x: c.left + 8, y: top, width: LABEL_W - 40, height: 2 })).toBeGreaterThan(0.5);
      // Chart part: the same stroke runs across the row, far from any bar.
      expect(await accentShare(page, { x: c.left + LABEL_W + 20, y: top, width: 120, height: 2 })).toBeGreaterThan(0.5);
      // Not on the unfocused neighbour row.
      expect(await accentShare(page, { x: c.left + 8, y: top + 2 * ROW - 3, width: LABEL_W - 40, height: 2 })).toBeLessThan(0.1);
    });

    test('frame follows focus and is never behind the pinned header', async ({ page }) => {
      const c = await containerBox(page);
      for (const key of ['PageDown', 'PageDown', 'End', 'Home', 'PageDown', 'ArrowUp']) {
        await page.keyboard.press(key);
        const now = await containerBox(page);
        const idx = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          return Number(a?.getAttribute('data-row-index') ?? -1);
        });
        expect(idx).toBeGreaterThanOrEqual(0);
        const rowTop = now.top + HEADER + idx * ROW - now.scrollTop;
        expect(rowTop).toBeGreaterThanOrEqual(c.top + HEADER - 1);
        expect(await accentShare(page, { x: now.left + 8, y: rowTop, width: LABEL_W - 40, height: 2 })).toBeGreaterThan(0.5);
      }
    });

    test('pointer focus (a click) does not show the frame', async ({ page }) => {
      await page.evaluate(() => ((document.getElementById('gantt') as HTMLElement).scrollLeft = 0));
      const c = await containerBox(page);
      const target = { x: c.left + LABEL_W + 40, y: c.top + HEADER + 4 * ROW + ROW / 2 };
      await page.mouse.click(target.x, target.y);
      expect(await accentShare(page, { x: c.left + 8, y: c.top + HEADER + 4 * ROW, width: LABEL_W - 40, height: 2 })).toBeLessThan(0.1);
    });
  });
}

test.describe('svg specifics', () => {
  test.beforeEach(async ({ page }) => {
    await openFocusFixture(page, 60);
    await scrollFar(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  });

  test('computed stroke on both copies, aria-hidden, no pointer events', async ({ page }) => {
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('.fg-timeline__focus-row')].map((e) => {
        const s = getComputedStyle(e);
        return { stroke: s.stroke, width: parseFloat(s.strokeWidth), pe: s.pointerEvents, hidden: e.getAttribute('aria-hidden'), inColumn: !!e.closest('.fg-timeline__sticky-column') };
      }),
    );
    expect(r).toHaveLength(2);
    for (const f of r) {
      expect(f.stroke).toBe(`rgb(${ACCENT.join(', ')})`);
      expect(f.width).toBeGreaterThanOrEqual(2);
      expect(f.pe).toBe('none');
      expect(f.hidden).toBe('true');
    }
    expect(r.map((f) => f.inColumn).sort()).toEqual([false, true]);
  });

  test('the column copy sits inside the sticky column box and below the header', async ({ page }) => {
    const m = await page.evaluate(() => {
      const f = document.querySelector('.fg-timeline__sticky-column .fg-timeline__focus-row')!.getBoundingClientRect();
      const col = document.querySelector('.fg-timeline__sticky-column')!.getBoundingClientRect();
      const head = document.querySelector('.fg-timeline__sticky-header')!.getBoundingClientRect();
      return { f, col, headBottom: head.bottom };
    });
    expect(m.f.left).toBeLessThan(m.col.right);
    expect(m.f.right).toBeGreaterThan(m.col.left);
    expect(m.f.top).toBeGreaterThanOrEqual(m.headBottom - 0.5);
  });

  test('the frame never intercepts the pointer: a click on the bar still selects and focus is kept', async ({ page }) => {
    await page.evaluate(() => ((document.getElementById('gantt') as HTMLElement).scrollLeft = 0));
    const hit = await page.evaluate(() => {
      const f = document.querySelector('.fg-timeline__layer > svg.fg-timeline .fg-timeline__focus-row')!.getBoundingClientRect();
      const c = document.getElementById('gantt')!.getBoundingClientRect();
      const x = c.left + 400;
      return document.elementsFromPoint(x, f.top + 1).some((e) => e.classList.contains('fg-timeline__focus-row'));
    });
    expect(hit).toBe(false);
    await page.locator('.fg-timeline__row[data-task-id="leaf-a2"] .fg-task__bar').first().click();
    expect(await selection(page)).toEqual(['leaf-a2']);
  });
});
