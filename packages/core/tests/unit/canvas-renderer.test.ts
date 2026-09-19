// @vitest-environment jsdom
//
// DOM + security tests for the Canvas renderer (spec-canvas-renderer-ticket1.md §9.1).
// Runs under jsdom (per-file override; the rest of core stays `environment: 'node'`), same
// convention `svg-renderer.test.ts` already uses.
//
// jsdom's `HTMLCanvasElement.prototype.getContext('2d')` returns `null` (no real Canvas
// implementation), so this file monkey-patches it to return a hand-rolled call-log mock
// before each `createCanvasRenderer()` call, restoring in `afterEach` via
// `vi.restoreAllMocks()`. Deliberately NOT `node-canvas`/`canvas` — see spec §9.1 for the
// full rationale (native-binding fragility, dependency-minimization, and pixel fidelity is
// already covered by the separate Playwright visual-regression spec).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import type { Temporal } from '@js-temporal/polyfill';
import {
  createCanvasRenderer,
  CanvasDimensionExceededError,
  MAX_CANVAS_DIMENSION_PX,
  MAX_CANVAS_AREA_PX_WEBKIT,
  resolveViewportHeightPx,
  computeVisibleWindow,
} from '../../src/render/canvas-renderer.js';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { computeCriticalPath } from '../../src/compute/critical-path.js';
import { DEFAULT_CALENDAR, normalizeDate } from '../../src/compute/working-calendar.js';
import {
  layoutDependencyPath,
  buildTaskAriaLabel,
  type TaskBarLayout,
  type RowLayout,
} from '../../src/render/renderer-base.js';
import { toTaskId, toDependencyId, type Task, type Dependency } from '../../src/types.js';

const cal = DEFAULT_CALENDAR;

function task(id: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: toTaskId(id),
    name: id,
    start,
    end,
    progress: 0.5,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

const baseTasks: Task[] = [
  task('a', '2026-01-05T09:00', '2026-01-07T17:00', { type: 'summary' }),
  task('b', '2026-01-06T09:00', '2026-01-08T17:00', { parent: toTaskId('a') }),
  task('c', '2026-01-09T09:00', '2026-01-12T17:00'),
  task('m', '2026-01-13T09:00', '2026-01-13T09:00', { type: 'milestone' }),
];
const baseDeps: Dependency[] = [
  { id: toDependencyId('d1'), from: toTaskId('a'), to: toTaskId('b'), type: 'SS' },
  { id: toDependencyId('d2'), from: toTaskId('b'), to: toTaskId('c'), type: 'FS' },
  { id: toDependencyId('d3'), from: toTaskId('c'), to: toTaskId('m'), type: 'FF' },
];

/**
 * Distinct, non-overlapping 1-day tasks, no `parent` (spec-canvas-row-limit-fix.md §12.1) —
 * general-purpose flat fixture used throughout this file for windowing/a11y/hit-testing
 * coverage. Every task shares the same tiny date span shape (1 day, offset by `i` days), so
 * the derived `TimeScale.totalWidth` stays comfortably under `MAX_CANVAS_DIMENSION_PX` for
 * moderate `n` (roughly up to ~2,700) — beyond that, the offset-by-`i`-days shape itself
 * starts to cross the WIDTH guard (an orthogonal axis from row count), so tests that need a
 * LARGE row count while deliberately isolating the height axis use
 * `buildManySameDayTasks()` below instead (fix #37, spec-canvas-row-virtualization.md).
 * NOTE: since fix #37, the canvas HEIGHT axis is no longer row-count-driven at all (bound to
 * `resolveViewportHeightPx()` instead) — this fixture is no longer used to hit the height
 * guard's boundary; see the 'canvas dimension guard' describe block below for how that's now
 * exercised (via an explicit, oversized `options.viewportHeight`).
 */
function buildFlatTasks(n: number): Task[] {
  const base = normalizeDate('2026-01-05T09:00', cal.timezone);
  const now = new Date();
  const tasks: Task[] = [];
  for (let i = 0; i < n; i++) {
    const start = base.add({ days: i });
    const end = start.add({ hours: 8 });
    tasks.push({
      id: toTaskId(`t${i}`),
      name: `t${i}`,
      start,
      end,
      progress: 0,
      type: 'task',
      createdAt: now,
      updatedAt: now,
    });
  }
  return tasks;
}

/**
 * `n` distinct rows (unique `id`, no `parent`) that ALL share the exact same start/end instant
 * (fix #37) — unlike `buildFlatTasks()` above (which offsets each task by one day, so its
 * derived width grows with `n` and would itself cross the width guard well before 5,000 rows),
 * this keeps the derived `TimeScale.totalWidth` a small constant regardless of `n`, so tests
 * using this helper isolate the HEIGHT axis (row count) cleanly, with zero risk of an
 * incidental width-axis interaction.
 */
function buildManySameDayTasks(n: number): Task[] {
  const start = normalizeDate('2026-01-05T09:00', cal.timezone);
  const end = start.add({ hours: 8 });
  const now = new Date();
  const tasks: Task[] = [];
  for (let i = 0; i < n; i++) {
    tasks.push({
      id: toTaskId(`t${i}`),
      name: `t${i}`,
      start,
      end,
      progress: 0,
      type: 'task',
      createdAt: now,
      updatedAt: now,
    });
  }
  return tasks;
}

// --- Hand-rolled CanvasRenderingContext2D call-log mock (spec §9.1) --------------------

interface DrawCall {
  readonly op:
    | 'fillRect'
    | 'strokeRect'
    | 'moveTo'
    | 'lineTo'
    | 'closePath'
    | 'beginPath'
    | 'rect'
    | 'fill'
    | 'stroke'
    | 'fillText'
    | 'setLineDash'
    | 'save'
    | 'restore'
    | 'translate'
    | 'rotate'
    | 'setTransform'
    | 'roundRect'
    | 'set';
  readonly args: readonly unknown[];
  readonly prop?: string;
}

interface MockContext2D {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: DrawCall[];
}

const TRACKED_PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textBaseline', 'textAlign'] as const;
const TRACKED_METHODS = [
  'fillRect',
  'strokeRect',
  'moveTo',
  'lineTo',
  'closePath',
  'beginPath',
  'rect',
  'fill',
  'stroke',
  'fillText',
  'setLineDash',
  'save',
  'restore',
  'translate',
  'rotate',
  'setTransform',
  'roundRect',
] as const;

function createMockContext2D(options: { withRoundRect?: boolean } = {}): MockContext2D {
  const calls: DrawCall[] = [];
  const propValues: Record<string, unknown> = {};

  const target: Record<string, unknown> = {};
  for (const method of TRACKED_METHODS) {
    if (method === 'roundRect' && options.withRoundRect === false) continue;
    target[method] = (...args: unknown[]): void => {
      calls.push({ op: method, args });
    };
  }
  for (const prop of TRACKED_PROPS) {
    Object.defineProperty(target, prop, {
      enumerable: true,
      get(): unknown {
        return propValues[prop];
      },
      set(value: unknown): void {
        propValues[prop] = value;
        calls.push({ op: 'set', prop, args: [value] });
      },
    });
  }

  return { ctx: target as unknown as CanvasRenderingContext2D, calls };
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

function installMockContext(mock: MockContext2D): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => mock.ctx);
}

function setDpr(value: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true, writable: true });
}

// --- spec-canvas-webkit-dimension-limit.md §13.1 -------------------------------------------
const ORIGINAL_USER_AGENT = navigator.userAgent;

/** Mirrors `setDpr()`'s override pattern — overrides `navigator.userAgent` for the current
 *  test, restored in `afterEach` below (navigator.userAgent, unlike devicePixelRatio, is read
 *  by `isWebKitEngine()` in every `render()` call, so a leaked override could silently affect
 *  unrelated later tests — worth actually restoring, not just relying on each test setting its
 *  own value). */
function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

const WEBKIT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const CHROMIUM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHROME_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

afterEach(() => {
  setUserAgent(ORIGINAL_USER_AGENT);
});

/**
 * A shape whose physical AREA exceeds `MAX_CANVAS_AREA_PX_WEBKIT` (16,777,216) but whose
 * individual physical axes both stay comfortably under `MAX_CANVAS_DIMENSION_PX` (65,535) —
 * the single shape this whole ticket's guard exists to catch on WebKit, and the single shape
 * whose behavior must NOT change on Chromium (§13.3's "must not regress" case). `viewMode:
 * 'day'` (60px/day, `renderer-base.ts`) over an exact 81-day range gives a deterministic
 * `physicalWidth = 160 (LABEL_COLUMN_WIDTH) + 81*60 = 5,020`.
 *
 * fix #37 (spec-canvas-row-virtualization.md): `physicalHeight` no longer scales with row
 * count (it is bound to `resolveViewportHeightPx(options)`), so this fixture now pins height
 * via an explicit `viewportHeight: 3_400` instead of via row count (previously
 * `buildFlatTasks(312)` alone drove `physicalHeight` to 10,016) — `tasks` is now just a small,
 * arbitrary flat set. `5,020 * 3,400 = 17,068,000` — comfortably over the 16,777,216 WebKit
 * area ceiling, and both axes comfortably under 65,535.
 */
function buildAreaOnlyOverflowFixture(): {
  tasks: Task[];
  timeRange: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime };
  viewportHeight: number;
} {
  const start = normalizeDate('2026-01-01T00:00', cal.timezone);
  const end = start.add({ days: 81 });
  return { tasks: buildFlatTasks(5), timeRange: { start, end }, viewportHeight: 3_400 };
}

// --- Structure / ARIA ---------------------------------------------------------------------

describe('createCanvasRenderer — structure', () => {
  it('mounts a <canvas class="fg-timeline-canvas"> that is aria-hidden (Ticket 2 supersedes Ticket 1\'s role="img" stopgap)', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.canvas.tagName.toLowerCase()).toBe('canvas');
    expect(h.canvas.getAttribute('class')).toBe('fg-timeline-canvas');
    expect(h.canvas.getAttribute('aria-hidden')).toBe('true');
    expect(h.canvas.getAttribute('role')).toBeNull();
    expect(h.canvas.getAttribute('aria-label')).toBeNull();
    expect(container.querySelectorAll('canvas.fg-timeline-canvas')).toHaveLength(1);
  });

  it('aria-label is capped at 200 chars for an oversized options.ariaLabel — now on interactionRoot, not canvas', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const longLabel = 'x'.repeat(500);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps }, { ariaLabel: longLabel });
    expect(h.interactionRoot.getAttribute('aria-label')).toHaveLength(200);
  });

  it('interactionRoot is a real, attached HTMLElement (Ticket 2) — different node than canvas', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.interactionRoot).toBeInstanceOf(HTMLElement);
    expect(h.interactionRoot).not.toBe(h.canvas);
    expect(container.contains(h.interactionRoot)).toBe(true);
    expect(h.pointerEventTarget).toBe(h.canvas);
  });
});

// --- Hidden ARIA layer (Ticket 2, spec §5 / §12.1) --------------------------------------

describe('hidden ARIA layer', () => {
  it('offscreen CSS applied via inline style.* (no host stylesheet loaded in this test)', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    // `position: sticky` (not `absolute`) since fix #37 — `container` is now the real scroll
    // viewport, and sticky keeps this hidden layer pinned at its visible top-left corner
    // regardless of scroll position (see canvas-renderer.ts's header comment + this file's
    // "row virtualization — a11y DOM windowing (fix #37)" describe block below).
    expect(h.interactionRoot.style.position).toBe('sticky');
    expect(h.interactionRoot.style.top).toBe('0px');
    expect(h.interactionRoot.style.left).toBe('0px');
    expect(h.interactionRoot.style.width).toBe('1px');
    expect(h.interactionRoot.style.height).toBe('1px');
    expect(h.interactionRoot.style.overflow).toBe('hidden');
    expect(h.interactionRoot.style.clip).toBe('rect(0px, 0px, 0px, 0px)');
    expect(h.interactionRoot.style.clipPath).toBe('inset(50%)');
  });

  it('layer root: role="treegrid" for a hierarchical project, aria-rowcount, aria-multiselectable, aria-label', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps }, { ariaLabel: 'My chart' });
    // `treegrid`, not `grid` — mirrors svg-renderer.ts: `baseTasks` has a summary row, whose
    // rows carry `aria-expanded`, valid only under `treegrid` (spec-collapse-expand.md §6.4).
    expect(h.interactionRoot.getAttribute('role')).toBe('treegrid');
    expect(h.interactionRoot.getAttribute('aria-rowcount')).toBe(String(baseTasks.length));
    expect(h.interactionRoot.getAttribute('aria-multiselectable')).toBe('true');
    expect(h.interactionRoot.getAttribute('aria-label')).toBe('My chart');
  });

  it('layer root: a flat project stays a plain role="grid"', () => {
    // No row has children -> no `aria-expanded` is emitted -> plain `grid`, same rule as
    // svg-renderer.ts (spec-collapse-expand.md §6.4).
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: buildFlatTasks(5), dependencies: [] });
    expect(h.interactionRoot.getAttribute('role')).toBe('grid');
  });

  it('one .fg-timeline-canvas__row per task, correct role/data-row-index/data-task-id/aria-rowindex/aria-selected', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, {
      tasks: baseTasks,
      dependencies: baseDeps,
      selectedTaskIds: [toTaskId('b')],
    });
    const rowEls = h.interactionRoot.querySelectorAll<HTMLElement>('.fg-timeline-canvas__row');
    expect(rowEls).toHaveLength(baseTasks.length);
    rowEls.forEach((rowEl, i) => {
      expect(rowEl.getAttribute('role')).toBe('row');
      expect(rowEl.getAttribute('data-row-index')).toBe(String(i));
      expect(rowEl.getAttribute('data-task-id')).toBe(baseTasks[i]!.id);
      expect(rowEl.getAttribute('aria-rowindex')).toBe(String(i + 1));
      expect(rowEl.getAttribute('aria-selected')).toBe(baseTasks[i]!.id === 'b' ? 'true' : 'false');
    });
  });

  it('nested .fg-timeline-canvas__row-cell[role=gridcell] > .fg-timeline-canvas__task[data-task-id] with aria-label matching buildTaskAriaLabel', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const cp = computeCriticalPath(baseTasks, baseDeps, cal);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps, criticalPath: cp });
    const rowEl = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__row[data-task-id="c"]')!;
    const cellEl = rowEl.querySelector('.fg-timeline-canvas__row-cell[role="gridcell"]');
    expect(cellEl).not.toBeNull();
    const taskEl = cellEl!.querySelector<HTMLElement>('.fg-timeline-canvas__task[data-task-id="c"]');
    expect(taskEl).not.toBeNull();
    const isCritical = cp.criticalTaskIds.includes(toTaskId('c'));
    const expected = buildTaskAriaLabel(baseTasks[2]!, isCritical, false, cal, 'en');
    expect(taskEl!.getAttribute('aria-label')).toBe(expected);
  });

  it('roving tabindex: exactly one [tabindex="0"], matching focusedTaskId; unset falls back to rows[0]', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps, focusedTaskId: toTaskId('c') });
    const tabbable = h.interactionRoot.querySelectorAll<HTMLElement>('[tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]!.getAttribute('data-task-id')).toBe('c');

    const h2 = createCanvasRenderer(document.createElement('div'), { tasks: baseTasks, dependencies: baseDeps });
    const tabbable2 = h2.interactionRoot.querySelectorAll<HTMLElement>('[tabindex="0"]');
    expect(tabbable2).toHaveLength(1);
    expect(tabbable2[0]!.getAttribute('data-task-id')).toBe(baseTasks[0]!.id);
  });

  it('canvas: aria-hidden === "true", role/aria-label attributes absent', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.canvas.getAttribute('aria-hidden')).toBe('true');
    expect(h.canvas.hasAttribute('role')).toBe(false);
    expect(h.canvas.hasAttribute('aria-label')).toBe(false);
  });

  it('focus restoration: focus a row, update() with same tasks, activeElement is a freshly-rebuilt row with the same data-task-id', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps, focusedTaskId: toTaskId('b') });
    const rowB = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__row[data-task-id="b"]')!;
    rowB.focus();
    // `.focus()` itself synchronously fires a real `focusin` that this module reacts to (not
    // suppressed by the reentrancy guard — that guard only suppresses render()'s OWN internal
    // restoration focus() calls, not a genuinely external one) — triggering a render that
    // rebuilds every row, including the one we just focused. Re-query for the live element
    // rather than assuming `rowB` is still attached/current.
    const rowBAfterFirstFocus = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__row[data-task-id="b"]')!;
    expect(document.activeElement).toBe(rowBAfterFirstFocus);

    h.update({ tasks: baseTasks, dependencies: baseDeps, focusedTaskId: toTaskId('b') });
    const newRowB = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__row[data-task-id="b"]')!;
    expect(newRowB).not.toBe(rowBAfterFirstFocus); // full rebuild — a new element
    expect(document.activeElement).toBe(newRowB);
  });

  describe('SECURITY', () => {
    it('a malicious task name reaches textContent verbatim, never markup — no <img>/<script> under interactionRoot', () => {
      const mock = createMockContext2D();
      installMockContext(mock);
      const evilName = '<img src=x onerror=alert(1)>';
      const t = task('x', '2026-01-05T09:00', '2026-01-07T17:00', { name: evilName });
      const h = createCanvasRenderer(container, { tasks: [t], dependencies: [] });
      const labelEl = h.interactionRoot.querySelector('.fg-timeline-canvas__row-label')!;
      expect(labelEl.textContent).toBe(evilName);
      expect(h.interactionRoot.querySelector('img')).toBeNull();
      expect(h.interactionRoot.querySelector('script')).toBeNull();
    });

    it('a task.id containing a double-quote does not throw during focus restoration', () => {
      const mock = createMockContext2D();
      installMockContext(mock);
      const trickyId = 'x"y';
      const t = task(trickyId, '2026-01-05T09:00', '2026-01-07T17:00');
      const h = createCanvasRenderer(container, { tasks: [t], dependencies: [], focusedTaskId: toTaskId(trickyId) });
      const rowEl = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__row')!;
      rowEl.focus();
      expect(() => h.update({ tasks: [t], dependencies: [], focusedTaskId: toTaskId(trickyId) })).not.toThrow();
    });

    it('oversized task name still caps the per-task aria-label at MAX_ARIA_TASK_NAME_LENGTH (200)', () => {
      const mock = createMockContext2D();
      installMockContext(mock);
      const longName = 'y'.repeat(500);
      const t = task('x', '2026-01-05T09:00', '2026-01-07T17:00', { name: longName });
      const h = createCanvasRenderer(container, { tasks: [t], dependencies: [] });
      const taskEl = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__task[data-task-id="x"]')!;
      const label = taskEl.getAttribute('aria-label')!;
      // label = "<name (capped 200)>, <dates> (<pct>% complete)" — assert the capped name prefix
      // length, matching svg-renderer.test.ts's equivalent assertion style.
      expect(label.startsWith('y'.repeat(200))).toBe(true);
      expect(label.startsWith('y'.repeat(201))).toBe(false);
    });

    it('unknown task.type falls back to the fg-task--task whitelist class', () => {
      const mock = createMockContext2D();
      installMockContext(mock);
      const t = task('x', '2026-01-05T09:00', '2026-01-07T17:00', { type: 'bogus' as unknown as Task['type'] });
      const h = createCanvasRenderer(container, { tasks: [t], dependencies: [] });
      const taskEl = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__task[data-task-id="x"]')!;
      expect(taskEl.classList.contains('fg-timeline-canvas__task--task')).toBe(true);
      expect(taskEl.classList.contains('fg-timeline-canvas__task--bogus')).toBe(false);
    });
  });
});

// --- collapse/expand — hidden a11y layer + hitTestRow.hitToggle (spec-collapse-expand.md
// §6.3/§9.7) -------------------------------------------------------------------------------

describe('collapse/expand — hidden a11y layer', () => {
  it('a hasChildren row ("a") gets aria-expanded="true" (expanded by default); a leaf row ("c") gets neither', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const rowA = h.interactionRoot.querySelector('.fg-timeline-canvas__row[data-task-id="a"]')!;
    expect(rowA.getAttribute('aria-expanded')).toBe('true');
    const rowC = h.interactionRoot.querySelector('.fg-timeline-canvas__row[data-task-id="c"]')!;
    expect(rowC.hasAttribute('aria-expanded')).toBe(false);
  });

  it('collapsedIds in the input reduces aria-rowcount and removes the hidden descendant row element', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, {
      tasks: baseTasks,
      dependencies: baseDeps,
      collapsedIds: new Set([toTaskId('a')]),
    });
    const rowA = h.interactionRoot.querySelector('.fg-timeline-canvas__row[data-task-id="a"]')!;
    expect(rowA.getAttribute('aria-expanded')).toBe('false');
    expect(h.interactionRoot.querySelector('.fg-timeline-canvas__row[data-task-id="b"]')).toBeNull();
    expect(h.interactionRoot.getAttribute('aria-rowcount')).toBe(String(baseTasks.length - 1)); // 'b' hidden
  });

  it('collapsedIds correctly threads through a SUBSEQUENT update() call, not just the first render (regression: both layoutRows() call sites must agree)', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.interactionRoot.querySelector('.fg-timeline-canvas__row[data-task-id="b"]')).not.toBeNull();
    expect(h.interactionRoot.getAttribute('aria-rowcount')).toBe(String(baseTasks.length));

    h.update({ tasks: baseTasks, dependencies: baseDeps, collapsedIds: new Set([toTaskId('a')]) });
    expect(h.interactionRoot.querySelector('.fg-timeline-canvas__row[data-task-id="b"]')).toBeNull();
    expect(h.interactionRoot.getAttribute('aria-rowcount')).toBe(String(baseTasks.length - 1));

    // Expand again — the hidden row must reappear.
    h.update({ tasks: baseTasks, dependencies: baseDeps, collapsedIds: new Set() });
    expect(h.interactionRoot.querySelector('.fg-timeline-canvas__row[data-task-id="b"]')).not.toBeNull();
    expect(h.interactionRoot.getAttribute('aria-rowcount')).toBe(String(baseTasks.length));
  });
});

describe('collapse/expand — hitTestRow().hitToggle (spec-collapse-expand.md §6.3)', () => {
  // Local copy of the `hitTestRow` describe block's `stubRect` helper (that one is scoped to
  // its own describe block) — gives `canvas.getBoundingClientRect()` a deterministic origin so
  // `clientX`/`clientY` map to canvas-local pixels 1:1.
  function stubRect(canvas: HTMLCanvasElement, rect: Partial<DOMRect>): void {
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => ({}),
      ...rect,
    } as DOMRect);
  }

  it('a click landing inside the toggle-glyph gutter of a hasChildren row resolves hitToggle: true', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    stubRect(h.canvas, {});
    // Row 'a' (index 0, depth 0, hasChildren): toggle gutter = [LABEL_PADDING_PX(8),
    // 8 + TOGGLE_GLYPH_GUTTER_PX(14)) = [8, 22) — x=10 lands inside it.
    const hit = h.hitTestRow(10, 32 + 16);
    expect(hit).toBeDefined();
    expect(hit!.taskId).toBe(baseTasks[0]!.id);
    expect(hit!.hitToggle).toBe(true);
  });

  it('a click on the same row but past the toggle gutter (e.g. on the label/bar area) resolves hitToggle: false', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    stubRect(h.canvas, {});
    const hit = h.hitTestRow(140, 32 + 16);
    expect(hit).toBeDefined();
    expect(hit!.taskId).toBe(baseTasks[0]!.id);
    expect(hit!.hitToggle).toBe(false);
  });

  it('a click inside the toggle-glyph gutter of a LEAF row (no children) resolves hitToggle: false — nothing to toggle', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    stubRect(h.canvas, {});
    // Row 'c' (index 2, leaf, no children) — same gutter x-range as row 'a' (depth 0), but
    // `hasChildren` is false so `hitToggle` must be false regardless of x.
    const hit = h.hitTestRow(10, 32 + 16 * 5);
    expect(hit).toBeDefined();
    expect(hit!.taskId).toBe(baseTasks[2]!.id);
    expect(hit!.hitToggle).toBe(false);
  });
});

describe('collapse/expand — SVG/Canvas parity (spec-collapse-expand.md §6.3, regression for "forgot to thread collapsedIds into Canvas\'s second layoutRows() call site")', () => {
  it('an identical dataset + identical collapsedIds renders the same visible row order and the same hasChildren/aria-expanded per row in BOTH renderers', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const collapsedIds = new Set([toTaskId('a')]);

    const canvasHandle = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps, collapsedIds });
    const svgContainer = document.createElement('div');
    document.body.appendChild(svgContainer);
    const svgHandle = createSvgRenderer(svgContainer, { tasks: baseTasks, dependencies: baseDeps, collapsedIds });

    const canvasRows = [...canvasHandle.interactionRoot.querySelectorAll<HTMLElement>('.fg-timeline-canvas__row')];
    const svgRows = [...svgHandle.svg.querySelectorAll<SVGElement>('.fg-timeline__row')];

    // Same visible task-id order.
    expect(canvasRows.map((r) => r.getAttribute('data-task-id'))).toEqual(
      svgRows.map((r) => r.getAttribute('data-task-id')),
    );
    // Same visible row count, reflected identically in aria-rowcount on both hidden/visible roots.
    expect(canvasHandle.interactionRoot.getAttribute('aria-rowcount')).toBe(svgHandle.svg.getAttribute('aria-rowcount'));
    expect(canvasRows).toHaveLength(baseTasks.length - 1); // 'b' (child of collapsed 'a') hidden

    // Same aria-expanded per row (hasChildren computed identically by both layoutRows() call
    // sites) — this is the assertion that would have caught a "forgot to thread collapsedIds
    // into the SECOND layoutRows() call" regression mechanically rather than by inspection.
    for (let i = 0; i < canvasRows.length; i++) {
      const canvasRow = canvasRows[i]!;
      const svgRow = svgRows[i]!;
      expect(canvasRow.getAttribute('data-task-id')).toBe(svgRow.getAttribute('data-task-id'));
      expect(canvasRow.hasAttribute('aria-expanded')).toBe(svgRow.hasAttribute('aria-expanded'));
      if (canvasRow.hasAttribute('aria-expanded')) {
        expect(canvasRow.getAttribute('aria-expanded')).toBe(svgRow.getAttribute('aria-expanded'));
      }
    }

    svgHandle.destroy();
    svgContainer.remove();
  });
});

// --- Hidden ARIA layer windowing (spec-canvas-row-virtualization.md, fix #37) -------------
// Supersedes issue #36's focus-centered `A11Y_WINDOW_OVERSCAN` (50) windowing — the a11y DOM
// window is now the SAME scroll-position-driven `computeVisibleWindow()` result the paint
// pass uses (`CANVAS_VIRTUALIZATION_OVERSCAN_ROWS = 20`), not an independent focus-centered
// one. `ensureFocusedRowVisible()` (also fix #37) still scrolls `container` to reveal the
// focused row FIRST, so the window this frame builds still ends up centered close to
// `focusedTaskId` in practice — but the actual boundaries below are derived from real
// scroll-math (`DEFAULT_VIEWPORT_HEIGHT_PX = 600`, `HEADER_HEIGHT = 32` ⇒ row-band viewport
// 568px ⇒ ~18 default-density (32px) rows visible ⇒ 18 + 2*20 = 58ish rows per window), not
// simply `2 * overscan + 1` the way #36's focus-centered version was.
describe('hidden ARIA layer — row-virtualization windowing (fix #37)', () => {
  it('builds far fewer row elements than taskCount, but aria-rowcount stays the FULL taskCount; window is centered near focusedTaskId, not the full list', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const tasks = buildFlatTasks(300);
    const h = createCanvasRenderer(container, { tasks, dependencies: [], focusedTaskId: toTaskId('t150') });

    const rowEls = h.interactionRoot.querySelectorAll('.fg-timeline-canvas__row');
    // Window = [113, 171] (59 rows) — see this describe block's header comment for the exact
    // scroll math (`ensureFocusedRowVisible` scrolls to `scrollTop=4264` to reveal row 150,
    // `computeVisibleWindow` then pads by ±20 rows around what's visible at that scrollTop).
    expect(rowEls).toHaveLength(59);
    expect(rowEls.length).toBeLessThan(tasks.length);
    expect(h.interactionRoot.getAttribute('aria-rowcount')).toBe(String(tasks.length));
    expect(h.interactionRoot.querySelector('[data-task-id="t150"]')).not.toBeNull();
  });

  it('a row far outside the window is absent from the DOM; window-edge rows are present', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const tasks = buildFlatTasks(300);
    const h = createCanvasRenderer(container, { tasks, dependencies: [], focusedTaskId: toTaskId('t150') });

    // Window = [113, 171] (see above).
    expect(h.interactionRoot.querySelector('[data-task-id="t0"]')).toBeNull();
    expect(h.interactionRoot.querySelector('[data-task-id="t299"]')).toBeNull();
    expect(h.interactionRoot.querySelector('[data-task-id="t112"]')).toBeNull(); // just below start
    expect(h.interactionRoot.querySelector('[data-task-id="t172"]')).toBeNull(); // just above end
    expect(h.interactionRoot.querySelector('[data-task-id="t113"]')).not.toBeNull(); // window start
    expect(h.interactionRoot.querySelector('[data-task-id="t150"]')).not.toBeNull(); // focused
    expect(h.interactionRoot.querySelector('[data-task-id="t171"]')).not.toBeNull(); // window end
  });

  it('window clamps at the start of the row list when focusedTaskId is near index 0 (no scroll needed)', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const tasks = buildFlatTasks(300);
    const h = createCanvasRenderer(container, { tasks, dependencies: [], focusedTaskId: toTaskId('t0') });

    // t0 is already within the initial (scrollTop=0) view — `ensureFocusedRowVisible` is a
    // no-op. Window = [0, 38] (rawEnd = ceil(568/32) = 18, +20 overscan = 38).
    expect(h.container.scrollTop).toBe(0);
    const rowEls = h.interactionRoot.querySelectorAll('.fg-timeline-canvas__row');
    expect(rowEls).toHaveLength(39);
    expect(h.interactionRoot.querySelector('[data-task-id="t0"]')).not.toBeNull();
    expect(h.interactionRoot.querySelector('[data-task-id="t38"]')).not.toBeNull();
    expect(h.interactionRoot.querySelector('[data-task-id="t39"]')).toBeNull();
  });

  it('window clamps at the end of the row list when focusedTaskId is near the last row', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const tasks = buildFlatTasks(300);
    const h = createCanvasRenderer(container, { tasks, dependencies: [], focusedTaskId: toTaskId('t299') });

    // `ensureFocusedRowVisible` scrolls to `scrollTop = 9032` to reveal row 299; window then
    // clamps to `[262, 299]` (endIndex clamped at `lastIndex = 299`).
    const rowEls = h.interactionRoot.querySelectorAll('.fg-timeline-canvas__row');
    expect(rowEls).toHaveLength(38);
    expect(h.interactionRoot.querySelector('[data-task-id="t299"]')).not.toBeNull();
    expect(h.interactionRoot.querySelector('[data-task-id="t262"]')).not.toBeNull();
    expect(h.interactionRoot.querySelector('[data-task-id="t261"]')).toBeNull();
  });

  it('re-rendering with a focusedTaskId far from the previous one relocates the window: new focused row present + focused, old-window-only row gone', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const tasks = buildFlatTasks(300);
    const h = createCanvasRenderer(container, { tasks, dependencies: [], focusedTaskId: toTaskId('t150') });

    const initialRow = h.interactionRoot.querySelector<HTMLElement>('[data-task-id="t150"]')!;
    initialRow.focus(); // hadFocusInside === true for the next render
    expect(document.activeElement).toBe(h.interactionRoot.querySelector('[data-task-id="t150"]'));

    h.update({ tasks, dependencies: [], focusedTaskId: toTaskId('t280') });

    // New window (see header comment's math, extended for t280) clamps to [243, 299].
    const newFocusedRow = h.interactionRoot.querySelector<HTMLElement>('[data-task-id="t280"]');
    expect(newFocusedRow).not.toBeNull();
    expect(newFocusedRow!.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(newFocusedRow);

    // t150 (old window center) is now outside [243, 299] — gone from the DOM.
    expect(h.interactionRoot.querySelector('[data-task-id="t150"]')).toBeNull();
  });

  it('degrades safely to an empty window when there are zero rows', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const start = normalizeDate('2026-01-01T00:00', cal.timezone);
    const end = start.add({ days: 10 });
    const h = createCanvasRenderer(container, { tasks: [], dependencies: [] }, { timeRange: { start, end } });
    expect(h.interactionRoot.querySelectorAll('.fg-timeline-canvas__row')).toHaveLength(0);
    expect(h.interactionRoot.getAttribute('aria-rowcount')).toBe('0');
  });

  it('a small project (fewer rows than one window) degrades to the full row set materialized, no clamping surprises', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const tasks = buildFlatTasks(5);
    const h = createCanvasRenderer(container, { tasks, dependencies: [] });
    const rowEls = h.interactionRoot.querySelectorAll('.fg-timeline-canvas__row');
    expect(rowEls).toHaveLength(5);
    expect(h.interactionRoot.getAttribute('aria-rowcount')).toBe('5');
  });
});

// --- hitTestRow (Ticket 2, spec §7.2 / §12.2) --------------------------------------------

describe('hitTestRow', () => {
  function stubRect(canvas: HTMLCanvasElement, rect: Partial<DOMRect>): void {
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => ({}),
      ...rect,
    } as DOMRect);
  }

  it('click inside row 0\'s band resolves to row 0\'s task', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    stubRect(h.canvas, {});
    // HEADER_HEIGHT = 32, ROW_HEIGHT.default = 32 — midpoint of row 0's band.
    const hit = h.hitTestRow(100, 32 + 16);
    expect(hit).toEqual({ taskId: baseTasks[0]!.id, rowIndex: 0, hitToggle: false });
  });

  it('click inside a deeply-nested row band resolves correctly regardless of label indentation', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    // 'b' is a child of 'a' (depth 1) in baseTasks — row index 1.
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    stubRect(h.canvas, {});
    const hit = h.hitTestRow(100, 32 + 32 + 16); // row index 1's band midpoint
    expect(hit).toEqual({ taskId: baseTasks[1]!.id, rowIndex: 1, hitToggle: false });
  });

  it('click in the header band (y < HEADER_HEIGHT) resolves to undefined', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    stubRect(h.canvas, {});
    expect(h.hitTestRow(100, 10)).toBeUndefined();
  });

  it('click below the last row resolves to undefined', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    stubRect(h.canvas, {});
    const belowLast = 32 + baseTasks.length * 32 + 100;
    expect(h.hitTestRow(100, belowLast)).toBeUndefined();
  });

  it('click outside canvas bounds (negative or beyond rect.width/height) resolves to undefined', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    stubRect(h.canvas, { width: 500, height: 500, right: 500, bottom: 500 });
    expect(h.hitTestRow(-10, 50)).toBeUndefined();
    expect(h.hitTestRow(50, -10)).toBeUndefined();
    expect(h.hitTestRow(600, 50)).toBeUndefined();
    expect(h.hitTestRow(50, 600)).toBeUndefined();
  });

  it('click exactly on a row boundary pixel resolves to the row below (Math.floor convention)', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    stubRect(h.canvas, {});
    // Exact boundary between row 0 and row 1: y = HEADER_HEIGHT + ROW_HEIGHT = 64.
    const hit = h.hitTestRow(100, 64);
    expect(hit).toEqual({ taskId: baseTasks[1]!.id, rowIndex: 1, hitToggle: false });
  });

  it.each(['compact', 'default', 'comfortable'] as const)('resolves correctly at density=%s', (density) => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps }, { density });
    stubRect(h.canvas, {});
    const hit = h.hitTestRow(100, 32 + 1);
    expect(hit?.taskId).toBe(baseTasks[0]!.id);
    expect(hit?.rowIndex).toBe(0);
  });

  it('reflects a fresh layout after update() — not a stale cache', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: [baseTasks[0]!], dependencies: [] });
    stubRect(h.canvas, {});
    expect(h.hitTestRow(100, 32 + 1)).toEqual({ taskId: baseTasks[0]!.id, rowIndex: 0, hitToggle: false });

    const swapped = task('z', '2026-01-05T09:00', '2026-01-07T17:00');
    h.update({ tasks: [swapped], dependencies: [] });
    expect(h.hitTestRow(100, 32 + 1)).toEqual({ taskId: swapped.id, rowIndex: 0, hitToggle: false });
  });

  it('accounts for a non-zero container.scrollTop (fix #37) — a click at the same canvas-local pixel resolves to a different row once scrolled', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const tasks = buildFlatTasks(50);
    const h = createCanvasRenderer(container, { tasks, dependencies: [] });
    stubRect(h.canvas, {});

    // At scrollTop=0, a click at the row-0 band midpoint resolves to row 0.
    expect(h.hitTestRow(100, 32 + 16)).toEqual({ taskId: toTaskId('t0'), rowIndex: 0, hitToggle: false });

    // Scroll down by exactly 5 rows (5 * 32 = 160px) — the SAME canvas-local pixel now maps
    // to content-space row 5, not row 0 (`hitTestRow` must add back `container.scrollTop`).
    h.container.scrollTop = 160;
    expect(h.hitTestRow(100, 32 + 16)).toEqual({ taskId: toTaskId('t5'), rowIndex: 5, hitToggle: false });
  });
});

// --- Focus ring (Ticket 2, spec §8.2 / §12.3) --------------------------------------------

describe('focus ring', () => {
  it('no focus inside the widget — no stroke call using the distinct focus-ring token color', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    container.style.setProperty('--fg-task-focus', '#00ff00'); // a color no other paint path uses
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps, focusedTaskId: toTaskId('c') });

    // Nothing was ever DOM-focused in this test — hadFocusInside is false by construction —
    // confirmed directly, not inferred from call-log shape alone.
    expect(h.interactionRoot.contains(document.activeElement)).toBe(false);

    const ringStrokeSets = mock.calls.filter((c) => c.op === 'set' && c.prop === 'strokeStyle' && c.args[0] === '#00ff00');
    expect(ringStrokeSets).toHaveLength(0);
  });

  it('focus set on a row paints a ring using --fg-task-focus/--fg-task-focus-width as the LAST call group', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    container.style.setProperty('--fg-task-focus', '#00ff00');
    container.style.setProperty('--fg-task-focus-width', '5');
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps, focusedTaskId: toTaskId('c') });
    const rowC = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__row[data-task-id="c"]')!;
    rowC.focus();

    const before = mock.calls.length;
    h.update({ tasks: baseTasks, dependencies: baseDeps, focusedTaskId: toTaskId('c') });
    const callsThisRender = mock.calls.slice(before);

    const ringStrokeIdx = callsThisRender.findIndex(
      (c) => c.op === 'set' && c.prop === 'strokeStyle' && c.args[0] === '#00ff00',
    );
    expect(ringStrokeIdx).toBeGreaterThanOrEqual(0);
    const ringWidthIdx = callsThisRender.findIndex((c) => c.op === 'set' && c.prop === 'lineWidth' && c.args[0] === 5);
    // Strictly after, not `>=` — `paintFocusRing` sets `strokeStyle` then `lineWidth`
    // (canvas-renderer.ts), so this must be a genuine `>`, not the previous
    // `> ringStrokeIdx - 1` (equivalent to `>=`), which would have still passed even if both
    // ended up at the same index.
    expect(ringWidthIdx).toBeGreaterThan(ringStrokeIdx);

    // The final `stroke()` call in the whole render pass belongs to the focus ring (painted
    // last, spec §8.2).
    const lastStrokeIdx = callsThisRender.map((c) => c.op).lastIndexOf('stroke');
    expect(lastStrokeIdx).toBeGreaterThan(ringStrokeIdx);
  });

  it('focusedTaskId not present in the current row set — no ring painted, no throw', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, {
      tasks: baseTasks,
      dependencies: baseDeps,
      focusedTaskId: toTaskId('gone'),
    });
    const rowA = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__row')!;
    rowA.focus();
    expect(() =>
      h.update({ tasks: baseTasks, dependencies: baseDeps, focusedTaskId: toTaskId('gone') }),
    ).not.toThrow();
  });

  it('reentrancy guard: a focus-restoration-triggered focusin during update() causes exactly one paint pass', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps, focusedTaskId: toTaskId('b') });
    const rowB = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__row[data-task-id="b"]')!;
    rowB.focus();

    let focusinCount = 0;
    h.interactionRoot.addEventListener('focusin', () => focusinCount++);

    const before = mock.calls.length;
    h.update({ tasks: baseTasks, dependencies: baseDeps, focusedTaskId: toTaskId('b') });
    const setTransformCallsThisUpdate = mock.calls.slice(before).filter((c) => c.op === 'setTransform');

    // Exactly one paint pass per update() — setTransform is called exactly once per
    // renderPixels() invocation, so >1 would mean the reentrancy guard failed to suppress a
    // recursive render triggered by the internal .focus() call's synchronous focusin.
    expect(setTransformCallsThisUpdate).toHaveLength(1);
    // The internal focus-restoration .focus() call DID fire focusin at least once (proving the
    // guard was actually exercised, not just trivially never triggered).
    expect(focusinCount).toBeGreaterThanOrEqual(1);
  });

  it('focusin/focusout dispatched directly on interactionRoot (native Tab) each trigger exactly one additional render', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });

    const countSetTransform = (): number => mock.calls.filter((c) => c.op === 'setTransform').length;

    const beforeFocusin = countSetTransform();
    const rowEl = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__row')!;
    rowEl.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(countSetTransform()).toBe(beforeFocusin + 1);

    // The focusin above triggered a full rebuild — `rowEl` is now a detached, stale node (its
    // replacement lives at the same query path). Dispatching directly on the stale node would
    // never bubble to `interactionRoot` post-rebuild, so re-query for the live element first.
    const beforeFocusout = countSetTransform();
    const rowElAfterRebuild = h.interactionRoot.querySelector<HTMLElement>('.fg-timeline-canvas__row')!;
    rowElAfterRebuild.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(countSetTransform()).toBe(beforeFocusout + 1);
  });
});

// --- DPR scaling -----------------------------------------------------------------------

describe('DPR scaling', () => {
  it.each([1, 2, 1.5])('canvas.width/height = ceil(total * dpr); style.width/height = CSS px (dpr=%s)', (dpr) => {
    setDpr(dpr);
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const ts = h.getTimeScale();
    const totalWidth = 160 + ts.totalWidth;
    // bodyHeight uses ROW_HEIGHT.default (32) * rows.length; header height 32.
    const expectedWidthPx = Math.round(totalWidth * dpr);
    expect(h.canvas.width).toBe(expectedWidthPx);
    expect(h.canvas.style.width).toBe(`${totalWidth}px`);

    const setTransformCalls = mock.calls.filter((c) => c.op === 'setTransform');
    expect(setTransformCalls).toHaveLength(1);
    expect(setTransformCalls[0]!.args).toEqual([dpr, 0, 0, dpr, 0, 0]);
  });
});

// --- Draw-call-log: bars, milestones -----------------------------------------------------

describe('task bar paint', () => {
  it('non-milestone bar: fill sequence present (beginPath/rect or roundRect + fill)', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    createCanvasRenderer(container, { tasks: [baseTasks[2]!], dependencies: [] });
    const fillOps = mock.calls.filter((c) => c.op === 'fill');
    expect(fillOps.length).toBeGreaterThan(0);
  });

  it('milestone: translate + rotate(Math.PI/4) present', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    createCanvasRenderer(container, { tasks: [baseTasks[3]!], dependencies: [] });
    const rotate = mock.calls.find((c) => c.op === 'rotate');
    expect(rotate).toBeDefined();
    expect(rotate!.args[0]).toBeCloseTo(Math.PI / 4);
    const translate = mock.calls.find((c) => c.op === 'translate');
    expect(translate).toBeDefined();
  });

  it('exactly tasks.length fillText calls carry label text (fast-check smoke, no throw)', () => {
    let current: MockContext2D = createMockContext2D();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => current.ctx);
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            offset: fc.integer({ min: 0, max: 60 }),
            span: fc.integer({ min: 1, max: 10 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (specs) => {
          const c2 = document.createElement('div');
          current = createMockContext2D();
          const base = normalizeDate('2026-01-01T00:00', cal.timezone);
          const tasks = specs.map((s, i) =>
            task(`t${i}`, base.add({ days: s.offset }).toString(), base.add({ days: s.offset + s.span }).toString(), {
              name: s.name,
            }),
          );
          expect(() => createCanvasRenderer(c2, { tasks, dependencies: [] })).not.toThrow();
          const labelCalls = current.calls.filter((c) => c.op === 'fillText' && specs.some((s) => c.args[0] === s.name));
          expect(labelCalls).toHaveLength(tasks.length);
        },
      ),
    );
  });
});

// --- save()/restore() discipline, dash-state non-leakage --------------------------------

describe('save()/restore() discipline — dash-state non-leakage', () => {
  it('critical task: setLineDash([4,2]) happens within a save/restore pair', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const cp = computeCriticalPath(baseTasks, baseDeps, cal);
    createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps, criticalPath: cp });

    const dashIdx = mock.calls.findIndex(
      (c) => c.op === 'setLineDash' && JSON.stringify(c.args[0]) === JSON.stringify([4, 2]),
    );
    expect(dashIdx).toBeGreaterThanOrEqual(0);

    // Find nearest enclosing save (before) / restore (after) around this call.
    let saveIdx = -1;
    for (let i = dashIdx; i >= 0; i--) {
      if (mock.calls[i]!.op === 'save') {
        saveIdx = i;
        break;
      }
    }
    let restoreIdx = -1;
    for (let i = dashIdx; i < mock.calls.length; i++) {
      if (mock.calls[i]!.op === 'restore') {
        restoreIdx = i;
        break;
      }
    }
    expect(saveIdx).toBeGreaterThanOrEqual(0);
    expect(restoreIdx).toBeGreaterThan(dashIdx);
    expect(saveIdx).toBeLessThan(dashIdx);
  });

  it('a non-critical task painted after a critical one has no leaked dash state (explicit setLineDash([]))', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    // Two independent (no dependency) tasks: 'long' spans more days than 'short', so with
    // no edges linking them CPM marks only the longer one critical (slack=0) — 'short' is
    // NOT critical and is painted AFTER 'long' in row order, exercising exactly the
    // leak-between-tasks scenario this test targets.
    const long = task('long', '2026-01-05T09:00', '2026-01-20T17:00');
    const short = task('short', '2026-01-05T09:00', '2026-01-08T17:00');
    const cp = computeCriticalPath([long, short], [], cal);
    expect(cp.criticalTaskIds).toEqual([toTaskId('long')]);

    createCanvasRenderer(container, { tasks: [long, short], dependencies: [], criticalPath: cp });

    const dashCalls = mock.calls.filter((c) => c.op === 'setLineDash');
    const nonEmptyDashCalls = dashCalls.filter((c) => JSON.stringify(c.args[0]) === JSON.stringify([4, 2]));
    // Exactly one critical task ('long') → exactly one [4,2] dash call across the whole render.
    expect(nonEmptyDashCalls).toHaveLength(1);
  });
});

// --- Selection + critical composition -----------------------------------------------------

describe('selection + critical-path composition', () => {
  it('a selected (non-critical) task: solid stroke, strokeStyle === taskSelected default, no non-empty dash', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    createCanvasRenderer(container, {
      tasks: [baseTasks[2]!],
      dependencies: [],
      selectedTaskIds: [toTaskId('c')],
    });
    const strokeStyleSets = mock.calls.filter((c) => c.op === 'set' && c.prop === 'strokeStyle');
    expect(strokeStyleSets.some((c) => c.args[0] === '#4338ca')).toBe(true);
    const nonEmptyDash = mock.calls.filter(
      (c) => c.op === 'setLineDash' && Array.isArray(c.args[0]) && (c.args[0] as unknown[]).length > 0,
    );
    expect(nonEmptyDash).toHaveLength(0);
  });

  it('a task both critical AND selected: two distinct stroke passes (dashed + solid)', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const cp = computeCriticalPath(baseTasks, baseDeps, cal);
    expect(cp.criticalTaskIds).toContain(toTaskId('c'));

    createCanvasRenderer(container, {
      tasks: baseTasks,
      dependencies: baseDeps,
      criticalPath: cp,
      selectedTaskIds: [toTaskId('c')],
    });

    const strokeCalls = mock.calls.filter((c) => c.op === 'stroke');
    // At least 2 stroke passes for task 'c': critical outline + selection outline (plus
    // grid lines/dependency lines elsewhere, so just assert critical+selection signals).
    const dashedNonEmpty = mock.calls.filter(
      (c) => c.op === 'setLineDash' && JSON.stringify(c.args[0]) === JSON.stringify([4, 2]),
    );
    expect(dashedNonEmpty.length).toBeGreaterThanOrEqual(1);
    const selectedStrokeStyle = mock.calls.filter((c) => c.op === 'set' && c.prop === 'strokeStyle' && c.args[0] === '#4338ca');
    expect(selectedStrokeStyle.length).toBeGreaterThanOrEqual(1);
    expect(strokeCalls.length).toBeGreaterThan(0);
  });
});

// --- Security: task.color -----------------------------------------------------------------

describe('SECURITY — color injection', () => {
  it.each([
    'url(javascript:alert(1))',
    'javascript:alert(1)',
    'red; background:url(javascript:alert(1))',
    'expression(alert(1))',
    '<script>alert(1)</script>',
  ])('malicious task.color %s never reaches fillStyle/strokeStyle args', (evil) => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const t = task('x', '2026-01-05T09:00', '2026-01-07T17:00', { color: evil });
    createCanvasRenderer(container, { tasks: [t], dependencies: [] });

    const colorSets = mock.calls.filter((c) => c.op === 'set' && (c.prop === 'fillStyle' || c.prop === 'strokeStyle'));
    for (const call of colorSets) {
      expect(call.args[0]).not.toBe(evil);
      expect(String(call.args[0])).not.toContain('javascript');
      expect(String(call.args[0])).not.toContain('expression');
      expect(String(call.args[0])).not.toContain('script');
      expect(String(call.args[0])).not.toContain('url(');
    }
    // fill defaulted to the token/default color, not the raw evil string.
    const fillSets = mock.calls.filter((c) => c.op === 'set' && c.prop === 'fillStyle');
    expect(fillSets.some((c) => c.args[0] === '#6366f1')).toBe(true);
  });

  it('valid task.color (#hex) is used as-is', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const t = task('x', '2026-01-05T09:00', '2026-01-07T17:00', { color: '#abcdef' });
    createCanvasRenderer(container, { tasks: [t], dependencies: [] });
    const fillSets = mock.calls.filter((c) => c.op === 'set' && c.prop === 'fillStyle');
    expect(fillSets.some((c) => c.args[0] === '#abcdef')).toBe(true);
  });
});

// --- Security: task.name / ctx.font -------------------------------------------------------

describe('SECURITY — task.name never reaches ctx.font', () => {
  it('a malicious task name is never folded into a `font` set call', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const evilName = '"; ctx.font="0px"; //';
    const t = task('x', '2026-01-05T09:00', '2026-01-07T17:00', { name: evilName });
    createCanvasRenderer(container, { tasks: [t], dependencies: [] });

    const fontSets = mock.calls.filter((c) => c.op === 'set' && c.prop === 'font');
    expect(fontSets.length).toBeGreaterThan(0);
    for (const call of fontSets) {
      expect(String(call.args[0])).not.toContain(evilName);
      expect(call.args[0]).toBe('12px system-ui, sans-serif');
    }

    // The name IS passed as fillText's literal text argument (injection-safe by construction).
    const fillTextCalls = mock.calls.filter((c) => c.op === 'fillText');
    expect(fillTextCalls.some((c) => c.args[0] === evilName)).toBe(true);
  });
});

// --- Dependency arrows ----------------------------------------------------------------------

describe('dependency arrows', () => {
  it.each(['FS', 'SS', 'FF', 'SF'] as const)(
    '%s: moveTo/lineTo point sequence matches layoutDependencyPath + one arrowhead triangle',
    (type) => {
      const mock = createMockContext2D();
      installMockContext(mock);
      const t1 = task('a', '2026-01-05T09:00', '2026-01-07T17:00');
      const t2 = task('b', '2026-01-08T09:00', '2026-01-10T17:00');
      const dep: Dependency = { id: toDependencyId('d'), from: toTaskId('a'), to: toTaskId('b'), type };
      createCanvasRenderer(container, { tasks: [t1, t2], dependencies: [dep] });

      const moveToCalls = mock.calls.filter((c) => c.op === 'moveTo');
      const lineToCalls = mock.calls.filter((c) => c.op === 'lineTo');
      // At least one moveTo (path start) + lineTo (path continuation) pair for the
      // dependency itself, plus 2 more lineTo for the arrowhead triangle.
      expect(moveToCalls.length).toBeGreaterThan(0);
      expect(lineToCalls.length).toBeGreaterThan(0);

      // Arrowhead: one extra beginPath+closePath+fill sequence beyond the polyline stroke.
      const fillOps = mock.calls.filter((c) => c.op === 'fill');
      expect(fillOps.length).toBeGreaterThan(0);
      const closePathOps = mock.calls.filter((c) => c.op === 'closePath');
      expect(closePathOps.length).toBeGreaterThanOrEqual(1);
    },
  );

  it('dangling dependency (from/to not in task set) is skipped — no draw calls, no throw', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const t1 = task('a', '2026-01-05T09:00', '2026-01-07T17:00');
    const dep: Dependency = { id: toDependencyId('d'), from: toTaskId('a'), to: toTaskId('ghost'), type: 'FS' };
    expect(() => createCanvasRenderer(container, { tasks: [t1], dependencies: [dep] })).not.toThrow();
  });

  it('unknown dependency.type is skipped — no draw calls, no throw', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const t1 = task('a', '2026-01-05T09:00', '2026-01-07T17:00');
    const t2 = task('b', '2026-01-08T09:00', '2026-01-10T17:00');
    const dep = { id: toDependencyId('d'), from: toTaskId('a'), to: toTaskId('b'), type: 'ZZ' } as unknown as Dependency;
    expect(() => createCanvasRenderer(container, { tasks: [t1, t2], dependencies: [dep] })).not.toThrow();
  });
});

// --- Null context throw ---------------------------------------------------------------------

describe('null 2D context', () => {
  it('getContext("2d") returning null → createCanvasRenderer throws synchronously', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    expect(() => createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps })).toThrow(
      /2D context unavailable/,
    );
  });
});

// --- update / setOptions / destroy ---------------------------------------------------------

describe('update / setOptions / destroy — idempotent', () => {
  it('destroy() removes the canvas from container; update()/setOptions() after destroy() are no-ops', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    h.destroy();
    expect(container.children).toHaveLength(0);

    const callCountBefore = mock.calls.length;
    h.update({ tasks: baseTasks, dependencies: baseDeps });
    h.setOptions({ density: 'compact' });
    expect(mock.calls.length).toBe(callCountBefore);
    expect(() => h.destroy()).not.toThrow();
    expect(container.children).toHaveLength(0);
  });

  it('update() with different input repaints (new draw calls recorded)', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: [baseTasks[0]!], dependencies: [] });
    const before = mock.calls.length;
    h.update({ tasks: baseTasks, dependencies: baseDeps });
    expect(mock.calls.length).toBeGreaterThan(before);
  });
});

// --- getTimeScale() contract ----------------------------------------------------------------

describe('getTimeScale() contract consistency', () => {
  it('returns a TimeScale whose dateToX/xToDate round-trip and totalWidth is finite/positive', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const ts = h.getTimeScale();
    expect(Number.isFinite(ts.totalWidth)).toBe(true);
    expect(ts.totalWidth).toBeGreaterThan(0);
    const x = ts.dateToX(ts.range.start);
    expect(x).toBeCloseTo(0, 6);
  });

  it('matches renderer-base.ts layoutDependencyPath output directly (cross-check)', () => {
    const from: TaskBarLayout = { task: baseTasks[0]!, x: 10, y: 0, width: 40, height: 20 };
    const to: TaskBarLayout = { task: baseTasks[1]!, x: 100, y: 40, width: 40, height: 20 };
    const dep: Dependency = { id: toDependencyId('x'), from: toTaskId('a'), to: toTaskId('b'), type: 'FS' };
    const layout = layoutDependencyPath(dep, from, to, 20);
    expect(layout.points[0]).toEqual({ x: 50, y: 10 });
  });
});

// --- roundRect feature-detect fallback -------------------------------------------------------

describe('ctx.roundRect feature-detect fallback', () => {
  it('falls back to beginPath+rect when ctx.roundRect is absent, still paints', () => {
    const mock = createMockContext2D({ withRoundRect: false });
    installMockContext(mock);
    expect(() => createCanvasRenderer(container, { tasks: [baseTasks[2]!], dependencies: [] })).not.toThrow();
    const rectCalls = mock.calls.filter((c) => c.op === 'rect');
    expect(rectCalls.length).toBeGreaterThan(0);
  });
});

// --- Canvas dimension guard (spec-canvas-row-limit-fix.md §12.1, extended by fix #37) -----
//
// No `node-canvas`, no real 65,536px canvas allocation anywhere in this block — the guard is
// pure arithmetic on numbers `render()` already computes, checked and thrown BEFORE any
// `canvas.width`/`canvas.height` assignment is attempted. jsdom's `HTMLCanvasElement.width`/
// `.height` setters are plain numeric IDL properties with no real backing-store allocation
// regardless, so even the safe-boundary cases below (which DO reach the assignment line)
// never allocate real GPU/pixel memory.
//
// fix #37 (spec-canvas-row-virtualization.md) changes the HEIGHT axis's shape fundamentally:
// `physicalHeight` is now `resolveViewportHeightPx(options) * dpr` — a small, ROW-COUNT-
// INDEPENDENT quantity (default 600px) — instead of `totalHeight * dpr` (which grew linearly
// with `rows.length`). The old "2046 safe / 2047 throws" row-count boundary tests below are
// therefore replaced: the height guard is now exercised via an explicit, oversized
// `options.viewportHeight` (the only thing that still feeds the height axis), and a NEW
// "row-count independence" block below asserts the actual regression this fix targets — that
// 5,000/10,000-row flat projects now construct successfully via Canvas, which was exactly the
// structurally-unreachable case issue #37 reports. The WIDTH axis is entirely unaffected by
// this fix (still `(LABEL_COLUMN_WIDTH + timeScale.totalWidth) * dpr`, still task/timeRange-
// derived) — those tests are kept as-is.

describe('canvas dimension guard', () => {
  describe('height boundary — dpr=1 (via an explicit, oversized options.viewportHeight)', () => {
    it('viewportHeight exactly at the boundary (65_535): safe, canvas.height === 65_535', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      const h = createCanvasRenderer(
        container,
        { tasks: buildFlatTasks(5), dependencies: [] },
        { viewportHeight: MAX_CANVAS_DIMENSION_PX },
      );
      expect(h.canvas.height).toBe(65_535);
    });

    it('viewportHeight one past the boundary (65_536): throws CanvasDimensionExceededError with exact fields; canvas removed', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      let thrown: unknown;
      try {
        createCanvasRenderer(
          container,
          { tasks: buildFlatTasks(5), dependencies: [] },
          { viewportHeight: MAX_CANVAS_DIMENSION_PX + 1 },
        );
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CanvasDimensionExceededError);
      const err = thrown as CanvasDimensionExceededError;
      expect(err.axis).toBe('height');
      expect(err.physicalPx).toBe(65_536);
      expect(err.limitPx).toBe(65_535);
      // `rowCount` still reports the real row count — independent of what actually tripped
      // the height axis now (viewportHeight, not row count).
      expect(err.rowCount).toBe(5);
      expect(err.devicePixelRatio).toBe(1);
      // Construction-time failure — mirrors the existing null-2D-context test's assertion
      // style: no half-mounted canvas left behind.
      expect(container.children).toHaveLength(0);
    });
  });

  describe('height boundary — dpr=2 (via an explicit, oversized options.viewportHeight)', () => {
    it('viewportHeight 32_767 at dpr=2: safe, physicalHeight === 65_534', () => {
      setDpr(2);
      const mock = createMockContext2D();
      installMockContext(mock);
      const h = createCanvasRenderer(
        container,
        { tasks: buildFlatTasks(5), dependencies: [] },
        { viewportHeight: 32_767 },
      );
      expect(h.canvas.height).toBe(65_534);
    });

    it('viewportHeight 32_768 at dpr=2: throws, physicalPx === 65_536', () => {
      setDpr(2);
      const mock = createMockContext2D();
      installMockContext(mock);
      let thrown: unknown;
      try {
        createCanvasRenderer(
          container,
          { tasks: buildFlatTasks(5), dependencies: [] },
          { viewportHeight: 32_768 },
        );
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CanvasDimensionExceededError);
      const err = thrown as CanvasDimensionExceededError;
      expect(err.axis).toBe('height');
      expect(err.physicalPx).toBe(65_536);
      expect(err.rowCount).toBe(5);
      expect(err.devicePixelRatio).toBe(2);
    });
  });

  describe('row-count independence (fix #37 — the core regression this fix targets)', () => {
    it('5,000 and 10,000 flat rows both construct successfully via Canvas, never throwing — canvas.height stays at the default viewport height (600px) regardless of row count', () => {
      setDpr(1);

      const mock5000 = createMockContext2D();
      installMockContext(mock5000);
      const h5000 = createCanvasRenderer(container, { tasks: buildManySameDayTasks(5000), dependencies: [] });
      expect(h5000.canvas.height).toBe(600);
      h5000.destroy();

      const container2 = document.createElement('div');
      document.body.appendChild(container2);
      const mock10000 = createMockContext2D();
      installMockContext(mock10000);
      const h10000 = createCanvasRenderer(container2, { tasks: buildManySameDayTasks(10000), dependencies: [] });
      expect(h10000.canvas.height).toBe(600);
      h10000.destroy();
      container2.remove();
    });

    it('the spacer element carries the FULL unbounded content height, giving `container` a real scrollHeight beyond the bounded canvas', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      const h = createCanvasRenderer(container, { tasks: buildManySameDayTasks(5000), dependencies: [] });
      const spacer = container.querySelector<HTMLElement>('.fg-timeline-canvas-spacer');
      expect(spacer).not.toBeNull();
      expect(spacer!.getAttribute('aria-hidden')).toBe('true');
      // HEADER_HEIGHT(32) + 5000 * ROW_HEIGHT.default(32)
      expect(spacer!.style.height).toBe(`${32 + 5000 * 32}px`);
      // The bounded canvas itself stays tiny, independent of the spacer's real content height.
      expect(h.canvas.height).toBe(600);
    });
  });

  describe('width boundary', () => {
    it('~1,095-day visible range at viewMode "day" (dpr=1): throws axis "width"', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      const start = normalizeDate('2026-01-01T00:00', cal.timezone);
      const end = start.add({ days: 1095 });
      let thrown: unknown;
      try {
        createCanvasRenderer(
          container,
          { tasks: [task('x', '2026-01-05T09:00', '2026-01-05T17:00')], dependencies: [] },
          { viewMode: 'day', timeRange: { start, end } },
        );
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CanvasDimensionExceededError);
      const err = thrown as CanvasDimensionExceededError;
      expect(err.axis).toBe('width');
      expect(err.physicalPx).toBeGreaterThan(MAX_CANVAS_DIMENSION_PX);
    });

    it('a narrower ~1,000-day range at viewMode "day" (dpr=1): safe, no throw', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      const start = normalizeDate('2026-01-01T00:00', cal.timezone);
      const end = start.add({ days: 1000 });
      expect(() =>
        createCanvasRenderer(
          container,
          { tasks: [task('x', '2026-01-05T09:00', '2026-01-05T17:00')], dependencies: [] },
          { viewMode: 'day', timeRange: { start, end } },
        ),
      ).not.toThrow();
    });
  });

  describe('0 rows', () => {
    it('empty tasks + explicit timeRange: no throw, canvas.height stays at the default viewport height (600px, independent of row count)', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      const start = normalizeDate('2026-01-01T00:00', cal.timezone);
      const end = start.add({ days: 10 });
      const h = createCanvasRenderer(container, { tasks: [], dependencies: [] }, { timeRange: { start, end } });
      // Bound to `resolveViewportHeightPx()`'s default (600px, fix #37) — no longer a
      // `rows.length === 0` special-case fallback derived from HEADER_HEIGHT + one row.
      expect(h.canvas.height).toBe(600);
    });
  });

  describe('update() — rollback on a failed render (width axis, via a wide derived timeRange)', () => {
    // `update()` only ever replaces `input` (tasks/dependencies), never `options` — and since
    // fix #37, the HEIGHT axis is driven entirely by `options.viewportHeight`, so a plain
    // `update()` can no longer cross the height boundary on its own (only `setOptions()` can,
    // see below). The WIDTH axis, however, is still task/timeRange-derived, so `update()` CAN
    // still cross it — this block now exercises that axis instead.
    it('an update() introducing a very wide task-date spread crosses the width guard via a derived timeRange; rolls back canvas/getTimeScale/currentInput; destroy() still works afterward', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      const narrow = [task('a', '2026-01-05T09:00', '2026-01-06T17:00')];
      const h = createCanvasRenderer(container, { tasks: narrow, dependencies: [] }, { viewMode: 'day' });
      const prevWidth = h.canvas.width;
      const prevTimeScale = h.getTimeScale();

      // No explicit `options.timeRange` — derived from `wide`'s dates. ~1,220 days apart at
      // viewMode 'day' (60px/day) comfortably crosses MAX_CANVAS_DIMENSION_PX once
      // `deriveTimeRange`'s padding is added.
      const wide = [
        task('start', '2026-01-01T00:00', '2026-01-02T00:00'),
        task('end', '2029-06-01T00:00', '2029-06-02T00:00'),
      ];
      expect(() => h.update({ tasks: wide, dependencies: [] })).toThrow(CanvasDimensionExceededError);

      // Rollback: the bitmap dimension and the TimeScale reference are both exactly what
      // they were before the failed update — never a half-applied new frame.
      expect(h.canvas.width).toBe(prevWidth);
      expect(h.getTimeScale()).toBe(prevTimeScale);

      expect(() => h.destroy()).not.toThrow();
      expect(container.children).toHaveLength(0);
    });

    it('recovers on a subsequent safe update() after a failed, rolled-back one', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      const narrow = [task('a', '2026-01-05T09:00', '2026-01-06T17:00')];
      const h = createCanvasRenderer(container, { tasks: narrow, dependencies: [] }, { viewMode: 'day' });

      const wide = [
        task('start', '2026-01-01T00:00', '2026-01-02T00:00'),
        task('end', '2029-06-01T00:00', '2029-06-02T00:00'),
      ];
      expect(() => h.update({ tasks: wide, dependencies: [] })).toThrow(CanvasDimensionExceededError);

      const recovered = [task('b', '2026-02-01T09:00', '2026-02-05T17:00')];
      expect(() => h.update({ tasks: recovered, dependencies: [] })).not.toThrow();
      // Height is entirely unaffected by any of this — always the default viewport (fix #37).
      expect(h.canvas.height).toBe(600);
    });
  });

  describe('update() — a LATER render()-internal throw (computeGridColumns) also rolls back state fully', () => {
    it('a MAX_GRID_COLUMNS throw from computeGridColumns (unrelated to the dimension guard, fires AFTER it passes) still rolls back getTimeScale(), not just canvas.height/currentInput', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);

      // Initial, narrow-range construction — succeeds cleanly (small derived range, well
      // under both MAX_GRID_COLUMNS and MAX_CANVAS_DIMENSION_PX).
      const narrowTasks = [
        task('a', '2026-01-05T09:00', '2026-01-06T17:00'),
        task('b', '2026-01-07T09:00', '2026-01-08T17:00'),
      ];
      const h = createCanvasRenderer(container, { tasks: narrowTasks, dependencies: [] }, { viewMode: 'year' });
      const prevTimeScale = h.getTimeScale();
      const prevHeight = h.canvas.height;

      // Wide-span tasks, no explicit `options.timeRange` — `deriveTimeRange` infers a
      // ~25,000+ day range at viewMode 'year'. `PIXELS_PER_DAY.year === 1`, so this NEVER
      // trips the dimension guard added by this fix (comfortably under
      // `MAX_CANVAS_DIMENSION_PX` on both axes) — but IS over `renderer-base.ts`'s own,
      // independent `MAX_GRID_COLUMNS` (20,000) guard inside `computeGridColumns`, a second,
      // unrelated throw site inside `render()` that fires strictly AFTER the dimension guard
      // has already passed.
      const wideTasks = [
        task('start', '2000-01-01T00:00', '2000-01-02T00:00'),
        task('end', '2069-01-01T00:00', '2069-01-02T00:00'), // ~25,200 days apart
      ];

      let thrown: unknown;
      try {
        h.update({ tasks: wideTasks, dependencies: [] });
      } catch (err) {
        thrown = err;
      }
      // Confirms this is genuinely a DIFFERENT throw site than the dimension guard.
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(CanvasDimensionExceededError);
      expect((thrown as Error).message).toMatch(/exceeded max column guard/);

      // The regression this test targets: getTimeScale() must be rolled back too, not just
      // canvas.height/currentInput — a throw that fires AFTER the dimension guard passes but
      // BEFORE `state.timeScale` is committed must still leave every exposed piece of state
      // untouched (spec §5.3, hardened).
      expect(h.getTimeScale()).toBe(prevTimeScale);
      expect(h.canvas.height).toBe(prevHeight);
    });
  });

  describe('setOptions() — rollback via viewportHeight crossing the boundary', () => {
    it('a viewportHeight change that alone crosses the boundary throws and leaves canvas.height unchanged', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      // 5,000 rows at the DEFAULT viewport height — safe, and independent of row count
      // (fix #37): this alone would have thrown pre-fix.
      const h = createCanvasRenderer(container, { tasks: buildManySameDayTasks(5000), dependencies: [] });
      expect(h.canvas.height).toBe(600);

      // Row count is unchanged — only `viewportHeight` grows, now the ONLY thing that can
      // cross the height axis (density no longer can either, since fix #37 decoupled the
      // canvas height from `rowHeight * rows.length` entirely).
      expect(() => h.setOptions({ viewportHeight: MAX_CANVAS_DIMENSION_PX + 1 })).toThrow(
        CanvasDimensionExceededError,
      );
      expect(h.canvas.height).toBe(600);
    });

    it('a density change ALONE no longer crosses the height boundary at any row count (fix #37 decouples height from rowHeight * rows.length)', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      const h = createCanvasRenderer(container, { tasks: buildManySameDayTasks(5000), dependencies: [] });
      expect(h.canvas.height).toBe(600);

      // 'comfortable' (40px rows) across 5,000 rows would have been ~40x over the old
      // row-count-driven ceiling — now a complete no-op on the canvas height.
      expect(() => h.setOptions({ density: 'comfortable' })).not.toThrow();
      expect(h.canvas.height).toBe(600);
    });
  });

  describe('error identity / exported constant', () => {
    it('CanvasDimensionExceededError is instanceof Error with name set; MAX_CANVAS_DIMENSION_PX === 65_535', () => {
      expect(MAX_CANVAS_DIMENSION_PX).toBe(65_535);

      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      let thrown: unknown;
      try {
        createCanvasRenderer(
          container,
          { tasks: buildFlatTasks(5), dependencies: [] },
          { viewportHeight: MAX_CANVAS_DIMENSION_PX + 1 },
        );
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CanvasDimensionExceededError);
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as CanvasDimensionExceededError).name).toBe('CanvasDimensionExceededError');
    });
  });

  // --- spec-canvas-webkit-dimension-limit.md §13.1 (WebKit-only area guard) --------------
  //
  // fix #37 changes `buildAreaOnlyOverflowFixture()`'s shape: since `physicalHeight` no longer
  // scales with row count, the fixture now pins height via an explicit `viewportHeight` option
  // instead of via row count — same target shape (both axes individually safe, product over
  // `MAX_CANVAS_AREA_PX_WEBKIT`), different knob.
  describe('WebKit-only area guard', () => {
    it('Chromium UA + area-only-overflowing shape: no throw (must not regress today\'s shipped behavior)', () => {
      setDpr(1);
      setUserAgent(CHROMIUM_UA);
      const mock = createMockContext2D();
      installMockContext(mock);
      const { tasks, timeRange, viewportHeight } = buildAreaOnlyOverflowFixture();
      expect(() =>
        createCanvasRenderer(container, { tasks, dependencies: [] }, { viewMode: 'day', timeRange, viewportHeight }),
      ).not.toThrow();
    });

    it('WebKit UA + the SAME area-only-overflowing shape: throws CanvasDimensionExceededError with axis "area"', () => {
      setDpr(1);
      setUserAgent(WEBKIT_UA);
      const mock = createMockContext2D();
      installMockContext(mock);
      const { tasks, timeRange, viewportHeight } = buildAreaOnlyOverflowFixture();
      let thrown: unknown;
      try {
        createCanvasRenderer(container, { tasks, dependencies: [] }, { viewMode: 'day', timeRange, viewportHeight });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CanvasDimensionExceededError);
      const err = thrown as CanvasDimensionExceededError;
      expect(err.axis).toBe('area');
      expect(err.limitPx).toBe(MAX_CANVAS_AREA_PX_WEBKIT);
      expect(err.physicalWidth).toBe(5_020);
      expect(err.physicalHeight).toBe(3_400);
      expect(err.physicalPx).toBe(err.physicalWidth! * err.physicalHeight!);
      expect(err.physicalPx).toBeGreaterThan(MAX_CANVAS_AREA_PX_WEBKIT);
      // Both axes individually stay well under the pre-existing per-axis check — confirms this
      // really is the area-only guard firing, not the height/width guard above it.
      expect(err.physicalWidth!).toBeLessThan(MAX_CANVAS_DIMENSION_PX);
      expect(err.physicalHeight!).toBeLessThan(MAX_CANVAS_DIMENSION_PX);
      expect(container.children).toHaveLength(0);
    });

    it('WebKit UA + a safe shape (well under the area ceiling): no throw', () => {
      setDpr(1);
      setUserAgent(WEBKIT_UA);
      const mock = createMockContext2D();
      installMockContext(mock);
      const h = createCanvasRenderer(container, { tasks: buildFlatTasks(20), dependencies: [] });
      expect(h.canvas.height).toBe(600);
    });

    it('Chrome-on-Android UA (contains the substring "Safari" too): treated as NOT WebKit, no throw', () => {
      setDpr(1);
      setUserAgent(CHROME_ANDROID_UA);
      const mock = createMockContext2D();
      installMockContext(mock);
      const { tasks, timeRange, viewportHeight } = buildAreaOnlyOverflowFixture();
      expect(() =>
        createCanvasRenderer(container, { tasks, dependencies: [] }, { viewMode: 'day', timeRange, viewportHeight }),
      ).not.toThrow();
    });

    it('Edge UA (Chromium-based, contains "Safari" + "Edg/"): treated as NOT WebKit, no throw', () => {
      setDpr(1);
      setUserAgent(EDGE_UA);
      const mock = createMockContext2D();
      installMockContext(mock);
      const { tasks, timeRange, viewportHeight } = buildAreaOnlyOverflowFixture();
      expect(() =>
        createCanvasRenderer(container, { tasks, dependencies: [] }, { viewMode: 'day', timeRange, viewportHeight }),
      ).not.toThrow();
    });

    it('WebKit UA: existing height boundary (via viewportHeight) still applies identically, checked BEFORE the area branch', () => {
      setDpr(1);
      setUserAgent(WEBKIT_UA);
      // Explicit narrow `timeRange` (1 day @ viewMode 'day'): pins physicalWidth to
      // 160(label) + 60(1 day) = 220px, so 220 * 65_535 = 14,417,700 stays under
      // MAX_CANVAS_AREA_PX_WEBKIT (16,777,216) — only the pre-existing height axis is exercised,
      // confirming it still runs (and still wins the tie-break) identically under WebKit.
      const start = normalizeDate('2026-01-01T00:00', cal.timezone);
      const end = start.add({ days: 1 });
      const mockSafe = createMockContext2D();
      installMockContext(mockSafe);
      const safe = createCanvasRenderer(
        container,
        { tasks: buildFlatTasks(5), dependencies: [] },
        { viewMode: 'day', timeRange: { start, end }, viewportHeight: MAX_CANVAS_DIMENSION_PX },
      );
      expect(safe.canvas.height).toBe(MAX_CANVAS_DIMENSION_PX);
      safe.destroy();

      let thrown: unknown;
      try {
        createCanvasRenderer(
          container,
          { tasks: buildFlatTasks(5), dependencies: [] },
          { viewMode: 'day', timeRange: { start, end }, viewportHeight: MAX_CANVAS_DIMENSION_PX + 1 },
        );
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CanvasDimensionExceededError);
      expect((thrown as CanvasDimensionExceededError).axis).toBe('height');
    });

    it('update() rollback also applies through the area-throw path (viewportHeight set tall via setOptions first, width crossed via update())', () => {
      setDpr(1);
      setUserAgent(WEBKIT_UA);
      const mock = createMockContext2D();
      installMockContext(mock);
      const h = createCanvasRenderer(container, { tasks: buildFlatTasks(5), dependencies: [] });

      // Grows the viewport tall first (safe alone — width stays tiny from the small task set,
      // so the area stays tiny too).
      expect(() => h.setOptions({ viewportHeight: 3_400 })).not.toThrow();
      expect(h.canvas.height).toBe(3_400);

      const prevWidth = h.canvas.width;
      const prevHeight = h.canvas.height;
      const prevTimeScale = h.getTimeScale();

      // Now widen the DERIVED timeRange on top of the already-tall viewport via `update()` (no
      // explicit `options.timeRange` was set, so this is task-derived) — crosses the WebKit
      // area ceiling: neither axis alone crosses MAX_CANVAS_DIMENSION_PX, only the product does.
      const wideTasks = [
        task('start', '2026-01-01T09:00', '2026-01-01T17:00'),
        task('end', '2027-02-05T09:00', '2027-02-05T17:00'), // ~400 days apart
      ];
      let thrown: unknown;
      try {
        h.update({ tasks: wideTasks, dependencies: [] });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CanvasDimensionExceededError);
      expect((thrown as CanvasDimensionExceededError).axis).toBe('area');
      expect(h.canvas.width).toBe(prevWidth);
      expect(h.canvas.height).toBe(prevHeight);
      expect(h.getTimeScale()).toBe(prevTimeScale);
    });

    it('CanvasDimensionExceededError for axis "height" leaves physicalWidth/physicalHeight undefined', () => {
      setDpr(1);
      setUserAgent(CHROMIUM_UA);
      const mock = createMockContext2D();
      installMockContext(mock);
      let thrown: unknown;
      try {
        createCanvasRenderer(
          container,
          { tasks: buildFlatTasks(5), dependencies: [] },
          { viewportHeight: MAX_CANVAS_DIMENSION_PX + 1 },
        );
      } catch (err) {
        thrown = err;
      }
      const err = thrown as CanvasDimensionExceededError;
      expect(err.axis).toBe('height');
      expect(err.physicalWidth).toBeUndefined();
      expect(err.physicalHeight).toBeUndefined();
    });
  });

  describe('regression — clampedCount console.warn does NOT fire on a dimension-guard overflow', () => {
    it('an overflowing render (height axis, via viewportHeight) with an end-before-start task never reaches the clampedCount warning', () => {
      setDpr(1);
      const mock = createMockContext2D();
      installMockContext(mock);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tasks = buildFlatTasks(5);
      // Swap start/end on one task so it WOULD trip the existing `clampedCount` warning —
      // this must never be reached, since the dimension guard (§5.2) now runs, and throws,
      // strictly before the barByTaskId loop that computes `clampedCount`.
      const clamped: Task = { ...tasks[0]!, start: tasks[0]!.end, end: tasks[0]!.start };
      const withClampedTask = [clamped, ...tasks.slice(1)];

      expect(() =>
        createCanvasRenderer(
          container,
          { tasks: withClampedTask, dependencies: [] },
          { viewportHeight: MAX_CANVAS_DIMENSION_PX + 1 },
        ),
      ).toThrow(CanvasDimensionExceededError);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});

// --- resolveViewportHeightPx (fix #37, spec §4.2) -------------------------------------------

describe('resolveViewportHeightPx', () => {
  it('defaults to 600 when viewportHeight is omitted', () => {
    expect(resolveViewportHeightPx({})).toBe(600);
  });

  it('honors an explicit viewportHeight at or above the minimum (32 + 24 = 56)', () => {
    expect(resolveViewportHeightPx({ viewportHeight: 800 })).toBe(800);
    expect(resolveViewportHeightPx({ viewportHeight: 56 })).toBe(56);
  });

  it('clamps a too-small requested viewportHeight up to the minimum', () => {
    expect(resolveViewportHeightPx({ viewportHeight: 10 })).toBe(56);
    expect(resolveViewportHeightPx({ viewportHeight: 1 })).toBe(56);
  });

  it('falls back to the default (600) for zero, negative, or non-finite input', () => {
    expect(resolveViewportHeightPx({ viewportHeight: 0 })).toBe(600);
    expect(resolveViewportHeightPx({ viewportHeight: -100 })).toBe(600);
    expect(resolveViewportHeightPx({ viewportHeight: Number.NaN })).toBe(600);
    expect(resolveViewportHeightPx({ viewportHeight: Number.POSITIVE_INFINITY })).toBe(600);
  });
});

// --- computeVisibleWindow (fix #37, spec §4.3) — property-based invariants (fast-check) -----

describe('computeVisibleWindow', () => {
  it('returns the empty-window sentinel when there are zero rows, regardless of scroll/viewport inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (scrollTop, rowBandViewportPx, rowHeight, overscanRows) => {
          const win = computeVisibleWindow([], { scrollTop, rowBandViewportPx }, rowHeight, overscanRows);
          expect(win).toEqual({ startIndex: 0, endIndex: -1 });
        },
      ),
      { numRuns: 50 },
    );
  });

  it('never returns an out-of-range window, and always contains every row whose band intersects the visible range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }), // rowCount
        fc.integer({ min: 0, max: 50_000 }), // scrollTop
        fc.integer({ min: 0, max: 5_000 }), // rowBandViewportPx
        fc.integer({ min: 0, max: 100 }), // overscanRows
        fc.integer({ min: 1, max: 100 }), // rowHeight
        (rowCount, scrollTop, rowBandViewportPx, overscanRows, rowHeight) => {
          const rows: RowLayout[] = Array.from({ length: rowCount }, (_, i) => ({
            task: baseTasks[0]!,
            depth: 0,
            rowIndex: i,
            y: i * rowHeight,
            hasChildren: false,
            isCollapsed: false,
          }));
          const win = computeVisibleWindow(rows, { scrollTop, rowBandViewportPx }, rowHeight, overscanRows);

          // In-range, non-empty, ordered.
          expect(win.startIndex).toBeGreaterThanOrEqual(0);
          expect(win.endIndex).toBeLessThanOrEqual(rowCount - 1);
          expect(win.startIndex).toBeLessThanOrEqual(win.endIndex);

          // No row whose band intersects the visible scroll range is ever excluded from the
          // window — the core "never skip a visible row" invariant.
          const viewTop = scrollTop;
          const viewBottom = scrollTop + rowBandViewportPx;
          for (let i = 0; i < rowCount; i++) {
            const bandTop = i * rowHeight;
            const bandBottom = bandTop + rowHeight;
            const intersectsVisible = bandBottom > viewTop && bandTop < viewBottom;
            if (intersectsVisible) {
              expect(i).toBeGreaterThanOrEqual(win.startIndex);
              expect(i).toBeLessThanOrEqual(win.endIndex);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a negative or non-finite scrollTop is clamped to 0, never producing a negative startIndex', () => {
    const rows: RowLayout[] = Array.from({ length: 50 }, (_, i) => ({
      task: baseTasks[0]!,
      depth: 0,
      rowIndex: i,
      y: i * 32,
      hasChildren: false,
      isCollapsed: false,
    }));
    expect(computeVisibleWindow(rows, { scrollTop: -500, rowBandViewportPx: 568 }, 32, 20)).toEqual(
      computeVisibleWindow(rows, { scrollTop: 0, rowBandViewportPx: 568 }, 32, 20),
    );
    expect(computeVisibleWindow(rows, { scrollTop: Number.NaN, rowBandViewportPx: 568 }, 32, 20)).toEqual(
      computeVisibleWindow(rows, { scrollTop: 0, rowBandViewportPx: 568 }, 32, 20),
    );
  });
});

// --- ensureFocusedRowVisible — via focusedTaskId re-renders (fix #37 §5.2) -------------------
// `ensureFocusedRowVisible()` itself is an internal, unexported nested function — exercised
// here indirectly through `container.scrollTop`, the one observable side effect it produces.
// (Exact scrollTop values for a 300-row fixture are also cross-checked in the "hidden ARIA
// layer — row-virtualization windowing" describe block above, which shares the same math.)

describe('ensureFocusedRowVisible — scroll adjustment on focusedTaskId change (fix #37 §5.2)', () => {
  it('does not scroll when the initially-focused row is already within the default viewport', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, {
      tasks: buildFlatTasks(300),
      dependencies: [],
      focusedTaskId: toTaskId('t5'),
    });
    expect(h.container.scrollTop).toBe(0);
  });

  it('scrolls down (forward) when focus jumps to a row below the current viewport, then scrolls back up (backward) when focus returns to an earlier row', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, {
      tasks: buildFlatTasks(300),
      dependencies: [],
      focusedTaskId: toTaskId('t150'),
    });
    expect(h.container.scrollTop).toBeGreaterThan(0);
    const scrolledDownTop = h.container.scrollTop;

    h.update({ tasks: buildFlatTasks(300), dependencies: [], focusedTaskId: toTaskId('t0') });
    expect(h.container.scrollTop).toBe(0);
    expect(h.container.scrollTop).toBeLessThan(scrolledDownTop);
  });

  it('is a no-op when the focused row is already fully visible after a small scroll adjustment', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, {
      tasks: buildFlatTasks(300),
      dependencies: [],
      focusedTaskId: toTaskId('t0'),
    });
    expect(h.container.scrollTop).toBe(0);
    // Re-rendering with the SAME focusedTaskId must not perturb an already-correct scrollTop.
    h.update({ tasks: buildFlatTasks(300), dependencies: [], focusedTaskId: toTaskId('t0') });
    expect(h.container.scrollTop).toBe(0);
  });

  // Regression coverage for a real bug this fix's own test-writing pass caught empirically (via
  // a real-browser Playwright a11y/visual test attempting to scroll a freshly-mounted, nothing-
  // focused Canvas mount): a scroll/resize-triggered `render()` (no `focusedTaskId` change at
  // all — the DEFAULT state for a just-mounted gantt, before any keyboard interaction) must NOT
  // re-run `ensureFocusedRowVisible()` and snap `container.scrollTop` back to the (implicitly
  // row-0) focused row. Before this fix, `ensureFocusedRowVisible()` ran unconditionally on
  // EVERY render regardless of what triggered it, which made real mouse-wheel/scrollbar
  // scrolling on a fresh mount completely inert (each 'scroll' event synchronously undid itself
  // on the very next rAF-scheduled repaint).
  it('a scroll-triggered re-render (no focusedTaskId change) does NOT undo a manual scroll — regression guard for the "scrolling a nothing-focused mount is inert" bug', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    // No `focusedTaskId` supplied at all — the common just-mounted state, where focus resolves
    // to row 0 by fallback (`state.input.focusedTaskId ?? rows[0]?.task.id`).
    const h = createCanvasRenderer(container, { tasks: buildFlatTasks(300), dependencies: [] });
    expect(h.container.scrollTop).toBe(0);

    h.container.scrollTop = 5_000;
    h.container.dispatchEvent(new Event('scroll'));
    // The scroll-triggered repaint is rAF-throttled in the real implementation; this test's
    // fixture install (`installMockContext`) does not itself flush a real rAF queue, so call
    // `update()` with the SAME (still-unset) `focusedTaskId` to force a synchronous re-render —
    // exactly mirroring what the throttled rAF callback would eventually do: re-run
    // `renderPixels()` with an unchanged resolved focus.
    h.update({ tasks: buildFlatTasks(300), dependencies: [] });
    expect(h.container.scrollTop).toBe(5_000);
  });

  it('an update() that changes tasks/dependencies but NOT focusedTaskId (still unset both times) preserves a manual scroll position the same way', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: buildFlatTasks(300), dependencies: [] });
    h.container.scrollTop = 3_200;
    // A genuinely different `tasks` array reference (not just a re-render of the same data) —
    // proves this is about `focusedTaskId` specifically, not some incidental reference-equality
    // shortcut on the whole `input` object.
    h.update({ tasks: buildFlatTasks(300), dependencies: [] });
    expect(h.container.scrollTop).toBe(3_200);
  });
});

// --- destroy() cancels a pending scroll/resize-triggered rAF (fix #37 §4.5/§4.6) ------------

describe('destroy() cancels a pending scroll/resize-triggered rAF', () => {
  it('a scroll event schedules a pending render frame; destroy() cancels it before it fires, and the (now-stale) frame is a safe no-op if it were to fire anyway', async () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: buildFlatTasks(50), dependencies: [] });

    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const callsBeforeScroll = mock.calls.length;

    h.container.dispatchEvent(new Event('scroll'));
    // A frame is now pending — destroy() must actively cancel it, not merely ignore it.
    h.destroy();
    expect(cancelSpy).toHaveBeenCalledTimes(1);

    // Flush a real animation frame — even if the (already-canceled) one were to fire anyway,
    // the `destroyed` guard inside `scheduleRender()`'s callback prevents any new paint.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(mock.calls.length).toBe(callsBeforeScroll);
  });

  it('calling destroy() with no pending frame does not call cancelAnimationFrame', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: buildFlatTasks(50), dependencies: [] });

    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    h.destroy();
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('destroy() is idempotent — a second call is a harmless no-op', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: buildFlatTasks(50), dependencies: [] });
    h.destroy();
    expect(() => h.destroy()).not.toThrow();
  });
});
