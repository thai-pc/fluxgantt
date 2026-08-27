import { test, expect } from '@playwright/test';

// --- Canvas mount-time auto-switch performance budgets ----------------------------------------
// (spec-canvas-auto-switch.md §9.1/§9.3/§9.4, Ticket 3 of `.claude/work/plan-canvas-renderer.md`)
//
// Runs under the `performance` Playwright project (see `playwright.config.ts`'s own comment for
// why this is Playwright, not vitest bench: it needs a real Chromium paint, not the mocked 2D
// context `packages/core/vitest.config.ts` uses for its unit tests). Drives
// `examples/plain-html-demo/canvas-mount-perf-harness.html`, which exposes `window.__mountAndTime()`
// (times a real `gantt.mount(container)` end-to-end via `renderer:selected`) and
// `window.__mountSvgDirectAndTime()` (the one forced-SVG comparative path §9.4c calls for) — see
// that harness's own header comment for the exact dataset shape and why both hooks pay the same
// `computeCriticalPath()` + double-render cost real `mount()` always pays.
//
// Local-run caveat (observed while authoring this spec, not a bug): running this project
// CONCURRENTLY with `visual`/`webkit-canvas-dimension-guard` (e.g. `npx playwright test` with no
// `--project` filter, on a dev machine) spins up many simultaneous real Chromium/WebKit instances
// and can push these wall-clock budgets over the edge from CPU contention alone — this margin
// exists for CI variance, not for "N other heavy browser suites running at the same time locally".
// `playwright.config.ts` already sets `workers: 1` under `process.env.CI`, so real CI runs every
// project's tests serially and doesn't hit this; locally, prefer `--project=performance` alone.
//
// --- Budget calibration methodology (spec §9.4) -----------------------------------------------
// Each of the four cases below was run 20 times locally (10 for the 10,000-task case, given its
// per-run cost — still a statistically reasonable sample), each sample a genuine cold `mount()`
// on a freshly-navigated page (no reused page, no auto-mount-on-load — see the harness's header
// comment for why that distinction matters). Samples were sorted; median and p75 were computed;
// the committed budget below is p75 × ~1.8-2x as a CI-safety margin (slower/shared/virtualized CI
// runners are common; this repo's own CI is a shared GitHub Actions runner). Raw sample data:
// `.changeset/canvas-renderer-ticket3.md` (original 2000/2001 calibration),
// `.changeset/canvas-renderer-a11y-windowing.md` (re-calibration after the a11y-layer windowing
// fix, issue #36 — see finding (1) below), and `.changeset/canvas-row-virtualization.md`
// (5,000/10,000 calibration after the row/viewport-virtualization fix, issue #37 — see finding
// (2) below) — do not hand-edit the budget constants below without re-running the calibration and
// updating the relevant changeset.
//
// --- IMPORTANT: empirically-confirmed spec-vs-reality history -----------------------------------
//
// (1) Comparative direction (§9.4c) — RESOLVED as of spec-canvas-renderer-a11y-windowing.md
// (issue #36). The spec frames the comparative assertion as "Canvas `mount()` at taskCount=2001
// should be faster than a forced-SVG mount would have been at the same count" — i.e. proof the
// auto-switch is a performance win, not just "fast in absolute terms". Ticket 3's ORIGINAL
// measurement showed the opposite (Canvas ~1.3x SLOWER, median 2519.5ms vs 1897.4ms), root-caused
// to the hidden ARIA a11y grid layer (Ticket 2) unconditionally building one real DOM row (4
// nodes) per task, on every `render()`, regardless of what's actually visible — an O(taskCount)
// DOM-construction cost with no relation to what's on/near screen. That layer is now WINDOWED
// (only `2 * A11Y_WINDOW_OVERSCAN + 1` = 101 DOM rows built, centered on the focused row,
// `canvas-renderer.ts`) rather than rebuilt in full every render. The comparative assertion below
// asserts `canvasMs < svgForcedMs` accordingly.
//
// (2) Canvas was structurally UNREACHABLE for genuinely large flat/all-expanded projects — RESOLVED
// as of spec-canvas-row-virtualization.md (issue #37). `layoutRows()` (`renderer-base.ts`) still
// has no collapse concept — every task always produces exactly one row — but Canvas's backing
// store height is no longer derived from total row count at all: `canvas-renderer.ts` now binds
// the `<canvas>` element's physical height to a fixed, host-configurable viewport
// (`resolveViewportHeightPx()`, default 600px) and only draws + hit-tests the rows whose band
// intersects the current scroll position (`computeVisibleWindow`), scrolling a full-height
// `aria-hidden` spacer element underneath it for native scrollbar behavior. The old ceiling —
// `MAX_CANVAS_DIMENSION_PX` (65,535px) ÷ `ROW_HEIGHT.default` (32px) ≈ 2,047 rows — no longer
// applies to the height axis at any row count; it now only guards the (row-count-independent)
// WIDTH axis (task-date-spread-derived) and, on WebKit, the combined area axis. Confirmed
// empirically: flat 5,000- and 10,000-task datasets (this harness's rolling 30-working-day-window
// shape, which keeps the derived width small and constant) now mount via Canvas successfully —
// `renderer:selected` fires `{renderer: 'canvas'}` with no `canvasFallbackReason` — and
// dramatically faster than the old SVG-fallback path ever was (~2.1s/~4.2s median vs the old
// SVG-fallback path's ~6.1s/~13-14s-class cost at these sizes). The two large-N cases below are
// renamed accordingly and now assert a genuine successful Canvas mount. See
// `.changeset/canvas-row-virtualization.md` for the full raw sample data.

const CASES = {
  svgAt2000: { taskCount: 2000, fn: '__mountAndTime', budgetMs: 5000 },
  // Re-calibrated post-a11y-windowing-fix (issue #36): p75 1236.7ms × ~1.86x margin (20 samples,
  // see `.changeset/canvas-renderer-a11y-windowing.md` for the raw data) — was 4600ms before the
  // fix (p75 2538.8ms), a ~3.7x tightening that directly reflects the windowed a11y layer no
  // longer paying an O(taskCount) DOM-construction cost on every render.
  canvasAt2001: { taskCount: 2001, fn: '__mountAndTime', budgetMs: 2300 },
  // 5,000/10,000-task cases (issue #37 fix — see finding (2) above): both now mount via Canvas
  // successfully — row-band virtualization means `render()` only ever draws/hit-tests the rows
  // intersecting the current (fixed-height) viewport, so cost no longer scales with total row
  // count the way the old always-render-every-row design did. Calibrated fresh against the fixed
  // build (20 samples for 5,000, 10 for 10,000 — see `.changeset/canvas-row-virtualization.md` for
  // the raw data): 5,000-task median 2141.2ms / p75 2152.1ms → budget below is p75 × ~1.95x;
  // 10,000-task median 4191.6ms / p75 4215.0ms → budget below is p75 × ~1.9x.
  canvasAt5000: { taskCount: 5000, fn: '__mountAndTime', budgetMs: 4200 },
  canvasAt10000: { taskCount: 10000, fn: '__mountAndTime', budgetMs: 8000 },
} as const;

async function mountAndTime(
  page: import('@playwright/test').Page,
  taskCount: number,
  fnName: string,
): Promise<number> {
  await page.goto(`/canvas-mount-perf-harness.html?taskCount=${taskCount}`);
  const { ms } = await page.evaluate(
    (fn) => (window as unknown as Record<string, () => Promise<{ ms: number }>>)[fn]!(),
    fnName,
  );
  return ms;
}

test.describe('absolute mount-time budgets (spec §9.1/§9.3)', () => {
  test(`taskCount=${CASES.svgAt2000.taskCount} (SVG, at threshold): mounts within budget`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ms = await mountAndTime(page, CASES.svgAt2000.taskCount, CASES.svgAt2000.fn);
    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'svg');
    expect(ms).toBeLessThan(CASES.svgAt2000.budgetMs);
  });

  test(`taskCount=${CASES.canvasAt2001.taskCount} (Canvas, just over threshold): mounts within budget`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ms = await mountAndTime(page, CASES.canvasAt2001.taskCount, CASES.canvasAt2001.fn);
    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'canvas');
    expect(ms).toBeLessThan(CASES.canvasAt2001.budgetMs);
  });

  test(`taskCount=${CASES.canvasAt5000.taskCount} (Canvas, row-band virtualized — see finding (2) above): mounts within budget`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ms = await mountAndTime(page, CASES.canvasAt5000.taskCount, CASES.canvasAt5000.fn);
    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'canvas');
    await expect(page.locator('body')).not.toHaveAttribute('data-canvas-fallback-reason');
    expect(ms).toBeLessThan(CASES.canvasAt5000.budgetMs);
  });

  test(`taskCount=${CASES.canvasAt10000.taskCount} (Canvas, row-band virtualized — see finding (2) above): mounts within budget`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ms = await mountAndTime(page, CASES.canvasAt10000.taskCount, CASES.canvasAt10000.fn);
    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'canvas');
    await expect(page.locator('body')).not.toHaveAttribute('data-canvas-fallback-reason');
    expect(ms).toBeLessThan(CASES.canvasAt10000.budgetMs);
  });
});

test.describe('comparative Canvas-vs-SVG measurement at the boundary (spec §9.4c)', () => {
  // See the module-level comment above for the full context: this now asserts the spec's
  // ORIGINALLY-INTENDED direction — real Canvas mount() is faster than a fair forced-SVG mount at
  // the same task count — now that the hidden a11y layer's DOM construction is windowed (issue
  // #36) instead of rebuilding one row per task on every render. Both numbers still individually
  // respect their own absolute budgets above; this test also makes the gap itself visible so a
  // future regression (a11y layer un-windowed again, window size drastically enlarged, etc.) is
  // caught here, not just via the absolute budgets.
  test('real Canvas mount() is faster than a fair forced-SVG mount(), and both stay within their absolute budgets', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const canvasMs = await mountAndTime(page, 2001, '__mountAndTime');

    await page.goto('/canvas-mount-perf-harness.html?taskCount=2001');
    const { ms: svgForcedMs } = await page.evaluate(
      () =>
        (
          window as unknown as { __mountSvgDirectAndTime: () => Promise<{ ms: number }> }
        ).__mountSvgDirectAndTime(),
    );

    expect(canvasMs).toBeLessThan(CASES.canvasAt2001.budgetMs);
    // Forced-SVG comparative budget: p75 1843.3ms × ~1.85x margin (20 samples, see
    // `.changeset/canvas-renderer-a11y-windowing.md` for the raw data) — was 3500ms before the
    // re-calibration (p75 1914.3ms); this path is pure SVG, so the near-unchanged number is
    // expected (it's the Canvas side of the comparison that moved).
    expect(svgForcedMs).toBeLessThan(3400);

    // The fix this test exists to verify (issue #36): with the a11y layer's DOM construction now
    // windowed to `2 * A11Y_WINDOW_OVERSCAN + 1` rows instead of rebuilt in full every render,
    // real Canvas mount() is consistently and comfortably faster than a fair forced-SVG mount at
    // the same task count — matching the spec's originally-intended direction (§9.4c), reversing
    // Ticket 3's original finding. Re-measured 20x locally: the two distributions don't even
    // overlap (Canvas max 1253.9ms < forced-SVG min 1747.7ms) — this is not a borderline flip.
    expect(canvasMs).toBeLessThan(svgForcedMs);
  });
});
