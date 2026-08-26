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
// runners are common; this repo's own CI is a shared GitHub Actions runner). Raw sample data for
// all four cases is recorded in `.changeset/canvas-renderer-ticket3.md` (original calibration) and
// `.changeset/canvas-renderer-a11y-windowing.md` (re-calibration after the a11y-layer windowing
// fix, issue #36 — see finding (1) below) — do not hand-edit the budget constants below without
// re-running the calibration and updating both places.
//
// --- IMPORTANT: one remaining empirically-confirmed spec-vs-reality conflict -------------------
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
// `canvas-renderer.ts`) rather than rebuilt in full every render. Re-measured fairly (same
// apples-to-apples double-render + `computeCriticalPath()` methodology as the original
// calibration) at taskCount=2001: Canvas median **1228.6ms** vs forced-SVG median **1831.3ms** —
// Canvas is now consistently and comfortably FASTER (the two 20-sample distributions don't even
// overlap: Canvas max 1253.9ms < forced-SVG min 1747.7ms), matching the spec's originally-intended
// direction. The comparative assertion below now asserts `canvasMs < svgForcedMs` accordingly.
// Full raw samples for this re-calibration are recorded in
// `.changeset/canvas-renderer-a11y-windowing.md`.
//
// (2) Canvas is structurally UNREACHABLE for genuinely large flat/all-expanded projects (a more
// severe finding than (1)). `layoutRows()` (`renderer-base.ts`) has no collapse/virtualization
// concept — every task in the store always produces exactly one row. Canvas's own (pre-existing,
// correct, unrelated-to-this-ticket) dimension guard rejects any canvas backing store taller than
// `MAX_CANVAS_DIMENSION_PX` (65,535px). At the default density (`ROW_HEIGHT.default = 32px`),
// that ceiling is reached at just **2,047 rows** — i.e. barely 47 rows above the 2,000-task
// auto-switch threshold itself. Confirmed empirically: a flat 5,000- or 10,000-task dataset NEVER
// actually renders via Canvas; `mount()` always throws `CanvasDimensionExceededError` internally
// and silently falls back to SVG (`renderer:selected` fires `{renderer: 'svg',
// canvasFallbackReason: 'dimension-exceeded'}`) — a real, working-as-designed safety net from an
// earlier ticket, not a bug in this one, but it means the ≥2000-task auto-switch cannot deliver
// Canvas rendering at all for the very "large project" sizes it exists to help, unless/until the
// core gains collapse-aware or virtualized row layout. The two large-N cases below test this REAL
// reachable path (SVG-via-dimension-fallback, which pays a wasted Canvas construction attempt
// AND a full SVG construction) rather than a "successful Canvas mount" that cannot happen today.
// See the changeset for the full writeup; this is flagged as a candidate follow-up, not fixed
// here (out of Ticket 3's scope).

const CASES = {
  svgAt2000: { taskCount: 2000, fn: '__mountAndTime', budgetMs: 5000 },
  // Re-calibrated post-a11y-windowing-fix (issue #36): p75 1236.7ms × ~1.86x margin (20 samples,
  // see `.changeset/canvas-renderer-a11y-windowing.md` for the raw data) — was 4600ms before the
  // fix (p75 2538.8ms), a ~3.7x tightening that directly reflects the windowed a11y layer no
  // longer paying an O(taskCount) DOM-construction cost on every render.
  canvasAt2001: { taskCount: 2001, fn: '__mountAndTime', budgetMs: 2300 },
  // 5,000/10,000 flat tasks always exceed the Canvas dimension guard (see finding (2) above) —
  // both of these cases actually exercise the SVG-via-dimension-fallback path, not a successful
  // Canvas mount. Budgets are still real, measured numbers for that real path. Unaffected by the
  // a11y-windowing fix (pure SVG path) — unchanged from the original calibration.
  svgFallbackAt5000: { taskCount: 5000, fn: '__mountAndTime', budgetMs: 12000 },
  svgFallbackAt10000: { taskCount: 10000, fn: '__mountAndTime', budgetMs: 26500 },
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

  test(`taskCount=${CASES.svgFallbackAt5000.taskCount} (SVG via dimension-guard fallback — see finding (2) above): mounts within budget`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ms = await mountAndTime(
      page,
      CASES.svgFallbackAt5000.taskCount,
      CASES.svgFallbackAt5000.fn,
    );
    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'svg');
    await expect(page.locator('body')).toHaveAttribute(
      'data-canvas-fallback-reason',
      'dimension-exceeded',
    );
    expect(ms).toBeLessThan(CASES.svgFallbackAt5000.budgetMs);
  });

  test(`taskCount=${CASES.svgFallbackAt10000.taskCount} (SVG via dimension-guard fallback — see finding (2) above): mounts within budget`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ms = await mountAndTime(
      page,
      CASES.svgFallbackAt10000.taskCount,
      CASES.svgFallbackAt10000.fn,
    );
    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'svg');
    await expect(page.locator('body')).toHaveAttribute(
      'data-canvas-fallback-reason',
      'dimension-exceeded',
    );
    expect(ms).toBeLessThan(CASES.svgFallbackAt10000.budgetMs);
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
