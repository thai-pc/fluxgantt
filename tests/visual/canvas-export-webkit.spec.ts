import { test, expect } from '@playwright/test';

// WebKit half of the Canvas-mode export limits (spec-canvas-export.md §5, AREA cap
// `MAX_CANVAS_AREA_PX_WEBKIT` = 16,777,216). Runs ONLY under the `webkit-canvas-dimension-guard`
// project (see playwright.config.ts `testMatch`; the `visual` project ignores this file) and
// asserts engine behavior, not pixels, so it adds no snapshot baseline.
//
// Geometry of the harness at 2100 rows (default density): 67,232 css px tall, ~832 wide. Scale
// 0.3 -> ~250 x 20,170 = ~5.0 M px (under the WebKit area cap); scale 1 exceeds the per-side
// cap outright. The Desktop Safari preset has deviceScaleFactor 2 but exportPng() ignores DPR.

test.describe('Canvas-mode export under WebKit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/canvas-export-harness.html?scale=0.3');
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  });

  test('exportPng at scale 0.3 succeeds with a real PNG', async ({ page }) => {
    const blob = await page.evaluate(async () => {
      const g = (window as unknown as { __gantt: { exportPng(o: object): Promise<Blob> } }).__gantt;
      const b = await g.exportPng({ scale: 0.3 });
      const head = new Uint8Array(await b.slice(0, 24).arrayBuffer());
      const dv = new DataView(head.buffer);
      return { size: b.size, sig: [...head.slice(0, 4)], w: dv.getUint32(16), h: dv.getUint32(20) };
    });
    expect(blob.sig).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(blob.h).toBe(Math.round(67_232 * 0.3));
    expect(blob.size).toBeGreaterThan(100);
  });

  test('exportPng at scale 1 rejects with the documented size error', async ({ page }) => {
    const message = await page.evaluate(async () => {
      const g = (window as unknown as { __gantt: { exportPng(o: object): Promise<Blob> } }).__gantt;
      try {
        await g.exportPng({ scale: 1 });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(message).toMatch(/gantt\.exportPng: output \d+x67232px exceeds this browser's safe canvas limit/);
  });

  test('exportSvg still works (vector, no pixel limit)', async ({ page }) => {
    const rows = await page.evaluate(() => {
      const g = (window as unknown as { __gantt: { exportSvg(): string } }).__gantt;
      const doc = new DOMParser().parseFromString(g.exportSvg(), 'image/svg+xml');
      return doc.querySelectorAll('[role="row"]').length;
    });
    expect(rows).toBe(2100);
  });
});
