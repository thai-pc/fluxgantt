import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility coverage for collapse/expand (spec-collapse-expand.md §9.10, WCAG 2.1 AA per
// testing.md). Fixture: examples/plain-html-demo/collapse.html — see
// `tests/e2e/collapse-expand.spec.ts`'s header for the 3-level row layout and the `?pad=` /
// `?collapsed=` query params.
//
// NOTE on scope (spec §6.4, REVISED): the root role is now derived per-render — `treegrid` when
// any row in the current layout has children, plain `grid` otherwise. This reverses spec §0
// decision 1 ("defer treegrid, keep grid for v1"), which was not tenable: WAI-ARIA allows
// `aria-expanded` on a row only under `treegrid`, and shipping §6.3's `aria-expanded` under
// `role="grid"` is a serious-impact axe violation (`aria-conditional-attr`) — caught by the axe
// scans below. `aria-level` follows the SAME gate for the same reason — axe lists it in
// `invalidTableRowAttrs` alongside `aria-expanded`, so both are emitted only when the layout is
// a tree, and both are covered by the scans below.

const SVG_ROW = '.fg-timeline__row';
const CANVAS_ROW = '.fg-timeline-canvas__row';

/** `aria-expanded` per row id: `null` means the attribute is ABSENT (the required state for a
 *  leaf — a non-expandable node must not carry `aria-expanded="false"`, which would announce it
 *  as a collapsed container). axe cannot catch "absent vs false", so it is asserted directly. */
async function ariaExpandedByTaskId(
  page: Page,
  rowSelector: string,
): Promise<Record<string, string | null>> {
  return page.evaluate((sel) => {
    const out: Record<string, string | null> = {};
    for (const el of document.querySelectorAll(sel)) {
      const id = el.getAttribute('data-task-id');
      if (id === null) continue;
      out[id] = el.getAttribute('aria-expanded');
    }
    return out;
  }, rowSelector);
}

/** Same shape as `ariaExpandedByTaskId`, for `aria-level`: `null` means ABSENT. A flat chart
 *  must report every row as `null`, which axe cannot distinguish from a wrong-but-present value
 *  the way it can for an outright invalid attribute. */
async function ariaLevelByTaskId(
  page: Page,
  rowSelector: string,
): Promise<Record<string, string | null>> {
  return page.evaluate((sel) => {
    const out: Record<string, string | null> = {};
    for (const el of document.querySelectorAll(sel)) {
      const id = el.getAttribute('data-task-id');
      if (id === null) continue;
      out[id] = el.getAttribute('aria-level');
    }
    return out;
  }, rowSelector);
}

test.describe('SVG renderer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
  });

  test('no detectable axe violations with a mix of collapsed, expanded and leaf rows', async ({
    page,
  }) => {
    const fullyExpanded = await new AxeBuilder({ page }).include('#gantt').analyze();
    expect(fullyExpanded.violations).toEqual([]);

    // Collapse the inner summary only, so the tree now genuinely contains all three row kinds
    // at once: an expanded container (`phase-1`), a collapsed container (`group-a`), and leaves.
    await page.locator(`${SVG_ROW}[data-task-id="group-a"] .fg-timeline__row-toggle`).click();

    const mixed = await new AxeBuilder({ page }).include('#gantt').analyze();
    expect(mixed.violations).toEqual([]);
  });

  test('`aria-expanded` is present and correct on container rows, and ABSENT on every leaf', async ({
    page,
  }) => {
    const expanded = await ariaExpandedByTaskId(page, SVG_ROW);
    expect(expanded['phase-1']).toBe('true');
    expect(expanded['group-a']).toBe('true');
    // Leaves must carry no `aria-expanded` at all — not `"false"`.
    expect(expanded['leaf-a1']).toBeNull();
    expect(expanded['leaf-a2']).toBeNull();
    expect(expanded['leaf-b']).toBeNull();
    expect(expanded['standalone']).toBeNull();

    await page.locator(`${SVG_ROW}[data-task-id="group-a"] .fg-timeline__row-toggle`).click();

    const afterCollapse = await ariaExpandedByTaskId(page, SVG_ROW);
    expect(afterCollapse['group-a']).toBe('false');
    expect(afterCollapse['phase-1']).toBe('true'); // ancestor unaffected
    expect(afterCollapse['standalone']).toBeNull(); // still a leaf, still no attribute
    // The hidden descendants are gone from the accessibility tree entirely — not merely
    // visually hidden, which a screen reader would still traverse.
    expect(afterCollapse['leaf-a1']).toBeUndefined();
    expect(afterCollapse['leaf-a2']).toBeUndefined();
  });

  test('the toggle glyph is `aria-hidden` — expanded state is announced once, by the row', async ({
    page,
  }) => {
    // Otherwise the chevron and its row would both announce the same state.
    const glyphs = page.locator('.fg-timeline__row-toggle');
    const count = await glyphs.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(glyphs.nth(i)).toHaveAttribute('aria-hidden', 'true');
    }
  });

  test('the grid stays a single Tab stop with exactly one tabindex="0" row after a collapse', async ({
    page,
  }) => {
    await expect(page.locator('svg.fg-timeline [tabindex="0"]')).toHaveCount(1);

    // Focus a row that is about to be hidden, then collapse its ancestor with the mouse — the
    // roving-tabindex invariant must survive (zero would mean focus was lost to <body>; two
    // would mean a stale hidden row kept its tabindex).
    // `.focus()`, not `.click()`: an SVG row is a `<g>` under the `.fg-timeline__grid` cell
    // rects, so a synthesized pointer click on it is always intercepted (same posture as
    // `tests/e2e/collapse-expand.spec.ts`).
    await page.locator(`${SVG_ROW}[data-task-id="leaf-a1"]`).focus();
    await page.locator(`${SVG_ROW}[data-task-id="phase-1"] .fg-timeline__row-toggle`).click();

    await expect(page.locator('svg.fg-timeline [tabindex="0"]')).toHaveCount(1);
    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? null);
    expect(activeTag).not.toBe('BODY');
  });

  test('collapse/expand is fully operable by keyboard alone (Enter), no pointer required', async ({
    page,
  }) => {
    // WCAG 2.1.1 Keyboard: every pointer-operable control needs a keyboard equivalent. The
    // chevron is a painted/`aria-hidden` glyph with no focus of its own, so Enter on the ROW is
    // that equivalent — assert it works from a pure Tab-then-Enter sequence.
    await page.keyboard.press('Tab');
    const focusedId = await page.evaluate(
      () => document.activeElement?.getAttribute('data-task-id') ?? null,
    );
    expect(focusedId).toBe('phase-1');

    await page.keyboard.press('Enter');
    await expect(page.locator(`${SVG_ROW}[data-task-id="group-a"]`)).toHaveCount(0);
    const after = await ariaExpandedByTaskId(page, SVG_ROW);
    expect(after['phase-1']).toBe('false');
  });

  test('`aria-level` is the 1-based depth on every row, containers and leaves alike', async ({
    page,
  }) => {
    // The fixture is 3 levels deep: phase-1 > group-a > leaf-a1/leaf-a2, plus leaf-b directly
    // under phase-1 and one unrelated top-level leaf. That covers root, mid and deepest at once.
    const levels = await ariaLevelByTaskId(page, SVG_ROW);
    expect(levels).toMatchObject({
      'phase-1': '1',
      'group-a': '2',
      'leaf-a1': '3',
      'leaf-a2': '3',
      'leaf-b': '2',
      standalone: '1',
    });
  });

  test('`aria-level` survives a collapse — the still-visible rows keep their real depth', async ({
    page,
  }) => {
    await page.locator(`${SVG_ROW}[data-task-id="group-a"] .fg-timeline__row-toggle`).click();

    const after = await ariaLevelByTaskId(page, SVG_ROW);
    // A collapsed container is still a container, so it keeps its own level; hiding its
    // children must not renumber anything that remains.
    expect(after['group-a']).toBe('2');
    expect(after['phase-1']).toBe('1');
    expect(after['leaf-b']).toBe('2');
    expect(after['leaf-a1']).toBeUndefined(); // out of the a11y tree entirely

    const results = await new AxeBuilder({ page }).include('#gantt').analyze();
    expect(results.violations).toEqual([]);
  });

  test('`initialCollapsed` produces a correct accessibility tree with no axe violations', async ({
    page,
  }) => {
    await page.goto('/collapse.html?collapsed=phase-1');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();

    const state = await ariaExpandedByTaskId(page, SVG_ROW);
    expect(state['phase-1']).toBe('false');
    expect(state['standalone']).toBeNull();

    const results = await new AxeBuilder({ page }).include('#gantt').analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('Canvas renderer', () => {
  // `?pad=` pushes the dataset past CANVAS_AUTO_SWITCH_THRESHOLD (2000) — see the e2e spec's
  // header for why padding is the only way to reach Canvas through the real public `mount()`.
  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html?pad=2100');
    await expect(page.locator(CANVAS_ROW).first()).toBeAttached();
  });

  test('no detectable axe violations on the hidden ARIA grid layer', async ({ page }) => {
    const results = await new AxeBuilder({ page }).include('#gantt').analyze();
    expect(results.violations).toEqual([]);
  });

  test('`aria-expanded` parity with SVG — present on containers, absent on leaves', async ({
    page,
  }) => {
    // Both renderers derive `hasChildren`/`isCollapsed` from the SAME `layoutRows()` result, so
    // this is the cross-renderer parity assertion §6.3 asks for, driven through the real
    // `mount()` rather than a unit-level renderer comparison.
    const state = await ariaExpandedByTaskId(page, CANVAS_ROW);
    expect(state['phase-1']).toBe('true');
    expect(state['group-a']).toBe('true');
    expect(state['leaf-a1']).toBeNull();
    expect(state['standalone']).toBeNull();

    // Canvas rows have no geometry of their own (the hidden ARIA layer is a `position: sticky`
    // 1x1px div), so the toggle click is computed from the `<canvas>` plus the renderer's own
    // layout constants — HEADER_HEIGHT (32) + rowIndex * ROW_HEIGHT.default (32), and x=14
    // inside `phase-1`'s depth-0 toggle band [8, 22). Same math as the e2e spec's
    // `clickCanvasRow()` helper.
    const canvasBox = await page.locator('canvas.fg-timeline-canvas').boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.mouse.click(canvasBox!.x + 14, canvasBox!.y + 32 + 16);

    const after = await ariaExpandedByTaskId(page, CANVAS_ROW);
    expect(after['phase-1']).toBe('false');
    expect(after['group-a']).toBeUndefined(); // out of the a11y tree, not just invisible
  });

  test('`aria-level` parity with SVG, and windowing does not distort it', async ({ page }) => {
    const levels = await ariaLevelByTaskId(page, CANVAS_ROW);
    expect(levels).toMatchObject({
      'phase-1': '1',
      'group-a': '2',
      'leaf-a1': '3',
      'leaf-b': '2',
      standalone: '1',
    });
    // The `?pad=` filler is flat and appended after the real rows, so every windowed filler row
    // must report level 1. This is the real windowing guard: `row.depth` comes from the
    // full-tree walk in `layoutRows`, not from the visible slice, so a row's level cannot
    // change as it scrolls into view.
    const fillerLevels = new Set(
      Object.entries(levels)
        .filter(
          ([id]) =>
            !['phase-1', 'group-a', 'leaf-a1', 'leaf-a2', 'leaf-b', 'standalone'].includes(id),
        )
        .map(([, level]) => level),
    );
    expect([...fillerLevels]).toEqual(['1']);
  });
});
