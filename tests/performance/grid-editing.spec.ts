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

test('opening and closing an editor at 2000 SVG rows is cheap and never repaints the chart', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 'edit=1&rows=2000&wide=1&cols=6&collapse=0');
  await page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.startCellEdit('filler-1000', 'name'));
  await page.waitForSelector('#gantt .fg-grid__editor'); // the editor code has loaded
  await page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.cancelCellEdit());
  const r = await page.evaluate(() => {
    const g = (window as unknown as { __gantt: G }).__gantt;
    let mutations = 0;
    const mo = new MutationObserver((l) => (mutations += l.length));
    mo.observe(document.querySelector('#gantt svg.fg-timeline')!, { childList: true, subtree: true });
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      (document.activeElement as HTMLElement | null)?.blur();
      const t0 = performance.now();
      g.startCellEdit(`filler-${1000 + i}`, 'start');
      document.querySelector<HTMLElement>('#gantt .fg-grid__editor')!.blur(); // closes it: a blur commits nothing here
      times.push(performance.now() - t0);
    }
    return { times, takeRecords: mo.takeRecords().length + mutations };
  });
  // Measured ~110 ms on a loaded dev box: inserting and removing the host makes the browser lay out the 2000-row SVG layer
  // twice (an absolutely positioned host halves it, but cannot pin to the grid column); the editor's own code is ~1 ms.
  console.log(`open+close at 2000 SVG rows: median ${median(r.times).toFixed(1)} ms`);
  expect(r.takeRecords).toBe(0); // nothing inside the chart svg changed: no repaint
  expect(median(r.times)).toBeLessThan(300);
});

test('opening and closing an editor at 5000 Canvas rows is O(1)', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 'edit=1&rows=5000&cols=6', true);
  await page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.startCellEdit('req', 'name'));
  await page.waitForSelector('#gantt .fg-grid__editor');
  await page.evaluate(() => (window as unknown as { __gantt: G }).__gantt.cancelCellEdit());
  const times = await page.evaluate(() => {
    const g = (window as unknown as { __gantt: G }).__gantt;
    const out: number[] = [];
    for (let i = 0; i < 10; i++) {
      (document.activeElement as HTMLElement | null)?.blur();
      const t0 = performance.now();
      g.startCellEdit('design', 'start');
      document.querySelector<HTMLElement>('#gantt .fg-grid__editor')!.blur();
      out.push(performance.now() - t0);
    }
    return out;
  });
  // Opening does not touch the chart (~4 ms measured). Closing with Escape or Enter returns focus to the a11y cell, which makes
  // the Canvas renderer repaint its window on `focusin` (the renderer's own cost, as for any cell focus): that is not measured here.
  console.log(`open+close at 5000 Canvas rows: median ${median(times).toFixed(1)} ms`);
  expect(median(times)).toBeLessThan(100);
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
