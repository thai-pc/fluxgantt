import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for dark mode (WCAG 2.1 AA per testing.md). Dark mode is a pure
// recolor — no DOM, ARIA or focus change — so the risk it carries is exactly one: contrast.

/** Cycles the demo's toggle to a given theme (auto -> light -> dark -> auto). */
async function cycleTo(page: import('@playwright/test').Page, theme: string): Promise<void> {
  const button = page.locator('#theme-toggle');
  for (let i = 0; i < 3; i += 1) {
    if ((await button.textContent())?.trim() === `Theme: ${theme}`) return;
    await button.click();
  }
  throw new Error(`theme toggle never reached "${theme}"`);
}

/** WCAG 2.1 relative luminance + contrast ratio, on `rgb(r, g, b)` strings. */
function contrastRatio(a: string, b: string): number {
  const luminance = (css: string): number => {
    const [r, g, bl] = (css.match(/\d+/g) ?? []).map(Number) as [number, number, number];
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

test('a dark chart has no detectable axe violations', async ({ page }) => {
  await page.goto('/');
  await cycleTo(page, 'dark');
  const results = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(results.violations).toEqual([]);
});

test('header label text clears WCAG AA contrast against the dark ground', async ({ page }) => {
  await page.goto('/');
  await cycleTo(page, 'dark');

  // Measured off the LIVE nodes rather than asserted against the DARK_TOKENS table: what a
  // reader actually sees is the resolved cascade, which is the thing WCAG is about.
  const label = page.locator('#gantt .fg-timeline__header-label').first();
  const { fg, bg } = await label.evaluate((el) => ({
    fg: getComputedStyle(el).fill,
    bg: getComputedStyle(el.ownerDocument.getElementById('gantt')!).backgroundColor,
  }));

  // 4.5:1 is AA for body text; these labels are small, so the stricter bar is the right one.
  expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
});

test('task bars stay distinguishable against the dark ground', async ({ page }) => {
  await page.goto('/');
  await cycleTo(page, 'dark');

  // Task accent colors are deliberately NOT re-tinted for dark (they are saturated mid-tones).
  // This is the guard on that decision: 3:1 is the AA bar for a non-text graphical object.
  const bar = page.locator('#gantt .fg-task__bar').first();
  const { fill, bg } = await bar.evaluate((el) => ({
    fill: getComputedStyle(el).fill,
    bg: getComputedStyle(el.ownerDocument.getElementById('gantt')!).backgroundColor,
  }));

  expect(contrastRatio(fill, bg)).toBeGreaterThanOrEqual(3);
});
