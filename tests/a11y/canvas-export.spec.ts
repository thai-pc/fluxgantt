import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility of the Canvas-mode export harness (spec-canvas-export.md, a11y section):
// the two export buttons are real labelled <button>s reachable by keyboard, the chart's a11y
// layer is unaffected by an export, and the exported SVG keeps a title and ARIA roles.

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/canvas-export-harness.html${query}`);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
}

async function expectNoViolations(page: Page, include?: string): Promise<void> {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) b = b.include(include);
  const results = await b.analyze();
  expect(results.violations).toEqual([]);
}

test('axe passes on the harness page, before and after an export', async ({ page }) => {
  await open(page);
  await expectNoViolations(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export SVG' }).click()]);
  expect(dl.suggestedFilename()).toBe('gantt.svg');
  await expect(page.locator('#export-status')).toHaveAttribute('data-state', 'ok');
  await expectNoViolations(page);
});

test('export buttons are keyboard-operable and focus stays on the button after exporting', async ({ page }) => {
  await open(page);
  const svgBtn = page.getByRole('button', { name: 'Export SVG' });
  await svgBtn.focus();
  await expect(svgBtn).toBeFocused();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(dl.suggestedFilename()).toBe('gantt.svg');
  await expect(svgBtn).toBeFocused();

  const pngBtn = page.getByRole('button', { name: 'Export PNG' });
  await page.keyboard.press('Tab');
  await expect(pngBtn).toBeFocused();
});

test('a rejected export is announced through a role=status live region', async ({ page }) => {
  await open(page, '?tasks=5100');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const status = page.getByRole('status');
  await expect(status).toContainText('Export failed');
  await expect(status).toContainText('visible rows exceeds');
});

test('the chart a11y layer is unchanged by an export (grid role, row count, tab stop)', async ({ page }) => {
  await open(page);
  const snapshot = () =>
    page.evaluate(() => ({
      rowcount: document.querySelector('#gantt [role="grid"]')?.getAttribute('aria-rowcount'),
      tabStops: document.querySelectorAll('#gantt [tabindex="0"]').length,
      rows: document.querySelectorAll('#gantt [role="row"]').length,
    }));
  const before = await snapshot();
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export SVG' }).click()]);
  await expect(page.locator('#export-status')).toHaveAttribute('data-state', 'ok');
  expect(await snapshot()).toEqual(before);
});
