import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for `withGrid()` on the CANVAS renderer (WCAG 2.1 AA per testing.md;
// spec-grid-columns.md 9.1, 13.5; PR G2). The pixels on the label canvas are aria-hidden; the hidden a11y
// layer holds the REAL treegrid: a header row of columnheaders, gridcells with aria-colindex, aria-colcount
// and aria-rowcount. Fixture: `examples/plain-html-demo/grid.html?rows=2100` (Canvas through the real mount()).

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/grid.html?rows=2100${query ? `&${query}` : ''}`);
  await expect(page.locator('#gantt canvas.fg-timeline-canvas-labels')).toBeAttached({ timeout: 30_000 });
  await page.waitForFunction(() => '__gantt' in window);
  // the painter chunk loads after the Canvas mount; the colcount marks the grid as installed
  await page.waitForFunction(() => document.querySelector('#gantt .fg-timeline-a11y-layer')?.hasAttribute('aria-colcount'));
}

const scan = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).include('#gantt').analyze();
const LAYER = '#gantt .fg-timeline-a11y-layer';

for (const [label, query] of [
  ['LTR', ''],
  ['RTL', 'rtl=1'],
  ['dark', 'theme=dark'],
  ['truncated text and an extra custom column', 'long=1&cols=6'],
  ['name column only', 'cols=1'],
  ['ten columns', 'cols=10'],
] as const) {
  test(`no axe violations on Canvas: ${label}`, async ({ page }) => {
    await open(page, query);
    expect((await scan(page)).violations).toEqual([]);
  });
}

test('no axe violations on Canvas with a row selected and keyboard focus inside the grid', async ({ page }) => {
  await open(page);
  await page.locator(`${LAYER} [data-task-id="design"][role=row]`).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  expect((await scan(page)).violations).toEqual([]);
});

test('the Canvas chart exposes a treegrid with a column count, a header row and indexed cells', async ({ page }) => {
  await open(page);
  const layer = page.locator(LAYER);
  await expect(layer).toHaveAttribute('role', 'treegrid');
  await expect(layer).toHaveAttribute('aria-colcount', '5');
  await expect(layer).toHaveAttribute('aria-rowcount', '2101'); // 2100 tasks + the header row
  const headers = layer.locator('[role=row][aria-rowindex="1"] [role=columnheader]');
  await expect(headers).toHaveCount(5);
  await expect(headers.nth(2)).toHaveAttribute('aria-label', 'End');
  const row = layer.locator('[data-task-id="design"][role=row]');
  await expect(row).toHaveAttribute('aria-rowindex', '4');
  const cells = row.locator(':scope > [role=gridcell], :scope > .fg-timeline-canvas__row-cell');
  expect(await cells.evaluateAll((els) => els.map((e) => e.getAttribute('aria-colindex')))).toEqual(['1', '2', '3', '4', '5']);
  expect(await cells.evaluateAll((els) => els.slice(1).map((e) => e.textContent))).toEqual(['Mar 16, 2026', 'Apr 3, 2026', '14d', '70%']);
});

test('the label canvas is aria-hidden and the layer is the only exposed grid', async ({ page }) => {
  await open(page);
  await expect(page.locator('#gantt canvas.fg-timeline-canvas-labels')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#gantt canvas.fg-timeline-canvas')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.locator('#gantt [role=treegrid], #gantt [role=grid]').count()).toBe(1);
});

test('the real cells are exposed to the accessibility tree', async ({ page }) => {
  await open(page);
  const snapshot = await page.locator(LAYER).ariaSnapshot();
  for (const s of ['columnheader "Start"', 'columnheader "Progress"', 'gridcell "Mar 16, 2026"', 'gridcell "70%"']) expect(snapshot).toContain(s);
});

test('keyboard behaviour is unchanged by the grid on Canvas: Tab leaves in one stop, arrows move rows', async ({ page }) => {
  await open(page);
  await page.locator(`${LAYER} [data-row-index]`).first().focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-task-id'))).toBe('req');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('#gantt') === null)).toBe(true);
});

test('a truncated, critical, selected row is still announced as critical path and selected (CDP accessibility tree)', async ({ page }) => {
  await open(page, 'long=1&deps=1');
  // select the `plan` row by clicking its Start cell on the canvas
  const box = await page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    const r = c.getBoundingClientRect();
    return { left: r.left + c.clientLeft, top: r.top + c.clientTop };
  });
  await page.mouse.click(box.left + 280, box.top + 32 + 16);
  // selecting a summary selects its descendants too
  await expect.poll(() => page.evaluate(() => (window as unknown as { __gantt: { getSelection(): string[] } }).__gantt.getSelection())).toContain('plan');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const nameOf = async (selector: string): Promise<string> => {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    return String(nodes[0]?.name?.value ?? '');
  };
  const rowName = await nameOf(`${LAYER} [data-task-id="plan"][role=row]`);
  expect(rowName).toContain('critical path');
  expect(rowName).toContain('selected');
  expect(rowName).toContain('Project plan: an unusually long');
  // the row's name cell carries no aria-label that would replace the bar's description (G1 review, H1)
  await expect(page.locator(`${LAYER} [data-task-id="plan"][role=row] .fg-timeline-canvas__row-cell`)).not.toHaveAttribute('aria-label', /.*/);
  // and the painted name really is cut (the layer keeps the full text)
  const full = await page.locator(`${LAYER} [data-task-id="plan"][role=row] .fg-timeline-canvas__row-label`).textContent();
  expect(full).toContain('has to be cut with an ellipsis');
});
