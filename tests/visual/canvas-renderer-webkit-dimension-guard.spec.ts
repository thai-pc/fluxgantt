import { test, expect } from '@playwright/test';

// --- Canvas renderer WebKit area-dimension guard — real-browser regression guard ------------
// (spec-canvas-webkit-dimension-limit.md §12.1/§13.2)
//
// Runs ONLY under the `webkit-canvas-dimension-guard` Playwright project (see
// `playwright.config.ts`'s `testMatch` scoping to this exact file — see that project's own
// comment for why it is NOT a general re-run of `e2e`/`visual`/`a11y` under WebKit). Confirms,
// against a real (Playwright-bundled, Linux WPE/GTK-based — NOT Apple's actual Safari binary;
// see `packages/core/src/render/canvas-renderer.ts`'s module-level comment above
// `MAX_CANVAS_AREA_PX_WEBKIT` for the full empirical methodology and this caveat) WebKit engine
// that:
//   1. the WebKit-only area guard actually fires at the constant this ticket chose
//      (`MAX_CANVAS_AREA_PX_WEBKIT`), not just in the mocked-2D-context unit tests
//      (`packages/core/tests/unit/canvas-renderer.test.ts`, which — like the sibling Chromium
//      fix's own equivalent tests — never allocate a REAL canvas backing store regardless of
//      engine);
//   2. a safe shape still paints real content under WebKit;
//   3. Ticket 2's hidden ARIA grid layer is unaffected by this ticket's change, under a second
//      engine, not just re-asserted by inspection.
//
// Deliberately NOT included: a per-axis-boundary straddling pair. §4 Step 2 of the spec DID find
// an independent, reproducible WebKit per-axis cap (~4,194,305px) during the empirical
// measurement phase, but it is strictly dominated by the pre-existing, engine-agnostic
// `MAX_CANVAS_DIMENSION_PX` (65,535) per-axis check that already runs for every engine — see
// `canvas-renderer.ts`'s module comment for the full reasoning. No separate WebKit per-axis
// constant/check exists in the implementation, so there is nothing here to straddle-test.
//
// Also deliberately NOT included: full visual-snapshot (pixel-diff) coverage under WebKit — see
// `playwright.config.ts`'s project comment; no WebKit baseline images exist for any fixture, and
// generating/maintaining a second per-engine snapshot set is out of this ticket's scope.

test.describe('safe-shape smoke test (reuses the existing Ticket-1 fixture, no new harness)', () => {
  test('canvas renderer paints real, non-blank content under WebKit', async ({ page }) => {
    await page.goto('/canvas-harness.html');
    const chart = page.locator('.fg-timeline-canvas');
    await expect(chart).toBeVisible();

    // "Prove it isn't blank" — same spirit as the sibling Chromium ticket's optional non-blank
    // check, not a snapshot diff (§13.2: no WebKit baseline images exist). Samples a pixel well
    // inside the first task bar's known paint region.
    const hasNonTransparentPixel = await page.evaluate(() => {
      const canvas = document.querySelector('.fg-timeline-canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) return true; // any non-zero alpha byte = something painted
      }
      return false;
    });
    expect(hasNonTransparentPixel).toBe(true);
  });
});

test.describe('area-boundary straddling pair (new, parametrized harness)', () => {
  // Exact row-count boundary derivation lives in
  // `examples/plain-html-demo/src/canvas-webkit-dimension-guard-harness.ts`'s header comment —
  // both the physicalWidth/physicalHeight formula (including the `deviceScaleFactor: 2` this
  // Playwright project's `devices['Desktop Safari']` preset actually uses) and the resulting
  // exact boundary (rows=594 safe / rows=595 overflowing) are documented there, not
  // re-derived here.
  const SAFE_ROWS = 594;
  const OVERFLOWING_ROWS = 595;

  test(`rows=${SAFE_ROWS}: paints, no error`, async ({ page }) => {
    await page.goto(`/canvas-webkit-dimension-guard-harness.html?rows=${SAFE_ROWS}`);
    await expect(page.locator('body')).toHaveAttribute('data-result', 'ok');
    await expect(page.locator('.fg-timeline-canvas')).toBeVisible();
  });

  test(`rows=${OVERFLOWING_ROWS}: throws CanvasDimensionExceededError with axis "area"`, async ({
    page,
  }) => {
    await page.goto(`/canvas-webkit-dimension-guard-harness.html?rows=${OVERFLOWING_ROWS}`);
    await expect(page.locator('body')).toHaveAttribute('data-result', 'error');
    await expect(page.locator('body')).toHaveAttribute('data-error-axis', 'area');
    await expect(page.locator('body')).toHaveAttribute(
      'data-error-name',
      'CanvasDimensionExceededError',
    );
    // No half-mounted canvas left behind — mirrors the unit tests' `container.children` assertion.
    await expect(page.locator('.fg-timeline-canvas')).toHaveCount(0);
  });
});

test.describe('a11y layer still works under WebKit', () => {
  // Deliberately NOT `canvas-a11y-harness.html` here (unlike the safe-shape smoke test above,
  // which does reuse an existing fixture unmodified): that page's 1,000-row dataset, combined
  // with `devices['Desktop Safari']`'s `deviceScaleFactor: 2`, computes physicalWidth x
  // physicalHeight well past `MAX_CANVAS_AREA_PX_WEBKIT` (empirically confirmed while authoring
  // this spec: ~109,677,568px², over 6x the 16,777,216 ceiling) — a genuine, EXPECTED case of
  // this ticket's guard now rejecting under WebKit a shape that was already safe under Chromium
  // (exactly the class of regression this ticket exists to catch), not a bug in this test. The
  // spec's own §13.2 wording requires "a shape that is safe under every WebKit-specific check but
  // was ALREADY safe under the original Chromium check too" — so this reuses the new
  // `canvas-webkit-dimension-guard-harness.html` fixture instead, at the SAFE_ROWS row count
  // already proven safe above. `createCanvasRenderer()` always builds the hidden ARIA grid layer
  // unconditionally (Ticket 2), independent of `enableClickSelect`/`enableKeyboardNav` wiring, so
  // this fixture (which wires neither) still exercises the exact structure being asserted here.
  const SAFE_ROWS = 594;

  test('hidden ARIA grid layer renders with the expected structure (role=grid, roving tabindex, canvas hidden)', async ({
    page,
  }) => {
    await page.goto(`/canvas-webkit-dimension-guard-harness.html?rows=${SAFE_ROWS}`);

    await expect(page.locator('.fg-timeline-a11y-layer')).toHaveAttribute('role', 'grid');
    await expect(page.locator('.fg-timeline-a11y-layer')).toHaveAttribute(
      'aria-rowcount',
      String(SAFE_ROWS),
    );
    await expect(page.locator('[role="row"]')).toHaveCount(SAFE_ROWS);
    // Roving tabindex: exactly one focusable row.
    await expect(page.locator('.fg-timeline-a11y-layer [tabindex="0"]')).toHaveCount(1);
    // The canvas bitmap itself stays out of the accessibility tree.
    await expect(page.locator('.fg-timeline-canvas')).toHaveAttribute('aria-hidden', 'true');
  });
});
