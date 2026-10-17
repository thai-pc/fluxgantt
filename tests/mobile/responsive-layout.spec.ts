import { test, expect } from '@playwright/test';

// Layout + target-size coverage for `withResponsive()` (spec-responsive-mobile.md §C), under the
// `mobile` project only (`devices['Pixel 5']`, 393x851, coarse pointer).
//
// The target-size bar asserted here is WCAG 2.2 SC 2.5.8 Target Size (MINIMUM) = 24x24 CSS px,
// not SC 2.5.5's 44x44 — 2.5.5 is Level AAA and this repo targets AA (`.claude/rules/testing.md`).
// These assertions live in the `mobile` project rather than `tests/a11y/` because target size is
// pointer- and viewport-dependent: the desktop chart is conformant at an 8px resize edge zone and
// a phone is not, so a desktop-project assertion would be measuring the wrong thing.
const MIN_TARGET_PX = 24;
const DEFAULT_LABEL_COLUMN_WIDTH = 160;
const MIN_LABEL_COLUMN_WIDTH = 96; // `ResponsiveOptions.minLabelColumnWidth` default

/** The label-column width the renderer actually PAINTED, read off the divider line's x, rather
 *  than from the mixin's own accessor — so this cannot pass on a value that was computed and
 *  then never reached the SVG. */
async function paintedLabelColumnWidth(page: import('@playwright/test').Page): Promise<number> {
  // The divider is pixel-snapped half a pixel inside the column (offset - 0.5).
  return (
    Number(await page.locator('#gantt svg.fg-timeline .fg-timeline__label-divider').getAttribute('x1')) + 0.5
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/responsive.html');
  await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
});

test('the label column narrows below the 160px default but stays at or above its 96px floor', async ({
  page,
}) => {
  await expect.poll(() => paintedLabelColumnWidth(page)).toBeLessThan(DEFAULT_LABEL_COLUMN_WIDTH);
  expect(await paintedLabelColumnWidth(page)).toBeGreaterThanOrEqual(MIN_LABEL_COLUMN_WIDTH);
  // And the mixin's accessor agrees with what was painted — one number, two readers.
  expect(
    await page.evaluate(
      () =>
        (window as never as { __gantt: { getLabelColumnWidth(): number } }).__gantt
          .getLabelColumnWidth(),
    ),
  ).toBe(await paintedLabelColumnWidth(page));
});

test("the chart switches to 'touch' density, giving rows taller than the 24px minimum", async ({
  page,
}) => {
  const bar = (await page.locator('.fg-task__bar').first().boundingBox())!;
  // `ROW_HEIGHT.touch` is 48 and the bar is a ratio of it, so the bar alone clears 24px — which
  // is the assertion that matters, since the bar is the drag-move target.
  expect(bar.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
});

test('every task bar meets the 24x24 CSS px minimum target size (WCAG 2.2 SC 2.5.8)', async ({
  page,
}) => {
  const bars = page.locator('.fg-task__bar');
  const count = await bars.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = (await bars.nth(i).boundingBox())!;
    expect(box.height, `bar ${i} height`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    // Width is data-dependent (a 1-day task at a wide view mode is genuinely narrow), so the
    // milestone diamond and short bars are covered by the row-height check above rather than by
    // asserting a width the dataset does not control. The fixture's shortest real bar spans ~3
    // weeks at 'week' view, comfortably past 24px.
    expect(box.width, `bar ${i} width`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  }
});

test('link handles are enlarged to a 24px diameter under a coarse pointer', async ({ page }) => {
  // `@media (hover: none)` already reveals the handles unconditionally on touch, so no hover
  // synthesis is needed to measure them.
  const handle = page.locator('.fg-task__link-handle').first();
  const box = (await handle.boundingBox())!;
  // `--fg-link-handle-radius: 12px` from the mixin's injected stylesheet → diameter 24. The
  // default 4px radius would give 8, which is what this guards against regressing to.
  expect(box.width).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
});

test('rotating to landscape re-lays-out: the label column widens with the viewport', async ({
  page,
}) => {
  const portraitWidth = await paintedLabelColumnWidth(page);
  await page.setViewportSize({ width: 851, height: 393 });
  // The clamp is `min(160, max(96, containerWidth * 0.4))`, so 393px portrait sits below the
  // 160px ceiling while 851px landscape is pinned at it — the widening is the observable proof
  // the `ResizeObserver` path ran.
  await expect.poll(() => paintedLabelColumnWidth(page)).toBeGreaterThan(portraitWidth);
  expect(await paintedLabelColumnWidth(page)).toBe(DEFAULT_LABEL_COLUMN_WIDTH);
});

// --- withViewport x withResponsive (spec-viewport-api.md §4.4, §9.4 item 8) ---------------------
// `responsive.ts` composes `withViewport`. `?density=compact` calls the public `setDensity()` BEFORE
// `mount()`; that pins density, so `withResponsive` must not replace it with `'touch'`.
// The default page (no param) is covered by the 'touch' density test above.

type ViewportGantt = {
  scrollToTask(id: string, o?: Record<string, unknown>): boolean;
  scrollToDate(d: string, o?: Record<string, unknown>): boolean;
  setDensity(d: string): void;
};

const rowPitch = async (page: import('@playwright/test').Page): Promise<number> => {
  const a = (await page.locator('.fg-timeline__row[data-row-index="0"]').boundingBox())!;
  const b = (await page.locator('.fg-timeline__row[data-row-index="1"]').boundingBox())!;
  return Math.round(b.y - a.y);
};

test.describe('explicit density pinned over the coarse-pointer default', () => {
  test('a pre-mount setDensity("compact") is not overridden by withResponsive, even across a rotation', async ({
    page,
  }) => {
    await page.goto('/responsive.html?density=compact');
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
    expect(await rowPitch(page)).toBe(24);

    // A resize/orientation change re-runs withResponsive's arbitration (ResizeObserver); the label
    // column still adapts but density stays pinned.
    const before = await paintedLabelColumnWidth(page);
    await page.setViewportSize({ width: 851, height: 393 });
    await expect.poll(() => paintedLabelColumnWidth(page)).toBeGreaterThan(before);
    expect(await rowPitch(page)).toBe(24);
    await page.setViewportSize({ width: 393, height: 851 });
    await expect.poll(() => paintedLabelColumnWidth(page)).toBe(before);
    expect(await rowPitch(page)).toBe(24);
  });

  test('a post-mount setDensity pins too: the touch default no longer applies afterwards', async ({
    page,
  }) => {
    await page.goto('/responsive.html');
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
    expect(await rowPitch(page)).toBe(48); // 'touch' default under a coarse pointer
    await page.evaluate(() => (window as unknown as { __gantt: ViewportGantt }).__gantt.setDensity('comfortable'));
    expect(await rowPitch(page)).toBe(40);
    const before = await paintedLabelColumnWidth(page);
    await page.setViewportSize({ width: 851, height: 393 });
    await expect.poll(() => paintedLabelColumnWidth(page)).toBeGreaterThan(before);
    expect(await rowPitch(page)).toBe(40);
  });
});

test.describe('scroll methods honour the narrowed label column', () => {
  test('scrollToDate(center) lands the date mid-viewport using the narrowed label width, not 160', async ({
    page,
  }) => {
    await page.goto('/responsive.html');
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
    const labelW = await paintedLabelColumnWidth(page);
    expect(labelW).toBeLessThan(DEFAULT_LABEL_COLUMN_WIDTH);

    // 'test' starts 2026-05-04 — its bar's left edge is exactly the date's x.
    await page.evaluate(() =>
      (window as unknown as { __gantt: ViewportGantt }).__gantt.scrollToDate('2026-05-04'),
    );
    const c = (await page.locator('#gantt').boundingBox())!;
    const bar = (await page.locator('.fg-task[data-task-id="test"] .fg-task__bar').boundingBox())!;
    // With the stale 160px constant the bar would sit (160 - labelW) px off centre.
    // The column is pinned, so the free area (and its middle) starts right of it.
    const drift = Math.abs(bar.x - (c.x + labelW + (c.width - labelW) / 2));
    expect(drift).toBeLessThanOrEqual(2);
    expect(160 - labelW).toBeGreaterThan(2); // the assertion above is able to detect the stale constant
  });

  test("scrollToTask('launch') brings the far-right milestone's row into the viewport and centres its point inside", async ({
    page,
  }) => {
    await page.goto('/responsive.html');
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
    expect(
      await page.evaluate(() =>
        (window as unknown as { __gantt: ViewportGantt }).__gantt.scrollToTask('launch'),
      ),
    ).toBe(true);
    const c = (await page.locator('#gantt').boundingBox())!;
    const shape = (await page.locator('.fg-task[data-task-id="launch"] .fg-task__bar').boundingBox())!;
    const cx = shape.x + shape.width / 2;
    // 'nearest' puts a zero-width span's point on the edge: allow sub-pixel rounding.
    expect(cx).toBeGreaterThanOrEqual(c.x - 1);
    expect(cx).toBeLessThanOrEqual(c.x + c.width + 1);
  });

  test("scrollToTask('launch') shows the whole milestone diamond, not half of it", async ({
    page,
  }) => {
    await page.goto('/responsive.html');
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
    await page.evaluate(() =>
      (window as unknown as { __gantt: ViewportGantt }).__gantt.scrollToTask('launch'),
    );
    const c = (await page.locator('#gantt').boundingBox())!;
    const shape = (await page.locator('.fg-task[data-task-id="launch"] .fg-task__bar').boundingBox())!;
    expect(shape.x).toBeGreaterThanOrEqual(c.x - 1);
    expect(shape.x + shape.width).toBeLessThanOrEqual(c.x + c.width + 1);
  });
});
