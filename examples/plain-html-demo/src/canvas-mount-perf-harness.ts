// Canvas mount-time auto-switch performance + visual-boundary harness
// (spec-canvas-auto-switch.md §9.2/§10, Ticket 3 of `.claude/work/plan-canvas-renderer.md`).
//
// Unlike the other three (Ticket 1/2, still-temporary) canvas harnesses in this directory, this
// one imports EVERYTHING from the published `@fluxgantt/core` barrel — no relative
// workspace-source imports. By definition, this ticket wires Canvas mode into the real public
// `mount()` path, so `createSvgRenderer`/`createGantt`/`toTaskId`/`toDependencyId` are all
// reachable through the package surface already (Canvas itself stays internal/lazy — reached
// only through `mount()`, never imported directly here).
//
// Query params:
//   ?taskCount=N   — flat (no hierarchy) synthetic dataset size, default 100. This is the ONLY
//                    axis this harness varies — see `generateDataset()` below for the exact
//                    shape (rolling 30-working-day window, ~30% FS-chained dependencies).
//
// Exposes on `window` (dev-only, `import.meta.env.DEV`-guarded — matches every other harness's
// posture, stripped from a production `vite build`). Deliberately does NOT auto-mount on page
// load — every caller (the perf spec, the visual-boundary spec) must call `__mountAndTime()`
// itself, once per fresh page navigation, so every sample is a genuine COLD first mount, not a
// remount (a remount is only modestly more expensive than a cold mount in practice — teardown of
// a prior mount is cheap relative to the dominant cost below — but "modestly more" is still noise
// this harness doesn't need):
//   __mountAndTime(): Promise<{ ms: number }>
//     Times a real `gantt.mount(container)` call end-to-end via the `renderer:selected` event —
//     works uniformly for both the synchronous SVG path (event fires inside the same call) and
//     the async Canvas path (event fires later, once the lazily-loaded chunk resolves and
//     paints).
//   __mountSvgDirectAndTime(): Promise<{ ms: number }>
//     The one "renderer-forced" comparative path spec-canvas-auto-switch.md §9.4c needs — see its
//     own doc comment below for why this does NOT just call `createSvgRenderer()` once (a bare
//     construct-only call is not a fair comparison against a real `mount()`, which always also
//     computes a critical path and repaints a second time to show it — confirmed by reading
//     `gantt.ts`'s `#mountSvg`/`#finishMount`/`#renderNow`).
//
// IMPORTANT, empirically discovered while calibrating this harness (raw numbers + full writeup in
// `.changeset/canvas-renderer-ticket3.md`): `computeCriticalPath()` alone dominates total mount
// cost at these task counts (~1.2s of a ~2.3s-2.5s total mount at just-over-threshold, scaling
// with task count) — a pre-existing cost this ticket did not introduce, unrelated to which
// renderer is chosen (`#renderNow` always computes it), and out of scope to optimize here. Once
// that shared cost is accounted for fairly on both sides (see `mountSvgDirectAndTime()` below),
// real Chromium measurement shows Canvas mount is NOT faster than a forced-SVG mount would have
// been at the same task count in this v1 (non-virtualized) design — it is consistently ~1.3-1.4x
// SLOWER, because Canvas mode's hidden ARIA a11y grid layer (Ticket 2) builds roughly the same
// O(taskCount) DOM node count SVG's own visible tree does, ON TOP OF the (cheap) canvas draw
// calls, rather than replacing that cost. This contradicts architecture.md's "Canvas fallback...
// task count > 2000" framing, which assumes Canvas is the faster path — flagged prominently for
// maintainer review, not silently worked around; see the changeset for the full numbers and
// recommended follow-up (most likely: virtualizing the a11y layer, which today builds one DOM row
// per task regardless of what's actually visible).
import { Temporal } from '@js-temporal/polyfill';
import {
  createGantt,
  createSvgRenderer,
  computeCriticalPath,
  DEFAULT_CALENDAR,
  toTaskId,
  toDependencyId,
  type Task,
  type Dependency,
  type GanttInstance,
} from '@fluxgantt/core';

// `@fluxgantt/core` treats Temporal as an optional peerDependency and reads `globalThis.Temporal`
// — it is the HOST APP's job to install it (`packages/core/src/internal/temporal.ts`). Guarded
// (`??=`) so this is a no-op wherever the runtime already has native `Temporal` (this repo's
// Playwright-bundled Chromium build — the only engine this harness's Playwright projects
// (`performance`, `visual`) target, see `playwright.config.ts`) — matching every other canvas
// harness's own defensive posture (`canvas-harness.ts`,
// `canvas-webkit-dimension-guard-harness.ts`).
(globalThis as { Temporal?: typeof Temporal }).Temporal ??= Temporal;

const WORKING_DAY_WINDOW_SIZE = 30;

/** `size` consecutive Mon-Fri dates (ISO strings), starting from a fixed Monday. A bounded
 *  "rolling window" — many tasks land on the same date once `taskCount > size` — keeps the
 *  overall visible date range (and therefore `computeGridColumns`'s column count) small and
 *  constant regardless of `taskCount`, so this harness measures mount/paint cost, not an
 *  unrelated `MAX_GRID_COLUMNS`-style cost (spec-canvas-auto-switch.md §9.2). */
function buildWorkingDayWindow(size: number): string[] {
  const dates: string[] = [];
  let cursor = Temporal.PlainDate.from('2026-01-05'); // a Monday
  while (dates.length < size) {
    if (cursor.dayOfWeek <= 5) dates.push(cursor.toString());
    cursor = cursor.add({ days: 1 });
  }
  return dates;
}

/** `taskCount` flat, 1-day tasks spread across a rolling working-day window, ~30% carrying one
 *  `FS` dependency to the immediately preceding task (spec-canvas-auto-switch.md §9.2's exact
 *  dataset shape) — a modest, non-pathological dependency density, not a worst-case single chain
 *  and not zero.
 *
 *  NOTE (see `tests/performance/canvas-mount.spec.ts`'s module comment, finding (2), for the full
 *  writeup): "flat" here isn't just a simplification — it's load-bearing. `layoutRows()` gives
 *  every task exactly one row with no collapse/virtualization, so at default density (32px/row)
 *  Canvas's own dimension guard (65,535px ÷ 32px ≈ 2,047 rows) makes any `taskCount` past ~2,047
 *  structurally unable to mount via Canvas at all — it always falls back to SVG. `taskCount=5000`
 *  and `taskCount=10000` in the perf spec deliberately measure that real fallback path, not a
 *  "successful Canvas mount" that cannot occur with this dataset shape. */
function generateDataset(taskCount: number): { tasks: Task[]; dependencies: Dependency[] } {
  const workingDayWindow = buildWorkingDayWindow(WORKING_DAY_WINDOW_SIZE);
  const now = new Date('2026-01-01T00:00:00Z');
  const tasks: Task[] = [];
  const dependencies: Dependency[] = [];
  for (let i = 0; i < taskCount; i++) {
    const date = workingDayWindow[i % WORKING_DAY_WINDOW_SIZE]!;
    tasks.push({
      id: toTaskId(`perf-task-${i}`),
      name: `Task ${i + 1}`,
      start: date,
      end: date,
      progress: 0,
      type: 'task',
      createdAt: now,
      updatedAt: now,
    });
    if (i > 0 && i % 10 < 3) {
      dependencies.push({
        id: toDependencyId(`perf-dep-${i}`),
        from: toTaskId(`perf-task-${i - 1}`),
        to: toTaskId(`perf-task-${i}`),
        type: 'FS',
      });
    }
  }
  return { tasks, dependencies };
}

const params = new URLSearchParams(window.location.search);
const taskCount = Number(params.get('taskCount') ?? '100');
const { tasks, dependencies } = generateDataset(taskCount);

const container = document.getElementById('gantt')!;
const gantt: GanttInstance = createGantt({ tasks, dependencies });

/** Times one `gantt.mount(container)` call via `renderer:selected` — resolves after the chosen
 *  renderer has fully painted, regardless of which renderer path (sync SVG / async Canvas) was
 *  taken. Also mirrors the resolved payload onto `document.body.dataset` so a Playwright spec can
 *  assert on it without hooking into the event system itself. */
function mountAndTime(): Promise<{ ms: number }> {
  return new Promise((resolve) => {
    const start = performance.now();
    const unsubscribe = gantt.on('renderer:selected', (payload) => {
      const ms = performance.now() - start;
      unsubscribe();
      document.body.dataset.renderer = payload.renderer;
      if (payload.canvasFallbackReason) {
        document.body.dataset.canvasFallbackReason = payload.canvasFallbackReason;
      } else {
        delete document.body.dataset.canvasFallbackReason;
      }
      resolve({ ms });
    });
    gantt.mount(container);
  });
}

const rawContainer = document.getElementById('gantt-raw')!;

/** Comparative path (§9.4c): times what a `mount()` call WOULD have cost if forced to use SVG at
 *  this exact task count, entirely bypassing `mount()`'s auto-switch. Mirrors `gantt.ts`'s own
 *  real `#mountSvg()` + first reactive-`effect()`-run work pattern exactly (confirmed by reading
 *  `#mountSvg`/`#finishMount`/`#renderNow`) — NOT just a bare `createSvgRenderer()` call: a real
 *  mount() first paints WITHOUT a critical path (`#renderInput()` never includes one), then the
 *  reactive effect it wires immediately computes one and calls `handle.update()` a second time to
 *  patch it in. `computeCriticalPath()` alone costs the large majority of total mount time at
 *  these task counts (confirmed while calibrating the budgets below — an unrelated, pre-existing
 *  cost this ticket did not introduce and is out of scope to optimize here); omitting it from this
 *  comparative path would make the assertion compare "Canvas mount minus CPM" against "SVG
 *  construct only", which is not the fair, apples-to-apples comparison §9.4c calls for. Clears
 *  `rawContainer` first so repeated calls don't accumulate multiple `<svg>` roots. */
function mountSvgDirectAndTime(): Promise<{ ms: number }> {
  rawContainer.replaceChildren();
  const start = performance.now();
  const handle = createSvgRenderer(rawContainer, { tasks, dependencies, calendar: DEFAULT_CALENDAR });
  const criticalPath = computeCriticalPath(tasks, dependencies, DEFAULT_CALENDAR);
  handle.update({ tasks, dependencies, calendar: DEFAULT_CALENDAR, selectedTaskIds: [], criticalPath });
  const ms = performance.now() - start;
  return Promise.resolve({ ms });
}

// Deliberately NO auto-mount-on-load here: `__mountAndTime()` must measure a genuine COLD first
// `mount()` call every time it's invoked. Both the perf spec and the visual-boundary spec must
// explicitly call `window.__mountAndTime()` themselves (once per fresh page navigation, for the
// perf spec's repeated-sample runs) to get a true cold-start number every time.

if (import.meta.env.DEV) {
  Object.assign(window as unknown as Record<string, unknown>, {
    __gantt: gantt,
    __mountAndTime: mountAndTime,
    __mountSvgDirectAndTime: mountSvgDirectAndTime,
  });
}
