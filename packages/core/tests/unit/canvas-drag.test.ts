// @vitest-environment jsdom
//
// Canvas-mode drag (spec-canvas-drag.md §11): `hitTestBar` geometry, the layout memo, the three
// recognizers driven through the REAL pointer-drag coordinator, and the overlay-canvas preview.
// jsdom has no layout engine and no 2D context, so the main canvas's `getBoundingClientRect` and
// `container.scrollTop` are stubbed and the 2D context is a recording Proxy. The pointer events
// are real `PointerEvent`s dispatched at the same targets a browser uses (canvas for
// `pointerdown`, `window` for the rest).
import type * as RendererBase from '../../src/render/renderer-base.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import type { Temporal } from '@js-temporal/polyfill';
import { createCanvasRenderer, type CanvasRendererHandle, type CanvasRendererInput } from '../../src/render/canvas-renderer.js';
import { getPointerDragController } from '../../src/interaction/pointer-drag.js';
import { layoutRows, layoutTaskBar } from '../../src/render/renderer-base.js';
import { computeRollup } from '../../src/compute/rollup.js';
import { toTaskId, type Task, type TaskId } from '../../src/types.js';

vi.mock('../../src/render/renderer-base.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RendererBase>();
  return { ...actual, layoutRows: vi.fn(actual.layoutRows) };
});

const CANVAS_W = 4000;
const CANVAS_H = 600;
const VISIBLE_W = 1500;
const HEADER = 32;
const LABEL = 160;

function task(id: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return { id: toTaskId(id), name: id, start, end, progress: 0.5, type: 'task', createdAt: now, updatedAt: now, ...extra };
}

const tasks: Task[] = [
  task('a', '2026-01-05T00:00', '2026-01-09T00:00'), // 4 days = 96 px
  task('b', '2026-01-12T00:00', '2026-01-16T00:00'),
  task('m', '2026-01-14T00:00', '2026-01-14T00:00', { type: 'milestone' }),
  task('s', '2026-01-05T00:00', '2026-01-09T00:00', { type: 'summary' }),
  task('c1', '2026-01-05T00:00', '2026-01-07T00:00', { parent: toTaskId('s') }),
  task('c2', '2026-01-07T00:00', '2026-01-09T00:00', { parent: toTaskId('s') }),
  task('tiny', '2026-01-19T00:00', '2026-01-19T04:00'), // 4 px wide: narrower than the edge zone
];

// --- harness ----------------------------------------------------------------------------------

type Counts = Record<string, number>;
const ctxByCanvas = new WeakMap<HTMLCanvasElement, { ctx: CanvasRenderingContext2D; counts: Counts }>();

function mockCtx(): { ctx: CanvasRenderingContext2D; counts: Counts } {
  const counts: Counts = {};
  const store: Record<string, unknown> = {};
  const ctx = new Proxy(store, {
    get: (t, k: string) => (k in t ? t[k] : (): void => void (counts[k] = (counts[k] ?? 0) + 1)),
    set: (t, k: string, v: unknown) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, counts };
}

let rafQueue: Array<(t: number) => void> = [];
const flushFrames = (): void => {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(0);
};

let container: HTMLElement;
let scrollTop = 0;

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => rafQueue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let entry = ctxByCanvas.get(this);
    if (!entry) ctxByCanvas.set(this, (entry = mockCtx()));
    return entry.ctx;
  } as never);
  container = document.createElement('div');
  document.body.appendChild(container);
  scrollTop = 0;
  Object.defineProperty(container, 'scrollTop', { get: () => scrollTop, set: (v: number) => void (scrollTop = v), configurable: true });
  document.body.style.cursor = '';
});
afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Setup {
  h: CanvasRendererHandle;
  canvas: HTMLCanvasElement;
  moved: Array<{ id: TaskId; start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime }>;
  resized: Array<{ id: TaskId; end: Temporal.ZonedDateTime }>;
  linked: Array<[TaskId, TaskId]>;
  dispose: () => void;
  bar(id: string): { L: number; R: number; top: number; midY: number; height: number };
  input: CanvasRendererInput;
}

function setup(
  opts: {
    input?: Partial<CanvasRendererInput>;
    options?: { labelColumnWidth?: number; density?: 'default' | 'compact' };
    links?: boolean;
    attach?: boolean;
    coarse?: boolean;
  } = {},
): Setup {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: opts.coarse === true && q.includes('coarse') }));
  const input: CanvasRendererInput = { tasks, dependencies: [], ...opts.input };
  const h = createCanvasRenderer(container, input, { viewMode: 'week', viewportHeight: CANVAS_H, ...opts.options });
  const canvas = h.canvas;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, width: CANVAS_W, height: CANVAS_H, toJSON: () => ({}),
  });
  // The scroll container's visible box is narrower than the (full content width) canvas.
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: VISIBLE_W, bottom: CANVAS_H, x: 0, y: 0, width: VISIBLE_W, height: CANVAS_H, toJSON: () => ({}),
  });
  Object.defineProperty(container, 'clientWidth', { value: VISIBLE_W, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: CANVAS_H, configurable: true });
  const moved: Setup['moved'] = [];
  const resized: Setup['resized'] = [];
  const linked: Setup['linked'] = [];
  const dispose =
    opts.attach === false
      ? () => undefined
      : h.attachDrag(getPointerDragController(h), {
          onTaskMoved: (id, start, end) => moved.push({ id, start, end }),
          onTaskResized: (id, end) => resized.push({ id, end }),
          onDependencyCreated: opts.links === false ? undefined : (from, to) => linked.push([from, to]),
        });
  const bar = (id: string) => {
    const s = h.getRenderState();
    const density = s.options.density ?? 'default';
    const rows = layoutRows(s.input.tasks, density, s.input.collapsedIds);
    const row = rows.find((r) => r.task.id === id)!;
    const rowHeight = density === 'compact' ? 24 : 32;
    const b = layoutTaskBar(row.task, h.getTimeScale(), row, rowHeight, s.input.rollup);
    const off = h.getLabelColumnWidth();
    const top = HEADER + b.y - scrollTop;
    return { L: off + b.x, R: off + b.x + b.width, top, midY: top + b.height / 2, height: b.height };
  };
  return { h, canvas, moved, resized, linked, dispose, bar, input };
}

function ptr(type: string, x: number, y: number, init: { id?: number; pointerType?: string; buttons?: number } = {}): PointerEvent {
  const e = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: init.id ?? 1,
    pointerType: init.pointerType ?? 'mouse',
    buttons: init.buttons ?? 0,
  });
  return e;
}
const down = (s: Setup, x: number, y: number, init?: Parameters<typeof ptr>[3]): void => void s.canvas.dispatchEvent(ptr('pointerdown', x, y, init));
const move = (x: number, y: number, init?: Parameters<typeof ptr>[3]): void => void window.dispatchEvent(ptr('pointermove', x, y, init));
const up = (x: number, y: number, init?: Parameters<typeof ptr>[3]): void => void window.dispatchEvent(ptr('pointerup', x, y, init));
const hover = (s: Setup, x: number, y: number, init?: Parameters<typeof ptr>[3]): void => {
  s.canvas.dispatchEvent(ptr('pointermove', x, y, init));
  flushFrames();
};
const day = (z: Temporal.ZonedDateTime): string => z.toPlainDate().toString();
const overlay = (): HTMLCanvasElement | null => container.querySelector('canvas.fg-timeline-canvas-overlay');

// --- hitTestBar ---------------------------------------------------------------------------------

describe('hitTestBar', () => {
  it('is undefined before attachDrag, defined while attached, undefined again after the disposer', () => {
    const s = setup({ attach: false });
    const a = s.bar('a');
    expect(s.h.hitTestBar(a.L + 40, a.midY)).toBeUndefined();
    const dispose = s.h.attachDrag(getPointerDragController(s.h), { onTaskMoved: () => undefined, onTaskResized: () => undefined });
    expect(s.h.hitTestBar(a.L + 40, a.midY)).toEqual({ taskId: 'a', zone: 'body' });
    dispose();
    dispose(); // idempotent
    expect(s.h.hitTestBar(a.L + 40, a.midY)).toBeUndefined();
  });

  it('classifies body / edge / link zones, with the 8 px edge zone and 4 px handle radius', () => {
    const s = setup();
    const a = s.bar('a');
    const at = (x: number, y = a.midY) => s.h.hitTestBar(x, y)?.zone;
    expect(at(a.L + 40)).toBe('body');
    expect(at(a.R - 9)).toBe('body');
    expect(at(a.R - 8)).toBe('resize-end');
    expect(at(a.R - 6)).toBe('resize-end'); // 6 px from the anchor: outside the 4 px handle
    expect(at(a.R - 3)).toBe('link-end');
    expect(at(a.R + 4)).toBe('link-end');
    expect(at(a.R + 6)).toBeUndefined();
    expect(at(a.L)).toBe('link-start');
    expect(at(a.L + 4)).toBe('link-start');
    expect(at(a.L + 5)).toBe('body');
    expect(at(a.L - 6)).toBeUndefined();
    expect(at(a.L + 40, a.top - 1)).toBeUndefined(); // just above the bar, same row
    expect(at(a.L + 40, a.top + a.height + 1)).toBeUndefined();
    expect(s.h.hitTestBar(a.L + 40, a.top)?.zone).toBe('body'); // inclusive top boundary
  });

  it('returns the id and never reaches into the DOM: the target of the press is irrelevant', () => {
    const s = setup();
    const b = s.bar('b');
    expect(s.h.hitTestBar(b.L + 30, b.midY)?.taskId).toBe('b');
  });

  it.each([
    ['header band', (a: ReturnType<Setup['bar']>) => [a.L + 40, HEADER - 1]],
    ['left of the canvas', () => [-1, 50]],
    ['right of the canvas', () => [CANVAS_W + 1, 50]],
    ['below the canvas', () => [200, CANVAS_H + 1]],
    ['below the last row', () => [200, CANVAS_H - 1]],
    ['non-finite x', () => [Number.NaN, 50]],
    ['non-finite y', () => [50, Number.POSITIVE_INFINITY]],
  ] as const)('is undefined for %s', (_name, pt) => {
    const s = setup();
    const [x, y] = pt(s.bar('a'));
    expect(s.h.hitTestBar(x!, y!)).toBeUndefined();
  });

  it('a narrow bar (< the edge zone) is moved, never resized: move wins', () => {
    const s = setup({ links: false });
    const t = s.bar('tiny');
    expect(t.R - t.L).toBeLessThan(8);
    expect(s.h.hitTestBar(t.R - 1, t.midY)?.zone).toBe('body');
  });

  it('a milestone is a diamond: the centre is a body, its square corner is a miss, and it has no edge', () => {
    const s = setup();
    const m = s.bar('m');
    const cx = (m.L + m.R) / 2;
    expect(s.h.hitTestBar(cx, m.midY)?.zone).toBe('body');
    // Inside the bounding square but outside the diamond.
    expect(s.h.hitTestBar(m.L + 1, m.top + 1)).toBeUndefined();
    const s2 = setup({ links: false });
    const m2 = s2.bar('m');
    expect(s2.h.hitTestBar(m2.R - 1, m2.midY)?.zone).toBe('body');
  });

  it('a rolled-up summary body is inert but its link handles still claim', () => {
    const s = setup({ input: { rollup: computeRollup(tasks) } });
    const sum = s.bar('s');
    expect(s.h.hitTestBar((sum.L + sum.R) / 2, sum.midY)).toBeUndefined();
    expect(s.h.hitTestBar(sum.R - 7, sum.midY)).toBeUndefined();
    expect(s.h.hitTestBar(sum.L, sum.midY)?.zone).toBe('link-start');
    // Without a rollup the same summary is an ordinary draggable bar.
    const plain = setup();
    const p = plain.bar('s');
    expect(plain.h.hitTestBar((p.L + p.R) / 2, p.midY)?.zone).toBe('body');
  });

  it('under a coarse pointer the zones widen to 24 px (edge) and 12 px (handle radius)', () => {
    const s = setup({ coarse: true });
    const a = s.bar('a');
    expect(s.h.hitTestBar(a.R - 20, a.midY)?.zone).toBe('resize-end');
    expect(s.h.hitTestBar(a.R - 25, a.midY)?.zone).toBe('body');
    expect(s.h.hitTestBar(a.R - 11, a.midY)?.zone).toBe('link-end');
    expect(s.h.hitTestBar(a.R - 13, a.midY)?.zone).toBe('resize-end');
    expect(s.h.hitTestBar(a.L + 11, a.midY)?.zone).toBe('link-start');
  });

  it('touch: link handles only claim for a SELECTED bar; mouse/pen always', () => {
    const plain = setup();
    const a = plain.bar('a');
    expect(plain.h.hitTestBar(a.R, a.midY, 'touch')?.zone).toBe('resize-end');
    expect(plain.h.hitTestBar(a.R, a.midY, 'mouse')?.zone).toBe('link-end');
    expect(plain.h.hitTestBar(a.R, a.midY, 'pen')?.zone).toBe('link-end');
    const selected = setup({ input: { selectedTaskIds: [toTaskId('a')] } });
    expect(selected.h.hitTestBar(a.R, a.midY, 'touch')?.zone).toBe('link-end');
  });

  it('enableDependencyDrag: false (no link callback) never yields a link zone', () => {
    const s = setup({ links: false });
    const a = s.bar('a');
    expect(s.h.hitTestBar(a.R, a.midY)?.zone).toBe('resize-end');
    expect(s.h.hitTestBar(a.L, a.midY)?.zone).toBe('body');
  });

  it('follows the scroll position, the collapsed rows and a narrowed label column', () => {
    const s = setup({ options: { labelColumnWidth: 100 } });
    expect(s.h.getLabelColumnWidth()).toBe(100);
    const b0 = s.bar('b');
    expect(b0.L).toBeGreaterThan(100);
    expect(s.h.hitTestBar(b0.L + 30, b0.midY)?.taskId).toBe('b');
    expect(b0.L - 100).toBeLessThan(b0.L - LABEL + 100 + 1); // origin is the narrowed 100 px column, not 160
    scrollTop = 32; // one row down: the row below now sits where `a`'s row was
    expect(s.h.hitTestBar(s.bar('b').L + 30, s.bar('b').midY)?.taskId).toBe('b');
    scrollTop = 0;

    const collapsed = setup({ input: { collapsedIds: new Set([toTaskId('s')]) } });
    // With `s` collapsed, `tiny` moves up two rows.
    const t = collapsed.bar('tiny');
    expect(collapsed.h.hitTestBar(t.L + 1, t.midY)?.taskId).toBe('tiny');
  });

  it('property: no point outside every bar rectangle ever claims a body or edge', () => {
    const s = setup({ links: false });
    const rects = tasks.filter((t) => t.id !== 'm' && t.id !== 's').map((t) => s.bar(t.id));
    fc.assert(
      fc.property(fc.integer({ min: 0, max: CANVAS_W }), fc.integer({ min: 0, max: CANVAS_H }), (x, y) => {
        const hit = s.h.hitTestBar(x, y);
        if (!hit) return true;
        const inside = [...tasks.map((t) => s.bar(t.id))].some((r) => x >= r.L - 1 && x <= r.R + 1 && y >= r.top - 1 && y <= r.top + r.height + 1);
        return inside && rects.length > 0;
      }),
    );
  });
});

describe('hitTestRow.onBar', () => {
  it('is true inside the bar / diamond and false on the rest of the row, without a drag attached', () => {
    const s = setup({ attach: false });
    const a = s.bar('a');
    expect(s.h.hitTestRow(a.L + 40, a.midY)?.onBar).toBe(true);
    expect(s.h.hitTestRow(a.R + 40, a.midY)?.onBar).toBe(false);
    expect(s.h.hitTestRow(10, a.midY)?.onBar).toBe(false); // label column
    const m = s.bar('m');
    expect(s.h.hitTestRow((m.L + m.R) / 2, m.midY)?.onBar).toBe(true);
    expect(s.h.hitTestRow(m.L + 1, m.top + 1)?.onBar).toBe(false);
    expect(s.h.hitTestRow(10, HEADER - 1)).toBeUndefined();
  });
});

// --- layout memo ----------------------------------------------------------------------------------

describe('layout memo', () => {
  it('runs layoutRows once per RenderState: hovers/presses reuse it, update() invalidates it', () => {
    const s = setup();
    const a = s.bar('a');
    const spy = vi.mocked(layoutRows);
    spy.mockClear();
    for (let i = 0; i < 20; i++) {
      s.h.hitTestBar(a.L + 40, a.midY);
      s.h.hitTestRow(a.L + 40, a.midY);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    s.h.update({ ...s.input, tasks: [...tasks].reverse() });
    spy.mockClear();
    s.h.hitTestRow(a.L + 40, a.midY);
    s.h.hitTestRow(a.L + 40, a.midY);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2); // the render itself + one memo fill
    const after = spy.mock.calls.length;
    s.h.hitTestRow(a.L + 40, a.midY);
    expect(spy.mock.calls.length).toBe(after);
  });

  it('a failed setOptions() rolls back to the previous state, whose memo entry is still valid', () => {
    const s = setup();
    const a = s.bar('a');
    s.h.hitTestRow(a.L + 40, a.midY); // fill the memo
    expect(() => s.h.setOptions({ viewportHeight: 1e7 })).toThrow(); // dimension guard
    const spy = vi.mocked(layoutRows);
    spy.mockClear();
    expect(s.h.hitTestRow(a.L + 40, a.midY)?.taskId).toBe('a');
    expect(spy).not.toHaveBeenCalled();
  });
});

// --- recognizers through the real coordinator ---------------------------------------------------------

describe('drag-move on Canvas', () => {
  it('moves a bar by whole calendar days and commits once on release', () => {
    const s = setup();
    const a = s.bar('a');
    down(s, a.L + 40, a.midY);
    move(a.L + 40 + 72, a.midY); // 3 days at 24 px/day
    expect(s.moved).toHaveLength(0);
    up(a.L + 40 + 72, a.midY);
    expect(s.moved).toHaveLength(1);
    expect(s.moved[0]!.id).toBe('a');
    expect(day(s.moved[0]!.start)).toBe('2026-01-08');
    expect(day(s.moved[0]!.end)).toBe('2026-01-12');
    expect(document.body.style.cursor).toBe('');
  });

  it('snaps to the nearest day and keeps the wall-clock time', () => {
    const s = setup();
    const a = s.bar('a');
    down(s, a.L + 40, a.midY);
    move(a.L + 40 + 35, a.midY); // 1.46 days -> 1
    up(a.L + 40 + 35, a.midY);
    expect(day(s.moved[0]!.start)).toBe('2026-01-06');
    expect(s.moved[0]!.start.hour).toBe(0);
  });

  it('threshold: a 3 px move starts nothing, 4 px does; a plain click commits nothing', () => {
    const s = setup();
    const a = s.bar('a');
    down(s, a.L + 40, a.midY);
    move(a.L + 43, a.midY);
    expect(document.body.style.cursor).toBe('');
    move(a.L + 44, a.midY);
    expect(document.body.style.cursor).toBe('grabbing');
    up(a.L + 44, a.midY);
    expect(s.moved).toHaveLength(1); // 4 px is 0 days: the callback still fires, the facade no-ops it
    expect(day(s.moved[0]!.start)).toBe('2026-01-05');

    down(s, a.L + 40, a.midY);
    up(a.L + 40, a.midY);
    expect(s.moved).toHaveLength(1);
  });

  it('a press outside any bar, in the header, or on a rolled-up body claims nothing', () => {
    const s = setup({ input: { rollup: computeRollup(tasks) } });
    const a = s.bar('a');
    down(s, 10, a.midY);
    move(200, a.midY);
    up(200, a.midY);
    down(s, a.L + 40, HEADER - 5);
    move(a.L + 200, HEADER - 5);
    up(a.L + 200, HEADER - 5);
    const sum = s.bar('s');
    down(s, (sum.L + sum.R) / 2, sum.midY);
    move((sum.L + sum.R) / 2 + 100, sum.midY);
    up((sum.L + sum.R) / 2 + 100, sum.midY);
    expect(s.moved).toHaveLength(0);
    expect(document.body.style.cursor).toBe('');
  });

  it('the pointer scrolled container maps to the right row', () => {
    const s = setup();
    scrollTop = 64; // `b` is row 1 -> now above the band; use `m` (row 2) -> row 0 of the band
    const m = s.bar('m');
    expect(m.midY).toBeGreaterThan(HEADER);
    down(s, (m.L + m.R) / 2, m.midY);
    move((m.L + m.R) / 2 + 48, m.midY);
    up((m.L + m.R) / 2 + 48, m.midY);
    expect(s.moved[0]!.id).toBe('m');
    expect(day(s.moved[0]!.start)).toBe('2026-01-16');
  });
});

describe('drag-resize on Canvas', () => {
  it('moves only the end, snapped to days', () => {
    const s = setup();
    const a = s.bar('a');
    down(s, a.R - 6, a.midY);
    move(a.R - 6 + 48, a.midY);
    up(a.R - 6 + 48, a.midY);
    expect(s.moved).toHaveLength(0);
    expect(s.resized).toHaveLength(1);
    expect(s.resized[0]!.id).toBe('a');
    expect(day(s.resized[0]!.end)).toBe('2026-01-11');
  });

  it('is floored at start + 1 day however far it is dragged left', () => {
    const s = setup();
    const a = s.bar('a');
    down(s, a.R - 6, a.midY);
    move(a.R - 6 - 500, a.midY);
    up(a.R - 6 - 500, a.midY);
    expect(day(s.resized[0]!.end)).toBe('2026-01-06');
  });

  it('an absurd finite delta cannot throw out of the pointer handler', () => {
    const s = setup();
    const a = s.bar('a');
    down(s, a.R - 6, a.midY);
    move(a.R - 6 + 1e12, a.midY);
    expect(() => up(a.R - 6 + 1e12, a.midY)).not.toThrow();
    expect(s.resized).toHaveLength(1);
  });
});

describe('drag-create-dependency on Canvas', () => {
  it('the END handle makes the origin the predecessor', () => {
    const s = setup();
    const a = s.bar('a');
    const b = s.bar('b');
    down(s, a.R, a.midY);
    move((b.L + b.R) / 2, b.midY);
    up((b.L + b.R) / 2, b.midY);
    expect(s.linked).toEqual([['a', 'b']]);
  });

  it('the START handle reverses the direction', () => {
    const s = setup();
    const a = s.bar('a');
    const b = s.bar('b');
    down(s, a.L, a.midY);
    move((b.L + b.R) / 2, b.midY);
    up((b.L + b.R) / 2, b.midY);
    expect(s.linked).toEqual([['b', 'a']]);
  });

  it('a self drop, an empty-space drop and a header drop create nothing', () => {
    const s = setup();
    const a = s.bar('a');
    down(s, a.R, a.midY);
    move(a.L + 40, a.midY);
    up(a.L + 40, a.midY);
    down(s, a.R, a.midY);
    move(a.R + 300, a.midY);
    up(a.R + 300, a.midY);
    down(s, a.R, a.midY);
    move(a.R + 50, 5);
    up(a.R + 50, 5);
    expect(s.linked).toEqual([]);
    expect(document.body.style.cursor).toBe('');
  });

  it('a rolled-up summary bar is a valid DROP target (SVG parity)', () => {
    const s = setup({ input: { rollup: computeRollup(tasks) } });
    const a = s.bar('a');
    const sum = s.bar('s');
    down(s, a.R, a.midY);
    move((sum.L + sum.R) / 2, sum.midY);
    up((sum.L + sum.R) / 2, sum.midY);
    expect(s.linked).toEqual([['a', 's']]);
  });

  it('without a link callback the handle is a plain edge and no crosshair appears', () => {
    const s = setup({ links: false });
    const a = s.bar('a');
    const b = s.bar('b');
    down(s, a.R, a.midY);
    move(a.R + 10, a.midY);
    expect(document.body.style.cursor).toBe('ew-resize');
    up((b.L + b.R) / 2, b.midY);
    expect(s.linked).toEqual([]);
  });
});

describe('gesture lifecycle on Canvas', () => {
  const startMove = (s: Setup) => {
    const a = s.bar('a');
    down(s, a.L + 40, a.midY);
    move(a.L + 80, a.midY);
    return a;
  };

  it('Escape cancels: no callback, cursor reset, overlay cleared', () => {
    const s = setup();
    startMove(s);
    flushFrames();
    expect(overlay()).not.toBeNull();
    const ov = ctxByCanvas.get(overlay()!)!;
    const clearsBefore = ov.counts['clearRect'] ?? 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.style.cursor).toBe('');
    expect(ov.counts['clearRect']).toBeGreaterThan(clearsBefore);
    up(500, 100);
    expect(s.moved).toHaveLength(0);
  });

  it('pointercancel (including the synthetic one edit-hooks fires, carrying only pointerId) cancels', () => {
    const s = setup();
    startMove(s);
    const synthetic = new Event('pointercancel', { bubbles: true });
    Object.defineProperty(synthetic, 'pointerId', { value: 1 });
    s.canvas.dispatchEvent(synthetic);
    expect(document.body.style.cursor).toBe('');
    up(300, 100);
    expect(s.moved).toHaveLength(0);
  });

  it('a second pointer is ignored while a gesture is open', () => {
    const s = setup();
    const a = startMove(s);
    const b = s.bar('b');
    down(s, b.L + 30, b.midY, { id: 2 });
    move(b.L + 90, b.midY, { id: 2 });
    up(a.L + 40 + 48, a.midY, { id: 1 });
    expect(s.moved.map((m) => m.id)).toEqual(['a']);
  });

  it('destroy() mid-drag cleans up and commits nothing', () => {
    const s = setup();
    startMove(s);
    flushFrames();
    s.h.destroy();
    expect(document.body.style.cursor).toBe('');
    expect(overlay()).toBeNull();
    up(300, 100);
    expect(s.moved).toHaveLength(0);
  });

  it('the attachDrag disposer mid-drag cancels the gesture', () => {
    const s = setup();
    startMove(s);
    s.dispose();
    expect(document.body.style.cursor).toBe('');
    up(300, 100);
    expect(s.moved).toHaveLength(0);
    // And the canvas no longer reacts to a fresh press.
    const a = s.bar('a');
    down(s, a.L + 40, a.midY);
    move(a.L + 200, a.midY);
    up(a.L + 200, a.midY);
    expect(s.moved).toHaveLength(0);
  });

  it('a garbage-coordinate pointerup cancels instead of committing', () => {
    const s = setup();
    startMove(s);
    const bad = ptr('pointerup', 0, 0);
    Object.defineProperty(bad, 'clientX', { value: Number.NaN });
    window.dispatchEvent(bad);
    expect(s.moved).toHaveLength(0);
    expect(document.body.style.cursor).toBe('');
  });

  it('a stale gesture (the chart was re-rendered from new data mid-drag) commits nothing and does not throw', () => {
    const s = setup();
    const a = startMove(s);
    s.h.update({ ...s.input, tasks: [...tasks] });
    expect(() => {
      move(a.L + 120, a.midY);
      up(a.L + 120, a.midY);
    }).not.toThrow();
    expect(s.moved).toHaveLength(0);
    expect(document.body.style.cursor).toBe('');
  });

  it('scrolling mid-drag (a render that keeps the state) keeps the gesture alive', () => {
    const s = setup();
    const a = startMove(s);
    scrollTop = 10;
    window.dispatchEvent(new Event('scroll')); // not wired to the container: trigger a scroll render
    container.dispatchEvent(new Event('scroll'));
    flushFrames();
    move(a.L + 40 + 72, a.midY);
    up(a.L + 40 + 72, a.midY);
    expect(s.moved).toHaveLength(1);
  });
});

// --- overlay + hover ------------------------------------------------------------------------------------------

describe('overlay canvas', () => {
  it('is not created by attachDrag; appears lazily; is aria-hidden, sticky, click-through', () => {
    const s = setup();
    expect(overlay()).toBeNull();
    const a = s.bar('a');
    down(s, a.L + 40, a.midY);
    move(a.L + 80, a.midY);
    flushFrames();
    const ov = overlay()!;
    expect(ov).not.toBeNull();
    expect(ov.getAttribute('aria-hidden')).toBe('true');
    expect(ov.style.pointerEvents).toBe('none');
    expect(ov.style.position).toBe('sticky');
    expect(ov.previousElementSibling).toBe(s.canvas);
    s.h.destroy();
    expect(overlay()).toBeNull();
  });

  it('never repaints the main canvas during a gesture', () => {
    const s = setup();
    const main = ctxByCanvas.get(s.canvas)!;
    const a = s.bar('a');
    down(s, a.L + 40, a.midY);
    const before = { ...main.counts };
    const widthWrites = vi.fn();
    const proto = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!;
    Object.defineProperty(s.canvas, 'width', { get: () => proto.get!.call(s.canvas), set: (v: number) => (widthWrites(v), proto.set!.call(s.canvas, v)), configurable: true });
    for (let i = 1; i <= 60; i++) {
      move(a.L + 40 + i * 2, a.midY);
      flushFrames();
    }
    up(a.L + 40 + 120, a.midY);
    expect(main.counts['setTransform']).toBe(before['setTransform']);
    expect(main.counts['fillRect']).toBe(before['fillRect']);
    expect(widthWrites).not.toHaveBeenCalled();
    expect(ctxByCanvas.get(overlay()!)!.counts['clearRect']).toBeGreaterThan(30);
  });

  it('is clipped to the row band so a ghost never paints over the pinned header', () => {
    const s = setup();
    const a = s.bar('a');
    down(s, a.L + 40, a.midY);
    move(a.L + 80, a.midY);
    flushFrames();
    const c = ctxByCanvas.get(overlay()!)!.counts;
    expect(c['clip']).toBeGreaterThan(0);
  });

  it('onRender re-syncs the overlay size after a viewport change', () => {
    const s = setup();
    const a = s.bar('a');
    down(s, a.L + 40, a.midY);
    move(a.L + 80, a.midY);
    flushFrames();
    expect(overlay()!.style.height).toBe(`${CANVAS_H}px`);
    s.h.setOptions({ viewportHeight: 400 });
    expect(overlay()!.style.height).toBe('400px');
  });
});

describe('hover cursor and link-handle reveal', () => {
  it('shows grab / ew-resize / crosshair over body / edge / handle and clears elsewhere', () => {
    const s = setup();
    const a = s.bar('a');
    hover(s, a.L + 40, a.midY);
    expect(s.canvas.style.cursor).toBe('grab');
    hover(s, a.R - 6, a.midY);
    expect(s.canvas.style.cursor).toBe('ew-resize');
    hover(s, a.R, a.midY);
    expect(s.canvas.style.cursor).toBe('crosshair');
    hover(s, a.R + 100, a.midY);
    expect(s.canvas.style.cursor).toBe('');
  });

  it('ignores touch hovers and moves with a button held; pointerleave clears', () => {
    const s = setup();
    const a = s.bar('a');
    hover(s, a.L + 40, a.midY, { pointerType: 'touch' });
    expect(s.canvas.style.cursor).toBe('');
    hover(s, a.L + 40, a.midY, { buttons: 1 });
    expect(s.canvas.style.cursor).toBe('');
    hover(s, a.L + 40, a.midY);
    expect(s.canvas.style.cursor).toBe('grab');
    s.canvas.dispatchEvent(new Event('pointerleave'));
    flushFrames();
    expect(s.canvas.style.cursor).toBe('');
  });

  it('a rolled-up body shows no grab cursor (it is inert) ', () => {
    const s = setup({ input: { rollup: computeRollup(tasks) } });
    const sum = s.bar('s');
    hover(s, (sum.L + sum.R) / 2, sum.midY);
    expect(s.canvas.style.cursor).toBe('');
  });

  it('draws two handles on the overlay for the hovered bar', () => {
    const s = setup();
    const a = s.bar('a');
    hover(s, a.L + 40, a.midY);
    expect(ctxByCanvas.get(overlay()!)!.counts['arc']).toBe(2);
  });

  it('draws handles for a selected bar after the render that selected it, without any pointer movement', () => {
    const s = setup();
    expect(overlay()).toBeNull();
    s.h.update({ ...s.input, selectedTaskIds: [toTaskId('b')] });
    expect(ctxByCanvas.get(overlay()!)!.counts['arc']).toBe(2);
  });

  it('draws no handles when dependency drag is off, and none in a readOnly chart (no drag attached)', () => {
    const off = setup({ links: false });
    const a = off.bar('a');
    hover(off, a.L + 40, a.midY);
    expect(off.canvas.style.cursor).toBe('grab');
    expect(overlay() === null || (ctxByCanvas.get(overlay()!)!.counts['arc'] ?? 0) === 0).toBe(true);
    container.innerHTML = '';
    const ro = setup({ attach: false });
    const b = ro.bar('a');
    hover(ro, b.L + 40, b.midY);
    expect(ro.canvas.style.cursor).toBe('');
    expect(overlay()).toBeNull();
  });
});

describe('attachDrag', () => {
  it('a second call replaces the first attachment', () => {
    const s = setup();
    const again = s.h.attachDrag(getPointerDragController(s.h), { onTaskMoved: () => undefined, onTaskResized: () => undefined });
    const a = s.bar('a');
    down(s, a.L + 40, a.midY);
    move(a.L + 100, a.midY);
    up(a.L + 100, a.midY);
    expect(s.moved).toHaveLength(0); // the first wiring's callbacks no longer fire
    again();
  });
});

// --- review fixes (B1, N1, N2, N7) ---------------------------------------------------------------

describe('link drop bounds (B1)', () => {
  it('releasing outside the scroll container creates nothing, even over a bar of the wider canvas', () => {
    // A far-right bar lives inside the canvas but beyond the container's visible box.
    const far = [...tasks, task('far', '2026-03-02T00:00', '2026-03-06T00:00')];
    const s = setup({ input: { tasks: far } });
    const a = s.bar('a');
    const f = s.bar('far');
    expect(f.L).toBeGreaterThan(VISIBLE_W);
    down(s, a.R, a.midY);
    move(f.L + 20, f.midY);
    up(f.L + 20, f.midY);
    expect(s.linked).toEqual([]);
    expect(s.h.hitTestBar(f.L + 20, f.midY)).toBeUndefined();
  });

  it('releasing below the visible container creates nothing', () => {
    const s = setup();
    const a = s.bar('a');
    const b = s.bar('b');
    down(s, a.R, a.midY);
    move((b.L + b.R) / 2, b.midY);
    Object.defineProperty(container, 'clientHeight', { value: b.midY - 5, configurable: true });
    up((b.L + b.R) / 2, b.midY);
    expect(s.linked).toEqual([]);
  });
});

describe('hover keeps the bar while its handle is hovered (N1) and resolves at the release point (N2)', () => {
  it('the outer half of a link handle keeps the handle drawn and the crosshair', () => {
    const s = setup();
    const a = s.bar('a');
    hover(s, a.L - 3, a.midY); // outside the bar rect, inside the 4 px handle
    expect(s.canvas.style.cursor).toBe('crosshair');
    expect(ctxByCanvas.get(overlay()!)!.counts['arc']).toBe(2);
  });

  it('after a gesture the cursor and handles follow the pointer where it was released', () => {
    const s = setup();
    const a = s.bar('a');
    const b = s.bar('b');
    down(s, a.R, a.midY);
    const over = { x: (b.L + b.R) / 2, y: b.midY };
    s.canvas.dispatchEvent(ptr('pointermove', over.x, over.y, { buttons: 1 }));
    move(over.x, over.y, { buttons: 1 });
    up(over.x, over.y);
    s.h.update({ ...s.input, tasks: [...tasks] });
    expect(s.canvas.style.cursor).toBe('grab'); // over bar b, not crosshair from the press point on a
  });
});

describe('preview painting (N7)', () => {
  it('a resize paints a ghost bar on the overlay and a link paints a dashed segment, arrowhead and target outline', () => {
    const s = setup();
    const a = s.bar('a');
    down(s, a.R - 6, a.midY);
    move(a.R + 40, a.midY);
    flushFrames();
    const ov = ctxByCanvas.get(overlay()!)!.counts;
    expect(ov['fill']).toBeGreaterThan(0);
    up(a.R + 40, a.midY);
    container.innerHTML = '';

    const l = setup();
    const b = l.bar('b');
    down(l, b.R, b.midY);
    const c = l.bar('a');
    move((c.L + c.R) / 2, c.midY);
    flushFrames();
    const counts = ctxByCanvas.get(overlay()!)!.counts;
    expect(counts['strokeRect']).toBeGreaterThan(0); // target outline
    expect(counts['lineTo']).toBeGreaterThan(0); // segment + arrowhead
    expect(counts['closePath']).toBeGreaterThan(0);
  });

  it.each(['resize', 'link'] as const)('a stale %s gesture commits nothing', (kind) => {
    const s = setup();
    const a = s.bar('a');
    down(s, kind === 'resize' ? a.R - 6 : a.R, a.midY);
    move(a.R + 60, a.midY);
    s.h.update({ ...s.input, tasks: [...tasks] });
    move(a.R + 100, a.midY);
    up(a.R + 100, a.midY);
    expect(s.resized).toHaveLength(0);
    expect(s.linked).toHaveLength(0);
  });
});
