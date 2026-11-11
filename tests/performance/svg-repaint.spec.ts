import { test, expect } from '@playwright/test';

// --- SVG repaint budgets at 2000 tasks (spec-svg-render-perf.md §10) ---------------------------
//
// Runs under the `performance` Playwright project, driving
// `examples/plain-html-demo/canvas-mount-perf-harness.html?taskCount=2000&grouped=1&mounted=1`,
// which mounts a real SVG chart on load (2000 tasks is exactly the SVG threshold) and exposes
// `window.__repaintAndTime(op)`: it runs one mutation, counts the full SVG renders it caused, then
// waits two animation frames so style + layout + paint are inside the measured window.
//
// Two kinds of assertion, deliberately:
//  1. RENDER COUNT per operation — deterministic on any machine, the real regression tripwire
//     (the bug this guards against was "every zoom/select/collapse paints twice and recomputes the
//     critical path"). Zoom, density, collapse and updateTask are exactly ONE full render each.
//     Selection and focus changes (select, focus, ArrowDown) are ZERO full renders: only the rows
//     whose state changed are rebuilt in place (`patched`, spec-svg-row-patch.md), and select-all
//     rebuilds every row without a full render.
//  2. Wall-clock budgets (`paintMs`) — a coarse backstop against a catastrophic regression.
//
// Same caveat as `canvas-mount.spec.ts`: run `--project=performance` alone, and expect CI variance.
// Budgets are calibrated like that spec's: samples on freshly-navigated pages, p75 x ~1.8-2x. Raw
// samples live in `.changeset/svg-render-perf.md`; re-run the calibration before editing them.

type Op = 'zoom' | 'density' | 'collapse' | 'select' | 'selectAll' | 'updateTask' | 'focus' | 'arrowDown';
interface Repaint {
  jsMs: number;
  paintMs: number;
  renders: number;
  patched: number;
}
/** Ops that rebuild rows in place instead of repainting the chart. */
const PATCH_OPS: readonly Op[] = ['select', 'focus', 'arrowDown'];

// p75 of 20 fresh-page samples x ~1.8-2x (quiet-machine p75, ms): zoom 530, density ~500, collapse
// 850, select 600, selectAll 650, updateTask 950, cold mount 870. Before the fix the same operations
// measured ~2300 (zoom/collapse/select/selectAll/updateTask) and 3500 (mount) on the same machine.
// select/focus/arrowDown are row patches (spec-svg-row-patch.md): quiet-machine p75 of 20 fresh pages
// 42 / 38 / 56 ms in Chromium, budgets are ~10x that because CI is a loaded linux runner.
const BUDGET_MS: Record<Op, number> = {
  zoom: 1000,
  density: 1000,
  collapse: 1600,
  select: 500,
  selectAll: 1400,
  updateTask: 1900,
  focus: 500,
  arrowDown: 600,
};
const MOUNT_BUDGET_MS = 1700;
// Post-fix median ~700 ms (renderer-thread CPU, Chromium) on a loaded dev box; the old walk was ~8400.
const LONG_SPAN_UPDATE_BUDGET_MS = 3000;

async function openMounted(page: import('@playwright/test').Page, interaction = false): Promise<void> {
  await page.goto(`/canvas-mount-perf-harness.html?taskCount=2000&grouped=1&mounted=1${interaction ? '&interaction=1' : ''}`);
  await page.waitForSelector('.fg-timeline__row');
}

async function repaint(page: import('@playwright/test').Page, op: Op): Promise<Repaint> {
  return page.evaluate(
    (o) => (window as unknown as { __repaintAndTime: (o: string) => Promise<Repaint> }).__repaintAndTime(o),
    op,
  );
}

const RUNS = 3;
const median = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test.describe('SVG repaint at 2000 tasks (spec-svg-render-perf.md)', () => {
  for (const op of ['zoom', 'density', 'collapse', 'select', 'selectAll', 'updateTask', 'focus', 'arrowDown'] as const) {
    const title = PATCH_OPS.includes(op)
      ? `${op}: zero full renders, at most 4 rows rebuilt, median of ${RUNS} fresh pages within budget`
      : op === 'selectAll'
        ? `${op}: zero full renders, every row rebuilt, median of ${RUNS} fresh pages within budget`
        : `${op}: exactly one full render, median of ${RUNS} fresh pages within budget`;
    test(title, async ({ page }) => {
      test.setTimeout(180_000);
      const samples: number[] = [];
      for (let run = 0; run < RUNS; run++) {
        await openMounted(page, op === 'focus' || op === 'arrowDown');
        await expect(page.locator('.fg-timeline__row')).toHaveCount(2000);
        // `zoom`/`density` start at the default, so warm once: the measured call is a real change.
        if (op === 'zoom' || op === 'density') await repaint(page, op);
        const r = await repaint(page, op);
        if (PATCH_OPS.includes(op)) {
          expect(r.renders).toBe(0);
          expect(r.patched).toBeLessThanOrEqual(4);
        } else if (op === 'selectAll') {
          expect(r.renders).toBe(0);
          expect(r.patched).toBe(2000);
        } else {
          expect(r.renders).toBe(1);
        }
        samples.push(r.paintMs);
      }
      // Median, not a single sample: one scheduler hiccup on a shared runner must not fail the build.
      // The raw samples are in the failure message and the changeset.
      expect(median(samples), `raw paintMs samples: ${samples.map(Math.round).join(', ')}`).toBeLessThan(
        BUDGET_MS[op],
      );
    });
  }

  // First-edit cost on a LONG range (investigation V). CPM's slack loop used to walk every day
  // between ES and LS per task, so one `updateTask` cost O(tasks x span): ~8.4 s CPU at 2000 tasks /
  // 520 working days / 20 holidays (about 24 s on a loaded box), against ~0.7 s now (one shared
  // working-hours table, a date-only parse fast path and a date-label cache that no longer thrashes).
  // The budget is ~4x the post-fix median so it passes on a loaded runner and still fails loudly on
  // the old walk. The deterministic tripwire lives in tests/unit/critical-path-slack.property.test.ts.
  test(`updateTask on a ${520}-day range: one render, median of ${RUNS} fresh pages within budget`, async ({ page }) => {
    test.setTimeout(240_000);
    const samples: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      await page.goto('/canvas-mount-perf-harness.html?taskCount=2000&span=520&holidays=20&mounted=1');
      await page.waitForSelector('.fg-timeline__row');
      await expect(page.locator('.fg-timeline__row')).toHaveCount(2000);
      const r = await repaint(page, 'updateTask');
      expect(r.renders).toBe(1);
      samples.push(r.paintMs);
    }
    expect(median(samples), `raw paintMs samples: ${samples.map(Math.round).join(', ')}`).toBeLessThan(
      LONG_SPAN_UPDATE_BUDGET_MS,
    );
  });

  test('cold mount: one render (not three), renderer is svg', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/canvas-mount-perf-harness.html?taskCount=2000&grouped=1');
    const { ms, renders } = await page.evaluate(async () => {
      const svgHost = document.getElementById('gantt')!;
      let n = 0;
      const observer = new MutationObserver((records) => {
        for (const r of records) for (const node of r.addedNodes) if (node.nodeName === 'defs') n++;
      });
      observer.observe(svgHost, { childList: true, subtree: true });
      const { ms } = await (window as unknown as { __mountAndTime: () => Promise<{ ms: number }> }).__mountAndTime();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      observer.disconnect();
      return { ms, renders: n };
    });
    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'svg');
    expect(renders).toBe(1);
    expect(ms).toBeLessThan(MOUNT_BUDGET_MS);
  });
});
