import { test, expect, type Page, type Locator } from '@playwright/test';

// Real e2e coverage for keyboard navigation (spec-keyboard-nav.md §12.3). Reuses the same
// fixtures as selection.spec.ts: `examples/plain-html-demo/selection.html` (2-level hierarchy
// `phase-1` + 2 children, followed by 3 flat siblings `sibling-a`/`sibling-b`/`sibling-c`, rows
// 0-5) and `/read-only.html` (readOnly: true, exposes `window.__gantt`).

function row(page: Page, taskId: string): Locator {
  return page.locator(`.fg-timeline__row[data-task-id="${taskId}"]`);
}

async function getSelection(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { getSelection(): string[] } }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    return g.getSelection();
  });
}

async function focusFirstRow(page: Page): Promise<void> {
  // Roving tabindex: exactly one row has tabindex="0" initially (the first row, no selection
  // yet) — Tab from the document body lands there directly.
  await page.locator('svg.fg-timeline [tabindex="0"]').first().focus();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/selection.html');
});

test('the grid root carries role="grid" and exactly one row has tabindex="0"', async ({ page }) => {
  await expect(page.locator('svg[role="grid"]')).toBeVisible();
  await expect(page.locator('svg.fg-timeline [tabindex="0"]')).toHaveCount(1);
});

test('ArrowDown moves focus to the next row and replaces the selection', async ({ page }) => {
  await focusFirstRow(page);
  await page.keyboard.press('ArrowDown');

  await expect(row(page, 'phase-1-task-a')).toHaveAttribute('tabindex', '0');
  await expect(row(page, 'phase-1-task-a')).toHaveAttribute('aria-selected', 'true');
  expect(await getSelection(page)).toEqual(['phase-1-task-a']);
});

test('ArrowUp at the first row does not move and does not throw', async ({ page }) => {
  await focusFirstRow(page);
  await page.keyboard.press('ArrowUp');
  await expect(row(page, 'phase-1')).toHaveAttribute('tabindex', '0');
});

test('Shift+ArrowDown extends a contiguous range selection', async ({ page }) => {
  // Navigate down to sibling-a first (row 3), then Shift+ArrowDown twice to select
  // sibling-a, sibling-b, sibling-c.
  await focusFirstRow(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); // phase-1 -> ... -> sibling-a
  await expect(row(page, 'sibling-a')).toHaveAttribute('tabindex', '0');

  await page.keyboard.press('Shift+ArrowDown'); // -> sibling-b
  await page.keyboard.press('Shift+ArrowDown'); // -> sibling-c

  const selection = await getSelection(page);
  expect(new Set(selection)).toEqual(new Set(['sibling-a', 'sibling-b', 'sibling-c']));
});

test('Space toggles the focused row selection', async ({ page }) => {
  await focusFirstRow(page);
  await page.keyboard.press('Space');
  expect(await getSelection(page)).toContain('phase-1');

  await page.keyboard.press('Space');
  expect(await getSelection(page)).not.toContain('phase-1');
});

test('Delete removes the selected task', async ({ page }) => {
  await focusFirstRow(page);
  // ArrowDown already replaces the selection with the newly focused row (select-follows-focus),
  // so sibling-a is selected as soon as it is reached — no extra Space needed.
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); // -> sibling-a, selected
  expect(await getSelection(page)).toEqual(['sibling-a']);

  await page.keyboard.press('Delete');

  await expect(row(page, 'sibling-a')).toHaveCount(0);
});

test('read-only chart: Delete is a no-op, ArrowDown/Space still navigate', async ({ page }) => {
  await page.goto('/read-only.html');
  await focusFirstRow(page);
  await page.keyboard.press('ArrowDown');
  const selectionAfterMove = await getSelection(page);
  expect(selectionAfterMove.length).toBe(1);

  await page.keyboard.press('Space');
  const selectionAfterToggle = await getSelection(page);
  expect(selectionAfterToggle.length).toBe(0);

  await page.keyboard.press('Space'); // reselect
  const beforeDelete = await page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { getTasks(): unknown[] } }).__gantt;
    return g ? g.getTasks().length : -1;
  });
  await page.keyboard.press('Delete');
  const afterDelete = await page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { getTasks(): unknown[] } }).__gantt;
    return g ? g.getTasks().length : -1;
  });
  expect(afterDelete).toBe(beforeDelete);
});
