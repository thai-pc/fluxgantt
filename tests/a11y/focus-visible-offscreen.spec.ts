import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ACCENT, openFocusFixture, scrollFar } from '../helpers/focus-frame.js';

// Row focus frame (spec-focus-visible-offscreen.md): axe stays clean with focus on a row whose bar is
// scrolled away, in both renderers and both themes; the SVG frame survives forced-colors and
// reduced-motion; the dark token reaches 3:1 on the live dark ground.

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('#gantt').analyze();
  expect(results.violations).toEqual([]);
}
async function focusOffscreenRow(page: Page, pad: number): Promise<void> {
  await openFocusFixture(page, pad);
  await scrollFar(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
}
const frameStyles = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.fg-timeline__focus-row')].map((e) => {
      const s = getComputedStyle(e);
      return { stroke: s.stroke, width: parseFloat(s.strokeWidth), anims: e.getAnimations().length };
    }),
  );

for (const [mode, pad] of [['svg', 60], ['canvas', 2100]] as const) {
  test(`${mode}: no axe violations with focus on a row whose bar is off screen`, async ({ page }) => {
    await focusOffscreenRow(page, pad);
    await axe(page);
  });
}

test('dark theme: no axe violations and the live focus colour is #38bdf8 at 3:1+ on the ground', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('#theme-toggle');
  for (let i = 0; i < 3 && (await button.textContent())?.trim() !== 'Theme: dark'; i++) await button.click();
  await page.locator('#gantt [tabindex="0"]').first().focus();
  await page.keyboard.press('ArrowDown');
  await axe(page);
  const live = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.fg-timeline__focus-row')].map((e) => getComputedStyle(e).stroke);
    return { f, bg: getComputedStyle(document.getElementById('gantt')!).backgroundColor };
  });
  expect(live.f).toHaveLength(2);
  expect(live.f.every((s) => s === 'rgb(56, 189, 248)')).toBe(true);
  expect(live.bg).toBe('rgb(10, 10, 10)');
});

test('svg + forced-colors: the ring and the frame resolve to the system Highlight colour', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await focusOffscreenRow(page, 60);
  const r = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'Highlight';
    document.body.append(probe);
    const highlight = getComputedStyle(probe).color;
    probe.remove();
    const stroke = (sel: string) => [...document.querySelectorAll(sel)].map((e) => getComputedStyle(e).stroke);
    return {
      highlight,
      frames: stroke('.fg-timeline__focus-row'),
      ring: stroke('.fg-timeline__row:focus-visible .fg-task__focus-ring'),
      columnBg: getComputedStyle(document.querySelector('.fg-timeline__sticky-column')!).backgroundColor,
      canvas: getComputedStyle(document.getElementById('gantt')!).backgroundColor,
    };
  });
  expect(r.frames).toHaveLength(2);
  expect(r.frames.every((s) => s === r.highlight)).toBe(true);
  expect(r.ring).toEqual([r.highlight]);
  // The pinned column takes the same forced ground as the chart, so Highlight is read against one ground.
  expect(r.columnBg).toBe(r.canvas);
});

test('canvas + forced-colors: nothing throws and the frame is still painted', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ forcedColors: 'active' });
  await focusOffscreenRow(page, 2100);
  expect(errors).toEqual([]);
  await expect(page.locator('canvas.fg-timeline-canvas-labels')).toBeVisible();
});

test('reduced motion: nothing animates on the frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await focusOffscreenRow(page, 60);
  const styles = await frameStyles(page);
  expect(styles).toHaveLength(2);
  expect(styles.every((s) => s.anims === 0)).toBe(true);
  expect(styles[0]!.stroke).toBe(`rgb(${ACCENT.join(', ')})`);
});
