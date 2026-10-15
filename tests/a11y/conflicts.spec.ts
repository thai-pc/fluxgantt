import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DEFAULT_PIXELS_PER_DAY, centreOf, mouseDrag } from '../helpers/drag.js';

// WCAG 2.1 AA for the conflicts fixture (`conflicts.html`): the status region + list the demo
// builds from `conflict:detected`. The library itself renders nothing for conflicts (v1, no render
// hook), so this covers what a host would build: a polite live region carrying the count in words,
// and a text list (not color-only).

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/conflicts.html${query}`);
  await expect(page.locator('svg.fg-timeline')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean((window as never as { __gantt?: unknown }).__gantt))).toBe(true);
}

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test('no axe violations with and without conflicts', async ({ page }) => {
  await open(page, '?mode=manual');
  await expectNoViolations(page);

  await mouseDrag(
    page,
    await centreOf(page.locator('[data-task-id="b"] .fg-task__bar')),
    -DEFAULT_PIXELS_PER_DAY * 2,
  );
  await expect(page.locator('#conflict-list li')).toHaveCount(1);
  await expectNoViolations(page);
});

test('the status is a polite, atomic live region and the conflict is conveyed in text, not color', async ({ page }) => {
  await open(page, '?mode=manual');
  const status = page.locator('#conflict-status');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveAttribute('aria-atomic', 'true');
  await expect(status).toHaveText('No schedule conflicts');

  await mouseDrag(
    page,
    await centreOf(page.locator('[data-task-id="b"] .fg-task__bar')),
    -DEFAULT_PIXELS_PER_DAY * 2,
  );

  // The live region's text itself changes (that is what AT announces) and names the count; the list
  // names kind + ids as words. Neither relies on color, and the list is labelled.
  await expect(status).toHaveText('1 schedule conflict');
  await expect(page.locator('#conflict-list')).toHaveAttribute('aria-label', 'Schedule conflicts');
  await expect(page.locator('#conflict-list li')).toHaveText(/Dependency violation: b starts before a allows \(FS\)/);
  // The live region is not a focus stop and the update did not steal focus from the page.
  expect(await page.evaluate(() => document.activeElement?.closest('#conflict-status') ?? null)).toBeNull();
});

test('a conflicted start state is reported in text on load and passes axe', async ({ page }) => {
  await open(page, '?mode=manual&seed=conflict');
  await expect(page.locator('#conflict-status')).toHaveText('1 schedule conflict');
  await expectNoViolations(page);
});
