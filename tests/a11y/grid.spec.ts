import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for `withGrid()` (WCAG 2.1 AA per testing.md; spec-grid-columns.md 9.1, 13.5):
// the chart svg holds the REAL treegrid (a header row of columnheaders, gridcells with aria-colindex),
// and the pinned layers are aria-hidden clones that must hold nothing focusable or role-bearing.
// Fixture: `examples/plain-html-demo/grid.html`.

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/grid.html${query ? `?${query}` : ''}`);
  await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => '__gantt' in window);
}

const scan = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).include('#gantt').analyze();

for (const [label, query] of [
  ['LTR', ''],
  ['RTL', 'rtl=1'],
  ['dark', 'theme=dark'],
  ['truncated text and an extra custom column', 'long=1&cols=6'],
  ['name column only', 'cols=1'],
  ['ten columns', 'cols=10'],
  ['flat 60 rows', 'rows=60'],
] as const) {
  test(`no axe violations: ${label}`, async ({ page }) => {
    await open(page, query);
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });
}

test('no axe violations with a row selected and keyboard focus inside the grid', async ({ page }) => {
  await open(page);
  await page.locator('#gantt .fg-timeline__row[data-task-id="design"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  expect((await scan(page)).violations).toEqual([]);
});

test('the chart exposes a treegrid with a column count, a header row and indexed cells', async ({ page }) => {
  await open(page);
  const svg = page.locator('#gantt svg.fg-timeline');
  await expect(svg).toHaveAttribute('role', 'treegrid');
  await expect(svg).toHaveAttribute('aria-colcount', '5');
  await expect(svg).toHaveAttribute('aria-rowcount', '8'); // 7 tasks + the header row
  const headers = svg.locator('[role=row][aria-rowindex="1"] [role=columnheader]');
  await expect(headers).toHaveCount(5);
  await expect(headers.nth(2)).toHaveAttribute('aria-label', 'End, column 3 of 5');
  const row = svg.locator('.fg-timeline__row[data-task-id="design"]');
  await expect(row).toHaveAttribute('aria-rowindex', '4');
  await expect(row.locator('[role=gridcell]')).toHaveCount(5);
  expect(await row.locator('[role=gridcell]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-colindex')))).toEqual(['1', '2', '3', '4', '5']);
});

test('the pinned overlays are aria-hidden and hold no role, tabindex, id or focusable element', async ({ page }) => {
  await open(page, 'long=1');
  const offenders = await page.evaluate(() =>
    [...document.querySelectorAll('.fg-timeline__sticky-column, .fg-timeline__sticky-corner, .fg-timeline__sticky-header')].flatMap((layer) => [
      layer.getAttribute('aria-hidden') === 'true' ? '' : `${layer.className} is not aria-hidden`,
      ...[...layer.querySelectorAll('[role],[tabindex],[id],a,button,input,select,textarea')].map((e) => e.tagName),
    ]).filter(Boolean),
  );
  expect(offenders).toEqual([]);
});

test('a truncated cell keeps its full text in the accessible name', async ({ page }) => {
  await open(page, 'long=1&cols=6');
  const name = page.locator('#gantt svg.fg-timeline .fg-timeline__row[data-task-id="req"] .fg-timeline__row-cell');
  await expect(name).toHaveAttribute('aria-label', /^Requirements: an unusually long task name/);
  const owner = page.locator('#gantt svg.fg-timeline .fg-timeline__row[data-task-id="req"] [role=gridcell][data-column-id=owner]');
  await expect(owner).toHaveAttribute('aria-label', /a custom value that is far too long to fit$/);
});

test('real cells remain exposed to the accessibility tree although they are invisible', async ({ page }) => {
  await open(page);
  const snapshot = await page.locator('#gantt svg.fg-timeline').ariaSnapshot();
  for (const s of ['columnheader "Start, column 2 of 5"', 'gridcell "Mar 16, 2026"', 'gridcell "70%"']) expect(snapshot).toContain(s);
});

test('keyboard behaviour is unchanged by the grid: Tab leaves in one stop, arrows move rows', async ({ page }) => {
  await open(page);
  await page.locator('#gantt .fg-timeline__row').first().focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-task-id'))).toBe('req');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('#gantt') === null)).toBe(true);
});
