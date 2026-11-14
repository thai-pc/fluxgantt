import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for the grid cell editors (spec-grid-columns.md 9.1, 10.5, 13.5; PR G6), SVG and Canvas,
// LTR and RTL: axe with the editor closed, open and valid, open and invalid; the Chromium accessibility tree (the
// input is a textbox named by `gridEditLabel`, an invalid one is described by its `role=alert` message); a cell
// that is not editable exposes `aria-readonly`; Tab from the editor commits and leaves (focus is never trapped).
// Fixture: `grid.html?edit=1` (`?rows=2100` mounts the Canvas renderer).

async function open(page: Page, query: string, canvas: boolean): Promise<void> {
  await page.goto(`/grid.html?edit=1&cols=6&${canvas ? 'rows=2100&' : ''}${query}`);
  await page.waitForFunction(() => '__gantt' in window);
  if (canvas) {
    await expect(page.locator('#gantt canvas.fg-timeline-canvas-labels')).toBeAttached({ timeout: 30_000 });
    await page.waitForFunction(() => (document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement | null)?.width === 772);
  } else {
    await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  }
}
const scan = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).include('#gantt').analyze();
const focusRow = (page: Page, task: string) =>
  page.evaluate((id) => (document.querySelector(`#gantt [role=row][data-task-id="${id}"]`) as HTMLElement).focus(), task);
async function focusCell(page: Page, task: string, colindex: number, rtl: boolean): Promise<void> {
  await focusRow(page, task);
  for (let i = 0; i < colindex; i++) await page.keyboard.press(rtl ? 'ArrowLeft' : 'ArrowRight');
  await expect(page.locator('#gantt [role=gridcell]:focus')).toHaveAttribute('aria-colindex', String(colindex));
}

for (const canvas of [false, true]) {
  for (const rtl of [false, true]) {
    const label = `${canvas ? 'Canvas' : 'SVG'} ${rtl ? 'RTL' : 'LTR'}`;
    const q = rtl ? 'rtl=1' : '';

    test(`no axe violations with the editor closed, open and invalid: ${label}`, async ({ page }) => {
      await open(page, q, canvas);
      await focusCell(page, 'design', 5, rtl); // progress
      expect((await scan(page)).violations).toEqual([]);
      await page.keyboard.press('Enter');
      await expect(page.locator('#gantt .fg-grid__editor')).toBeFocused();
      expect((await scan(page)).violations).toEqual([]);
      await page.locator('#gantt .fg-grid__editor').fill('abc');
      await page.keyboard.press('Enter');
      await expect(page.locator('#gantt .fg-grid__edit-error')).toHaveText('Enter a number.');
      expect((await scan(page)).violations).toEqual([]);
      await page.keyboard.press('Escape');
    });

    test(`the editor is a named textbox, an invalid one is described by its alert (CDP accessibility tree): ${label}`, async ({ page }) => {
      await open(page, q, canvas);
      await focusCell(page, 'design', 4, rtl); // duration
      await page.keyboard.press('Enter');
      await page.locator('#gantt .fg-grid__editor').fill('abc');
      await page.keyboard.press('Enter');
      await page.evaluate(() => document.activeElement!.setAttribute('data-probe', 'editor'));
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('Accessibility.enable');
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-probe=editor]' });
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
      const input = nodes[0]!;
      expect(input.role?.value).toBe('textbox');
      expect(String(input.name?.value)).toBe('Duration, Design');
      expect(input.properties?.find((p) => p.name === 'invalid')?.value.value).toBe('true');
      const all = await cdp.send('Accessibility.getFullAXTree');
      const byId = new Map(all.nodes.map((n) => [n.nodeId, n]));
      const textOf = (n: (typeof all.nodes)[number]): string =>
        `${n.role?.value === 'StaticText' || n.role?.value === 'InlineTextBox' ? String(n.name?.value ?? '') : ''}${(n.childIds ?? []).map((c) => textOf(byId.get(c)!)).join('')}`;
      const alert = all.nodes.find((n) => n.role?.value === 'alert' && !n.ignored);
      expect(alert).toBeDefined();
      expect(textOf(alert!)).toContain('Enter a number.');
    });

    test(`Tab from the editor commits and leaves: focus is not trapped: ${label}`, async ({ page }) => {
      await open(page, q, canvas);
      await focusCell(page, 'design', 1, rtl);
      await page.keyboard.press('Enter');
      await page.locator('#gantt .fg-grid__editor').fill('Tabbed design');
      await page.keyboard.press('Tab');
      await expect(page.locator('#gantt .fg-grid__editor')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __gantt: { getTask(id: string): { name: string } } }).__gantt.getTask('design').name)).toBe('Tabbed design');
      await page.keyboard.press('Tab');
      await expect(page.locator('#gantt [role=gridcell]:focus')).toHaveCount(0); // moved on
    });
  }
}

test('a cell that is not editable exposes aria-readonly, an editable one does not', async ({ page }) => {
  await open(page, '', false);
  await focusCell(page, 'plan', 2, false); // a summary's start is rolled up
  await expect(page.locator('#gantt [role=gridcell]:focus')).toHaveAttribute('aria-readonly', 'true');
  await focusCell(page, 'design', 2, false);
  await expect(page.locator('#gantt [role=gridcell]:focus')).not.toHaveAttribute('aria-readonly', /./);
});

test('the open editor is announced when it takes focus and the chart is still one Tab stop', async ({ page }) => {
  await open(page, '', false);
  await focusCell(page, 'design', 1, false);
  await page.keyboard.press('Enter');
  const stops = await page.locator('#gantt [tabindex]').evaluateAll((es) => es.filter((e) => Number(e.getAttribute('tabindex')) >= 0).map((e) => e.getAttribute('role')));
  expect(stops).toEqual(['row']);
  await expect(page.locator('#gantt .fg-grid__editor')).toHaveAttribute('aria-label', 'Name, Design');
});
