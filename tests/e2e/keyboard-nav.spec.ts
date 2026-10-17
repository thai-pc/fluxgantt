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

async function getViewMode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { getViewMode(): string } }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    return g.getViewMode();
  });
}

async function getTaskCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { getTasks(): unknown[] } }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    return g.getTasks().length;
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

test('the grid root carries role="treegrid" and exactly one row has tabindex="0"', async ({ page }) => {
  // `treegrid`, not `grid`: `/selection.html`'s fixture is hierarchical (`phase-1` parents two
  // rows), so its rows carry `aria-expanded`, which WAI-ARIA permits only under `treegrid`
  // (spec-collapse-expand.md §6.4). A flat project still renders a plain `grid`.
  await expect(page.locator('svg[role="treegrid"]')).toBeVisible();
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

// Cross-platform modifier key convention already established in selection.spec.ts:45.
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test('Ctrl/Cmd+Z undoes a Delete', async ({ page }) => {
  await focusFirstRow(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); // -> sibling-a, selected
  expect(await getSelection(page)).toEqual(['sibling-a']);

  await page.keyboard.press('Delete');
  await expect(row(page, 'sibling-a')).toHaveCount(0);

  await page.keyboard.press(`${modifier}+z`);
  await expect(row(page, 'sibling-a')).toBeVisible();
});

test('Ctrl/Cmd+Shift+Z redoes', async ({ page }) => {
  await focusFirstRow(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); // -> sibling-a, selected

  await page.keyboard.press('Delete');
  await page.keyboard.press(`${modifier}+z`);
  await expect(row(page, 'sibling-a')).toBeVisible();

  await page.keyboard.press(`${modifier}+Shift+Z`);
  await expect(row(page, 'sibling-a')).toHaveCount(0);
});

test('read-only chart: Ctrl/Cmd+Z is a no-op', async ({ page }) => {
  await page.goto('/read-only.html');
  await focusFirstRow(page);

  const beforeCount = await page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { getTasks(): unknown[] } }).__gantt;
    return g ? g.getTasks().length : -1;
  });

  await page.keyboard.press('Delete'); // already covered as a no-op elsewhere; re-asserted here
  await page.keyboard.press(`${modifier}+z`);

  const afterCount = await page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { getTasks(): unknown[] } }).__gantt;
    return g ? g.getTasks().length : -1;
  });
  expect(afterCount).toBe(beforeCount);
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

test('Ctrl/Cmd+= zooms in', async ({ page }) => {
  await focusFirstRow(page);
  const before = await getViewMode(page);

  await page.keyboard.press(`${modifier}+=`);

  const after = await getViewMode(page);
  expect(after).not.toBe(before);
});

test('Ctrl/Cmd+- zooms out', async ({ page }) => {
  await focusFirstRow(page);
  const before = await getViewMode(page);

  await page.keyboard.press(`${modifier}+-`);

  const after = await getViewMode(page);
  expect(after).not.toBe(before);
});

test('read-only chart: Ctrl/Cmd+= still zooms', async ({ page }) => {
  await page.goto('/read-only.html');
  await focusFirstRow(page);
  const before = await getViewMode(page);

  await page.keyboard.press(`${modifier}+=`);

  const after = await getViewMode(page);
  expect(after).not.toBe(before);
});

test('no visible double-zoom regression: page-level zoom stays unaffected by Ctrl/Cmd+=/- (best-effort)', async ({ page }) => {
  await focusFirstRow(page);
  const scaleBefore = await page.evaluate(() => window.visualViewport?.scale);

  await page.keyboard.press(`${modifier}+=`);
  await page.keyboard.press(`${modifier}+-`);

  const scaleAfter = await page.evaluate(() => window.visualViewport?.scale);
  expect(scaleAfter).toBe(scaleBefore);
});

test('Ctrl/Cmd+D duplicates the selected task', async ({ page }) => {
  await focusFirstRow(page);
  const before = await getTaskCount(page);

  await page.keyboard.press('ArrowDown'); // -> phase-1-task-a, selected
  await page.keyboard.press(`${modifier}+d`);

  const after = await getTaskCount(page);
  expect(after).toBe(before + 1);
});

test('selection moves to the new copy after Ctrl/Cmd+D', async ({ page }) => {
  await focusFirstRow(page);
  await page.keyboard.press('ArrowDown'); // -> phase-1-task-a, selected
  const before = await getSelection(page);

  await page.keyboard.press(`${modifier}+d`);

  const after = await getSelection(page);
  expect(after).toHaveLength(1);
  expect(after[0]).not.toBe(before[0]);
});

test('read-only chart: Ctrl/Cmd+D is a no-op', async ({ page }) => {
  await page.goto('/read-only.html');
  await focusFirstRow(page);
  await page.keyboard.press('ArrowDown');
  const beforeCount = await getTaskCount(page);
  const beforeSelection = await getSelection(page);

  await page.keyboard.press(`${modifier}+d`);

  const afterCount = await getTaskCount(page);
  const afterSelection = await getSelection(page);
  expect(afterCount).toBe(beforeCount);
  expect(afterSelection).toEqual(beforeSelection);
});

test('no native bookmark-dialog interference: page stays intact after Ctrl/Cmd+D (best-effort)', async ({ page }) => {
  await focusFirstRow(page);
  await page.keyboard.press('ArrowDown');

  await page.keyboard.press(`${modifier}+d`);

  await expect(page.locator('svg.fg-timeline')).toBeVisible();
});

// --- Keep the keyboard-focused row visible (spec-keyboard-focus-scroll.md) ----------------------
//
// Fixture: `/collapse.html?pad=60` — 420px `overflow: auto` container, SVG mode, `filler-N` rows.
// The pinned 32px date axis covers the top of the container's client area, so a focused row is
// "visible" only inside `[origin + 32, origin + clientHeight]`.

const HEADER = 32;

async function containerBox(page: Page) {
  return page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    const r = c.getBoundingClientRect();
    return { top: r.top + c.clientTop, h: c.clientHeight };
  });
}

async function setScroll(page: Page, top: number, left = 0): Promise<void> {
  await page.evaluate(
    ([t, l]) => {
      const c = document.getElementById('gantt')!;
      c.scrollTop = t as number;
      c.scrollLeft = l as number;
    },
    [top, left] as const,
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

const scrollOf = (page: Page) =>
  page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    return { top: c.scrollTop, left: c.scrollLeft };
  });

// `tol`: a row's painted box can poke ~1px past its slot (bar outline / focus ring), more at 24px rows.
async function expectFocusedRowInBand(page: Page, tol = 1): Promise<void> {
  const c = await containerBox(page);
  const id = await page.evaluate(() => document.activeElement?.getAttribute('data-task-id'));
  const box = (await row(page, id!).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(c.top + HEADER - tol);
  expect(box.y + box.height).toBeLessThanOrEqual(c.top + c.h + tol);
}

test.describe('keeps the focused row visible (SVG)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html?pad=60');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    await focusFirstRow(page);
  });

  for (const shift of [false, true]) {
    test(`${shift ? 'Shift+' : ''}ArrowDown past the bottom keeps the row below the header, scrollLeft untouched`, async ({
      page,
    }) => {
      await setScroll(page, 0, 80);
      const left = (await scrollOf(page)).left;
      expect(left).toBeGreaterThan(0);
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press(shift ? 'Shift+ArrowDown' : 'ArrowDown');
        await expectFocusedRowInBand(page);
        expect((await scrollOf(page)).left).toBe(left);
      }
      expect((await scrollOf(page)).top).toBeGreaterThan(0);
    });
  }

  test('ArrowUp onto a row above the fold lands it below the header band', async ({ page }) => {
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
    // Focus is row 30 (y = 960). Scroll BELOW it so the predecessor sits above the view, then
    // ArrowUp must pin that row to the top of the band.
    await setScroll(page, 1200);
    await page.keyboard.press('ArrowUp');
    await expectFocusedRowInBand(page);
    // And one case where the predecessor is BELOW the view (bottom-flush branch).
    await setScroll(page, 400);
    await page.keyboard.press('ArrowUp');
    await expectFocusedRowInBand(page);
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('ArrowUp');
      await expectFocusedRowInBand(page);
    }
  });

  test('a pointer click on a fully or partly visible row does not scroll', async ({ page }) => {
    const c = await containerBox(page);
    await setScroll(page, 0);
    await page.mouse.click(400, c.top + HEADER + 48);
    expect((await scrollOf(page)).top).toBe(0);
    await setScroll(page, 10); // row 0 is now partly under the band
    await page.mouse.click(400, c.top + HEADER + 20);
    expect((await scrollOf(page)).top).toBe(10);
  });

  test('prefers-reduced-motion: the scroll lands in the same frame', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const tops: number[] = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('ArrowDown');
      // Read without waiting a frame: an animated scroll would still be at the old offset.
      tops.push((await scrollOf(page)).top);
      await expectFocusedRowInBand(page);
    }
    expect(tops[tops.length - 1]).toBeGreaterThan(0);
  });
});

// setDensity() after mount changes the painted row height; the reveal must follow it. `compact`
// needs many rows: the browser's scroll clamp hides an overshoot on a short list.
for (const [density, pad, presses] of [
  ['touch', 40, 15],
  ['compact', 120, 60],
] as const) {
  test(`setDensity('${density}') after mount: the focused row stays in the band`, async ({ page }) => {
    await page.goto(`/collapse.html?pad=${pad}`);
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    await focusFirstRow(page);
    await page.evaluate((d) => (window as unknown as { __gantt: { setDensity(d: string): void } }).__gantt.setDensity(d), density);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await focusFirstRow(page);
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('ArrowDown');
      await expectFocusedRowInBand(page, 3); // un-fixed overshoot is tens of px
    }
  });
}

test('Canvas mode: ArrowDown past the bottom and back stays in the row band, no double scroll', async ({
  page,
}) => {
  await page.goto('/canvas-a11y-harness.html');
  const container = page.locator('#gantt');
  await page.locator('.fg-timeline-a11y-layer [tabindex="0"]').first().focus();
  for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowDown');
  // Canvas-only expectation (row 25 bottom 832 - 568px band), identical to a11y/canvas-renderer.
  expect(await container.evaluate((el) => el.scrollTop)).toBe(264);
  for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowUp');
  expect(await container.evaluate((el) => el.scrollTop)).toBe(0);
});

// Canvas-mode regression guard without the old hard-coded geometry: a >2000-row `createGantt()`
// chart under two container heights (the Canvas viewport follows the container). The SVG helper
// is gated off, so the final offset must equal Canvas's own expectation, never double-scrolled.
for (const height of [420, 250]) {
  test(`Canvas (createGantt, ${height}px container): no double scroll`, async ({ page }) => {
    await page.goto('/collapse.html?pad=2100');
    await page.evaluate((h) => (document.getElementById('gantt')!.style.height = `${h}px`), height);
    await page.locator('.fg-timeline-a11y-layer [tabindex="0"]').first().focus();
    const n = 30;
    for (let i = 0; i < n; i++) await page.keyboard.press('ArrowDown');
    const { top, ch } = await page.evaluate(() => {
      const c = document.getElementById('gantt')!;
      return { top: c.scrollTop, ch: c.clientHeight };
    });
    // Row index n sits at y = 32 * n (default density); minimal bottom-flush scroll.
    expect(top).toBe(Math.max(0, 32 * n + 32 - (ch - HEADER)));
  });
}
