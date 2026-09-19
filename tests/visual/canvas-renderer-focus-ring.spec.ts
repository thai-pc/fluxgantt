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
const FOCUS_RING_CLIP_HEIGHT_PX = 150;

test('a focused row shows a visible ring on the canvas bitmap', async ({ page }) => {
  await page.goto('/canvas-a11y-harness.html');
  await page.locator('.fg-timeline-a11y-layer [tabindex="0"]').first().focus();
  const box = await page.locator('.fg-timeline-canvas').boundingBox();
  const clip = { x: box!.x, y: box!.y, width: box!.width, height: FOCUS_RING_CLIP_HEIGHT_PX };
  const screenshot = await page.screenshot({ clip });
  expect(screenshot).toMatchSnapshot('canvas-focus-ring.png');
});
