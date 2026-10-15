import { test, expect } from '@playwright/test';

// Canvas-mode export timing (spec-canvas-export.md, "row cap" measurement notes). Drives
// `examples/plain-html-demo/canvas-export-harness.html` (2100 rows, Canvas mode) and times a real
// `exportSvg()` (synchronous, builds the offscreen SVG) and a half-scale `exportPng()`.
//
// Budgets are deliberately generous: they exist to catch an order-of-magnitude regression (e.g. the
// offscreen render going quadratic), not to track small drifts. Calibration: 5 cold runs locally
// on Chromium with native Temporal: exportSvg 1.2-2.7 s, exportPng(0.5x) 0.4-0.65 s; the 6 s budgets are ~2-4x that. Like the
// rest of this project, run it alone (`--project=performance`), not alongside other browsers.

const BUDGET_SVG_MS = Number(process.env.EXPORT_SVG_BUDGET_MS ?? 6000);
const BUDGET_PNG_MS = Number(process.env.EXPORT_PNG_BUDGET_MS ?? 6000);

test('exportSvg at 2,100 rows (Canvas mode) stays within budget', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/canvas-export-harness.html');
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  const { ms, length } = await page.evaluate(() => {
    const g = (window as unknown as { __gantt: { exportSvg(): string } }).__gantt;
    const t0 = performance.now();
    const svg = g.exportSvg();
    return { ms: performance.now() - t0, length: svg.length };
  });
  console.log(`exportSvg(2100 rows): ${ms.toFixed(0)} ms, ${length} chars`);
  expect(length).toBeGreaterThan(100_000);
  expect(ms).toBeLessThan(BUDGET_SVG_MS);
});

test('exportPng at 2,100 rows, scale 0.5 (Canvas mode) stays within budget', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/canvas-export-harness.html');
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  const { ms, size } = await page.evaluate(async () => {
    const g = (window as unknown as { __gantt: { exportPng(o: object): Promise<Blob> } }).__gantt;
    const t0 = performance.now();
    const blob = await g.exportPng({ scale: 0.5 });
    return { ms: performance.now() - t0, size: blob.size };
  });
  console.log(`exportPng(2100 rows, 0.5x): ${ms.toFixed(0)} ms, ${size} bytes`);
  expect(size).toBeGreaterThan(1000);
  expect(ms).toBeLessThan(BUDGET_PNG_MS);
});
