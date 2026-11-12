import { test, expect, type Page } from '@playwright/test';
import { pinToday } from '../helpers/pin-today.js';

// Row focus frame visual regression (spec-focus-visible-offscreen.md): the focused row has a 2 px frame
// across the pinned label column and the chart while its bar is scrolled out of view. SVG and Canvas,
// light and dark, LTR and RTL, plus the bar-visible case. Fixture: `rtl.html` (`?rtl=0` is the LTR
// twin, `?pad=2100` selects Canvas, `?theme=dark`). Baselines are committed per platform
// (`-darwin.png` here, `-linux.png` from a CI run, never hand-edited; testing.md).

const TODAY = '2026-03-10T12:00:00Z';

async function open(page: Page, query: string): Promise<void> {
  await pinToday(page, TODAY);
  await page.goto(`/rtl.html?${query}`);
  await expect(page.locator(query.includes('pad=2100') ? '#gantt canvas.fg-timeline-canvas' : '#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => '__fx' in window);
  await page.mouse.move(0, 0);
}

/** Focus row 2 by keyboard, then scroll to the far end of the inline axis (bars leave the view). */
async function focusAndScrollAway(page: Page, rtl: boolean, away = true): Promise<void> {
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.evaluate(
    ([r, far]) =>
      new Promise<void>((done) => {
        const c = document.getElementById('gantt')!;
        const max = c.scrollWidth - c.clientWidth;
        c.scrollLeft = far ? (r ? -max : max) : 0;
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
    [rtl, away] as const,
  );
}

for (const renderer of ['svg', 'canvas'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const dir of ['ltr', 'rtl'] as const) {
      test(`${renderer}, ${theme}, ${dir}: focus frame with the bar scrolled out`, async ({ page }) => {
        const q = [renderer === 'canvas' ? 'pad=2100' : '', theme === 'dark' ? 'theme=dark' : '', dir === 'ltr' ? 'rtl=0' : ''].filter(Boolean).join('&');
        await open(page, q);
        await focusAndScrollAway(page, dir === 'rtl');
        await expect(page.locator('#gantt')).toHaveScreenshot(`focus-frame-${renderer}-${theme}-${dir}.png`);
      });
    }
  }
}

test('svg, light, ltr: focus frame with the bar visible keeps the bar ring', async ({ page }) => {
  await open(page, 'rtl=0');
  await focusAndScrollAway(page, false, false);
  await expect(page.locator('#gantt')).toHaveScreenshot('focus-frame-svg-bar-visible.png');
});
