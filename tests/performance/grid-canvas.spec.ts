import { test, expect, type Page } from '@playwright/test';

// Grid columns at scale on the CANVAS renderer (spec-grid-columns.md 13.6; PR G2): 5000 rows x 6 columns
// (`grid.html?rows=5000&wide=1&cols=6`, tasks over ~520 days with 20 holidays, so the duration column also
// exercises the shared working-hours table that replaced the per-row walk of PR #125). Two budgets, as in
// `grid.spec.ts`: the time from `mount()` until the grid is painted (the Canvas chunk, then the lazy
// `canvas-grid` chunk, then the first grid paint) and a scroll loop over the virtualized window, each
// against the same chart WITHOUT the grid (`grid=0`). Wall-clock numbers are a coarse backstop (CI is a
// loaded runner); run `--project=performance` alone, concurrent browsers skew the clock.

const ROWS = 5000;
const RUNS = 3;
const median = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const p95 = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;

/** Opens the fixture and returns the ms from the `mount()` call to the first paint that holds the grid. */
async function readyMs(page: Page, query: string, grid: boolean, width = 772): Promise<number> {
  await page.addInitScript(
    ([g, w]) => {
      const timer = setInterval(() => {
        const labels = document.querySelector('canvas.fg-timeline-canvas-labels') as HTMLCanvasElement | null;
        const layer = document.querySelector('.fg-timeline-a11y-layer');
        const ok = g ? labels?.width === w && layer?.hasAttribute('aria-colcount') : !!labels && !!layer;
        if (ok) {
          (window as unknown as { __readyAt: number }).__readyAt = performance.now();
          clearInterval(timer);
        }
      }, 2);
    },
    [grid, width] as const,
  );
  await page.goto(`/grid.html?${query}`);
  await page.waitForFunction(() => '__readyAt' in window, undefined, { timeout: 120_000 });
  return page.evaluate(() => {
    const w = window as unknown as { __readyAt: number; __fx: { t0: number } };
    return w.__readyAt - w.__fx.t0;
  });
}

/** `steps` vertical scroll steps of 10 rows, each timed to the end of the next frame. */
async function scrollMs(page: Page, steps: number): Promise<number[]> {
  return page.evaluate(async (n) => {
    const c = document.getElementById('gantt')!;
    const out: number[] = [];
    for (let i = 1; i <= n; i++) {
      const t0 = performance.now();
      c.scrollTop = i * 320;
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      out.push(performance.now() - t0);
    }
    return out;
  }, steps);
}

test.describe(`${ROWS} rows x 6 columns on Canvas`, () => {
  test('mount until the grid is painted, against the same Canvas chart without it', async ({ page }) => {
    test.setTimeout(240_000);
    const plain: number[] = [];
    const grid: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      plain.push(await readyMs(page, `rows=${ROWS}&wide=1&grid=0`, false));
      grid.push(await readyMs(page, `rows=${ROWS}&wide=1&cols=6&collapse=0`, true));
    }
    const nodes = await page.locator('#gantt .fg-timeline-a11y-layer *').count();
    console.log(
      `canvas ${ROWS} rows x 6 cols: grid painted ${median(grid).toFixed(0)} ms after mount() (samples ${grid.map((x) => x.toFixed(0)).join(', ')}); ` +
        `plain canvas ${median(plain).toFixed(0)} ms (${plain.map((x) => x.toFixed(0)).join(', ')}); a11y layer ${nodes} nodes`,
    );
    // the grid adds the lazy chunk, one extra paint and one meter over the span: seconds, not tens of seconds
    expect(median(grid)).toBeLessThan(median(plain) + 3000);
    expect(median(grid)).toBeLessThan(8000);
    // the a11y layer is windowed, not O(rows): header + ~60 rows x (cells + children)
    expect(nodes).toBeLessThan(1500);
  });

  test('scrolling repaints a bounded window: per-frame cost with the grid vs without it', async ({ page }) => {
    test.setTimeout(240_000);
    await readyMs(page, `rows=${ROWS}&wide=1&grid=0`, false);
    const plain = await scrollMs(page, 60);
    await readyMs(page, `rows=${ROWS}&wide=1&cols=6&collapse=0`, true);
    const grid = await scrollMs(page, 60);
    console.log(
      `canvas ${ROWS} rows scroll step (2 frames): grid median ${median(grid).toFixed(1)} ms, p95 ${p95(grid).toFixed(1)} ms; ` +
        `plain median ${median(plain).toFixed(1)} ms, p95 ${p95(plain).toFixed(1)} ms`,
    );
    // the plain Canvas chart already pays O(rows) layout per frame (~150 ms here); the grid must stay a small
    // multiple of that (it paints one window of cells and builds one window of a11y cells, never O(rows))
    expect(median(grid)).toBeLessThan(median(plain) * 1.5 + 25);
    expect(p95(grid)).toBeLessThan(p95(plain) * 1.5 + 50);
  });

  test('a repaint after an edit with the duration column stays close to the same repaint without it', async ({ page }) => {
    test.setTimeout(240_000);
    const measure = async (cols: string): Promise<number> => {
      const xs: number[] = [];
      for (let i = 0; i < 3; i++) {
        await readyMs(page, `rows=${ROWS}&wide=1&cols=1&collapse=0`, true, 220);
        await page.evaluate((c) => (window as unknown as { __gantt: { setGridColumns(c: unknown): void } }).__gantt.setGridColumns(JSON.parse(c)), cols);
        xs.push(
          await page.evaluate(async () => {
            const g = (window as unknown as { __gantt: { updateTask(id: string, p: object): unknown } }).__gantt;
            const t0 = performance.now();
            g.updateTask('filler-5', { name: 'renamed' });
            await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
            return performance.now() - t0;
          }),
        );
      }
      return median(xs);
    };
    const without = await measure('[{"id":"name"},{"id":"start"},{"id":"end"},{"id":"progress"}]');
    const withDuration = await measure('[{"id":"name"},{"id":"start"},{"id":"end"},{"id":"duration"},{"id":"progress"}]');
    console.log(`canvas ${ROWS} rows updateTask repaint: ${without.toFixed(0)} ms without, ${withDuration.toFixed(0)} ms with the duration column`);
    expect(withDuration - without).toBeLessThan(2500);
  });
});
