import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for the pinned SVG date axis (spec-svg-sticky-header.md section 2.6). The
// overlay is an aria-hidden presentation replica of the in-svg header, so the bar is: it adds no
// axe violations, no duplicate accessible names, no focus stops, and it does not animate.
// Fixture: `collapse.html?pad=60` (420px scroll container).

const OVERLAY = '#gantt svg.fg-timeline__sticky-header';

test.beforeEach(async ({ page }) => {
  await page.goto('/collapse.html?pad=60');
  await expect(page.locator('svg.fg-timeline')).toBeVisible();
  await page.evaluate(() => {
    document.getElementById('gantt')!.scrollTop = 400;
  });
});

test('a scrolled chart with the pinned band has no axe violations', async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .include('#gantt')
    .analyze();
  expect(results.violations).toEqual([]);
});

test('the overlay is hidden from the accessibility tree and adds no accessible names or focus stops', async ({
  page,
}) => {
  const overlay = page.locator(OVERLAY);
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  expect(await overlay.locator('[tabindex], a, button, input').count()).toBe(0);

  // Header text exists exactly once for assistive technology: only the chart's own header is
  // exposed, so the date labels are not announced twice.
  const snapshot = await page.locator('#gantt').ariaSnapshot();
  expect(snapshot).not.toContain('fg-timeline__sticky-header');
  const exposedHeaderLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#gantt .fg-timeline__header-label')).filter(
      (el) => el.closest('[aria-hidden="true"]') === null,
    ).length,
  );
  const chartLabels = await page.locator('#gantt svg.fg-timeline .fg-timeline__header-label').count();
  expect(exposedHeaderLabels).toBe(chartLabels);

  // Exactly one grid in the page, and the roving tabindex keeps a single Tab stop.
  expect(await page.locator('#gantt [role="grid"], #gantt [role="treegrid"]').count()).toBe(1);
  expect(await page.locator('#gantt .fg-timeline__row[tabindex="0"]').count()).toBe(1);
});

test('the overlay has no transition or animation, also under prefers-reduced-motion', async ({ page }) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    const css = await page.locator(OVERLAY).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { duration: cs.transitionDuration, animation: cs.animationName };
    });
    expect(css.duration.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
    expect(css.animation).toBe('none');
  }
});

test('the dark theme paints the band from the same tokens (header labels keep AA contrast)', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#theme-toggle').click(); // auto -> light
  await page.locator('#theme-toggle').click(); // light -> dark
  await expect(page.locator('#theme-toggle')).toHaveText('Theme: dark');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .include('#gantt')
    .analyze();
  expect(results.violations).toEqual([]);
  const band = await page.locator(OVERLAY).evaluate((el) => getComputedStyle(el).backgroundColor);
  const chart = await page.locator('#gantt svg.fg-timeline .fg-timeline__header rect').evaluate(
    (el) => getComputedStyle(el).fill,
  );
  expect(band).toBe(chart);
});
