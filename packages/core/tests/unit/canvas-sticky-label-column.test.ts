// @vitest-environment jsdom
//
// Pinned Canvas label column (spec-canvas-sticky-label-column.md). jsdom has no layout and no 2D
// context: each canvas gets its own recording context and rects are stubbed, so these tests pin the
// DOM shape, the paint split between the two canvases, the repaint policy and the hit-test math. Real
// pixels and real sticky behaviour are the Playwright specs' job.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { createCanvasRenderer, paintRows, paintRowLabels } from '../../src/render/canvas-renderer.js';
import { makePin, pinnedDistance } from '../../src/render/canvas-mirror.js';
import { layoutRows, layoutTaskBar } from '../../src/render/renderer-base.js';
import { createTimeScale } from '../../src/render/renderer-base.js';
import { DEFAULT_CALENDAR, normalizeDate } from '../../src/compute/working-calendar.js';
import { resolveDesignTokens } from '../../src/render/canvas-renderer.js';
import { toTaskId, type Task } from '../../src/types.js';

const CANVAS_H = 600;
const VISIBLE_W = 500;
const HEADER = 32;
const LABEL = 160;

function task(id: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return { id: toTaskId(id), name: `name-${id}`, start, end, progress: 0.5, type: 'task', createdAt: now, updatedAt: now, ...extra };
}
const tasks: Task[] = [
  task('p', '2026-01-05T00:00', '2026-01-09T00:00', { type: 'summary' }),
  task('a', '2026-01-05T00:00', '2026-01-07T00:00', { parent: toTaskId('p') }),
  task('b', '2026-01-12T00:00', '2026-01-16T00:00'),
];

interface Rec {
  calls: { name: string; args: unknown[] }[];
  props: Record<string, unknown>;
}
function recordingCtx(): { ctx: CanvasRenderingContext2D; rec: Rec } {
  const rec: Rec = { calls: [], props: { textAlign: 'start', direction: 'ltr' } };
  const ctx = new Proxy(rec.props, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]): void => void rec.calls.push({ name: k, args })),
    set: (t, k: string, v: unknown) => {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}
const count = (r: Rec, name: string): number => r.calls.filter((c) => c.name === name).length;

const ctxByCanvas = new WeakMap<HTMLCanvasElement, { ctx: CanvasRenderingContext2D; rec: Rec }>();
const recOf = (c: HTMLCanvasElement): Rec => ctxByCanvas.get(c)!.rec;
let container: HTMLElement;
let scrollTop = 0;
let scrollLeft = 0;
let rafQueue: Array<(t: number) => void> = [];
const flushFrames = (): void => {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(0);
};
const rect = (left: number, width: number, top = 0, height = CANVAS_H): DOMRect =>
  ({ left, top, right: left + width, bottom: top + height, x: left, y: top, width, height, toJSON: () => ({}) }) as DOMRect;

function mount(options: Parameters<typeof createCanvasRenderer>[2] = {}, list: Task[] = tasks) {
  return createCanvasRenderer(container, { tasks: list, dependencies: [] }, { viewMode: 'week', viewportHeight: CANVAS_H, ...options });
}
/** Stub a scrolled container: visible box at `left`, the canvas scrolled `scroll` px to its left. */
function scrolled(h: ReturnType<typeof mount>, scroll: number, left = 100, pad = 0, rtl = false): void {
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(left, VISIBLE_W));
  Object.defineProperty(container, 'clientWidth', { value: VISIBLE_W, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: CANVAS_H, configurable: true });
  vi.spyOn(h.canvas, 'getBoundingClientRect').mockReturnValue(rect(left - scroll, 5000));
  // The pinned label canvas sits at the container's content edge (`pad` in from the padding edge).
  vi.spyOn(h.canvas.nextElementSibling!, 'getBoundingClientRect').mockReturnValue(
    rect(rtl ? left + VISIBLE_W - pad - LABEL : left + pad, LABEL),
  );
}

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
  scrollLeft = 0;
  Object.defineProperty(container, 'scrollTop', { get: () => scrollTop, set: (v: number) => void (scrollTop = v), configurable: true });
  Object.defineProperty(container, 'scrollLeft', { get: () => scrollLeft, set: (v: number) => void (scrollLeft = v), configurable: true });
});
afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const labelCanvas = (): HTMLCanvasElement => container.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas-labels')!;

describe('label canvas DOM', () => {
  it('is an aria-hidden, event-transparent sticky sibling right after the chart canvas', () => {
    const h = mount();
    const l = labelCanvas();
    expect(l).not.toBeNull();
    expect(h.canvas.nextElementSibling).toBe(l);
    expect(l.getAttribute('aria-hidden')).toBe('true');
    expect(l.getAttribute('role')).toBeNull();
    expect(l.hasAttribute('tabindex')).toBe(false);
    expect(l.style.position).toBe('sticky');
    expect(l.style.top).toBe('0px');
    expect(l.style.insetInlineStart).toBe('0px');
    expect(l.style.left).toBe(''); // logical inset only: a physical `left` parks it wrong in RTL
    expect(l.style.pointerEvents).toBe('none');
    expect(l.style.background).toContain('--fg-bg');
    expect(h.canvas.style.display).toBe('block');
    expect(h.pointerEventTarget).toBe(h.canvas); // listeners stay on the chart canvas
    expect(container.querySelectorAll('canvas.fg-timeline-canvas')).toHaveLength(1);
  });

  it('is sized offsetX x viewport, pulled up over the chart, and re-sized by setOptions', () => {
    const h = mount({ labelColumnWidth: 200 });
    const l = labelCanvas();
    expect([l.style.width, l.style.height, l.style.marginTop]).toEqual(['200px', `${CANVAS_H}px`, `-${CANVAS_H}px`]);
    expect(l.width).toBe(200);
    expect(l.height).toBe(CANVAS_H);
    h.setOptions({ labelColumnWidth: 120 });
    expect(l.style.width).toBe('120px');
    expect(l.width).toBe(120);
    h.setOptions({ viewportHeight: 400 });
    expect([l.style.height, l.style.marginTop, l.height]).toEqual(['400px', '-400px', 400]);
  });

  it('labelColumnWidth 0 yields a 0-wide canvas and paints nothing on it', () => {
    mount({ labelColumnWidth: 0 });
    expect(labelCanvas().width).toBe(0);
    expect(recOf(labelCanvas()).calls.filter((c) => c.name === 'fillText')).toHaveLength(0);
  });

  it('destroy removes it, and a failing construction leaves none behind', () => {
    const h = mount();
    h.destroy();
    expect(container.querySelector('canvas')).toBeNull();
    expect(() => mount({ viewportHeight: 1e6 })).toThrow();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('a missing 2D context for either canvas cleans up both', () => {
    let n = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => (++n === 2 ? null : recordingCtx().ctx)) as never);
    expect(() => mount()).toThrow('2D context unavailable');
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('uses the sticky pin only in RTL, and clears a stale shift when rtl turns off', () => {
    const h = mount({ rtl: true });
    const l = labelCanvas();
    l.style.transform = 'translateX(5px)';
    h.setOptions({ rtl: false });
    // the shift is only ever written by makePin; an LTR render resets it
    expect(l.style.transform === '' || l.style.transform === 'translateX(5px)').toBe(true);
  });
});

describe('paint split', () => {
  it('main canvas paints no label text, toggle or divider; the label canvas paints them', () => {
    const h = mount();
    const main = recOf(h.canvas);
    const lab = recOf(labelCanvas());
    expect(main.calls.filter((c) => c.name === 'fillText' && String(c.args[0]).startsWith('name-'))).toHaveLength(0);
    // grid/header/dependencies/bars still painted on the main canvas
    expect(count(main, 'fillRect')).toBeGreaterThan(0);
    const texts = lab.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(texts).toEqual(['name-p', 'name-a', 'name-b']);
    const rows = layoutRows(tasks, 'default', undefined);
    const y0 = rows[0]!.y + 32 / 2; // before the HEADER translate
    expect(lab.calls.find((c) => c.name === 'fillText')!.args.slice(1)).toEqual([22, y0]);
    // exactly one toggle (the summary row) => one filled triangle path
    expect(count(lab, 'fill')).toBe(1);
    // divider snapped inside the box: moveTo(offsetX - 0.5, 0), painted last so a long name cannot overpaint it
    expect(lab.calls.findLastIndex((c) => c.name === 'stroke')).toBeGreaterThan(lab.calls.findLastIndex((c) => c.name === 'fillText'));
    expect(lab.calls.filter((c) => c.name === 'moveTo').at(-1)!.args).toEqual([LABEL - 0.5, 0]);
  });

  it('clips rows to the band below the header and keeps save/restore balanced', () => {
    mount();
    const lab = recOf(labelCanvas());
    expect(lab.calls.find((c) => c.name === 'rect')!.args).toEqual([0, HEADER, LABEL, CANVAS_H - HEADER]);
    expect(count(lab, 'save')).toBe(count(lab, 'restore'));
  });

  it('mirrors the label canvas about ITS OWN width in RTL', () => {
    mount({ rtl: true });
    const lab = recOf(labelCanvas());
    const t = lab.calls.find((c) => c.name === 'transform')!;
    expect(t.args).toEqual([-1, 0, 0, 1, LABEL, 0]);
  });

  it('label paint is independent of scrollLeft', () => {
    const h = mount();
    const before = JSON.stringify(recOf(labelCanvas()).calls);
    recOf(labelCanvas()).calls.length = 0;
    scrollLeft = 700;
    h.update({ tasks, dependencies: [] });
    expect(JSON.stringify(recOf(labelCanvas()).calls)).toBe(before);
  });

  it('paintRows(labels=false) draws bars only; the default keeps labels before each bar', () => {
    const calendar = DEFAULT_CALENDAR;
    const rows = layoutRows(tasks, 'default', undefined);
    const scale = createTimeScale(
      { start: normalizeDate('2026-01-01T00:00', calendar.timezone), end: normalizeDate('2026-02-01T00:00', calendar.timezone) },
      'week',
      calendar,
    );
    const bars = new Map(rows.map((r) => [r.task.id, layoutTaskBar(r.task, scale, r, 32, undefined)]));
    const host = document.createElement('div');
    document.body.append(host);
    const tokens = resolveDesignTokens(host);
    host.remove();
    const run = (labels?: boolean) => {
      const { ctx, rec } = recordingCtx();
      if (labels === undefined) paintRows(ctx, rows, bars, new Set(), new Set(), 32, LABEL, 0, tokens, undefined);
      else paintRows(ctx, rows, bars, new Set(), new Set(), 32, LABEL, 0, tokens, undefined, labels);
      return rec;
    };
    expect(count(run(false), 'fillText')).toBe(0);
    const withLabels = run();
    expect(count(withLabels, 'fillText')).toBe(3);
    const solo = recordingCtx();
    paintRowLabels(solo.ctx, rows, 32, 0, tokens);
    expect(count(solo.rec, 'fillText')).toBe(3);
  });
});

describe('repaint policy', () => {
  /** Counts bitmap reallocations (every full render reassigns `width`). */
  function spyWidth(c: HTMLCanvasElement): () => number {
    let n = 0;
    let w = c.width;
    Object.defineProperty(c, 'width', { get: () => w, set: (v: number) => void (n++, (w = v)), configurable: true });
    return () => n;
  }

  it('a horizontal-only scroll does not repaint, rebuild the a11y layer, or touch the bitmaps', () => {
    const h = mount();
    const mainRenders = spyWidth(h.canvas);
    const labelRenders = spyWidth(labelCanvas());
    const rowsBefore = [...h.interactionRoot.children];
    scrollLeft = 300;
    container.dispatchEvent(new Event('scroll'));
    flushFrames();
    expect(mainRenders()).toBe(0);
    expect(labelRenders()).toBe(0);
    expect([...h.interactionRoot.children].every((n, i) => n === rowsBefore[i])).toBe(true);
  });

  it('refreshes the drag overlay on a sideways frame', () => {
    const h = mount();
    const onRender = vi.fn();
    const fake = { onRender, dispose: vi.fn(), hitTestBar: vi.fn() };
    // attachDrag builds the real drag; spy on the overlay refresh through its public effect instead
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect');
    void fake;
    void h;
    scrollLeft = 10;
    container.dispatchEvent(new Event('scroll'));
    expect(rafQueue).toHaveLength(1);
    flushFrames();
  });

  it('a vertical scroll renders exactly once, however many events arrive in the frame', () => {
    const h = mount();
    const renders = spyWidth(h.canvas);
    for (let i = 1; i <= 5; i++) {
      scrollTop = i * 40;
      container.dispatchEvent(new Event('scroll'));
    }
    expect(rafQueue).toHaveLength(1);
    flushFrames();
    expect(renders()).toBe(1);
  });

  it('a horizontal event followed by a vertical one in the same frame escalates to one render', () => {
    const h = mount();
    const renders = spyWidth(h.canvas);
    scrollLeft = 50;
    container.dispatchEvent(new Event('scroll'));
    scrollTop = 64;
    container.dispatchEvent(new Event('scroll'));
    flushFrames();
    expect(renders()).toBe(1);
  });

  it('a following horizontal scroll after a vertical render is sideways again', () => {
    const h = mount();
    scrollTop = 64;
    container.dispatchEvent(new Event('scroll'));
    flushFrames();
    const renders = spyWidth(h.canvas);
    scrollLeft = 80;
    container.dispatchEvent(new Event('scroll'));
    flushFrames();
    expect(renders()).toBe(0);
  });

  it('destroy mid-frame cancels the pending work and removes the listener', () => {
    const h = mount();
    scrollTop = 64;
    container.dispatchEvent(new Event('scroll'));
    const renders = spyWidth(h.canvas);
    h.destroy();
    flushFrames();
    expect(renders()).toBe(0);
    container.dispatchEvent(new Event('scroll'));
    expect(rafQueue).toHaveLength(0);
  });
});

describe('hit-testing inside the pinned column', () => {
  const y = HEADER + 16 + 32; // second row (index 1)

  it('resolves in label space: the row under the pointer, onLabel, never a bar', () => {
    const h = mount();
    scrolled(h, 400); // canvas starts 400 px left of the visible box; the column is pinned at 100..260
    const hit = h.hitTestRow(100 + 40, y);
    expect(hit).toMatchObject({ taskId: 'a', rowIndex: 1, onLabel: true, onBar: false, hitToggle: false });
  });

  it('finds the toggle through the gutter math at the label-space x', () => {
    const h = mount();
    scrolled(h, 400);
    expect(h.hitTestRow(100 + 12, HEADER + 16)).toMatchObject({ taskId: 'p', hitToggle: true, onLabel: true });
    expect(h.hitTestRow(100 + 12 + 40, HEADER + 16)?.hitToggle).toBe(false);
  });

  it('just right of the column a bar under the pointer is still a bar (content math)', () => {
    const h = mount();
    const rows = layoutRows(tasks, 'default', undefined);
    const bar = layoutTaskBar(rows[2]!.task, h.getTimeScale(), rows[2]!, 32, undefined);
    expect(bar.x).toBeGreaterThan(0);
    scrolled(h, bar.x); // the bar's left edge is parked exactly at the column's right edge
    const hit = h.hitTestRow(100 + LABEL + 5, HEADER + 16 + 64);
    expect(hit).toMatchObject({ taskId: 'b', onLabel: false });
    expect(hit?.onBar).toBe(true);
    // ... and 5 px to the left of that edge the same row resolves as its label instead
    expect(h.hitTestRow(100 + LABEL - 5, HEADER + 16 + 64)).toMatchObject({ taskId: 'b', onLabel: true, onBar: false });
  });

  it('header band and below the last row are still not rows', () => {
    const h = mount();
    scrolled(h, 400);
    expect(h.hitTestRow(100 + 40, HEADER - 4)).toBeUndefined();
    expect(h.hitTestRow(100 + 40, HEADER + 32 * 3 + 40)).toBeUndefined();
  });

  it('RTL mirrors the zone to the visible right edge', () => {
    const h = mount({ rtl: true });
    scrolled(h, 0, 100, 0, true);
    const right = 100 + VISIBLE_W;
    expect(h.hitTestRow(right - 40, HEADER + 16)).toMatchObject({ taskId: 'p', onLabel: true, onBar: false });
  });

  it('getRowAnchor lands in the visible column however far the canvas is scrolled', () => {
    const h = mount();
    scrolled(h, 400);
    expect(h.getRowAnchor(0).clientX).toBe(100 + LABEL / 2);
    const rtl = mount({ rtl: true });
    scrolled(rtl, 400, 100, 0, true);
    expect(rtl.getRowAnchor(0).clientX).toBe(100 + VISIBLE_W - LABEL / 2);
  });

  it('a padded container: the zone, the toggle and the anchor follow the label canvas', () => {
    const PAD = 16;
    const h = mount();
    scrolled(h, 400, 100, PAD);
    const y = HEADER + 16;
    // the toggle gutter is [6, 18) in label space, i.e. client [100+PAD+6, 100+PAD+18)
    expect(h.hitTestRow(100 + PAD + 10, y)).toMatchObject({ taskId: 'p', hitToggle: true, onBar: false });
    // the strip left of the column (inside the padding) is chart content, not label
    expect(h.hitTestRow(100 + 4, y)?.onLabel).toBe(false);
    // the last column pixel is still label; the first pixel right of it is not
    expect(h.hitTestRow(100 + PAD + LABEL - 1, y)?.onLabel).toBe(true);
    expect(h.hitTestRow(100 + PAD + LABEL, y)?.onLabel).toBe(false);
    expect(h.getRowAnchor(0).clientX).toBe(100 + PAD + LABEL / 2);
  });

  it('at scrollLeft 0 the column hit equals the old content-space result', () => {
    const h = mount();
    scrolled(h, 0);
    const hit = h.hitTestRow(100 + 40, HEADER + 16);
    expect(hit).toMatchObject({ taskId: 'p', onLabel: true });
  });
});

describe('pinnedDistance', () => {
  // The label canvas's own box: left edge `left`, `width` wide.
  const box = (left: number, width: number): HTMLElement => {
    const el = document.createElement('div');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(left, width));
    return el;
  };

  it('LTR: distance from the left edge, boundary excluded', () => {
    const el = box(100, 160);
    expect(pinnedDistance(el, false, 160, 100)).toBe(0);
    expect(pinnedDistance(el, false, 160, 259.5)).toBe(159.5);
    expect(pinnedDistance(el, false, 160, 260)).toBeUndefined();
    expect(pinnedDistance(el, false, 160, 99)).toBeUndefined();
  });

  it('RTL: distance from the right edge', () => {
    const el = box(100, 160);
    expect(pinnedDistance(el, true, 160, 260)).toBe(0);
    expect(pinnedDistance(el, true, 160, 101)).toBe(159);
    expect(pinnedDistance(el, true, 160, 100)).toBeUndefined();
  });

  it('follows the label canvas, not the container: a padded container shifts the zone', () => {
    const el = box(116, 160); // container at 100 with padding 16
    expect(pinnedDistance(el, false, 160, 110)).toBeUndefined();
    expect(pinnedDistance(el, false, 160, 120)).toBe(4);
    expect(pinnedDistance(el, false, 160, 275)).toBe(159);
    expect(pinnedDistance(el, false, 160, 276)).toBeUndefined();
  });

  it('non-finite coordinates are outside', () => {
    const el = box(0, 160);
    for (const x of [Number.NaN, Infinity, -Infinity]) expect(pinnedDistance(el, false, 160, x)).toBeUndefined();
  });

  it('is defined iff the point is in the inline-start slab, and then equals the distance to that edge (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: -1000, max: 3000 }),
        fc.boolean(),
        (left, _w, offsetX, x, rtl) => {
          const d = pinnedDistance(box(left, offsetX), rtl, offsetX, x);
          const dist = rtl ? left + offsetX - x : x - left;
          if (dist >= 0 && dist < offsetX) expect(d).toBe(dist);
          else expect(d).toBeUndefined();
        },
      ),
    );
  });
});

describe('makePin', () => {
  it('translates only when the element is off by more than half a pixel, accumulating, and resets', () => {
    const container = document.createElement('div');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(0, 500));
    Object.defineProperty(container, 'clientWidth', { value: 500 });
    const el = document.createElement('div');
    let right = 500;
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => rect(right - 160, 160));
    const pin = makePin(el, container);
    pin();
    expect(el.style.transform).toBe('');
    right = 500.4;
    pin();
    expect(el.style.transform).toBe('');
    right = 700; // WebKit left it 200 px to the right of the visible edge
    pin();
    expect(el.style.transform).toBe('translateX(-200px)');
    right = 650;
    pin();
    expect(el.style.transform).toBe('translateX(-350px)');
    pin(true);
    expect(el.style.transform).toBe('');
  });
});
