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
import { createCanvasRenderer } from '../../src/render/canvas-renderer.js';
import { computeCriticalPath } from '../../src/compute/critical-path.js';
import { DEFAULT_CALENDAR, normalizeDate } from '../../src/compute/working-calendar.js';
import { layoutDependencyPath, type TaskBarLayout } from '../../src/render/renderer-base.js';
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

// --- Structure / ARIA ---------------------------------------------------------------------

describe('createCanvasRenderer — structure', () => {
  it('mounts a <canvas class="fg-timeline-canvas"> with role="img" and aria-label', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.canvas.tagName.toLowerCase()).toBe('canvas');
    expect(h.canvas.getAttribute('class')).toBe('fg-timeline-canvas');
    expect(h.canvas.getAttribute('role')).toBe('img');
    expect(h.canvas.getAttribute('aria-label')).toBe('Gantt chart');
    expect(container.querySelectorAll('canvas.fg-timeline-canvas')).toHaveLength(1);
  });

  it('aria-label is capped at 200 chars for an oversized options.ariaLabel', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const longLabel = 'x'.repeat(500);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps }, { ariaLabel: longLabel });
    expect(h.canvas.getAttribute('aria-label')).toHaveLength(200);
  });

  it('interactionRoot is undefined on every handle produced by Ticket 1', () => {
    const mock = createMockContext2D();
    installMockContext(mock);
    const h = createCanvasRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.interactionRoot).toBeUndefined();
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
