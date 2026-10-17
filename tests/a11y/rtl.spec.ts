import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// RTL accessibility (spec-rtl-chart.md AC8; WCAG 2.1 AA). Fixture: `examples/plain-html-demo/rtl.html`
// (an Arabic plan, `rtl: true`). The ARIA grid is built from DOM order, which a mirrored chart does
// not change, so the same tree must come out as in LTR; the extra `<g>` must be transparent to AT.

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/rtl.html${query ? `?${query}` : ''}`);
  await expect(page.locator(query.includes('pad=2100') ? '#gantt canvas.fg-timeline-canvas' : '#gantt svg.fg-timeline')).toBeVisible({ timeout: 30_000 });
}

for (const [name, query] of [
  ['SVG', ''],
  ['SVG dark', 'theme=dark'],
  ['Hebrew', 'lang=he'],
  ['Canvas', 'pad=2100'],
] as const) {
  test(`${name}: a mirrored chart has no detectable axe violations`, async ({ page }) => {
    await open(page, query);
    const results = await new AxeBuilder({ page }).include('#gantt').analyze();
    expect(results.violations).toEqual([]);
  });
}

test('the mirror group is transparent to AT: grid, rows and gridcells come out in the LTR order', async ({ page, context }) => {
  await open(page);
  const tree = (p: Page) =>
    p.evaluate(() => {
      const svg = document.querySelector('#gantt svg.fg-timeline')!;
      return {
        role: svg.getAttribute('role'),
        rowcount: svg.getAttribute('aria-rowcount'),
        rows: [...svg.querySelectorAll('[role="row"]')].map((r) => ({
          id: r.getAttribute('data-task-id'),
          level: r.getAttribute('aria-level'),
          expanded: r.getAttribute('aria-expanded'),
          cells: [...r.querySelectorAll('[role="gridcell"]')].length,
        })),
        group: document.querySelector('svg.fg-timeline > g.fg-rtl')?.getAttributeNames().sort(),
      };
    });
  const rtl = await tree(page);
  const ltr = await context.newPage();
  await open(ltr, 'rtl=0');
  const twin = await tree(ltr);
  expect(rtl.group).toEqual(['class', 'direction', 'transform']); // no role / aria-* / tabindex on the wrapper
  expect({ ...rtl, group: undefined }).toEqual({ ...twin, group: undefined });
  await ltr.close();
});

test('the chart and a task keep their computed accessible names in Arabic', async ({ page }) => {
  await open(page);
  await expect(page.locator('#gantt svg.fg-timeline')).toHaveAccessibleName('خطة المشروع');
  await expect(page.locator('.fg-task[data-task-id="design"]')).toHaveAccessibleName(/^التصميم — من .+ إلى .+، مكتمل 70%$/);
});

test('keyboard: Tab reaches the grid, a row gets a visible focus indicator, arrows still move the roving row', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const a = document.activeElement as SVGElement;
    return { cls: a.getAttribute('class'), id: a.getAttribute('data-task-id'), tabindex: a.getAttribute('tabindex') };
  });
  expect(focused.cls).toContain('fg-timeline__row');
  expect(focused.tabindex).toBe('0');
  await page.keyboard.press('ArrowDown');
  const next = await page.evaluate(() => document.activeElement!.getAttribute('data-task-id'));
  expect(next).not.toBe(focused.id);
  // The ring is a painted rect inside the mirrored group: it must be stroked (the `:focus-visible`
  // rule still matches the moved row) and sit on the focused bar.
  const ring = await page.evaluate(() => {
    const row = document.activeElement!;
    const rect = row.querySelector('.fg-task__focus-ring')!;
    const bar = row.querySelector('.fg-task__bar')!.getBoundingClientRect();
    const r = rect.getBoundingClientRect();
    return { stroke: getComputedStyle(rect).stroke, barCentre: bar.left + bar.width / 2, ringLeft: r.left, ringRight: r.right };
  });
  expect(ring.stroke).not.toBe('none');
  expect(ring.ringLeft).toBeLessThanOrEqual(ring.barCentre);
  expect(ring.ringRight).toBeGreaterThanOrEqual(ring.barCentre);
});

test('the critical path stays distinguishable without colour: a dashed outline survives the mirror', async ({ page }) => {
  await open(page);
  const dashes = await page.evaluate(() =>
    [...document.querySelectorAll<SVGElement>('.fg-task__bar')].filter((b) => {
      const d = b.style.strokeDasharray || b.getAttribute('stroke-dasharray');
      return d !== null && d !== '' && d !== 'none';
    }).length,
  );
  expect(dashes).toBeGreaterThan(0);
});

test('prefers-reduced-motion: the mirrored chart renders the same with no transition on the handles', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const t = await page.evaluate(() => getComputedStyle(document.querySelector('.fg-task__link-handle')!).transitionDuration);
  expect(['0s', '0s, 0s']).toContain(t);
});
