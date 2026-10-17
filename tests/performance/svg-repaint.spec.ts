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
//     critical path"). Zoom, density, collapse, select, select-all and updateTask are all exactly
//     ONE full render each.
//  2. Wall-clock budgets (`paintMs`) — a coarse backstop against a catastrophic regression.
//
// Same caveat as `canvas-mount.spec.ts`: run `--project=performance` alone, and expect CI variance.
// Budgets are calibrated like that spec's: samples on freshly-navigated pages, p75 x ~1.8-2x. Raw
// samples live in `.changeset/svg-render-perf.md`; re-run the calibration before editing them.

type Op = 'zoom' | 'density' | 'collapse' | 'select' | 'selectAll' | 'updateTask';
interface Repaint {
  jsMs: number;
  paintMs: number;
  renders: number;
}

// p75 of 20 fresh-page samples x ~1.8-2x (quiet-machine p75, ms): zoom 530, density ~500, collapse
// 850, select 600, selectAll 650, updateTask 950, cold mount 870. Before the fix the same operations
// measured ~2300 (zoom/collapse/select/selectAll/updateTask) and 3500 (mount) on the same machine.
const BUDGET_MS: Record<Op, number> = {
  zoom: 1000,
  density: 1000,
  collapse: 1600,
  select: 1200,
  selectAll: 1400,
  updateTask: 1900,
};
const MOUNT_BUDGET_MS = 1700;

async function openMounted(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/canvas-mount-perf-harness.html?taskCount=2000&grouped=1&mounted=1');
  await page.waitForSelector('.fg-timeline__row');
}

async function repaint(page: import('@playwright/test').Page, op: Op): Promise<Repaint> {
  return page.evaluate(
    (o) => (window as unknown as { __repaintAndTime: (o: string) => Promise<Repaint> }).__repaintAndTime(o),
    op,
  );
}

test.describe('SVG repaint at 2000 tasks (spec-svg-render-perf.md)', () => {
  for (const op of ['zoom', 'density', 'collapse', 'select', 'selectAll', 'updateTask'] as const) {
    test(`${op}: exactly one full render, within budget`, async ({ page }) => {
      test.setTimeout(120_000);
      await openMounted(page);
      await expect(page.locator('.fg-timeline__row')).toHaveCount(2000);
      // `zoom` starts at 'week' (the default) and the first hop is to 'week' again, so warm it once:
      // the measured call is always a real change.
      if (op === 'zoom' || op === 'density') await repaint(page, op);
      const r = await repaint(page, op);
      expect(r.renders).toBe(1);
      expect(r.paintMs).toBeLessThan(BUDGET_MS[op]);
    });
  }

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
