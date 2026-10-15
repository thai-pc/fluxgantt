import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for `withViewport()` (spec-viewport-api.md §8/§9.4), WCAG 2.1 AA.
// Scrolling and density are programmatic viewport changes, not new controls, so the bar is "no new
// violations, ARIA tree intact, focus not stolen". Fixture: `collapse.html` (see
// `tests/e2e/viewport.spec.ts` for the layout and the `?pad=` / `?collapsed=` params).

type G = {
  scrollToTask(id: string, o?: Record<string, unknown>): boolean;
  setDensity(d: string): void;
};

async function call(page: Page, fn: string, arg?: unknown): Promise<unknown> {
  return page.evaluate(
    ([src, a]) => {
      const gantt = (window as unknown as { __gantt?: G }).__gantt;
      if (!gantt) throw new Error('window.__gantt not exposed by the demo');
      return (0, eval)(`(${src as string})`)(gantt, a);
    },
    [fn, arg] as const,
  );
}

const activeTaskId = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('data-task-id') ?? null);

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .include('#gantt')
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe('SVG renderer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html?pad=60&collapsed=phase-1');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
  });

  test('no axe violations after setDensity(compact) and setDensity(comfortable)', async ({ page }) => {
    for (const d of ['compact', 'comfortable']) {
      await call(page, '(g, d) => g.setDensity(d)', d);
      await expectNoViolations(page);
    }
  });

  test('no axe violations after scrollToTask, incl. the treegrid/aria-expanded pairing after an auto-expand', async ({
    page,
  }) => {
    await call(page, "(g) => g.scrollToTask('filler-55')");
    await expectNoViolations(page);

    // Auto-expand `phase-1` (collapsed via the URL): its row must flip to aria-expanded="true"
    // and the root must still be a treegrid.
    await call(page, "(g) => g.scrollToTask('leaf-a1')");
    await expect(page.locator('svg.fg-timeline')).toHaveAttribute('role', 'treegrid');
    await expect(page.locator('.fg-timeline__row[data-task-id="phase-1"]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expectNoViolations(page);
  });

  test('keyboard focus stays on the focused row across setDensity, and the roving tabindex survives', async ({
    page,
  }) => {
    await page.locator('svg.fg-timeline [tabindex="0"]').first().focus();
    await page.keyboard.press('ArrowDown');
    const before = await activeTaskId(page);
    expect(before).not.toBeNull();
    for (const d of ['compact', 'comfortable', 'default']) {
      await call(page, '(g, d) => g.setDensity(d)', d);
      expect(await activeTaskId(page)).toBe(before);
      await expect(page.locator('svg.fg-timeline [tabindex="0"]')).toHaveCount(1);
    }
    // The focus indicator is still present on the focused row (visible, not display:none).
    await expect(page.locator(`.fg-timeline__row[data-task-id="${before}"]`)).toBeFocused();
  });

  test('scrollToTask does not steal focus from an element outside the chart', async ({ page }) => {
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'host-btn';
      b.textContent = 'host';
      document.body.append(b);
      b.focus();
    });
    await call(page, "(g) => g.scrollToTask('filler-40')");
    await expect(page.locator('#host-btn')).toBeFocused();
  });
});

test.describe('Canvas renderer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html?pad=2100');
    await expect(page.locator('canvas.fg-timeline-canvas')).toBeVisible();
  });

  test('no axe violations after setDensity (focused row kept near the top)', async ({ page }) => {
    await page.locator('.fg-timeline-canvas__row[tabindex="0"]').first().focus();
    await page.keyboard.press('ArrowDown');
    for (const d of ['compact', 'comfortable']) {
      await call(page, '(g, d) => g.setDensity(d)', d);
      await expectNoViolations(page);
    }
  });

  test('keyboard focus stays on the focused row across setDensity', async ({ page }) => {
    await page.locator('.fg-timeline-canvas__row[tabindex="0"]').first().focus();
    await page.keyboard.press('ArrowDown');
    const before = await activeTaskId(page);
    expect(before).not.toBeNull();
    await call(page, '(g, d) => g.setDensity(d)', 'compact');
    expect(await activeTaskId(page)).toBe(before);
  });

  // Regression: the Canvas hidden ARIA layer is windowed by scroll position; the roving-tabindex
  // row must stay rendered after a far scroll (focus kept, exactly one Tab stop, no axe
  // `scrollable-region-focusable`). Both tests settle two frames before asserting.
  const settle = (page: Page) =>
    page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

  test('scrollToTask keeps keyboard focus on the focused row in Canvas mode', async ({ page }) => {
    await page.locator('.fg-timeline-canvas__row[tabindex="0"]').first().focus();
    await page.keyboard.press('ArrowDown');
    const before = await activeTaskId(page);
    await call(page, "(g) => g.scrollToTask('filler-1800')");
    await settle(page);
    expect(await activeTaskId(page)).toBe(before);
  });

  test('no axe violations after scrollToTask across the virtualized range', async ({
    page,
  }) => {
    await call(page, "(g) => g.scrollToTask('filler-2050')");
    await settle(page);
    await expectNoViolations(page);
  });
});
