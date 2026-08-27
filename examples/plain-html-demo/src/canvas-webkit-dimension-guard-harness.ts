// Canvas WebKit area-dimension-guard fixture (spec-canvas-webkit-dimension-limit.md §13.2).
//
// TEMPORARY FILE — this ticket only, same posture as `canvas-harness.ts`/
// `canvas-a11y-harness.ts` (Ticket 1/2 of `.claude/work/plan-canvas-renderer.md`):
// `createCanvasRenderer` is not yet re-exported from `@fluxgantt/core`'s public barrel
// (deliberately inert/unwired), so this harness imports it via a RELATIVE PATH directly into
// workspace source. Expected to be deleted/rewritten once Canvas mode is wired into
// `createGantt().mount()`.
//
// Reads `?rows=N` from the query string and builds N flat (no-hierarchy), same-day tasks, always
// rendered against a FIXED, explicit 1-day `timeRange` — so `physicalWidth` is constant
// regardless of N (`160` label column + `60` px/day * 1 day = `220` CSS px).
//
// Also reads an optional `?viewportHeight=N` and forwards it verbatim as
// `CanvasRendererOptions.viewportHeight` (same pattern as `canvas-mount-perf-harness.ts`'s
// `canvasViewportHeight` query param) — omitted, Canvas's own 600px default
// (`resolveViewportHeightPx()`) applies.
//
// HISTORICAL NOTE (fix #37, spec-canvas-row-virtualization.md): this harness used to derive
// `physicalHeight` (and therefore the computed area) from `rows` alone — `rows` was the ONLY
// axis needed to isolate the WebKit-only AREA guard (`MAX_CANVAS_AREA_PX_WEBKIT`) from the
// pre-existing per-axis guard (`MAX_CANVAS_DIMENSION_PX`). Fix #37 deliberately decoupled
// Canvas's backing-store height from row count entirely (`physicalHeight` is now derived from
// `resolveViewportHeightPx()`, not `totalHeight`), so row count alone can no longer trip the
// area guard — mirrors exactly why `canvas-mount-perf-harness.ts` gained its own
// `canvasViewportHeight` param. `viewportHeight` is now the ONLY axis that varies
// `physicalHeight` here; `rows` no longer affects it at all (kept only so the a11y-layer test
// below still has a real, `aria-rowcount`-bearing dataset to assert against).
//
// viewportHeight boundary math (assumes the Playwright `webkit-canvas-dimension-guard`
// project's `devices['Desktop Safari']` preset, whose `deviceScaleFactor` is 2 — NOT 1 —
// confirmed via `node -e "console.log(require('@playwright/test').devices['Desktop Safari'])"`
// while authoring this harness):
//   cssWidth      = 160 (LABEL_COLUMN_WIDTH) + 60 (PIXELS_PER_DAY.day) * 1 day = 220
//   physicalWidth = round(220 * 2) = 440
//   physicalHeight(viewportHeight) = round(viewportHeight * 2)
//   area(viewportHeight) = 440 * round(viewportHeight * 2)
// Solving `area(viewportHeight) <= 16_777_216` (MAX_CANVAS_AREA_PX_WEBKIT) for the largest safe
// EVEN physicalHeight (round() of an integer CSS px * 2 is always even):
//   physicalHeight <= 16_777_216 / 440 = 38_130.036... -> largest safe physicalHeight = 38_130
// So viewportHeight=19_065 is the largest SAFE value tested here
// (physicalHeight = round(19_065 * 2) = 38_130, area = 440 * 38_130 = 16,777,200, margin 16px²)
// and viewportHeight=19_066 is the smallest OVERFLOWING value tested here
// (physicalHeight = round(19_066 * 2) = 38_132, area = 440 * 38_132 = 16,778,080, over by
// 864px²) — the straddling pair `tests/visual/canvas-renderer-webkit-dimension-guard.spec.ts`
// asserts against, mirroring the sibling Chromium fix's own precise-boundary style (no
// injected test-only override, just the real formula solved for the smallest adjacent-integer
// straddle of the actual input parameter).
import { Temporal } from '@js-temporal/polyfill';
import { createCanvasRenderer, CanvasDimensionExceededError } from '../../../packages/core/src/render/canvas-renderer.js';
import { toTaskId, type Task } from '@fluxgantt/core';

// `@fluxgantt/core` treats Temporal as an optional peerDependency and reads `globalThis.Temporal`
// — it is the HOST APP's job to install it (`packages/core/src/internal/temporal.ts`). Guarded
// (`??=`) so this is a no-op wherever the runtime already has native `Temporal` and only actually
// installs the polyfill where it's missing — required for this harness to run under the
// `webkit-canvas-dimension-guard` Playwright project (Playwright's bundled WebKit build does not
// yet ship native `Temporal`, unlike this repo's Playwright-bundled Chromium build, confirmed
// while authoring this harness).
(globalThis as { Temporal?: typeof Temporal }).Temporal ??= Temporal;

const params = new URLSearchParams(window.location.search);
const rowCount = Number(params.get('rows') ?? '20');
const viewportHeightParam = params.get('viewportHeight');
const viewportHeight = viewportHeightParam !== null ? Number(viewportHeightParam) : undefined;

const now = new Date('2026-01-01T00:00:00Z');
const tasks: Task[] = Array.from({ length: rowCount }, (_, i) => ({
  id: toTaskId(`t${i}`),
  name: `Task ${i + 1}`,
  start: '2026-01-01',
  end: '2026-01-01',
  progress: 0,
  type: 'task',
  createdAt: now,
  updatedAt: now,
}));

const container = document.getElementById('gantt')!;
const errorMessageEl = document.getElementById('error-message')!;

try {
  const handle = createCanvasRenderer(
    container,
    { tasks, dependencies: [] },
    {
      viewMode: 'day',
      timeRange: { start: '2026-01-01', end: '2026-01-02' },
      ...(viewportHeight !== undefined ? { viewportHeight } : {}),
    },
  );
  document.body.dataset.result = 'ok';
  if (import.meta.env.DEV) {
    (window as unknown as { __webkitGuardHandle?: typeof handle }).__webkitGuardHandle = handle;
  }
} catch (err) {
  if (err instanceof CanvasDimensionExceededError) {
    document.body.dataset.result = 'error';
    document.body.dataset.errorAxis = err.axis;
    document.body.dataset.errorName = err.name;
    errorMessageEl.textContent = err.message; // textContent only — never innerHTML (security.md).
  } else {
    document.body.dataset.result = 'unexpected-error';
    errorMessageEl.textContent = String(err);
    throw err;
  }
}
