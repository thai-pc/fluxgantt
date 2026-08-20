// Canvas a11y/interaction harness (spec-canvas-renderer-ticket2.md §12.5).
//
// TEMPORARY FILE — Ticket 2 of `.claude/work/plan-canvas-renderer.md` only, same posture as
// `canvas-harness.ts` (Ticket 1): `createCanvasRenderer` is not yet re-exported from
// `@fluxgantt/core`'s public barrel (deliberately inert/unwired — Ticket 3's job), so this
// harness imports it via a RELATIVE PATH directly into workspace source, bypassing the
// published package surface. Expected to be deleted/rewritten once Ticket 3 wires Canvas mode
// into `createGantt().mount()`.
//
// Unlike `canvas-harness.ts` (paint-only, ~8 tasks), this harness exercises the FULL Ticket 2
// interaction surface end to end: `enableClickSelect` + `enableKeyboardNav` wired directly
// against a real `createCanvasRenderer()` handle, with a small in-page selection/focus state
// object standing in for what `gantt.ts`'s real `TaskStore`/`SelectionStore` will do once
// Ticket 3 lands — mirroring in miniature what the eventual facade wiring will look like.
// 1,000 tasks — a large-N interaction smoke fixture (see `TASK_COUNT` below for why it's 1,000,
// not the architecture.md `>2000` Canvas-switch threshold value).
import { Temporal } from '@js-temporal/polyfill';
import { createCanvasRenderer } from '../../../packages/core/src/render/canvas-renderer.js';
import { enableClickSelect } from '../../../packages/core/src/interaction/selection.js';
import { enableKeyboardNav } from '../../../packages/core/src/interaction/keyboard-nav.js';
import { layoutRows } from '../../../packages/core/src/render/renderer-base.js';
import { toTaskId, type Task, type TaskId } from '@fluxgantt/core';

// `@fluxgantt/core` treats Temporal as an optional peerDependency and reads `globalThis.Temporal`
// (spec-canvas-webkit-dimension-limit.md §13.2 finding, `packages/core/src/internal/temporal.ts`)
// — it is the HOST APP's job to install it. Guarded (`??=`) so this is a no-op wherever the
// runtime already has native `Temporal` (e.g. this repo's Playwright-bundled Chromium build, at
// the time of writing) and only actually installs the polyfill where it's missing (e.g.
// Playwright's bundled WebKit build, which does not yet ship native `Temporal`) — required for
// this harness to run under the new `webkit-canvas-dimension-guard` Playwright project.
(globalThis as { Temporal?: typeof Temporal }).Temporal ??= Temporal;

// TASK_COUNT is deliberately NOT the architecture.md `>2000` Canvas-switch figure. Real browsers
// impose a hard PER-DIMENSION limit on a `<canvas>`'s backing store — confirmed empirically in
// this environment via a Playwright binary search (fill a marker rect near the bottom edge of
// canvases of increasing `height`, then `getImageData` it back): height=65535 paints correctly,
// height=65536 does not — every draw call still "succeeds" (no thrown exception), it just has
// zero visible effect, because the browser silently failed to allocate a valid backing surface.
// `createCanvasRenderer` (Ticket 1) has no virtual scrolling yet (architecture.md's "virtual
// scrolling for large projects" is aspirational, not implemented in the static painter): the
// canvas bitmap is sized to `totalWidth × totalHeight × devicePixelRatio` for the FULL, unclipped
// date range and row count, with no cap. At `ROW_HEIGHT.default` (32px) + a 32px header, the
// theoretical max before hitting 65535px is ~2,047 rows — but that cuts it close, and the exact
// boundary between 32,768 and 65,535 was NOT further bisected, so a lower real limit on some
// GPU/CI combination (32,768 is the next natural power-of-two candidate) can't be ruled out.
// 1,000 rows keeps `32 + 1000×32 = 32,032px` comfortably under BOTH candidate boundaries while
// still being a meaningful large-N a11y-grid + interaction smoke test. This is a genuine,
// previously-undiscovered gap in Ticket 1's painter (silent blank rendering past this row count,
// invisible to `canvas-renderer.test.ts`'s mocked-2D-context unit tests) — flagged for Ticket 3
// (virtual scrolling), not fixed here; this harness works around it rather than papering over it.
const TASK_COUNT = 1000;
const base = Temporal.PlainDate.from('2026-01-01');
const now = new Date('2026-01-01T00:00:00Z');
// Every task's [start, end) is confined to this fixed 14-day window (cycled, not monotonically
// advancing) — a narrow date range keeps the canvas WIDTH small regardless of TASK_COUNT.
const WINDOW_DAYS = 14;

// Flat list (no hierarchy) — every row directly reachable.
const tasks: Task[] = Array.from({ length: TASK_COUNT }, (_, i) => {
  const start = base.add({ days: i % WINDOW_DAYS });
  const end = start.add({ days: 2 });
  return {
    id: toTaskId(`t${i}`),
    name: `Task ${i + 1}`,
    start: start.toString(),
    end: end.toString(),
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
  };
});

const container = document.getElementById('gantt')!;
const handle = createCanvasRenderer(container, { tasks, dependencies: [] });

// --- Minimal in-page selection/focus state (stand-in for the real TaskStore/SelectionStore
// that Ticket 3's `gantt.ts` wiring will eventually own) ---------------------------------
let selected = new Set<TaskId>();
let focusedTaskId: TaskId | undefined;

function rerender(): void {
  handle.update({
    tasks,
    dependencies: [],
    selectedTaskIds: [...selected],
    focusedTaskId,
  });
}

/** Resolves every task id whose row falls between `anchorId` and `focusId` (inclusive), in
 *  row order — same semantics `enableClickSelect`'s Shift+click range-select already uses,
 *  reimplemented here for the keyboard path since `KeyboardNavOptions.onRangeSelect` only
 *  hands back the two endpoint ids, not the resolved range. */
function resolveRange(anchorId: TaskId, focusId: TaskId): TaskId[] {
  const rows = layoutRows(tasks, 'default');
  const anchorIndex = rows.findIndex((r) => r.task.id === anchorId);
  const focusIndex = rows.findIndex((r) => r.task.id === focusId);
  if (anchorIndex === -1 || focusIndex === -1) return focusId !== undefined ? [focusId] : [];
  const lo = Math.min(anchorIndex, focusIndex);
  const hi = Math.max(anchorIndex, focusIndex);
  return rows.slice(lo, hi + 1).map((r) => r.task.id);
}

enableClickSelect(handle, () => tasks, {
  onSelect(id) {
    selected = new Set([id]);
    focusedTaskId = id;
    rerender();
  },
  onToggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
    focusedTaskId = id;
    rerender();
  },
  onRangeSelect(ids) {
    selected = new Set(ids);
    rerender();
  },
  onClear() {
    selected = new Set();
    rerender();
  },
});

const nav = enableKeyboardNav(handle, {
  onSelect(id) {
    selected = new Set([id]);
    focusedTaskId = id;
    rerender();
  },
  onToggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
    focusedTaskId = id;
    rerender();
  },
  onRangeSelect(anchorId, focusId) {
    selected = new Set(resolveRange(anchorId, focusId));
    focusedTaskId = focusId;
    rerender();
  },
  // No real store in this harness — Delete/undo/redo/duplicate/zoom are all no-ops. This
  // harness's scope is click-select + roving-tabindex keyboard nav parity (spec §12.5), not
  // full editing; Ticket 3's real `gantt.ts` wiring supplies the mutating behavior these
  // callbacks would otherwise drive.
  onDeleteSelected() {},
  onUndo() {},
  onRedo() {},
  onDuplicateSelected() {},
  onZoomIn() {},
  onZoomOut() {},
  getTasks: () => tasks,
  density: 'default',
  isReadOnly: () => false,
  getSelection: () => [...selected],
});

// Keep focusedTaskId in sync with keyboard-nav's own initial-focus resolution (spec §4.2) —
// enableKeyboardNav resolves an initial focused row at setup time, independent of this
// harness's own `focusedTaskId` variable, so seed it once here.
focusedTaskId = nav.getFocusedTaskId();
rerender();

if (import.meta.env.DEV) {
  (window as unknown as { __canvasA11yHandle?: typeof handle }).__canvasA11yHandle = handle;
}
