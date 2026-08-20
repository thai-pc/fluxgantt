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
// regardless of N (`160` label column + `60` px/day * 1 day = `220` CSS px) and only
// `physicalHeight` (and therefore the computed area) varies with the row count. This isolates
// the WebKit-only AREA guard (`MAX_CANVAS_AREA_PX_WEBKIT`) from the pre-existing per-axis guard
// (`MAX_CANVAS_DIMENSION_PX`), which needs a much larger single axis to ever trip on its own.
//
// Row-count boundary math (assumes the Playwright `webkit-canvas-dimension-guard` project's
// `devices['Desktop Safari']` preset, whose `deviceScaleFactor` is 2 — NOT 1 — confirmed via
// `node -e "console.log(require('@playwright/test').devices['Desktop Safari'])"` while authoring
// this harness):
//   cssWidth      = 160 (LABEL_COLUMN_WIDTH) + 60 (PIXELS_PER_DAY.day) * 1 day = 220
//   physicalWidth = round(220 * 2) = 440
//   cssHeight(rows)      = 32 (HEADER_HEIGHT) + rows * 32 (ROW_HEIGHT.default)
//   physicalHeight(rows) = round(cssHeight(rows) * 2) = 64 + rows * 64   (exact — always even)
//   area(rows) = 440 * (64 + rows * 64) = 28,160 + 28,160 * rows
// Solving `area(rows) <= 16_777_216` (MAX_CANVAS_AREA_PX_WEBKIT):
//   rows <= (16_777_216 - 28_160) / 28_160 = 594.85...
// So rows=594 is the exact largest SAFE row count (area = 16,755,200, margin 22,016px²) and
// rows=595 is the exact smallest OVERFLOWING row count (area = 16,783,360, over by 6,144px²) —
// the straddling pair `tests/visual/canvas-renderer-webkit-dimension-guard.spec.ts` asserts
// against, mirroring the sibling Chromium fix's own precise natural-row-count boundary style
// (no injected test-only override).
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
    { viewMode: 'day', timeRange: { start: '2026-01-01', end: '2026-01-02' } },
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
