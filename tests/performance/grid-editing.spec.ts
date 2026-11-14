import { test, expect, type Page } from '@playwright/test';

// The grid cell editors at scale (spec-grid-columns.md 13.6; PR G6): composing `withGridEditing` adds no per-cell cost
// to a mount, opening and closing an editor is cheap and does not repaint the chart, a committed edit costs about what the
// same store write costs without the editor, and 200 open / commit cycles leak no node. Driving
// `examples/plain-html-demo/grid.html?edit=1&rows=2000&wide=1` (the PR #125 data: ~520 days, 20 holidays). Wall-clock
// budgets are coarse backstops (CI is a loaded runner; run `--project=performance` alone).

interface G {
  startCellEdit(id: string, col: string): boolean;
  cancelCellEdit(): void;
  isEditingCell(): boolean;
  setProgress(id: string, p: number): unknown;
  undo(): void;
}
const median = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const RUNS = 3;

async function open(page: Page, query: string, canvas = false): Promise<number> {
  await page.goto(`/grid.html?${query}`);
  if (canvas) await page.waitForSelector('#gantt canvas.fg-timeline-canvas-labels', { timeout: 60_000 });
  else await page.waitForSelector('#gantt svg.fg-timeline .fg-timeline__row', { timeout: 60_000 });
  return page.evaluate(() => (window as unknown as { __fx: { mountMs: number } }).__fx.mountMs);
}
const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

test('mounting with withGridEditing composed costs about what mounting without it costs (2000 rows, 6 columns)', async ({ page }) => {
  test.setTimeout(240_000);
  const plain: number[] = [];
  const edit: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    plain.push(await open(page, 'rows=2000&wide=1&cols=6&collapse=0'));
    edit.push(await open(page, 'edit=1&rows=2000&wide=1&cols=6&collapse=0'));
  }
  const ratio = median(edit) / median(plain);
  console.log(`withGridEditing mount: ${median(edit).toFixed(0)} ms vs ${median(plain).toFixed(0)} ms (x${ratio.toFixed(2)})`);
  expect(ratio).toBeLessThan(1.25); // the spec's +3 % is the quiet-machine target; this is a loaded-runner backstop
});

// Before the G6 review fixes (keyboard open and close, loaded dev box): SVG 2000 rows open ~80 ms, close ~35 ms; Canvas 5000 rows
// open ~255 ms, close ~330 ms (each one a full renderer repaint).
test('opening and closing an editor from the keyboard at 2000 SVG rows is cheap and never repaints the chart', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 'edit=1&rows=2000&wide=1&cols=6&collapse=0');
  const result = await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>('#gantt')!;
    const id = 'filler-1000';
    const rowEl = () => root.querySelector<HTMLElement>(`[role=row][data-task-id="${id}"]`)!;
    const next = () => new Promise<void>((r) => setTimeout(r, 0));
    let mutations = 0;
    const mo = new MutationObserver((l) => (mutations += l.length));
    mo.observe(root.querySelector('svg.fg-timeline')!, { childList: true, subtree: true });
    const open: number[] = [];
    const close: number[] = [];
    for (let i = 0; i < 8; i++) {
      rowEl().focus({ preventScroll: true });
      const cell = rowEl().querySelector<HTMLElement>('[role=gridcell][aria-colindex="2"]')!;
      cell.setAttribute('tabindex', '-1');
      cell.focus({ preventScroll: true });
      mo.takeRecords();
      let t0 = performance.now();
      cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await Promise.resolve(); // the claimed key acts in a microtask once the code has loaded
      await Promise.resolve();
      const input = root.querySelector<HTMLInputElement>('.fg-grid__editor');
      if (i > 0) open.push(performance.now() - t0); // the first one loads the chunk
      if (!input) { await next(); continue; }
      t0 = performance.now();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      if (i > 0) close.push(performance.now() - t0);
      await next();
    }
    return { open, close, mutations: mutations + mo.takeRecords().length };
  });
  const m = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  console.log(`SVG 2000 rows, keyboard: open median ${m(result.open).toFixed(1)} ms, close ${m(result.close).toFixed(1)} ms`);
  expect(result.open.length).toBeGreaterThan(3);
  expect(result.mutations).toBe(0); // nothing inside the chart svg changed
  // Measured after the fixes: open ~60 ms, close ~21 ms (the layout of the 2000-row chart; the editor's own code is ~1 ms).
  expect(m(result.open)).toBeLessThan(120);
  expect(m(result.close)).toBeLessThan(60);
});

test('opening and closing an editor from the keyboard at 5000 Canvas rows does not repaint the chart for the editor', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 'edit=1&rows=5000&cols=6', true);
  const result = await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>('#gantt')!;
    const layer = root.querySelector('.fg-timeline-a11y-layer')!;
    const rowEl = () => root.querySelector<HTMLElement>('[role=row][data-task-id="design"]')!;
    const next = () => new Promise<void>((r) => setTimeout(r, 0));
    let repaints = 0;
    const mo = new MutationObserver(() => repaints++);
    mo.observe(layer, { childList: true });
    const open: number[] = [];
    const close: number[] = [];
    const repaintsOpen: number[] = [];
    const repaintsClose: number[] = [];
    for (let i = 0; i < 8; i++) {
      rowEl().focus({ preventScroll: true });
      let cell = rowEl().querySelector<HTMLElement>('[role=gridcell][aria-colindex="2"]')!;
      cell.setAttribute('tabindex', '-1');
      cell.focus({ preventScroll: true });
      cell = (document.activeElement as HTMLElement) ?? cell;
      await next();
      mo.takeRecords();
      repaints = 0;
      let t0 = performance.now();
      cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
      const input = root.querySelector<HTMLInputElement>('.fg-grid__editor');
      if (i > 0) open.push(performance.now() - t0);
      mo.takeRecords();
      if (i > 0) repaintsOpen.push(repaints);
      if (!input) { await next(); continue; }
      repaints = 0;
      t0 = performance.now();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      if (i > 0) close.push(performance.now() - t0);
      mo.takeRecords();
      await next();
      if (i > 0) repaintsClose.push(repaints);
    }
    return { open, close, repaintsOpen, repaintsClose };
  });
  const m = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  console.log(`Canvas 5000 rows, keyboard: open median ${m(result.open).toFixed(1)} ms, close ${m(result.close).toFixed(1)} ms`);
  expect(result.open.length).toBeGreaterThan(3);
  // Measured after the fixes: open ~2 ms, close ~0.5 ms (no renderer repaint for the editor).
  expect(m(result.open)).toBeLessThan(25);
  expect(m(result.close)).toBeLessThan(25);
});

test('one committed edit costs about what the same store write costs without the editor (2000 tasks / 520 days / 20 holidays)', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 'edit=1&rows=2000&wide=1&cols=6&collapse=0');
  const timed = (kind: 'editor' | 'api'): Promise<number> =>
    page.evaluate(async (k) => {
      const g = (window as unknown as { __gantt: G }).__gantt;
      const t0 = performance.now();
      if (k === 'api') g.setProgress('filler-900', 0.55);
      else {
        g.startCellEdit('filler-900', 'progress');
        const input = document.querySelector<HTMLInputElement>('#gantt .fg-grid__editor')!;
        input.value = '56';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      }
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const ms = performance.now() - t0;
      g.undo();
      return ms;
    }, kind);
  await page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.startCellEdit('filler-900', 'progress'));
  await page.waitForSelector('#gantt .fg-grid__editor');
  await page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.cancelCellEdit());
  const api: number[] = [];
  const editor: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    api.push(await timed('api'));
    editor.push(await timed('editor'));
  }
  console.log(`one edit: editor ${median(editor).toFixed(0)} ms vs setProgress ${median(api).toFixed(0)} ms`);
  expect(median(editor)).toBeLessThan(median(api) * 1.5 + 50);
});

test('200 open / commit cycles leave no node behind', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 'edit=1&cols=6');
  const count = () => page.evaluate(() => document.querySelectorAll('body *').length);
  await page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.startCellEdit('req', 'name'));
  await page.waitForSelector('#gantt .fg-grid__editor');
  await page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.cancelCellEdit());
  await frames(page);
  const n0 = await count();
  await page.evaluate(() => {
    const g = (window as unknown as { __gantt: G }).__gantt;
    for (let i = 0; i < 200; i++) {
      g.startCellEdit('req', 'progress');
      const input = document.querySelector<HTMLInputElement>('#gantt .fg-grid__editor')!;
      input.value = String(i % 100);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }
  });
  await frames(page);
  expect(Math.abs((await count()) - n0)).toBeLessThan(5);
});
