import { test, expect } from '@playwright/test';

// --- Canvas renderer focus-ring visual regression (spec-canvas-renderer-ticket2.md §12.6) ---
//
// Focus ring correctness is a pixel/visual concern, not a DOM/axe one — `role`/`aria-*`
// correctness is covered in `tests/a11y/canvas-renderer.spec.ts`; this spec covers only the
// ring's actual on-screen appearance on the canvas bitmap, following Ticket 1's
// `tests/visual/canvas-renderer.spec.ts`'s "regression-detector against a stored baseline, not
// a generalized cross-renderer pixel-diff tool" honest-scope framing. Fixture:
// `examples/plain-html-demo/canvas-a11y-harness.html` (TEMPORARY, Ticket-2-only — see that
// file's header comment).
//
// Baseline generated fresh in this change (no prior screenshot existed): run
// `pnpm test:visual --update-snapshots` on the CI image before treating
// `*-snapshots/*.png` as ground truth.
//
// Clipped to a small top slice of the canvas (header + first row), NOT the full element:
// the harness's canvas is 1,000 rows tall (~32,000px, per its own dataset-sizing rationale — see
// `canvas-a11y-harness.ts`'s header comment, which also documents a real browser per-canvas-
// dimension backing-store limit discovered while authoring this spec), far taller than any
// viewport. Capturing the FULL element forces Chromium to scroll-and-stitch multiple tiles, which
// is empirically non-deterministic (~0.01% pixel drift between two back-to-back captures of the
// identical, unchanged bitmap — reproduced while authoring this spec). The focused row (row 0) is
// always within this clipped region, so the ring is fully exercised without the stitching
// flakiness.
const FOCUS_RING_CLIP_HEIGHT_PX = 150;

test('a focused row shows a visible ring on the canvas bitmap', async ({ page }) => {
  await page.goto('/canvas-a11y-harness.html');
  await page.locator('.fg-timeline-a11y-layer [tabindex="0"]').first().focus();
  const box = await page.locator('.fg-timeline-canvas').boundingBox();
  const clip = { x: box!.x, y: box!.y, width: box!.width, height: FOCUS_RING_CLIP_HEIGHT_PX };
  const screenshot = await page.screenshot({ clip });
  expect(screenshot).toMatchSnapshot('canvas-focus-ring.png');
});
