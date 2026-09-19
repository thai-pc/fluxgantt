import { test, expect, type Page, type Locator } from '@playwright/test';

// Real e2e coverage for collapse/expand (spec-collapse-expand.md §9.9).
//
// Fixture: examples/plain-html-demo/collapse.html (src/collapse.ts) — a 3-level hierarchy in
// layout order:
//   row 0  phase-1     (summary, hasChildren)
//   row 1  ├─ group-a  (summary, hasChildren)
//   row 2  │  ├─ leaf-a1
//   row 3  │  └─ leaf-a2
//   row 4  └─ leaf-b
//   row 5  standalone  (top-level leaf, never affected by any collapse above)
// Three levels, not two, on purpose: collapsing `phase-1` must hide `group-a` AND its two
// grandchildren — the one assertion a 2-level fixture cannot distinguish from "hide my direct
// children". Exposes `window.__gantt` (dev-only), same harness as every other spec.
//
// `?pad=N` pads the dataset past `CANVAS_AUTO_SWITCH_THRESHOLD` (2000) so `mount()` picks Canvas.
// There is no public "force renderer" config (spec-canvas-auto-switch.md) — task count is the
// sole switch input — so padding is the only way to drive the Canvas path through the REAL
// public `mount()`. The named rows above keep their order and ids either way, which is what lets
// the SVG and Canvas blocks below share assertions.

const SVG_ROW = '.fg-timeline__row';
const CANVAS_ROW = '.fg-timeline-canvas__row';

function svgRow(page: Page, taskId: string): Locator {
  return page.locator(`${SVG_ROW}[data-task-id="${taskId}"]`);
}

/** The collapse/expand chevron inside a given SVG row. */
function svgToggle(page: Page, taskId: string): Locator {
  return page.locator(`${SVG_ROW}[data-task-id="${taskId}"] .fg-timeline__row-toggle`);
}

async function isCollapsed(page: Page, taskId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const g = (window as unknown as { __gantt?: { isCollapsed(id: string): boolean } }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    return g.isCollapsed(id);
  }, taskId);
}

async function getSelection(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { getSelection(): string[] } }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    return g.getSelection();
  });
}

/**
 * Click a point inside a Canvas-mode row, in `.fg-timeline-canvas` coordinates.
 *
 * Canvas rows have no geometry of their own: the hidden ARIA layer is a `position: sticky`
 * 1x1px div, so `boundingBox()` on a `.fg-timeline-canvas__row` is meaningless for pointer
 * math. Coordinates must be derived from the `<canvas>` element and the renderer's own layout
 * constants instead — `HEADER_HEIGHT` (32) + rowIndex * rowHeight (32 at `default` density),
 * matching `hitTestRow()`'s inverse computation exactly. Rows 0..N here are VISIBLE rows (what
 * `layoutRows()` emitted), which is the same index space `data-row-index` carries.
 */
const CANVAS_HEADER_HEIGHT = 32;
const CANVAS_ROW_HEIGHT = 32; // ROW_HEIGHT['default']

async function clickCanvasRow(page: Page, rowIndex: number, offsetX: number): Promise<void> {
  const canvas = page.locator('canvas.fg-timeline-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + CANVAS_HEADER_HEIGHT + rowIndex * CANVAS_ROW_HEIGHT + CANVAS_ROW_HEIGHT / 2;
  await page.mouse.click(box!.x + offsetX, y);
}

test.describe('SVG renderer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
  });

  test('clicking the chevron on a summary row hides its whole subtree; clicking again restores it', async ({
    page,
  }) => {
    await expect(svgRow(page, 'group-a')).toBeVisible();
    await expect(svgRow(page, 'leaf-a1')).toBeVisible();
    await expect(svgRow(page, 'leaf-b')).toBeVisible();

    await svgToggle(page, 'phase-1').click();

    // The whole subtree goes, two levels deep — not just the direct children.
    await expect(svgRow(page, 'group-a')).toHaveCount(0);
    await expect(svgRow(page, 'leaf-a1')).toHaveCount(0);
    await expect(svgRow(page, 'leaf-a2')).toHaveCount(0);
    await expect(svgRow(page, 'leaf-b')).toHaveCount(0);
    // The collapsed row itself and every unrelated row stay.
    await expect(svgRow(page, 'phase-1')).toBeVisible();
    await expect(svgRow(page, 'standalone')).toBeVisible();
    expect(await isCollapsed(page, 'phase-1')).toBe(true);

    await svgToggle(page, 'phase-1').click();

    await expect(svgRow(page, 'group-a')).toBeVisible();
    await expect(svgRow(page, 'leaf-a1')).toBeVisible();
    await expect(svgRow(page, 'leaf-a2')).toBeVisible();
    await expect(svgRow(page, 'leaf-b')).toBeVisible();
    expect(await isCollapsed(page, 'phase-1')).toBe(false);
  });

  test('collapsing an inner summary hides only its own subtree, leaving its siblings visible', async ({
    page,
  }) => {
    await svgToggle(page, 'group-a').click();

    await expect(svgRow(page, 'leaf-a1')).toHaveCount(0);
    await expect(svgRow(page, 'leaf-a2')).toHaveCount(0);
    // `leaf-b` is a SIBLING of `group-a`, not a descendant — it must survive.
    await expect(svgRow(page, 'leaf-b')).toBeVisible();
    await expect(svgRow(page, 'group-a')).toBeVisible();
  });

  test('Enter on a focused summary row toggles it, and on a focused leaf row does nothing', async ({
    page,
  }) => {
    // Roving tabindex: the grid is a single Tab stop and starts on row 0 (`phase-1`).
    await page.locator(`svg.fg-timeline [tabindex="0"]`).first().focus();
    await expect(svgRow(page, 'phase-1')).toBeFocused();

    await page.keyboard.press('Enter');
    expect(await isCollapsed(page, 'phase-1')).toBe(true);
    await expect(svgRow(page, 'group-a')).toHaveCount(0);

    await page.keyboard.press('Enter');
    expect(await isCollapsed(page, 'phase-1')).toBe(false);
    await expect(svgRow(page, 'group-a')).toBeVisible();

    // Now move focus to a genuine LEAF and confirm Enter is inert there. Navigated with
    // ArrowDown rather than `.focus()`: `keyboard-nav.ts` tracks the focused row in a module
    // local updated by its OWN callbacks, and registers no `focusin` listener — so a bare
    // `.focus()` moves DOM focus without telling keyboard-nav, and the next Enter would still
    // act on the previously-tracked row. (Pre-existing keyboard-nav behavior, shared by every
    // keybinding, not something collapse introduced.)
    await page.keyboard.press('ArrowDown'); // -> group-a
    await page.keyboard.press('ArrowDown'); // -> leaf-a1 (a leaf)
    await expect(svgRow(page, 'leaf-a1')).toBeFocused();

    const rowsBefore = await page.locator(SVG_ROW).count();
    await page.keyboard.press('Enter');
    expect(await isCollapsed(page, 'leaf-a1')).toBe(false);
    expect(await page.locator(SVG_ROW).count()).toBe(rowsBefore);
  });

  test('keyboard focus stays on a real, visible row after a MOUSE collapse of the focused row’s ancestor', async ({
    page,
  }) => {
    // This is spec §4's `syncFocusToRows()` scenario, and the regression test for the
    // ordering bug it guards: `interaction/mixin.ts` must batch `toggleCollapse()` together
    // with `syncFocusToRows()`, or the synchronous render effect repaints while focus still
    // points at the row that is about to be hidden — leaving the painted roving tabindex on an
    // element no longer in the DOM, with no further repaint to correct it.
    await svgRow(page, 'leaf-a1').focus();
    await expect(svgRow(page, 'leaf-a1')).toBeFocused();

    // Collapse `phase-1` (grandparent of the focused row) with the MOUSE, so focus correction
    // has to come from `syncFocusToRows()` rather than the inline Enter path.
    await svgToggle(page, 'phase-1').click();

    // Focus must not be lost to <body>, and must not reference a detached element.
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        taskId: el?.getAttribute('data-task-id') ?? null,
        connected: el?.isConnected ?? false,
        tag: el?.tagName ?? null,
      };
    });
    expect(focused.tag).not.toBe('BODY');
    expect(focused.connected).toBe(true);
    expect(focused.taskId).not.toBeNull();

    // And it must be a currently-VISIBLE row — `phase-1` itself (the nearest visible ancestor)
    // or, failing that, some other row still on screen. Never one of the hidden descendants.
    expect(['leaf-a1', 'leaf-a2', 'group-a', 'leaf-b']).not.toContain(focused.taskId);
    await expect(page.locator(`${SVG_ROW}[data-task-id="${focused.taskId}"]`)).toBeVisible();

    // Exactly one row carries tabindex="0" — the roving-tabindex invariant must survive the
    // collapse, not end up with zero (focus lost) or two (stale row left behind).
    await expect(page.locator('svg.fg-timeline [tabindex="0"]')).toHaveCount(1);
  });

  test('Arrow/Shift+Arrow traverse only VISIBLE rows, skipping a collapsed subtree', async ({
    page,
  }) => {
    // Collapse the INNER summary, so the visible row order becomes
    //   0 phase-1 · 1 group-a · 2 leaf-b · 3 standalone
    // with `leaf-a1`/`leaf-a2` hidden BETWEEN rows 1 and 2. That gap is the whole point: under a
    // layout that ignored `collapsedIds`, ArrowUp from `leaf-b` would land on the hidden
    // `leaf-a2`, so where focus lands is a direct, observable test of visible-only traversal.
    await svgToggle(page, 'group-a').click();
    await expect(svgRow(page, 'leaf-a1')).toHaveCount(0);

    // Navigate with arrows only — a bare `.focus()` would not update keyboard-nav's own
    // tracked row (see the note in the Enter test above). From row 0, two ArrowDowns land on
    // `leaf-b` ONLY IF the hidden rows are skipped; a layout ignoring `collapsedIds` would put
    // `leaf-a1` there instead.
    await page.locator('svg.fg-timeline [tabindex="0"]').first().focus();
    await expect(svgRow(page, 'phase-1')).toBeFocused();
    await page.keyboard.press('ArrowDown'); // -> group-a
    await page.keyboard.press('ArrowDown'); // -> leaf-b (leaf-a1/leaf-a2 are hidden)
    await expect(svgRow(page, 'leaf-b')).toBeFocused();

    await page.keyboard.press('ArrowUp');

    await expect(svgRow(page, 'group-a')).toBeFocused();
    await expect(svgRow(page, 'group-a')).toHaveAttribute('tabindex', '0');

    // And the Shift+Arrow range built from that traversal spans the visible rows it walked.
    await page.keyboard.press('Shift+ArrowDown');
    const selection = await getSelection(page);
    expect(selection).toContain('group-a');
    expect(selection).toContain('leaf-b');
    // NOTE: `leaf-a1`/`leaf-a2` ARE in this selection despite being hidden — not a range bug.
    // `group-a` is in the range, and selecting a summary auto-selects its descendants
    // (parent-implies-children, spec-selection.md §3), which is deliberately a DATA relation,
    // independent of whether a row is currently visible. The range itself never walked them.
    expect(selection).not.toContain('standalone'); // genuinely outside the walked range
  });

  test('`initialCollapsed` applies at construction, before any interaction', async ({ page }) => {
    await page.goto('/collapse.html?collapsed=group-a');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();

    expect(await isCollapsed(page, 'group-a')).toBe(true);
    await expect(svgRow(page, 'leaf-a1')).toHaveCount(0);
    await expect(svgRow(page, 'leaf-a2')).toHaveCount(0);
    // Ancestor and sibling unaffected.
    await expect(svgRow(page, 'phase-1')).toBeVisible();
    await expect(svgRow(page, 'leaf-b')).toBeVisible();
  });
});

test.describe('Canvas renderer', () => {
  // `pad` pushes the total past CANVAS_AUTO_SWITCH_THRESHOLD (2000) so `mount()` picks Canvas.
  // Canvas mode resolves lazily (dynamic `import()` of the renderer chunk), so every test here
  // waits on the hidden ARIA layer appearing rather than on `svg.fg-timeline`.
  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html?pad=2100');
    await expect(page.locator(CANVAS_ROW).first()).toBeAttached();
  });

  test('the Canvas path really is active (no SVG timeline rendered)', async ({ page }) => {
    await expect(page.locator('svg.fg-timeline')).toHaveCount(0);
  });

  test('clicking the chevron gutter hides the subtree, and hit-testing agrees with the paint pass', async ({
    page,
  }) => {
    const row = page.locator(`${CANVAS_ROW}[data-task-id="phase-1"]`);
    await expect(row).toBeAttached();
    await expect(page.locator(`${CANVAS_ROW}[data-task-id="group-a"]`)).toBeAttached();

    // Canvas has no per-glyph DOM element — the chevron is painted pixels, hit-tested by
    // `hitTestRow()`'s `hitToggle` band. For the depth-0 `phase-1` row (row index 0) the band is
    // [LABEL_PADDING_PX (8), 8 + TOGGLE_GLYPH_GUTTER_PX (14)) = [8, 22), so x=14 is inside it.
    await clickCanvasRow(page, 0, 14);

    expect(await isCollapsed(page, 'phase-1')).toBe(true);
    // The hidden ARIA layer is the observable proxy for the paint pass — both derive from the
    // same `layoutRows(..., collapsedIds)` call, which is exactly the invariant under test
    // (spec §6.3: threading `collapsedIds` into only ONE of the two call sites desynchronizes
    // hit-testing from painting).
    await expect(page.locator(`${CANVAS_ROW}[data-task-id="group-a"]`)).toHaveCount(0);
    await expect(page.locator(`${CANVAS_ROW}[data-task-id="leaf-a1"]`)).toHaveCount(0);
    await expect(page.locator(`${CANVAS_ROW}[data-task-id="phase-1"]`)).toBeAttached();
  });

  test('a click OUTSIDE the chevron gutter on the same row does not toggle', async ({ page }) => {
    // Well past the [8, 22) gutter, in the label text area.
    await clickCanvasRow(page, 0, 160);

    expect(await isCollapsed(page, 'phase-1')).toBe(false);
    await expect(page.locator(`${CANVAS_ROW}[data-task-id="group-a"]`)).toBeAttached();
  });

  test('Enter on a focused summary row toggles in Canvas mode too', async ({ page }) => {
    const row = page.locator(`${CANVAS_ROW}[data-task-id="phase-1"]`);
    await row.focus();
    await page.keyboard.press('Enter');

    expect(await isCollapsed(page, 'phase-1')).toBe(true);
    await expect(page.locator(`${CANVAS_ROW}[data-task-id="group-a"]`)).toHaveCount(0);
  });

  test('`aria-rowcount` shrinks to the visible row count after a collapse', async ({ page }) => {
    // `treegrid`, not `grid`: this fixture is hierarchical, and the root role is derived from
    // that (spec-collapse-expand.md §6.4). Derived from the FULL row set, so it stays stable
    // as the padded dataset scrolls.
    const grid = page.locator('[role="treegrid"]');
    const before = Number(await grid.getAttribute('aria-rowcount'));
    expect(before).toBeGreaterThan(2000); // padded dataset

    await clickCanvasRow(page, 0, 14);
    expect(await isCollapsed(page, 'phase-1')).toBe(true);

    const after = Number(await grid.getAttribute('aria-rowcount'));
    // Four rows hidden: group-a, leaf-a1, leaf-a2, leaf-b.
    expect(after).toBe(before - 4);
  });
});
