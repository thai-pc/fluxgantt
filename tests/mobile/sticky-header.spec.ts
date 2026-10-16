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

test('a touch pan that starts on the pinned band scrolls the container natively', async ({ page }) => {
  await page.goto('/responsive.html');
  await expect(page.locator('#gantt svg.fg-timeline__sticky-header')).toHaveCount(1);
  await page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    c.style.width = '260px'; // narrower than the chart, so horizontal scroll exists
  });
  const start = await page.evaluate(() => {
    const r = document.querySelector('#gantt svg.fg-timeline__sticky-header')!.getBoundingClientRect();
    const c = document.getElementById('gantt')!.getBoundingClientRect();
    return { x: Math.min(r.left + 200, c.left + c.width - 30), y: r.top + 12 };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizeScrollGesture', {
    x: start.x,
    y: start.y,
    xDistance: -150,
    yDistance: 0,
    gestureSourceType: 'touch',
  });
  await expect
    .poll(() => page.evaluate(() => document.getElementById('gantt')!.scrollLeft))
    .toBeGreaterThan(0);
});
