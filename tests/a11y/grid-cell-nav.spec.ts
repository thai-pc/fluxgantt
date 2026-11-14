import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for the grid keyboard model (spec-grid-columns.md 9; PR G4), SVG and Canvas:
// axe with a cell focused (the cell is a script-focusable gridcell inside the chart), and the Chromium
// accessibility tree: a focused cell is announced as a gridcell of a named row, with its column index matching
// a named columnheader. Fixture: `grid.html` (`?rows=2100` mounts the Canvas renderer).

async function open(page: Page, query: string, canvas: boolean): Promise<void> {
  await page.goto(`/grid.html?${canvas ? 'rows=2100&' : ''}${query}`);
  await page.waitForFunction(() => '__gantt' in window);
  if (canvas) {
    await expect(page.locator('#gantt canvas.fg-timeline-canvas-labels')).toBeAttached({ timeout: 30_000 });
    await page.waitForFunction(() => (document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement | null)?.width === 652);
  } else {
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  }
}
const scan = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).include('#gantt').analyze();
const focusRow = (page: Page, task: string) =>
  page.evaluate((id) => (document.querySelector(`#gantt [role=row][data-task-id="${id}"]`) as HTMLElement).focus(), task);

for (const canvas of [false, true]) {
  for (const rtl of [false, true]) {
    const label = `${canvas ? 'Canvas' : 'SVG'} ${rtl ? 'RTL' : 'LTR'}`;
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
    const q = rtl ? 'rtl=1' : '';

    test(`no axe violations with a cell focused: ${label}`, async ({ page }) => {
      await open(page, q, canvas);
      await focusRow(page, 'design');
      await page.keyboard.press(fwd);
      await page.keyboard.press(fwd);
      await page.keyboard.press(fwd);
      await expect(page.locator('#gantt [role=gridcell]:focus')).toHaveAttribute('aria-colindex', '3');
      expect((await scan(page)).violations).toEqual([]);
      await page.keyboard.press('ArrowUp'); // header mode on the same grid
      await page.keyboard.press('ArrowUp');
      expect((await scan(page)).violations).toEqual([]);
    });

    test(`a focused cell is announced with its row and its column header (CDP accessibility tree): ${label}`, async ({ page }) => {
      await open(page, q, canvas);
      await focusRow(page, 'design');
      await page.keyboard.press(fwd);
      await page.keyboard.press(fwd);
      await page.keyboard.press(fwd); // the End column (aria-colindex 3)
      await expect(page.locator('#gantt [role=gridcell]:focus')).toHaveAttribute('aria-colindex', '3');
      await page.evaluate(() => document.activeElement!.setAttribute('data-probe', 'cell'));
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('Accessibility.enable');
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-probe=cell]' });
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: true });
      const byId = new Map(nodes.map((n) => [n.nodeId, n]));
      const focused = nodes[0]!;
      expect(focused.role?.value).toBe('gridcell');
      expect(String(focused.name?.value ?? '')).toMatch(/\d{4}|Mar|Apr|Feb/); // the End date text
      // the row it belongs to carries the task's name; the cell is inside it
      let row: typeof focused | undefined = focused;
      while (row && row.role?.value !== 'row') row = row.parentId ? byId.get(row.parentId) : undefined;
      expect(String(row?.name?.value ?? '')).toContain('Design');
      // the grid it is in is a treegrid with a header row of named column headers: the End header has the cell's index
      let grid: typeof focused | undefined = focused;
      while (grid && grid.role?.value !== 'treegrid' && grid.role?.value !== 'grid') grid = grid.parentId ? byId.get(grid.parentId) : undefined;
      expect(grid).toBeDefined();
      const all = await cdp.send('Accessibility.getFullAXTree');
      const endHeader = all.nodes.find((n) => n.role?.value === 'columnheader' && String(n.name?.value ?? '').startsWith('End'));
      expect(endHeader).toBeDefined();
      const domCell = await page.evaluate(() => Number(document.activeElement!.getAttribute('aria-colindex')));
      const domHead = await page.evaluate(() => Number(document.querySelector('#gantt [role=columnheader][data-column-id=end]')!.getAttribute('aria-colindex')));
      expect(domCell).toBe(domHead);
      // the cell is not a descendant of a container with its own aria-label (G1 H1): the bar keeps its name
      expect(await page.evaluate(() => document.activeElement!.hasAttribute('aria-label') && !document.activeElement!.getAttribute('data-column-id'))).toBe(false);
    });
  }

  test(`the bar keeps its accessible name when the name cell is focused: ${canvas ? 'Canvas' : 'SVG'}`, async ({ page }) => {
    await open(page, '', canvas);
    await focusRow(page, 'design');
    await page.keyboard.press('ArrowRight');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const names = nodes.map((n) => String(n.name?.value ?? ''));
    expect(names.some((n) => n.includes('Design') && n.includes('2026'))).toBe(true);
  });

  test(`the chart stays one Tab stop in cell mode: ${canvas ? 'Canvas' : 'SVG'}`, async ({ page }) => {
    await open(page, '', canvas);
    await focusRow(page, 'design');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const stops = await page.locator('#gantt [tabindex]').evaluateAll((es) => es.filter((e) => Number(e.getAttribute('tabindex')) >= 0).map((e) => e.getAttribute('role')));
    expect(stops).toEqual(['row']);
  });
}
