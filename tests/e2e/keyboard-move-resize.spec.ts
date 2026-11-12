import { test, expect, type Page } from '@playwright/test';
import { DAY_MS, dependencyCount, events, openCanvasDrag as openCanvas, taskMs } from '../helpers/canvas-drag.js';
import { openRtl } from '../helpers/rtl.js';

// Keyboard alternative to drag (WCAG 2.2 SC 2.5.7, spec-keyboard-move-resize.md). Fixtures:
// `canvas-drag.html` (`?pad=0` = SVG twin, default = Canvas; rows a b c d ms sum x y, c -> d) and
// `rtl.html` (`?pad=0` SVG, `?pad=2100` Canvas). Dates are read through the public API.

const row = (page: Page, id: string) => page.locator(`[role="row"][data-task-id="${id}"]`);
// A programmatic `.focus()`, as an AT cursor does: the focused row becomes the roving one in both renderers.
const focusRow = async (page: Page, id: string) => {
  await row(page, id).focus();
  await expect(row(page, id)).toBeFocused();
};
// `?pad=0` is the SVG twin of the Canvas fixture.
const openCanvasDrag = async (page: Page, query = '') => {
  if (!query.includes('pad=0')) return openCanvas(page, query);
  await page.goto(`/canvas-drag.html?${query}`);
  await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
  await page.waitForFunction(() => '__fx' in window && '__events' in window);
};

for (const [name, query] of [
  ['SVG', 'pad=0'],
  ['Canvas', ''],
] as const) {
  test.describe(`${name}: Alt+Arrow`, () => {
    test.beforeEach(async ({ page }) => openCanvasDrag(page, query));

    test('moves the focused task one day, focus stays, one undo step', async ({ page }) => {
      const [s0, e0] = [await taskMs(page, 'a', 'start'), await taskMs(page, 'a', 'end')];
      await focusRow(page, 'a');
      await page.keyboard.press('Alt+ArrowRight');
      await expect.poll(() => taskMs(page, 'a', 'start')).toBe(s0 + DAY_MS);
      expect(await taskMs(page, 'a', 'end')).toBe(e0 + DAY_MS);
      await expect(row(page, 'a')).toBeFocused();
      expect((await events(page, 'task:moved')).length).toBe(1);
      await page.keyboard.press('Alt+ArrowLeft');
      await page.keyboard.press('Alt+ArrowLeft');
      expect(await taskMs(page, 'a', 'start')).toBe(s0 - DAY_MS);
      await page.evaluate(() => (window as unknown as { __gantt: { undo(): void } }).__gantt.undo());
      expect(await taskMs(page, 'a', 'start')).toBe(s0);
    });

    test('Alt+Shift+ArrowLeft shortens the end', async ({ page }) => {
      const e0 = await taskMs(page, 'b', 'end');
      await focusRow(page, 'b');
      await page.keyboard.press('Alt+Shift+ArrowLeft');
      await expect.poll(() => taskMs(page, 'b', 'end')).toBeLessThan(e0);
      expect((await events(page, 'task:resized')).length).toBe(1);
    });

    test('a milestone moves but does not resize', async ({ page }) => {
      const m0 = await taskMs(page, 'ms', 'end');
      await focusRow(page, 'ms');
      await page.keyboard.press('Alt+Shift+ArrowRight');
      expect(await taskMs(page, 'ms', 'end')).toBe(m0);
      expect(await taskMs(page, 'ms', 'start')).toBe(m0);
      await page.keyboard.press('Alt+ArrowRight');
      await expect.poll(() => taskMs(page, 'ms', 'start')).toBe(m0 + DAY_MS);
    });

    test('Shift+ArrowDown then Alt+Enter links anchor -> focus', async ({ page }) => {
      const n = await dependencyCount(page);
      await focusRow(page, 'a');
      await page.keyboard.press('Shift+ArrowDown'); // anchor a, focus b
      await page.keyboard.press('Alt+Enter');
      await expect.poll(() => dependencyCount(page)).toBe(n + 1);
    });

    test('Alt+ArrowLeft / Alt+ArrowRight are default-prevented (no browser Back / Forward)', async ({ page }) => {
      // A page listener in the bubble phase, registered after mount, sees the final `defaultPrevented`.
      await page.evaluate(() => {
        const w = window as unknown as { __prevented: boolean[] };
        w.__prevented = [];
        window.addEventListener('keydown', (e) => e.key.startsWith('Arrow') && w.__prevented.push(e.defaultPrevented));
      });
      await focusRow(page, 'a');
      await page.keyboard.press('Alt+ArrowLeft');
      await page.keyboard.press('Alt+ArrowRight');
      expect(await page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented)).toEqual([true, true]);
    });

    test('focus moved programmatically to another row (AT cursor): Alt+ArrowRight moves THAT task', async ({ page }) => {
      await focusRow(page, 'a');
      const [a0, b0] = [await taskMs(page, 'a', 'start'), await taskMs(page, 'b', 'start')];
      await focusRow(page, 'b');
      await page.keyboard.press('Alt+ArrowRight');
      await expect.poll(() => taskMs(page, 'b', 'start')).toBe(b0 + DAY_MS);
      expect(await taskMs(page, 'a', 'start')).toBe(a0);
      await expect(row(page, 'b')).toBeFocused();
    });
  });
}

test.describe('readOnly', () => {
  test('Alt+Arrow changes nothing', async ({ page }) => {
    await openCanvasDrag(page, 'pad=0&readonly=1');
    const s0 = await taskMs(page, 'a', 'start');
    await focusRow(page, 'a');
    await page.keyboard.press('Alt+ArrowRight');
    expect(await taskMs(page, 'a', 'start')).toBe(s0);
  });
});

for (const [name, query] of [
  ['SVG', 'pad=0'],
  ['Canvas', 'pad=2100'],
] as const) {
  test.describe(`RTL ${name}: logical direction`, () => {
    test.beforeEach(async ({ page }) => openRtl(page, query));

    test('Alt+ArrowLeft moves LATER, Alt+ArrowRight EARLIER', async ({ page }) => {
      const s0 = await taskMs(page, 'design', 'start');
      await focusRow(page, 'design');
      await page.keyboard.press('Alt+ArrowLeft');
      await expect.poll(() => taskMs(page, 'design', 'start')).toBe(s0 + DAY_MS);
      await page.keyboard.press('Alt+ArrowRight');
      await page.keyboard.press('Alt+ArrowRight');
      expect(await taskMs(page, 'design', 'start')).toBe(s0 - DAY_MS);
    });
  });
}

test('LTR twin: Alt+ArrowRight moves later (oracle for the RTL flip)', async ({ page }) => {
  await openRtl(page, 'rtl=0');
  const s0 = await taskMs(page, 'design', 'start');
  await focusRow(page, 'design');
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => taskMs(page, 'design', 'start')).toBe(s0 + DAY_MS);
});
