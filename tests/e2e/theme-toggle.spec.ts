import { test, expect } from '@playwright/test';

// End-to-end coverage for the `withTheme` mixin, driven through the demo's theme toggle
// (examples/plain-html-demo). The unit suite already proves the token bookkeeping in jsdom;
// what only a real browser can prove is the half the design leans on: that CSS custom
// properties set on the mount container INHERIT into the SVG, so `var(--fg-*, <light>)` written
// inline at every paint site re-resolves to the dark value with no renderer change at all.

/** Cycles the demo's toggle to a given theme. The button walks auto -> light -> dark -> auto. */
async function cycleTo(page: import('@playwright/test').Page, theme: string): Promise<void> {
  const button = page.locator('#theme-toggle');
  for (let i = 0; i < 3; i += 1) {
    if ((await button.textContent())?.trim() === `Theme: ${theme}`) return;
    await button.click();
  }
  throw new Error(`theme toggle never reached "${theme}"`);
}

test('the toggle cycles auto -> light -> dark -> auto', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('#theme-toggle');
  await expect(button).toHaveText('Theme: auto');
  await button.click();
  await expect(button).toHaveText('Theme: light');
  await button.click();
  await expect(button).toHaveText('Theme: dark');
  await button.click();
  await expect(button).toHaveText('Theme: auto');
});

test('dark sets the token overrides on the mount container, and light removes them', async ({
  page,
}) => {
  await page.goto('/');
  const container = page.locator('#gantt');

  await cycleTo(page, 'dark');
  // Read the INLINE style, not the computed value: these are written directly on the container
  // by `withTheme`, and that is what light mode has to take back off again.
  await expect(container).toHaveAttribute('style', /--fg-bg:\s*#0a0a0a/);
  await expect(container).toHaveAttribute('style', /--fg-grid-line:\s*#27272a/);

  await cycleTo(page, 'light');
  const style = (await container.getAttribute('style')) ?? '';
  expect(style).not.toContain('--fg-');
});

test('the dark tokens inherit into the SVG, so painted colors follow with no repaint', async ({
  page,
}) => {
  await page.goto('/');
  const gridLine = page.locator('#gantt .fg-timeline__grid-line').first();

  // The light fallback baked inline at the paint site.
  const lightStroke = await gridLine.evaluate((el) => getComputedStyle(el).stroke);

  await cycleTo(page, 'dark');
  const darkStroke = await gridLine.evaluate((el) => getComputedStyle(el).stroke);

  // `rgb(39, 39, 42)` === #27272a — the browser resolved the SAME inline `var()` declaration
  // against the container's new custom property. No renderer code ran in between.
  expect(darkStroke).toBe('rgb(39, 39, 42)');
  expect(darkStroke).not.toBe(lightStroke);
});

test('a dark chart exports dark SVG — the bake reads resolved values, not fallbacks', async ({
  page,
}) => {
  await page.goto('/');
  await cycleTo(page, 'dark');

  const svg = await page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { exportSvg(): string } }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    return g.exportSvg();
  });

  // `bakeComputedStyles()` runs BEFORE the <style> strip, so the dark values are baked in and
  // no unresolved `var()` survives into a file that may be opened standalone.
  expect(svg).toContain('rgb(39, 39, 42)');
  expect(svg).not.toContain('var(--fg-');
});
