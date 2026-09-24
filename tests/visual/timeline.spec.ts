import { test, expect, type Page } from '@playwright/test';
import { pinToday } from '../helpers/pin-today.js';

// REMOVED, not un-skipped: the original `test.skip('gantt timeline — visual baseline')` scaffold
// screenshotted a bare `<div style="background:#6366f1">` via `page.setContent` — it rendered no
// chart and asserted nothing about the renderer. Every test below is a real snapshot of a real
// mounted chart, which is what that placeholder was a stand-in for. Platform-dependence, the
// reason it was skipped, is handled properly instead: baselines are committed per platform
// (`-darwin.png` + `-linux.png`) and `ci.yml` runs this project on ubuntu.

// --- Selection visual regression (spec-selection.md §12.6) ---------------------------------
//
// Confirms the two visual treatments coexist without collision: selection is a pure-CSS
// SVG `outline` on `.fg-task__bar` (svg-renderer.ts's `SELECTION_STYLE_TEXT`), critical-path
// is an inline `stroke`/`stroke-dasharray` on the SAME `<rect>` — different box-model
// properties, so a task that is both critical AND selected shows both signals at once
// (dashed red stroke inside, solid indigo outline ring outside), never one silently
// overwriting the other.

async function callGantt<T>(page: Page, fn: (g: any) => T): Promise<T> {
  return page.evaluate((fnSource) => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- test-only bridge
    const f = new Function('g', `return (${fnSource})(g)`);
    return f((window as unknown as { __gantt: unknown }).__gantt);
  }, fn.toString());
}

test('a single selected task renders the outline ring', async ({ page }) => {
  await page.goto('/selection.html');
  await callGantt(page, (g) => g.select('sibling-a'));
  await expect(page.locator('.fg-task[data-task-id="sibling-a"]')).toHaveClass(/fg-task--selected/);

  const chart = page.locator('#gantt');
  await expect(chart).toHaveScreenshot('timeline-single-selected.png');
});

test('a task both critical and selected renders both indicators without collision', async ({
  page,
}) => {
  await page.goto('/');
  // The quick-start demo's design→build→review FS chain puts `build` on the critical path
  // (see smoke.spec.ts's own "marks the critical path" assertion).
  await callGantt(page, (g) => g.select('build'));
  const bar = page.locator('.fg-task[data-task-id="build"]');
  await expect(bar).toHaveClass(/fg-task--critical/);
  await expect(bar).toHaveClass(/fg-task--selected/);

  // The collision-avoidance guarantee itself (spec-selection.md §7.3): the critical
  // indicator's inline `stroke-dasharray` on `.fg-task__bar` must remain set — selection
  // never overwrites it, since selection is a separate `outline` property.
  const strokeDasharray = await bar
    .locator('.fg-task__bar')
    .evaluate((el) => (el as SVGElement).style.getPropertyValue('stroke-dasharray'));
  expect(strokeDasharray).not.toBe('');

  const chart = page.locator('#gantt');
  await expect(chart).toHaveScreenshot('timeline-critical-and-selected.png');
});

// --- Keyboard-nav focus-ring visual regression (spec-keyboard-nav.md §12.5) -----------------
//
// The focus ring is a separate `<rect class="fg-task__focus-ring">` sibling of the task bar
// (svg-renderer.ts's `FOCUS_STYLE_TEXT`), visible only while its ancestor `.fg-timeline__row`
// matches `:focus-visible` — distinct from both the selection `outline` (indigo, on
// `.fg-task__bar`) and the critical-path `stroke-dasharray` (red, inline on the bar). These
// snapshots lock in that the three signals compose without visually colliding.
//
// Baselines are generated fresh in this change: run `pnpm test:visual --update-snapshots` on
// the CI image before treating `*-snapshots/*.png` as ground truth, and have a human review
// the generated PNGs (see the file header note above).

async function focusFirstRow(page: Page): Promise<void> {
  await page.locator('svg.fg-timeline [tabindex="0"]').first().focus();
}

test('a focused-only (not selected, not critical) task renders the sky-blue focus ring', async ({
  page,
}) => {
  await page.goto('/selection.html');
  await focusFirstRow(page);

  const chart = page.locator('#gantt');
  await expect(chart).toHaveScreenshot('timeline-focused-only.png');
});

test('a focused AND selected task composes the focus ring with the selection outline, no collision', async ({
  page,
}) => {
  await page.goto('/selection.html');
  await focusFirstRow(page);
  await page.keyboard.press('Space'); // toggles selection on for the focused row

  const chart = page.locator('#gantt');
  await expect(chart).toHaveScreenshot('timeline-focused-and-selected.png');
});

test('a focused, selected, AND critical-path task composes all three indicators at once', async ({
  page,
}) => {
  await page.goto('/');
  // The quick-start demo's design→build→review FS chain puts `build` on the critical path.
  await callGantt(page, (g) => g.select('build'));

  // Tab to the grid then arrow to the `build` row to focus it (row order: design, build,
  // review, launch, docs-task — see main.ts).
  await page.locator('svg.fg-timeline [tabindex="0"]').first().focus();
  await page.keyboard.press('ArrowDown'); // design -> build

  const chart = page.locator('#gantt');
  await expect(chart).toHaveScreenshot('timeline-focused-critical-and-selected.png');
});

test('the focus ring is still visible under prefers-reduced-motion (no reliance on animation)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/selection.html');
  await focusFirstRow(page);

  const chart = page.locator('#gantt');
  await expect(chart).toHaveScreenshot('timeline-focused-reduced-motion.png');
});

// --- Progress fill visual regression (spec §5.4) --------------------------------------------
//
// The quick-start demo spans the whole range of the feature in one screenshot: `design` at
// progress 1 (fully filled), `build` at 0.6, `docs-task` at 0.2, `review` at 0 (no overlay
// element at all), and the `launch` milestone (exempt — a partial diamond would read as a
// different shape rather than a different value).

test('progress fills render at their authored fractions, with none on a milestone or at zero', async ({
  page,
}) => {
  await page.goto('/');

  // DOM state first, screenshot second: a PNG diff alone cannot distinguish "the fill is
  // absent" from "the fill is present but wrong", and these baselines are darwin-only (CI runs
  // the e2e project, not visual), so the assertions below are the portable half of this test.
  const fillRatio = async (taskId: string): Promise<number | null> =>
    page.locator(`.fg-task[data-task-id="${taskId}"]`).evaluate((group) => {
      const fill = group.querySelector('.fg-task__progress');
      if (!fill) return null;
      const bar = group.querySelector('.fg-task__bar')!;
      return Number(fill.getAttribute('width')) / Number(bar.getAttribute('width'));
    });

  expect(await fillRatio('design')).toBeCloseTo(1, 3);
  expect(await fillRatio('build')).toBeCloseTo(0.6, 3);
  expect(await fillRatio('docs-task')).toBeCloseTo(0.2, 3);
  expect(await fillRatio('review')).toBeNull(); // progress 0 → no element
  expect(await fillRatio('launch')).toBeNull(); // milestone → exempt

  // Resolved through the real CSS cascade, which jsdom cannot do — this is the only place the
  // `var(--fg-task-completed, …)` fallback is proven to actually paint the emerald token.
  const painted = await page
    .locator('.fg-task[data-task-id="build"] .fg-task__progress')
    .evaluate((el) => getComputedStyle(el).fill);
  expect(painted).toBe('rgb(16, 185, 129)');

  const chart = page.locator('#gantt');
  await expect(chart).toHaveScreenshot('timeline-progress-fill.png');
});

// --- Today marker visual regression (spec §9.1) ----------------------------------------
//
// `now` is pinned INSIDE the demo's 2026-08-03..08-12 range before `goto` — with the real
// clock the marker is correctly absent (today is outside every fixture's range), which is also
// why this change adds one new baseline and regenerates none of the existing ones.

test('the today marker draws a full-height red rule over the today column wash', async ({
  page,
}) => {
  await pinToday(page, '2026-08-07T12:00:00Z');
  await page.goto('/');

  // DOM state first, screenshot second — these baselines are darwin-only (CI runs the e2e
  // project, not visual), so the assertions below are the portable half of this test.
  const line = page.locator('#gantt .fg-timeline__today-line');
  await expect(line).toHaveCount(1);

  // Spans the whole chart, header band included.
  const { y1, y2, x } = await line.evaluate((el) => ({
    y1: Number(el.getAttribute('y1')),
    y2: Number(el.getAttribute('y2')),
    x: Number(el.getAttribute('x1')),
  }));
  expect(y1).toBe(0);
  expect(y2).toBe(Number(await page.locator('svg.fg-timeline').getAttribute('height')));
  expect(x).toBeGreaterThan(160); // past the label column, inside the timeline

  // Resolved through the real CSS cascade, which jsdom cannot do — the only place the
  // `var(--fg-task-critical, …)` fallback is proven to actually paint red.
  const painted = await line.evaluate((el) => getComputedStyle(el).stroke);
  expect(painted).toBe('rgb(239, 68, 68)');

  // The column wash and the line are different layers and must BOTH be visible (the explicit
  // decision behind this feature) — exactly one grid cell still carries the yellow
  // `--fg-grid-today` wash behind the red rule.
  const washed = await page
    .locator('#gantt .fg-timeline__grid-cell')
    .evaluateAll((els) => els.filter((el) => getComputedStyle(el).fill === 'rgb(254, 243, 199)').length);
  expect(washed).toBe(1);

  const chart = page.locator('#gantt');
  await expect(chart).toHaveScreenshot('timeline-today-marker.png');
});

// --- Dark mode visual regression (spec §7.6) -------------------------------------------------
//
// `withTheme` adds NO renderer code: it redefines the `--fg-*` custom properties on the mount
// container and lets the browser re-resolve the `var()` declarations the SVG already writes
// inline. That is a claim about the whole painted surface at once, which is exactly what a
// screenshot is good for — the DOM assertions below are the portable half, and the baseline is
// the one that would catch a token the renderer reads but the dark table forgot.
//
// This adds ONE new baseline and regenerates none: the existing ones all render in light mode,
// which is still what the demo loads with (`'auto'`, under a light-preferring test browser).

test('a dark-themed chart repaints ground, grid, header and text', async ({ page }) => {
  await page.goto('/');

  const button = page.locator('#theme-toggle');
  await button.click(); // auto -> light
  await button.click(); // light -> dark
  await expect(button).toHaveText('Theme: dark');

  const chart = page.locator('#gantt');
  // DOM state first, screenshot second (these baselines are darwin-only; CI runs e2e, not
  // visual). `rgb(10, 10, 10)` === the `--fg-bg` dark value, resolved through the cascade.
  await expect(chart).toHaveCSS('background-color', 'rgb(10, 10, 10)');
  await expect(chart).toHaveScreenshot('timeline-dark.png');
});
