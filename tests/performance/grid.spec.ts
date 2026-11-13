import { test, expect, type Page } from '@playwright/test';

// Grid columns at scale on the SVG renderer (spec-grid-columns.md 13.6): 2000 rows is exactly the SVG
// threshold. Driving `examples/plain-html-demo/grid.html?rows=2000&wide=1` (tasks spread over ~520
// days, 20 holidays: the span and calendar that made the per-row duration walk cost ~8.4 s in PR #125).
//
// Two kinds of assertion, as in `svg-repaint.spec.ts`: node counts (deterministic everywhere) and
// wall-clock budgets (a coarse backstop; CI is a loaded runner). Budgets are ~2x the median of 5 fresh
// pages on a quiet machine; run `--project=performance` alone (concurrent browsers skew the clock).

interface G {
  updateTask(id: string, p: Record<string, unknown>): unknown;
  setGridColumns(c: unknown[]): void;
  exportGridCsv(): string;
}

async function open(page: Page, query: string): Promise<{ mountMs: number }> {
  await page.goto(`/grid.html?${query}`);
  await page.waitForSelector('#gantt svg.fg-timeline .fg-timeline__row');
  return page.evaluate(() => ({ mountMs: (window as unknown as { __fx: { mountMs: number } }).__fx.mountMs }));
}

const median = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const RUNS = 3;

/** One operation in the page, timed to the end of the second animation frame after it. */
const timed = (page: Page, src: string): Promise<number> =>
  page.evaluate(async (s) => {
    const g = (window as unknown as { __gantt: G }).__gantt;
    const t0 = performance.now();
    // eslint-disable-next-line no-new-func
    new Function('g', s)(g);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    return performance.now() - t0;
  }, src);

// first paint (the mount's two renders: the default width, then the grid's pinned width), median of 3
// measured medians on a loaded dev box (ms): 1 col 2230, 3 cols 1840, 6 cols 1570, 10 cols 1510; the plain
// chart paints in ~1000 (the grid mount is two renders). Backstop budgets, ~2.5x.
const MOUNT_BUDGET_MS: Record<number, number> = { 1: 5500, 3: 5500, 6: 5500, 10: 6000 };

test.describe('mount at 2000 rows (SVG)', () => {
  for (const cols of [1, 3, 6, 10]) {
    test(`${cols} column(s): node count and first paint within budget`, async ({ page }) => {
      test.setTimeout(180_000);
      const samples: number[] = [];
      for (let i = 0; i < RUNS; i++) samples.push((await open(page, `rows=2000&wide=1&cols=${cols}&collapse=0`)).mountMs);
      const nodes = await page.locator('#gantt svg.fg-timeline .fg-timeline__row').count();
      expect(nodes).toBe(2000);
      // every cell is a real <text> in the chart plus a clone in the pinned column
      expect(await page.locator('#gantt svg.fg-timeline [role=gridcell]').count()).toBe(2000 * Math.max(cols, 1));
      const budget = MOUNT_BUDGET_MS[cols]!;
      console.log(`grid mount, ${cols} col(s), 2000 rows: median ${median(samples).toFixed(0)} ms (samples ${samples.map((s) => s.toFixed(0)).join(', ')})`);
      expect(median(samples)).toBeLessThan(budget);
    });
  }

  test('the grid adds a bounded multiple of the plain chart paint (6 columns)', async ({ page }) => {
    test.setTimeout(180_000);
    const plain: number[] = [];
    const grid: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      plain.push((await open(page, 'rows=2000&wide=1&grid=0')).mountMs);
      grid.push((await open(page, 'rows=2000&wide=1&cols=6&collapse=0')).mountMs);
    }
    const ratio = median(grid) / median(plain);
    console.log(`grid 6 cols vs plain at 2000 rows: ${median(grid).toFixed(0)} ms vs ${median(plain).toFixed(0)} ms (x${ratio.toFixed(2)})`);
    expect(ratio).toBeLessThan(4);
  });
});

test.describe('the duration column does not reintroduce the per-row walk (PR #125)', () => {
  test('exportGridCsv over 2000 rows / 520 days / 20 holidays with and without the duration column', async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, 'rows=2000&wide=1&cols=1&collapse=0');
    const run = (cols: string): Promise<number> =>
      page.evaluate((c) => {
        const g = (window as unknown as { __gantt: G }).__gantt;
        g.setGridColumns(JSON.parse(c));
        const t0 = performance.now();
        const csv = g.exportGridCsv();
        const ms = performance.now() - t0;
        if (csv.split('\r\n').length !== 2001) throw new Error('row count');
        return ms;
      }, cols);
    const without: number[] = [];
    const withDuration: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      without.push(await run('[{"id":"name"},{"id":"end"}]'));
      withDuration.push(await run('[{"id":"name"},{"id":"duration"}]'));
    }
    console.log(`csv 2000 rows: end column ${median(without).toFixed(0)} ms, duration column ${median(withDuration).toFixed(0)} ms`);
    // the old per-row walk was ~8400 ms here; one shared meter is a few hundred ms at most
    expect(median(withDuration)).toBeLessThan(1500);
  });

  test('one updateTask repaint with the duration column stays close to the same repaint without it', async ({ page }) => {
    test.setTimeout(180_000);
    const measure = async (cols: string): Promise<number> => {
      const xs: number[] = [];
      for (let i = 0; i < 5; i++) {
        await open(page, `rows=2000&wide=1&cols=1&collapse=0`);
        await page.evaluate((c) => (window as unknown as { __gantt: G }).__gantt.setGridColumns(JSON.parse(c)), cols);
        xs.push(await timed(page, "g.updateTask('filler-5', { name: 'renamed' })"));
      }
      return median(xs);
    };
    const without = await measure('[{"id":"name"},{"id":"start"},{"id":"end"},{"id":"progress"}]');
    const withDuration = await measure('[{"id":"name"},{"id":"start"},{"id":"end"},{"id":"duration"},{"id":"progress"}]');
    console.log(`updateTask repaint: ${without.toFixed(0)} ms without, ${withDuration.toFixed(0)} ms with the duration column`);
    // measured +300 ms on a quiet run; the per-row walk of PR #125 was ~+8000 ms here
    expect(withDuration - without).toBeLessThan(2500);
    expect(withDuration).toBeLessThan(7000);
  });

  test('a selection patch does not re-read any value (rows rebuilt in place)', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, 'rows=2000&wide=1&cols=6&collapse=0');
    const ms = await timed(page, "g.select('filler-9')");
    console.log(`select at 2000 rows with 6 columns: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(800);
  });
});
