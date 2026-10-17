import { test, expect, type Page } from '@playwright/test';
import { centreOf, mouseDrag } from '../helpers/drag.js';

// Desktop e2e for `withEditHooks()` (spec-host-edit-hooks.md §10). Fixture:
// `examples/plain-html-demo/edit-hooks.html` (`src/edit-hooks.ts`), which implements the documented
// host recipes (context menu + rename dialog) and records every relevant event on
// `window.__events`. Rows: `sum` (summary) > `a`, `b`; then `c` -> `d` (FS), all leaves.
// Query params: ?pad=N (Canvas), ?readonly=1, ?nolinks=1, ?prevent=0 (see the page header).

interface LogEntry {
  name: string;
  payload: Record<string, unknown>;
}

const row = (page: Page, id: string) => page.locator(`.fg-timeline__row[data-task-id="${id}"]`);
const barRect = (page: Page, id: string) => page.locator(`.fg-task[data-task-id="${id}"] .fg-task__bar`);
const bar = (page: Page, id: string) => page.locator(`.fg-task[data-task-id="${id}"]`);

async function events(page: Page, name?: string): Promise<LogEntry[]> {
  const all = await page.evaluate(() => (window as unknown as { __events: LogEntry[] }).__events.slice());
  return name ? all.filter((e) => e.name === name) : all;
}
async function clearEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __events: LogEntry[] }).__events.length = 0;
  });
}
async function taskName(page: Page, id: string): Promise<string> {
  return page.evaluate(
    (i) => (window as unknown as { __gantt: { getTask(id: string): { name: string } } }).__gantt.getTask(i).name,
    id,
  );
}
async function taskStart(page: Page, id: string): Promise<string> {
  return page.evaluate((i) => String((window as never as { __gantt: { getTask(id: string): { start: unknown } } }).__gantt.getTask(i).start), id);
}
/** `data-task-id` of the element holding focus, or '<body>' / '<other>'. */
async function focusedTaskId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return '<body>';
    return el.closest('[data-task-id]')?.getAttribute('data-task-id') ?? '<other>';
  });
}
async function focusRow(page: Page, id: string): Promise<void> {
  await page.evaluate((i) => document.querySelector<HTMLElement>(`.fg-timeline__row[data-task-id="${i}"]`)!.focus(), id);
}

/** Reach a row the way a keyboard user does: the roving row starts on `sum` (row 0), then arrow
 *  down. A bare `.focus()` on another row would NOT move keyboard-nav's own position (see the
 *  `test.fixme` below), so it is not a faithful way to "be on" a row. */
async function navTo(page: Page, id: string): Promise<void> {
  const order = ['sum', 'a', 'b', 'c', 'd'];
  await focusRow(page, 'sum');
  for (let i = 0; i < order.indexOf(id); i++) await page.keyboard.press('ArrowDown');
  expect(await focusedTaskId(page)).toBe(id);
  await clearEvents(page);
}

test.describe('SVG renderer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/edit-hooks.html');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    await clearEvents(page);
  });

  test('dblclick on a bar emits one task:activated (part bar), no move, at most one selection:changed', async ({ page }) => {
    const before = await taskStart(page, 'c');
    await bar(page, 'c').dblclick();
    const activated = await events(page, 'task:activated');
    expect(activated).toHaveLength(1);
    expect(activated[0]!.payload).toMatchObject({ taskId: 'c', part: 'bar', source: 'pointer' });
    expect(Number.isFinite(activated[0]!.payload['clientX'])).toBe(true);
    expect((await events(page, 'selection:changed')).length).toBeLessThanOrEqual(1);
    expect(await events(page, 'task:moved')).toHaveLength(0);
    expect(await events(page, 'task:resized')).toHaveLength(0);
    expect(await taskStart(page, 'c')).toBe(before);
    await expect(page.getByRole('dialog', { name: 'Rename task' })).toBeVisible();
  });

  test('dblclick on the label reports part label', async ({ page }) => {
    await page.locator('.fg-timeline__sticky-column .fg-timeline__row-label[data-task-id="c"]').dblclick();
    await page.keyboard.press('Escape');
    const label = await events(page, 'task:activated');
    expect(label).toHaveLength(1);
    expect(label[0]!.payload).toMatchObject({ taskId: 'c', part: 'label' });

  });

  // PRODUCT GAP (spec-host-edit-hooks.md §2.3 says a grid cell reports part 'row', and Canvas does):
  // in the SVG renderer the empty grid area of a task row is `rect.fg-timeline__grid-cell`, which
  // is NOT a descendant of `g.fg-timeline__row` (that group holds only the label and the bar), so
  // `target.closest('.fg-timeline__row')` is null and neither dblclick nor right-click emits
  // anything there. Repro: open /edit-hooks.html, double-click (or right-click) the empty timeline
  // area to the right of Alpha's bar. Expected: task:activated {taskId:'a', part:'row'}. Actual: nothing.
  test('dblclick on the empty grid area of a row reports part row (SVG, as Canvas does)', async ({ page }) => {
    const box = (await barRect(page, 'a').boundingBox())!;
    await page.mouse.dblclick(box.x + box.width + 60, box.y + box.height / 2);
    const hit = await events(page, 'task:activated');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.payload).toMatchObject({ taskId: 'a', part: 'row' });
  });

  test('dblclick on the collapse toggle emits nothing', async ({ page }) => {
    await page.locator('.fg-timeline__sticky-column .fg-timeline__row-toggle[data-task-id="sum"]').dblclick();
    expect(await events(page, 'task:activated')).toHaveLength(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('right-click emits task:context-requested and the host suppresses the native menu', async ({ page }) => {
    await bar(page, 'c').click({ button: 'right' });
    const ctx = await events(page, 'task:context-requested');
    expect(ctx).toHaveLength(1);
    expect(ctx[0]!.payload).toMatchObject({ taskId: 'c', part: 'bar', source: 'pointer' });
    const native = await events(page, 'native:contextmenu');
    expect(native).toHaveLength(1);
    expect(native[0]!.payload['defaultPrevented']).toBe(true);
    await expect(page.getByRole('menu', { name: 'Task actions' })).toBeVisible();
  });

  test('the native menu is NOT suppressed when the host does not call preventDefault()', async ({ page }) => {
    await page.goto('/edit-hooks.html?prevent=0');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    await clearEvents(page);
    await page.locator('.fg-timeline__sticky-column .fg-timeline__row-label[data-task-id="c"]').click({ button: 'right' });
    expect(await events(page, 'task:context-requested')).toHaveLength(1);
    const native = await events(page, 'native:contextmenu');
    expect(native).toHaveLength(1);
    expect(native[0]!.payload['defaultPrevented']).toBe(false);
  });

  test('Enter on a focused leaf row activates it', async ({ page }) => {
    await navTo(page, 'a');
    await page.keyboard.press('Enter');
    const activated = await events(page, 'task:activated');
    expect(activated).toHaveLength(1);
    expect(activated[0]!.payload).toMatchObject({ taskId: 'a', part: 'row', source: 'keyboard' });
    await expect(page.getByRole('dialog', { name: 'Rename task' })).toBeVisible();
  });

  test('Enter on a summary row still collapses it and does not activate', async ({ page }) => {
    await focusRow(page, 'sum');
    await page.keyboard.press('Enter');
    await expect(row(page, 'a')).toHaveCount(0);
    expect(await events(page, 'task:activated')).toHaveLength(0);
    await page.keyboard.press('Enter');
    await expect(row(page, 'a')).toHaveCount(1);
    expect(await events(page, 'task:activated')).toHaveLength(0);
  });

  test('F2 on a summary row activates it (and does not collapse)', async ({ page }) => {
    await focusRow(page, 'sum');
    await page.keyboard.press('F2');
    const activated = await events(page, 'task:activated');
    expect(activated).toHaveLength(1);
    expect(activated[0]!.payload).toMatchObject({ taskId: 'sum', source: 'keyboard' });
    await expect(row(page, 'a')).toHaveCount(1);
  });

  for (const key of ['Shift+F10', 'ContextMenu']) {
    test(`${key} emits task:context-requested exactly once (no duplicate from a synthesized native contextmenu)`, async ({ page }) => {
      await navTo(page, 'c');
      await page.keyboard.press(key);
      // Give a (hypothetical) keyup-time native contextmenu a chance to arrive.
      await page.waitForTimeout(150);
      const ctx = await events(page, 'task:context-requested');
      expect(ctx).toHaveLength(1);
      expect(ctx[0]!.payload).toMatchObject({ taskId: 'c', part: 'row', source: 'keyboard' });
      const box = (await row(page, 'c').boundingBox())!;
      const { clientX, clientY } = ctx[0]!.payload as { clientX: number; clientY: number };
      expect(clientY).toBeGreaterThanOrEqual(box.y);
      expect(clientY).toBeLessThanOrEqual(box.y + box.height);
      expect(clientX).toBeGreaterThanOrEqual(box.x);
      await expect(page.getByRole('menu')).toBeVisible();
    });
  }

  test('click a bar, then ArrowDown moves from the clicked row (keyboard-nav follows the click)', async ({ page }) => {
    await bar(page, 'a').click();
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'b')).toHaveAttribute('aria-selected', 'true');
    await expect(row(page, 'b')).toHaveAttribute('tabindex', '0');
    expect(await focusedTaskId(page)).toBe('b');
  });

  test('readOnly still emits both events', async ({ page }) => {
    await page.goto('/edit-hooks.html?readonly=1');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    await clearEvents(page);
    await bar(page, 'c').dblclick();
    expect(await events(page, 'task:activated')).toHaveLength(1);
    await page.keyboard.press('Escape');
    await bar(page, 'c').click({ button: 'right' });
    expect(await events(page, 'task:context-requested')).toHaveLength(1);
  });

  test('enableDependencyDrag: true (default) renders link handles', async ({ page }) => {
    await expect(page.locator('.fg-task__link-handle').first()).toBeAttached();
  });

  test('enableDependencyDrag: false hides link handles, drag-create-dep does nothing, move and resize still work', async ({ page }) => {
    await page.goto('/edit-hooks.html?nolinks=1');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    await expect(page.locator('.fg-task__link-handle')).toHaveCount(0);
    await clearEvents(page);

    // Attempt a link drag: from where the end handle would be (the bar's right edge, vertically
    // centred) onto `b`'s bar. With no handles this can only be a resize/move of `a`, never a link.
    const a = (await barRect(page, 'a').boundingBox())!;
    const b = (await barRect(page, 'b').boundingBox())!;
    const from = { x: a.x + a.width, y: a.y + a.height / 2 };
    await mouseDrag(page, from, b.x + b.width / 2 - from.x, b.y + b.height / 2 - from.y);
    expect(await events(page, 'dependency:added')).toHaveLength(0);
    expect(await page.evaluate(() => (window as never as { __gantt: { getDependencies(): unknown[] } }).__gantt.getDependencies().length)).toBe(1);

    // Move still works.
    await clearEvents(page);
    const before = await taskStart(page, 'c');
    await mouseDrag(page, await centreOf(bar(page, 'c')), 24 * 3);
    await expect.poll(async () => (await events(page, 'task:moved')).length).toBeGreaterThan(0);
    expect(await taskStart(page, 'c')).not.toBe(before);

    // Resize still works: drag the right edge of `d`, inset 3 px.
    await clearEvents(page);
    const d = (await barRect(page, 'd').boundingBox())!;
    await mouseDrag(page, { x: d.x + d.width - 6, y: d.y + d.height / 2 }, 24 * 2);
    await expect.poll(async () => (await events(page, 'task:resized')).length).toBeGreaterThan(0);
  });

  // PRODUCT BUG (found by this suite, extends review finding 8): keyboard-nav keeps its own
  // `focusedTaskId` and does not follow DOM focus. Repro: right-click the bar of `c` (the menu
  // opens, DOM focus is on row `c`), press Escape (the documented focus-return recipe puts focus
  // back on `c`), press Enter. Expected: `task:activated` for `c`. Actual: nothing is emitted and
  // the SUMMARY `sum` collapses, because keyboard-nav still believes the roving row is `sum`
  // (a summary -> it toggles and preventDefault()s, so the edit-hooks mixin sees defaultPrevented).
  // The same happens after the host restores focus to a row with `.focus()` following the dialog.
  test('right-click a row, Escape, then Enter acts on the row that has focus (not a stale roving row)', async ({ page }) => {
    await bar(page, 'c').click({ button: 'right' });
    await page.keyboard.press('Escape');
    expect(await focusedTaskId(page)).toBe('c');
    await clearEvents(page);
    await page.keyboard.press('Enter');
    expect(await events(page, 'task:activated')).toHaveLength(1);
    await expect(row(page, 'a')).toHaveCount(1); // `sum` must not have collapsed
  });

  test('full flow: right-click -> menu -> Rename -> dialog -> type -> Enter -> name updated -> focus back on the row', async ({ page }) => {
    await bar(page, 'c').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Task actions' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(2);
    await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
    await menu.getByRole('menuitem', { name: 'Rename' }).click();
    await expect(menu).toHaveCount(0);

    const dlg = page.getByRole('dialog', { name: 'Rename task' });
    await expect(dlg).toBeVisible();
    const input = dlg.getByLabel('Task name');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Charlie');
    await input.fill('Charlie renamed');
    await page.keyboard.press('Enter');

    await expect(dlg).toHaveCount(0);
    expect(await taskName(page, 'c')).toBe('Charlie renamed');
    await expect.poll(() => focusedTaskId(page)).toBe('c');
  });

  test('keyboard-only flow: Shift+F10 -> Escape returns focus to the row; Enter opens the dialog, Escape returns focus', async ({ page }) => {
    await navTo(page, 'c');
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await focusedTaskId(page)).toBe('c');

    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Task name')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await focusedTaskId(page)).toBe('c');

    // Menu -> Enter on Rename -> type -> Enter, all from the keyboard.
    await page.keyboard.press('ContextMenu');
    await page.keyboard.press('Enter');
    await page.getByLabel('Task name').fill('Kbd');
    await page.keyboard.press('Enter');
    expect(await taskName(page, 'c')).toBe('Kbd');
    expect(await focusedTaskId(page)).toBe('c');
  });
});

// Canvas mode: 5 named rows + 2100 filler rows crosses CANVAS_AUTO_SWITCH_THRESHOLD (2000).
// Canvas rows have no geometry of their own (the ARIA layer is 1 px), so pointer coordinates are
// derived from the <canvas> rect and the renderer constants, like collapse-expand.spec.ts does.
const HEADER = 32;
const ROW_H = 32;
const LABEL_W = 160;

test.describe('Canvas renderer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/edit-hooks.html?pad=2100');
    await expect(page.locator('canvas.fg-timeline-canvas')).toBeVisible();
    await expect(page.locator('.fg-timeline-canvas__row').first()).toBeAttached();
    await clearEvents(page);
  });

  /** Client y of the middle of painted row `idx`, given the container's current scrollTop. */
  async function rowPoint(page: Page, idx: number, x: number) {
    const box = (await page.locator('canvas.fg-timeline-canvas').boundingBox())!;
    const scrollTop = await page.evaluate(() => document.getElementById('gantt')!.scrollTop);
    return { x: box.x + x, y: box.y + HEADER + idx * ROW_H - scrollTop + ROW_H / 2, box };
  }

  test('dblclick resolves the right row at the top (label vs row part)', async ({ page }) => {
    const label = await rowPoint(page, 3, LABEL_W / 2);
    await page.mouse.dblclick(label.x, label.y);
    let ev = await events(page, 'task:activated');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ taskId: 'c', part: 'label', source: 'pointer' });
    await page.keyboard.press('Escape');

    await clearEvents(page);
    const grid = await rowPoint(page, 3, LABEL_W + 200);
    await page.mouse.dblclick(grid.x, grid.y);
    ev = await events(page, 'task:activated');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ taskId: 'c', part: 'row' });
  });

  test('dblclick and right-click hit the correct row at a scrolled position', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('gantt')!.scrollTop = 20000;
    });
    // First painted row index under the viewport after scrolling.
    const idx = 20000 / ROW_H + 3;
    const p = await rowPoint(page, idx, LABEL_W + 100);
    await page.mouse.dblclick(p.x, p.y);
    const act = await events(page, 'task:activated');
    expect(act).toHaveLength(1);
    // Rows 0-4 are named, so row `idx` is filler-(idx - 5).
    expect(act[0]!.payload).toMatchObject({ taskId: `filler-${idx - 5}`, part: 'row' });
    await page.keyboard.press('Escape');

    await clearEvents(page);
    const l = await rowPoint(page, idx, 30);
    await page.mouse.click(l.x, l.y, { button: 'right' });
    const ctx = await events(page, 'task:context-requested');
    expect(ctx).toHaveLength(1);
    expect(ctx[0]!.payload).toMatchObject({ taskId: `filler-${idx - 5}`, part: 'label', source: 'pointer' });
    expect((await events(page, 'native:contextmenu'))[0]!.payload['defaultPrevented']).toBe(true);
  });

  test('Shift+F10 anchor falls inside the painted row rect (top and scrolled)', async ({ page }) => {
    // Reach the row with real ArrowDown presses (keyboard-nav owns the roving position and
    // scrolls the focused row into view; a bare `.focus()` on a Canvas ARIA row is overridden).
    const arrowTo = async (idx: number) => {
      await page.evaluate(() => document.querySelector<HTMLElement>('.fg-timeline-canvas__row[data-row-index="0"]')!.focus({ preventScroll: true }));
      for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown');
      await clearEvents(page);
    };

    await arrowTo(3);
    await page.keyboard.press('Shift+F10');
    let ctx = await events(page, 'task:context-requested');
    expect(ctx).toHaveLength(1);
    expect(ctx[0]!.payload['taskId']).toBe('c');
    let r = await rowPoint(page, 3, 0);
    let { clientX, clientY } = ctx[0]!.payload as { clientX: number; clientY: number };
    expect(clientY).toBeGreaterThanOrEqual(r.y - ROW_H / 2);
    expect(clientY).toBeLessThanOrEqual(r.y + ROW_H / 2);
    expect(clientX).toBeGreaterThan(r.box.x + 1);
    await page.keyboard.press('Escape');

    test.setTimeout(90_000);
    await page.goto('/edit-hooks.html?pad=2100');
    await expect(page.locator('.fg-timeline-canvas__row').first()).toBeAttached();
    const idx = 19; // just below the first viewport (600 px container, ~17 rows): keyboard-nav scrolls to it
    await arrowTo(idx);
    expect(await page.evaluate(() => document.getElementById('gantt')!.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Shift+F10');
    ctx = await events(page, 'task:context-requested');
    expect(ctx).toHaveLength(1);
    r = await rowPoint(page, idx, 0);
    ({ clientX, clientY } = ctx[0]!.payload as { clientX: number; clientY: number });
    expect(clientY).toBeGreaterThanOrEqual(r.y - ROW_H / 2);
    expect(clientY).toBeLessThanOrEqual(r.y + ROW_H / 2);
    expect(clientX).toBeGreaterThan(r.box.x + 1);
  });
});
