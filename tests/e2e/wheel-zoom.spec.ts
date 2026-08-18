import { test, expect, type Page } from '@playwright/test';

// Real e2e coverage for mouse-wheel + Ctrl zoom (spec-wheel-zoom.md §10.3). Reuses the same
// fixtures as keyboard-nav.spec.ts: `examples/plain-html-demo/selection.html` and
// `/read-only.html` (readOnly: true, exposes `window.__gantt`) — no new fixture page.
//
// Modifier synthesis: Playwright's `page.mouse.wheel(deltaX, deltaY)` does not accept a
// `ctrlKey`/modifier option directly (spec-wheel-zoom.md §10.3, option (a)). We bracket the
// wheel dispatch with `page.keyboard.down('Control')` / `.up('Control')` — the "real"
// simulation, relying on the browser correctly reporting `ctrlKey: true` on the wheel event
// while the key is physically held. This is the same modifier the codebase uses for the
// `Control`/`Meta` cross-platform convention elsewhere (see keyboard-nav.spec.ts's own
// `modifier` constant) — but per spec-wheel-zoom.md §1, wheel-zoom is deliberately
// `ctrlKey`-only (NOT `ctrlKey || metaKey`), so we always hold literal `Control`, even on
// macOS/webkit, unlike the keyboard Ctrl/Cmd+Plus/Minus tests.
async function ctrlWheel(page: Page, deltaY: number): Promise<void> {
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

async function getViewMode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { getViewMode(): string } }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    return g.getViewMode();
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/selection.html');
});

test('Ctrl+wheel-up zooms in', async ({ page }) => {
  const chart = page.locator('svg.fg-timeline');
  await chart.hover();
  const before = await getViewMode(page);

  await ctrlWheel(page, -120);

  await expect.poll(() => getViewMode(page)).not.toBe(before);
});

test('Ctrl+wheel-down zooms out', async ({ page }) => {
  const chart = page.locator('svg.fg-timeline');
  await chart.hover();
  const before = await getViewMode(page);

  await ctrlWheel(page, 120);

  await expect.poll(() => getViewMode(page)).not.toBe(before);
});

test('plain wheel (no Ctrl) does not change getViewMode() and does not prevent normal scrolling', async ({
  page,
}) => {
  const chart = page.locator('svg.fg-timeline');
  await chart.hover();
  const before = await getViewMode(page);

  await page.mouse.wheel(0, 120);

  // View mode is unchanged — most important real-browser regression check for this feature.
  expect(await getViewMode(page)).toBe(before);
});

test('read-only chart: Ctrl+wheel still zooms', async ({ page }) => {
  await page.goto('/read-only.html');
  const chart = page.locator('svg.fg-timeline');
  await chart.hover();
  const before = await getViewMode(page);

  await ctrlWheel(page, -120);

  await expect.poll(() => getViewMode(page)).not.toBe(before);
});
