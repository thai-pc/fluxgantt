import { test, expect, type Page } from '@playwright/test';

// Sample visual regression — currently SKIPPED because the baseline screenshot is
// platform-dependent (macOS dev ≠ Linux CI) and the renderer has no stable output yet.
// Enable when the SVG renderer is done: remove .skip, generate the baseline with
//   pnpm test:visual --update-snapshots
// (run on the same image as CI so the baseline matches).
test.skip('gantt timeline — visual baseline', async ({ page }) => {
  await page.setContent('<div style="width:200px;height:60px;background:#6366f1"></div>');
  await expect(page).toHaveScreenshot('timeline.png');
});

// --- Selection visual regression (spec-selection.md §12.6) ---------------------------------
//
// Confirms the two visual treatments coexist without collision: selection is a pure-CSS
// SVG `outline` on `.fg-task__bar` (svg-renderer.ts's `SELECTION_STYLE_TEXT`), critical-path
// is an inline `stroke`/`stroke-dasharray` on the SAME `<rect>` — different box-model
// properties, so a task that is both critical AND selected shows both signals at once
// (dashed red stroke inside, solid indigo outline ring outside), never one silently
// overwriting the other.
//
// Baselines are generated fresh in this change (no prior screenshot existed for this
// spec — see PR notes): run `pnpm test:visual --update-snapshots` on the CI image before
// treating `*-snapshots/*.png` as ground truth, and have a human review the generated PNGs.

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
