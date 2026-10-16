import { test, expect } from '@playwright/test';

// Pinned SVG date axis on a coarse pointer (spec-svg-sticky-header.md section 2.4). The chart's
// own touch pan is a JS recognizer on the chart `<svg>` (`touch-action: none` there); the pinned
// band is a separate sibling, so it must NOT inherit that rule, otherwise a finger that starts on
// the band could neither pan with JS nor scroll natively. Fixture: `responsive.html`.

test('the pinned band stays at the top after a vertical scroll and leaves native touch scrolling on', async ({
  page,
}) => {
  await page.goto('/responsive.html');
  await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
  await expect(page.locator('#gantt svg.fg-timeline__sticky-header')).toHaveCount(1);

  const result = await page.evaluate(async () => {
    const c = document.getElementById('gantt')!;
    c.style.height = '90px'; // shorter than the 4-row chart, so it really scrolls
    c.scrollTop = 40;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const band = c.querySelector<SVGSVGElement>('svg.fg-timeline__sticky-header')!;
    const chart = c.querySelector<SVGSVGElement>('svg.fg-timeline')!;
    return {
      scrollTop: c.scrollTop,
      bandTop: band.getBoundingClientRect().top,
      containerTop: c.getBoundingClientRect().top + c.clientTop,
      bandTouchAction: getComputedStyle(band).touchAction,
      chartTouchAction: getComputedStyle(chart).touchAction,
    };
  });

  expect(result.scrollTop).toBeGreaterThan(0);
  expect(Math.abs(result.bandTop - result.containerTop)).toBeLessThanOrEqual(0.5);
  expect(result.chartTouchAction).toBe('none');
  expect(result.bandTouchAction).not.toBe('none');
});
