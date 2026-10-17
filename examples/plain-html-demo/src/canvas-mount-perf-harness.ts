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
//   ?taskCount=N             — flat (no hierarchy) synthetic dataset size, default 100. The
//                              PRIMARY axis this harness varies — see `generateDataset()` below
//                              for the exact shape (rolling 30-working-day window, ~30%
//                              FS-chained dependencies).
//   ?canvasViewportHeight=N  — forwarded verbatim to `GanttConfig.canvasViewportHeight`,
//                              omitted (Canvas's own 600px default applies) when absent. Only
//                              needed by `canvas-auto-switch-boundary.spec.ts`'s dimension-guard
//                              test: since issue #37 decoupled Canvas's backing-store height from
//                              `taskCount` entirely, `taskCount` alone can no longer be used to
//                              force a `CanvasDimensionExceededError` fallback — an explicit,
//                              oversized `canvasViewportHeight` is now the only way to do that
//                              through the real `mount()` path.
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
// renderer is chosen (`#renderNow` always computes it), and out of scope to optimize here.
//
// HISTORICAL FINDING, now RESOLVED (see `tests/performance/canvas-mount.spec.ts`'s module comment
// for the full history): Ticket 3's original measurement found Canvas mount ~1.3-1.4x SLOWER than
// a fair forced-SVG mount at the same task count, root-caused to Canvas mode's hidden ARIA a11y
// grid layer (Ticket 2) building one real DOM row per task on every render regardless of what was
// visible. That was windowed (issue #36), and Canvas's own row rendering/hit-testing was later
// made row-band-virtualized too (issue #37 — `computeVisibleWindow`, `canvas-renderer.ts`) so cost
// no longer scales with total row count at all. Canvas mount is now consistently and comfortably
// FASTER than a fair forced-SVG mount at the same task count, matching
// architecture.md's "Canvas fallback... task count > 2000" framing.
import { Temporal } from '@js-temporal/polyfill';
import {
  createGantt,
  computeCriticalPath,
  DEFAULT_CALENDAR,
  toTaskId,
  toDependencyId,
  type Task,
  type Dependency,
  type GanttInstance,
} from '@fluxgantt/core';
// `createSvgRenderer` moved off the main barrel in the facade split (it is render-layer code,
// and re-exporting it from `.` pinned the SVG renderer into every consumer's graph).
import { createSvgRenderer, withRender, type RenderCapability } from '@fluxgantt/core/render';
import { withViewport, type ViewportCapability } from '@fluxgantt/core/viewport';

// `@fluxgantt/core` treats Temporal as an optional peerDependency and reads `globalThis.Temporal`
// — it is the HOST APP's job to install it (`packages/core/src/internal/temporal.ts`). Guarded
// (`??=`) so this is a no-op wherever the runtime already has native `Temporal` (this repo's
// Playwright-bundled Chromium build — the only engine this harness's Playwright projects
// (`performance`, `visual`) target, see `playwright.config.ts`) — matching every other canvas
// harness's own defensive posture (`canvas-harness.ts`,
// `canvas-webkit-dimension-guard-harness.ts`).
(globalThis as { Temporal?: typeof Temporal }).Temporal ??= Temporal;

const WORKING_DAY_WINDOW_SIZE = 30;
const GROUP_SIZE = 20;

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
 *  writeup): "flat" here isn't just a simplification — `layoutRows()` still gives every task
 *  exactly one row with no collapse concept. Before issue #37's row/viewport-virtualization fix,
 *  that meant Canvas's dimension guard (65,535px ÷ 32px ≈ 2,047 rows at default density) made any
 *  `taskCount` past ~2,047 structurally unable to mount via Canvas at all. Since that fix, Canvas's
 *  backing-store height is bound to a fixed viewport (`resolveViewportHeightPx()`, default 600px)
 *  independent of row count, so `taskCount=5000` and `taskCount=10000` in the perf spec now
 *  measure a genuine, successful Canvas mount — the rolling working-day window here also keeps the
 *  derived WIDTH axis small and constant regardless of `taskCount`, so neither dimension axis is
 *  hit by this dataset shape at any of the sizes this harness is driven at. */
function generateDataset(
  taskCount: number,
  windowSize: number,
  grouped: boolean,
): { tasks: Task[]; dependencies: Dependency[] } {
  const workingDayWindow = buildWorkingDayWindow(windowSize);
  const now = new Date('2026-01-01T00:00:00Z');
  const tasks: Task[] = [];
  const dependencies: Dependency[] = [];
  for (let i = 0; i < taskCount; i++) {
    const date = workingDayWindow[i % windowSize]!;
    // `grouped`: every 20th task is a summary row whose 19 followers are its children, so a
    // collapse has something to hide. Dependencies then only link siblings.
    const isGroupHead = grouped && i % GROUP_SIZE === 0;
    tasks.push({
      id: toTaskId(`perf-task-${i}`),
      name: `Task ${i + 1}`,
      start: date,
      end: date,
      progress: 0,
      type: isGroupHead ? 'summary' : 'task',
      ...(grouped && !isGroupHead ? { parent: toTaskId(`perf-task-${i - (i % GROUP_SIZE)}`) } : {}),
      createdAt: now,
      updatedAt: now,
    });
    if (i > 0 && i % 10 < 3 && !(grouped && (i % GROUP_SIZE === 0 || i % GROUP_SIZE === 1))) {
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
// `?span=N` widens the rolling window from 30 to N working days (a long date range, so
// `computeGridColumns` has many columns); `?holidays=N` gives the calendar N holidays;
// `?grouped=1` adds summary rows (needed for the collapse op); `?mounted=1` mounts on load and
// exposes `__repaintAndTime` (svg-repaint.spec.ts). All default to the original shape.
const spanParam = Number(params.get('span') ?? WORKING_DAY_WINDOW_SIZE);
const holidayCount = Number(params.get('holidays') ?? '0');
const grouped = params.get('grouped') === '1';
const { tasks, dependencies } = generateDataset(taskCount, spanParam, grouped);
const calendar = {
  ...DEFAULT_CALENDAR,
  holidays: Array.from({ length: holidayCount }, (_, i) =>
    Temporal.PlainDate.from('2026-01-05')
      .add({ days: 7 * (i + 1) + 2 })
      .toString(),
  ),
};
const canvasViewportHeightParam = params.get('canvasViewportHeight');
const canvasViewportHeight =
  canvasViewportHeightParam !== null ? Number(canvasViewportHeightParam) : undefined;

const container = document.getElementById('gantt')!;
// `mount()` lives on the opt-in `withRender` mixin since the facade split — this harness times
// that exact path, so it composes it. `withInteraction` is deliberately NOT composed: gesture
// wiring is not part of what §9.4 measures.
const gantt: GanttInstance & RenderCapability & ViewportCapability = withViewport(
  withRender(
    createGantt({
      tasks,
      dependencies,
      ...(holidayCount > 0 ? { calendar } : {}),
      ...(canvasViewportHeight !== undefined ? { canvasViewportHeight } : {}),
    }),
  ),
);

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
  const handle = createSvgRenderer(rawContainer, {
    tasks,
    dependencies,
    calendar: DEFAULT_CALENDAR,
  });
  const criticalPath = computeCriticalPath(tasks, dependencies, DEFAULT_CALENDAR);
  handle.update({
    tasks,
    dependencies,
    calendar: DEFAULT_CALENDAR,
    selectedTaskIds: [],
    criticalPath,
  });
  const ms = performance.now() - start;
  return Promise.resolve({ ms });
}

type RepaintOp = 'zoom' | 'density' | 'collapse' | 'select' | 'selectAll' | 'updateTask';
const viewModes = ['month', 'week', 'day'] as const;
let zoomStep = 0;
let densityStep = 0;
let selectStep = 0;

/** Counts full SVG renders by watching for the `<defs>` arrowhead marker each `render()` appends
 *  (one per render) — a wall-clock-independent tripwire for redundant repaints. */
function countRenders(svg: Element, run: () => void): number {
  const observer = new MutationObserver(() => {});
  observer.observe(svg, { childList: true });
  run();
  const records = observer.takeRecords();
  observer.disconnect();
  let renders = 0;
  for (const r of records) for (const n of r.addedNodes) if (n.nodeName === 'defs') renders++;
  return renders;
}

/** Runs one mutation against the MOUNTED chart, then waits two animation frames (style + layout +
 *  paint). `jsMs` = the synchronous call, `paintMs` = until the second frame, `renders` = full SVG
 *  renders the call caused. */
async function repaintAndTime(
  op: RepaintOp,
): Promise<{ jsMs: number; paintMs: number; renders: number }> {
  const svg = container.querySelector('svg.fg-timeline')!;
  const t0 = performance.now();
  const renders = countRenders(svg, () => {
    switch (op) {
      case 'zoom':
        gantt.zoomTo(viewModes[++zoomStep % viewModes.length]!);
        break;
      case 'density':
        gantt.setDensity(densityStep++ % 2 === 0 ? 'compact' : 'default');
        break;
      case 'collapse':
        gantt.toggleCollapse(toTaskId('perf-task-0'));
        break;
      case 'select':
        gantt.select(toTaskId(`perf-task-${10 + (selectStep++ % 5)}`));
        break;
      case 'selectAll':
        gantt.selectAll();
        break;
      case 'updateTask':
        gantt.updateTask(toTaskId('perf-task-10'), { name: `renamed ${performance.now()}` });
        break;
    }
  });
  const jsMs = performance.now() - t0;
  await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));
  return { jsMs, paintMs: performance.now() - t0, renders };
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
    __repaintAndTime: repaintAndTime,
  });
  // Opt-in only (`?mounted=1`): the default contract above stays "never auto-mount".
  if (params.get('mounted') === '1') gantt.mount(container);
}
