import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for the host recipes built on `withEditHooks()` (WCAG 2.1 AA per
// testing.md). Fixture: `/edit-hooks.html` — a context menu (role=menu) and a rename dialog
// (role=dialog) that the PAGE builds from the library's events, so these scans cover the
// documented recipe (what hosts will copy), plus the chart itself with the hooks composed.

async function activeDescription(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return '<body>';
    return `${el.getAttribute('role') ?? el.tagName.toLowerCase()}:${el.getAttribute('data-task-id') ?? el.textContent?.slice(0, 20) ?? ''}`;
  });
}

async function focusRow(page: Page, id: string): Promise<void> {
  await page.evaluate((i) => document.querySelector<HTMLElement>(`.fg-timeline__row[data-task-id="${i}"]`)!.focus(), id);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/edit-hooks.html');
  await expect(page.locator('svg.fg-timeline')).toBeVisible();
});

test('the chart with edit hooks composed has no axe violations', async ({ page }) => {
  const results = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(results.violations).toEqual([]);
});

test('no axe violations with the context menu open', async ({ page }) => {
  await focusRow(page, 'a');
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Task actions' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('no axe violations with the rename dialog open', async ({ page }) => {
  await focusRow(page, 'a');
  await page.keyboard.press('F2');
  await expect(page.getByRole('dialog', { name: 'Rename task' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('menu: role, labelled items, arrow keys cycle, Escape closes and focus returns to the row', async ({ page }) => {
  await focusRow(page, 'a');
  await page.keyboard.press('ContextMenu');
  const menu = page.getByRole('menu', { name: 'Task actions' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Rename', 'Delete']);
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(await activeDescription(page)).toBe('row:a');
});

test('dialog: labelled by its title, input has an accessible name, Tab is trapped, Escape restores focus', async ({ page }) => {
  await focusRow(page, 'a');
  await page.keyboard.press('F2');
  const dlg = page.getByRole('dialog', { name: 'Rename task' });
  await expect(dlg).toHaveAttribute('aria-modal', 'true');
  await expect(dlg.getByRole('textbox', { name: 'Task name' })).toBeFocused();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(await activeDescription(page)).toBe('row:a');
});

test('keyboard-only flow end to end: focus never falls to <body>', async ({ page }) => {
  // Reach row `c` the way a keyboard user does: Tab into the grid, then arrow.
  await page.keyboard.press('Tab');
  expect(await activeDescription(page)).not.toBe('<body>');
  await focusRow(page, 'sum');
  const trail: string[] = [];
  const press = async (key: string): Promise<void> => {
    await page.keyboard.press(key);
    trail.push(`${key} -> ${await activeDescription(page)}`);
  };
  await press('ArrowDown'); // a
  await press('ArrowDown'); // b
  await press('ArrowDown'); // c
  await press('Shift+F10'); // menu
  await press('ArrowDown'); // Delete
  await press('ArrowUp'); // Rename
  await press('Enter'); // dialog
  await page.getByLabel('Task name').fill('Charlie (kbd)');
  await press('Enter'); // commit, focus back
  await press('F2'); // dialog again
  await press('Escape'); // cancel, focus back
  await press('ArrowDown'); // d
  expect(trail.filter((t) => t.endsWith('<body>')), trail.join('\n')).toEqual([]);
  expect(await page.evaluate(() => (window as never as { __gantt: { getTask(id: string): { name: string } } }).__gantt.getTask('c').name)).toBe('Charlie (kbd)');
  // The row that regained focus after the dialog is `c`.
  expect(trail[7]).toBe('Enter -> row:c');
});

test('the focus ring is visible on the row after the host menu and dialog hand focus back', async ({ page }) => {
  const ringStroke = () =>
    page.evaluate(() => {
      const ring = document.querySelector('.fg-timeline__row[data-task-id="c"] .fg-task__focus-ring');
      return ring ? getComputedStyle(ring).stroke : 'missing';
    });
  await focusRow(page, 'sum');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  expect(await ringStroke()).not.toMatch(/none|missing/);
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Escape');
  // Focus restored by the host recipe with `.focus()` after a keyboard open: :focus-visible holds.
  expect(await ringStroke()).not.toMatch(/none|missing/);
});
