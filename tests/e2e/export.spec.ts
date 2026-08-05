import { test, expect } from '@playwright/test';

// Exercises the export API through the dev-only `window.__gantt` handle the demo exposes.
// This is a real end-to-end check of exportSvg/exportJson/exportPng against a mounted chart —
// no fragile pointer geometry involved.

test('exportSvg returns a self-contained <svg> string', async ({ page }) => {
  await page.goto('/');
  const svg = await page.evaluate(() => {
    const g = (window as unknown as { __gantt?: { exportSvg(): string } }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    return g.exportSvg();
  });
  expect(svg).toContain('<svg');
  expect(svg).toContain('</svg>');
});

test('exportJson round-trips the 5 tasks + 2 dependencies', async ({ page }) => {
  await page.goto('/');
  const bundle = await page.evaluate(() => {
    const g = (window as unknown as {
      __gantt?: { exportJson(): { tasks: unknown[]; dependencies: unknown[] } };
    }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    return g.exportJson();
  });
  expect(bundle.tasks).toHaveLength(5);
  expect(bundle.dependencies).toHaveLength(2);
});

test('exportPng resolves to a non-empty Blob', async ({ page }) => {
  await page.goto('/');
  const size = await page.evaluate(async () => {
    const g = (window as unknown as { __gantt?: { exportPng(): Promise<Blob> } }).__gantt;
    if (!g) throw new Error('window.__gantt not exposed by the demo');
    const blob = await g.exportPng();
    return blob.size;
  });
  expect(size).toBeGreaterThan(0);
});
