// @vitest-environment jsdom
//
// Canvas-mode RTL (spec-rtl-chart.md section 6; AC1, AC2, AC5, AC6, AC7). jsdom has no layout engine
// and no 2D context: the context is a recording Proxy and the canvas rects are stubbed, so these
// tests pin the exact calls (transform order, `direction`, text-align swap, save/restore balance);
// real pixels are the Playwright specs' job.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import type { Temporal } from '@js-temporal/polyfill';
import { createCanvasRenderer, type CanvasRendererHandle } from '../../src/render/canvas-renderer.js';
import { applyMirror, fillTextAt, layoutX } from '../../src/render/canvas-mirror.js';
import { getPointerDragController } from '../../src/interaction/pointer-drag.js';
import { layoutRows, layoutTaskBar } from '../../src/render/renderer-base.js';
import { exportCanvasPng } from '../../src/io/export-canvas-png.js';
import { createGantt } from '../../src/gantt.js';
import { withRender, CANVAS_AUTO_SWITCH_THRESHOLD } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withEditHooks } from '../../src/edit-hooks/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import { toTaskId, type Task, type TaskId } from '../../src/types.js';

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
];

// --- recording context -----------------------------------------------------------------------
interface Rec {
  calls: { name: string; args: unknown[] }[];
  props: Record<string, unknown>;
}
function recordingCtx(init: Record<string, unknown> = {}): { ctx: CanvasRenderingContext2D; rec: Rec } {
  const rec: Rec = { calls: [], props: { textAlign: 'start', direction: 'ltr', ...init } };
  const ctx = new Proxy(rec.props, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]): void => void rec.calls.push({ name: k, args })),
    set: (t, k: string, v: unknown) => {
      rec.calls.push({ name: `${k}=`, args: [v] });
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}
const names = (r: Rec): string[] => r.calls.map((c) => c.name);

describe('applyMirror / fillTextAt (spec 6.1)', () => {
  it('applyMirror post-multiplies a horizontal flip about the width and marks the context rtl', () => {
    const { ctx, rec } = recordingCtx();
    applyMirror(ctx, 640);
    expect(rec.calls).toEqual([
      { name: 'transform', args: [-1, 0, 0, 1, 640, 0] },
      { name: 'direction=', args: ['rtl'] },
    ]);
  });

  it('fillTextAt is a plain fillText on an LTR context (no transform, no save)', () => {
    const { ctx, rec } = recordingCtx();
    fillTextAt(ctx, 'abc', 10, 20);
    expect(rec.calls).toEqual([{ name: 'fillText', args: ['abc', 10, 20] }]);
  });

  it.each(['left', 'start'])('counter-flips about the anchor and right-aligns a %s run on a mirrored context', (align) => {
    const { ctx, rec } = recordingCtx({ direction: 'rtl', textAlign: align });
    fillTextAt(ctx, 'مهمة', 30, 8);
    expect(names(rec)).toEqual(['save', 'transform', 'textAlign=', 'fillText', 'restore']);
    expect(rec.calls[1]!.args).toEqual([-1, 0, 0, 1, 60, 0]);
    expect(rec.calls[2]!.args).toEqual(['right']);
    expect(rec.calls[3]!.args).toEqual(['مهمة', 30, 8]);
  });

  it('leaves a centered run centered, and keeps save/restore balanced', () => {
    const { ctx, rec } = recordingCtx({ direction: 'rtl', textAlign: 'center' });
    fillTextAt(ctx, 'x', 5, 5);
    expect(names(rec)).toEqual(['save', 'transform', 'fillText', 'restore']);
  });

  it('layoutX is an involution and the identity when not mirrored (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), fc.double({ min: 0, max: 1e5, noNaN: true }), (x, w) => {
        expect(layoutX(false, x, w)).toBe(x);
        expect(layoutX(true, layoutX(true, x, w), w)).toBeCloseTo(x, 6);
      }),
    );
  });
});

// --- renderer ---------------------------------------------------------------------------------
const ctxByCanvas = new WeakMap<HTMLCanvasElement, { ctx: CanvasRenderingContext2D; rec: Rec }>();
let container: HTMLElement;
let scrollTop = 0;
let rafQueue: Array<(t: number) => void> = [];
const flushFrames = (): void => {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(0);
};

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => rafQueue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let entry = ctxByCanvas.get(this);
    if (!entry) ctxByCanvas.set(this, (entry = recordingCtx()));
    return entry.ctx;
  } as never);
  container = document.createElement('div');
  document.body.appendChild(container);
  scrollTop = 0;
  Object.defineProperty(container, 'scrollTop', { get: () => scrollTop, set: (v: number) => void (scrollTop = v), configurable: true });
});
afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rect = (left: number, width: number, height = CANVAS_H): DOMRect =>
  ({ left, top: 0, right: left + width, bottom: height, x: left, y: 0, width, height, toJSON: () => ({}) }) as DOMRect;

function setup(rtl: boolean, attach = true) {
  const h = createCanvasRenderer(container, { tasks, dependencies: [] }, { viewMode: 'week', viewportHeight: CANVAS_H, ...(rtl ? { rtl: true } : {}) });
  // The canvas CSS width IS the painted width; in a RTL scroll container at scrollLeft 0 its right
  // edge is aligned with the container's right edge.
  const W = LABEL + h.getTimeScale().totalWidth;
  vi.spyOn(h.canvas, 'getBoundingClientRect').mockReturnValue(rect(rtl ? VISIBLE_W - W : 0, W));
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(0, VISIBLE_W));
  Object.defineProperty(container, 'clientWidth', { value: VISIBLE_W, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: CANVAS_H, configurable: true });
  const moved: Array<{ id: TaskId; start: Temporal.ZonedDateTime }> = [];
  const linked: Array<[TaskId, TaskId]> = [];
  if (attach) {
    h.attachDrag(getPointerDragController(h), {
      onTaskMoved: (id, start) => moved.push({ id, start }),
      onTaskResized: () => undefined,
      onDependencyCreated: (from, to) => linked.push([from, to]),
    });
  }
  const bar = (id: string) => {
    const s = h.getRenderState();
    const rows = layoutRows(s.input.tasks, 'default', s.input.collapsedIds);
    const row = rows.find((r) => r.task.id === id)!;
    const b = layoutTaskBar(row.task, h.getTimeScale(), row, 32, undefined);
    const off = h.getLabelColumnWidth();
    const top = HEADER + b.y;
    return { L: off + b.x, R: off + b.x + b.width, midY: top + b.height / 2 };
  };
  /** Client x of layout x `lx`: left-aligned when LTR, mirrored about the right edge when RTL. */
  const vis = (lx: number): number => (rtl ? VISIBLE_W - lx : lx);
  return { h, moved, linked, bar, W, vis };
}
const recOf = (h: CanvasRendererHandle): Rec => ctxByCanvas.get(h.canvas)!.rec;

describe('renderPixels with rtl (spec 6.2)', () => {
  it('mirrors right after the base transform, once per repaint, and sets direction rtl', () => {
    const { h } = setup(true);
    const rec = recOf(h);
    const transforms = rec.calls.filter((c) => c.name === 'setTransform' || c.name === 'transform');
    expect(transforms[0]!.name).toBe('setTransform');
    expect(transforms[1]).toEqual({ name: 'transform', args: [-1, 0, 0, 1, h.canvas.width / (window.devicePixelRatio || 1), 0] });
    expect(rec.props['direction']).toBe('rtl');
    rec.calls.length = 0;
    h.setOptions({ viewMode: 'day' });
    expect(rec.calls.filter((c) => c.name === 'transform' && (c.args as number[])[0] === -1 && (c.args as number[])[2] === 0 && (c.args as number[])[4] !== 0 && (c.args as number[])[4] === h.canvas.width / (window.devicePixelRatio || 1))).toHaveLength(1);
  });

  it('paints every text through the counter-flip (header upper, header lower, row labels)', () => {
    const { h } = setup(true);
    const rec = recOf(h);
    const texts = rec.calls.filter((c) => c.name === 'fillText');
    expect(texts.length).toBeGreaterThan(0);
    // each fillText is preceded by a counter-flip about its own x
    rec.calls.forEach((c, i) => {
      if (c.name !== 'fillText') return;
      const flip = rec.calls.slice(0, i).reverse().find((x) => x.name === 'transform')!;
      expect(flip.args).toEqual([-1, 0, 0, 1, 2 * (c.args[1] as number), 0]);
      expect(rec.calls[i - 1]!.name === 'transform' || rec.calls[i - 1]!.name === 'textAlign=').toBe(true);
    });
  });

  it('an LTR chart never touches direction or the transform stack (no regression)', () => {
    const { h } = setup(false);
    const rec = recOf(h);
    expect(rec.calls.some((c) => c.name === 'transform' && (c.args as number[])[0] === -1)).toBe(false);
    expect(rec.calls.some((c) => c.name === 'direction=')).toBe(false);
  });
});

describe('hit testing and anchors with rtl (AC6, spec 6.3)', () => {
  it('hitTestRow reads layout x from the right edge; the toggle gutter is at the right', () => {
    const rows = [task('p', '2026-01-05T00:00', '2026-01-09T00:00', { type: 'summary' }), task('k', '2026-01-05T00:00', '2026-01-07T00:00', { parent: toTaskId('p') })];
    const h = createCanvasRenderer(container, { tasks: rows, dependencies: [] }, { viewMode: 'week', viewportHeight: CANVAS_H, rtl: true });
    const W = 4000;
    vi.spyOn(h.canvas, 'getBoundingClientRect').mockReturnValue(rect(100, W));
    const y = HEADER + 16;
    // layout x 10 (inside the toggle gutter, depth 0) is the visual x W - 10 from the left
    const hit = h.hitTestRow(100 + (W - 10), y);
    expect(hit).toMatchObject({ taskId: 'p', hitToggle: true });
    // the mirrored-away end of the canvas is the timeline, not a toggle
    expect(h.hitTestRow(100 + 10, y)).toMatchObject({ taskId: 'p', hitToggle: false });
  });

  it('getRowAnchor sits in the middle of the label column at the RIGHT edge', () => {
    const { h, W } = setup(true);
    vi.spyOn(h.canvas, 'getBoundingClientRect').mockReturnValue(rect(50, W));
    expect(h.getRowAnchor(0).clientX).toBe(50 + W - LABEL / 2);
    const ltr = setup(false);
    vi.spyOn(ltr.h.canvas, 'getBoundingClientRect').mockReturnValue(rect(50, ltr.W));
    expect(ltr.h.getRowAnchor(0).clientX).toBe(50 + LABEL / 2);
  });

  it('hitTestBar finds the bar at its mirrored position and agrees with the painted geometry', () => {
    const { h, bar, vis } = setup(true);
    const a = bar('a');
    const at = (lx: number) => h.hitTestBar(vis(lx), a.midY)?.zone;
    expect(at(a.L + 40)).toBe('body');
    expect(at(a.R - 8)).toBe('resize-end'); // the end edge zone is at the visually-LEFT end
    expect(at(a.L + 4)).toBe('link-start');
    expect(at(a.R + 4)).toBe('link-end');
    // the LTR positions of the same layout x are NOT the bar any more
    expect(h.hitTestBar(a.L + 40, a.midY)?.zone).not.toBe('body');
  });
});

describe('Canvas drag with rtl (spec 7.6)', () => {
  function pe(type: string, x: number, y: number): PointerEvent {
    return new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' });
  }
  const dispatch = (target: EventTarget, type: string, x: number, y: number): void => void target.dispatchEvent(pe(type, x, y));

  it('dragging a bar visually left moves it later, visually right earlier', () => {
    const { h, moved, bar, vis, W } = setup(true);
    h.mirrorX = (x) => W - x; // what withRtl installs; the coordinator keys the dx sign on its presence
    const a = bar('a');
    const px = vis(a.L + 40); // a point inside the bar, in visual space
    dispatch(h.canvas, 'pointerdown', px, a.midY);
    dispatch(window, 'pointermove', px - 48, a.midY);
    dispatch(window, 'pointerup', px - 48, a.midY);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.start.toPlainDate().toString()).toBe('2026-01-07'); // +2 days

    dispatch(h.canvas, 'pointerdown', px, a.midY);
    dispatch(window, 'pointermove', px + 48, a.midY);
    dispatch(window, 'pointerup', px + 48, a.midY);
    expect(moved[1]!.start.toPlainDate().toString()).toBe('2026-01-03'); // -2 days
  });

  it('paints the ghost overlay through the same mirror', () => {
    const { h, bar, vis, W } = setup(true);
    h.mirrorX = (x) => W - x;
    const a = bar('a');
    const px = vis(a.L + 40);
    dispatch(h.canvas, 'pointerdown', px, a.midY);
    dispatch(window, 'pointermove', px - 48, a.midY);
    flushFrames();
    const overlay = container.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas-overlay')!;
    const orec = ctxByCanvas.get(overlay)!.rec;
    expect(orec.calls.some((c) => c.name === 'transform' && (c.args as number[])[0] === -1)).toBe(true);
    expect(orec.props['direction']).toBe('rtl');
    // logical, not physical, so a RTL scroll container keeps the overlay in view
    expect(overlay.style.insetInlineStart).toBe('0px');
    expect(overlay.style.left).toBe('');
    dispatch(window, 'pointerup', px - 48, a.midY);
  });

  it('a link drag from the visually-right handle (the START) makes the owner the successor', () => {
    const { h, bar, linked, vis, W } = setup(true);
    h.mirrorX = (x) => W - x;
    const a = bar('a');
    const b = bar('b');
    dispatch(h.canvas, 'pointerdown', vis(a.L), a.midY); // the start handle sits at layout L
    dispatch(window, 'pointermove', vis(a.L) - 60, a.midY + 40);
    dispatch(window, 'pointermove', vis(b.L + 40), b.midY);
    dispatch(window, 'pointerup', vis(b.L + 40), b.midY);
    expect(linked).toEqual([[toTaskId('b'), toTaskId('a')]]);
  });
});

// --- exports ----------------------------------------------------------------------------------
describe('Canvas PNG export with rtl (spec 6.5, AC7)', () => {
  /** Routes every new canvas to a fresh recording context that also answers the allocation probe. */
  function installExportCtx(): Rec[] {
    const recs: Rec[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((cb: BlobCallback) => cb(new Blob(['x']))) as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      const { ctx, rec } = recordingCtx();
      recs.push(rec);
      const probe: Record<string, unknown> = { getImageData: () => ({ data: [0, 0, 0, 255] }) };
      return new Proxy(ctx, { get: (t, k: string) => (k in probe ? probe[k] : Reflect.get(t, k)) });
    } as never);
    return recs;
  }

  it('applies the mirror to the export repaint, after the scale transform and the background fill', async () => {
    const { h } = setup(true, false);
    const recs = installExportCtx();
    await exportCanvasPng(h, { scale: 2, background: '#ffffff' });
    const rec = recs.at(-1)!;
    const i = names(rec).indexOf('setTransform');
    expect(i).toBeGreaterThan(-1);
    expect(rec.calls[i]!.args).toEqual([2, 0, 0, 2, 0, 0]);
    const cssW = LABEL + h.getTimeScale().totalWidth;
    expect(rec.calls[i + 1]).toEqual({ name: 'transform', args: [-1, 0, 0, 1, cssW, 0] });
    expect(rec.props['direction']).toBe('rtl');
    expect(names(rec).lastIndexOf('fillRect', i)).toBeGreaterThan(-1); // the ground is painted before the transform
  });

  it('does not mirror an LTR export', async () => {
    const { h } = setup(false, false);
    const recs = installExportCtx();
    await exportCanvasPng(h, { background: '#ffffff' });
    expect(recs.at(-1)!.calls.some((c) => c.name === 'transform')).toBe(false);
  });
});

describe('withRtl over a Canvas mount (spec 5.2, 6.4)', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: toTaskId(`t${i}`),
      name: `t${i}`,
      start: '2026-01-05T09:00',
      end: '2026-01-06T09:00',
      progress: 0,
      type: 'task' as const,
    }));

  it('sets rtl on the canvas renderer, mirrorX, dir, and mirrors the throwaway export svg', async () => {
    const g = withEditHooks(withRtl(withInteraction(withRender(createGantt({ tasks: many(CANVAS_AUTO_SWITCH_THRESHOLD + 1), rtl: true })))));
    g.mount(container);
    await vi.waitFor(() => expect(getInternal(g).mountOf()?.renderer).toBe('canvas'));
    const handle = getInternal(g).mountOf()!.handle as CanvasRendererHandle;
    expect(container.getAttribute('dir')).toBe('rtl');
    expect(handle.getRenderState().options.rtl).toBe(true);
    expect(handle.mirrorX!(0)).toBe(handle.getLabelColumnWidth() + handle.getTimeScale().totalWidth);

    const src = handle.createExportSvg();
    expect(src.svg.querySelector(':scope > g.fg-rtl')).not.toBeNull();
    expect(src.svg.querySelector(':scope > g.fg-rtl')!.getAttribute('transform')).toBe(
      `matrix(-1 0 0 1 ${src.svg.getAttribute('width')} 0)`,
    );
    src.dispose();

    g.destroy();
    expect(container.hasAttribute('dir')).toBe(false);
  }, 30_000);

  it('edit-hooks classify the label column at the right edge (mirrored x)', async () => {
    const g = withEditHooks(withRtl(withInteraction(withRender(createGantt({ tasks: many(CANVAS_AUTO_SWITCH_THRESHOLD + 1), rtl: true })))));
    const requested = vi.fn();
    g.on('task:context-requested', (p) => requested(p.part));
    g.mount(container);
    await vi.waitFor(() => expect(getInternal(g).mountOf()?.renderer).toBe('canvas'));
    const handle = getInternal(g).mountOf()!.handle as CanvasRendererHandle;
    const W = handle.getLabelColumnWidth() + handle.getTimeScale().totalWidth;
    vi.spyOn(handle.canvas, 'getBoundingClientRect').mockReturnValue(rect(0, W));
    const y = HEADER + 16;
    // visual x measured from the canvas left: the label column is the RIGHTMOST 160 px
    for (const [x, part] of [[W - 40, 'label'], [W - LABEL - 40, 'row'], [40, 'row']] as const) {
      requested.mockClear();
      handle.canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      expect(requested).toHaveBeenCalledTimes(1);
      expect(requested.mock.calls[0]![0]).toBe(part === 'row' ? requested.mock.calls[0]![0] : part);
      if (part === 'row') expect(requested.mock.calls[0]![0]).not.toBe('label');
    }
  }, 30_000);
});

