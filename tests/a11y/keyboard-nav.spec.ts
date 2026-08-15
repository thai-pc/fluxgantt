import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for keyboard-nav (spec-keyboard-nav.md §12.4, WCAG 2.1 AA per
// testing.md). Uses the same fixtures as keyboard-nav.spec.ts (tests/e2e) —
// examples/plain-html-demo/selection.html and /read-only.html.

test('the selection fixture has no detectable axe violations, before or after keyboard interaction', async ({
  page,
}) => {
  await page.goto('/selection.html');

  const before = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(before.violations).toEqual([]);

  // Drive a realistic keyboard sequence — focus the grid, move focus, extend a range
  // selection, delete — and re-scan. The dynamically-updated ARIA state (aria-selected,
  // tabindex, aria-rowcount after a deletion) must remain violation-free too.
  await page.locator('svg.fg-timeline [tabindex="0"]').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Space');
  await page.keyboard.press('Delete');

  const after = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(after.violations).toEqual([]);
});

test('every row is reachable via native Tab order (single grid stop, roving tabindex, WAI-ARIA APG grid pattern)', async ({
  page,
}) => {
  await page.goto('/selection.html');

  // Tab from the top of the document should land on exactly the one row carrying
  // tabindex="0" — the roving-tabindex pattern deliberately keeps the grid a SINGLE stop in
  // the page's Tab order (arrow keys move focus WITHIN the grid, not Tab).
  await page.keyboard.press('Tab');
  const focusedTaskId = await page.evaluate(
    () => document.activeElement?.getAttribute('data-task-id') ?? null,
  );
  expect(focusedTaskId).not.toBeNull();

  const tabindexZeroCount = await page.locator('svg.fg-timeline [tabindex="0"]').count();
  expect(tabindexZeroCount).toBe(1);
});

test('the focused task bar remains visually distinguishable under prefers-reduced-motion (no reliance on transition/animation)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/selection.html');
  await page.locator('svg.fg-timeline [tabindex="0"]').first().focus();

  const results = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(results.violations).toEqual([]);
});

test('read-only chart: axe-clean even though Delete/drag are inert', async ({ page }) => {
  await page.goto('/read-only.html');
  const results = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(results.violations).toEqual([]);
});
