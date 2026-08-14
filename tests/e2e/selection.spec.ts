import { test, expect, type Page } from '@playwright/test';

// Real e2e coverage for click-select (spec-selection.md §12.5). Unlike drag-move/drag-resize/
// drag-create-dependency, click-select needs no pixel-geometry math — `locator.click()` on
// `[data-task-id="..."]` is sufficient — so these are real, passing tests, not `test.fixme`.
//
// Fixture: examples/plain-html-demo/selection.html (src/selection.ts) — a 2-level hierarchy
// (`phase-1` summary + 2 children `phase-1-task-a`/`phase-1-task-b`) followed by 3 flat
// sibling tasks (`sibling-a`/`sibling-b`/`sibling-c`), rows 0-5 in that order. Exposes
// `window.__gantt` (dev-only), same harness as the other specs.

function taskBar(page: Page, taskId: string) {
  return page.locator(`.fg-task[data-task-id="${taskId}"]`);
}

async function getSelection(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { getSelection(): string[] } }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    return g.getSelection();
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/selection.html');
});

test('clicking a task bar selects it', async ({ page }) => {
  await taskBar(page, 'sibling-a').click();

  await expect(taskBar(page, 'sibling-a')).toHaveClass(/fg-task--selected/);
  expect(await getSelection(page)).toEqual(['sibling-a']);
});

test('clicking a second task bar (no modifier) replaces the selection', async ({ page }) => {
  await taskBar(page, 'sibling-a').click();
  await taskBar(page, 'sibling-b').click();

  await expect(taskBar(page, 'sibling-a')).not.toHaveClass(/fg-task--selected/);
  await expect(taskBar(page, 'sibling-b')).toHaveClass(/fg-task--selected/);
  expect(await getSelection(page)).toEqual(['sibling-b']);
});

test('Ctrl/Cmd+click a second task adds it to the selection', async ({ page }) => {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

  await taskBar(page, 'sibling-a').click();
  await taskBar(page, 'sibling-b').click({ modifiers: [modifier] });

  await expect(taskBar(page, 'sibling-a')).toHaveClass(/fg-task--selected/);
  await expect(taskBar(page, 'sibling-b')).toHaveClass(/fg-task--selected/);
  const selection = await getSelection(page);
  expect(selection).toContain('sibling-a');
  expect(selection).toContain('sibling-b');
  expect(selection).toHaveLength(2);
});

test('Shift+click a third task selects the contiguous row range', async ({ page }) => {
  // Anchor on sibling-a (row 3), Shift+click sibling-c (row 5) → sibling-a, sibling-b,
  // sibling-c (rows 3-5 inclusive) all become selected.
  await taskBar(page, 'sibling-a').click();
  await taskBar(page, 'sibling-c').click({ modifiers: ['Shift'] });

  await expect(taskBar(page, 'sibling-a')).toHaveClass(/fg-task--selected/);
  await expect(taskBar(page, 'sibling-b')).toHaveClass(/fg-task--selected/);
  await expect(taskBar(page, 'sibling-c')).toHaveClass(/fg-task--selected/);
  const selection = await getSelection(page);
  expect(new Set(selection)).toEqual(new Set(['sibling-a', 'sibling-b', 'sibling-c']));
});

test('clicking empty canvas area clears the selection', async ({ page }) => {
  await taskBar(page, 'sibling-a').click();
  await expect(taskBar(page, 'sibling-a')).toHaveClass(/fg-task--selected/);

  // Click on the SVG root itself (outside any task row) — grid/margin area.
  await page.locator('svg.fg-timeline').click({ position: { x: 5, y: 5 } });

  await expect(page.locator('.fg-task--selected')).toHaveCount(0);
  expect(await getSelection(page)).toEqual([]);
});

test('clicking a parent task selects it and all its visible children', async ({ page }) => {
  await taskBar(page, 'phase-1').click();

  await expect(taskBar(page, 'phase-1')).toHaveClass(/fg-task--selected/);
  await expect(taskBar(page, 'phase-1-task-a')).toHaveClass(/fg-task--selected/);
  await expect(taskBar(page, 'phase-1-task-b')).toHaveClass(/fg-task--selected/);
  const selection = await getSelection(page);
  expect(new Set(selection)).toEqual(
    new Set(['phase-1', 'phase-1-task-a', 'phase-1-task-b']),
  );
});
