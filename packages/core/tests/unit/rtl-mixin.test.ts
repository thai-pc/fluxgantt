// @vitest-environment jsdom
//
// `withRtl()` over the SVG renderer (spec-rtl-chart.md sections 5, 7, 8; AC1-AC5, AC12). jsdom has
// no layout engine, so container geometry is stubbed with `defineProperty` (as viewport-dom.test.ts
// does) and `getBoundingClientRect()` stays all-zero, which makes the interaction layer's
// client-to-user scale fall back to 1 and its left to 0.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../../src/gantt.js';
import type { GanttConfig } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withViewport } from '../../src/viewport/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { DEFAULT_CALENDAR } from '../../src/compute/working-calendar.js';
import { getInternal } from '../../src/gantt-internal.js';
import { toTaskId, type Task } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const LABEL_W = 160;

const task = (id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: toTaskId(id),
  name: id,
  start,
  end,
  progress: 0,
  type: 'task',
  ...extra,
});
const TASKS: readonly TaskInput[] = [
  task('a', '2026-01-05T09:00', '2026-01-09T09:00'),
  task('b', '2026-01-12T09:00', '2026-01-16T09:00'),
];

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

function chart(config: GanttConfig = {}, apply = true) {
  const base = withViewport(withInteraction(withRender(createGantt({ tasks: TASKS, ...config }))));
  return apply ? withRtl(base) : base;
}
const mirrorGroup = (root: Element): Element | null => root.querySelector(':scope > g.fg-rtl');
const overlay = (): SVGSVGElement => container.querySelector('.fg-timeline__sticky-header')!;
const chartSvg = (): SVGSVGElement => container.querySelector('svg.fg-timeline')!;

describe('withRtl is inert unless config.rtl === true (AC1)', () => {
  it.each([[{}], [{ rtl: false }]])('config %j: byte-identical DOM to a chart without the mixin, dir untouched', (cfg) => {
    const plain = chart(cfg, false);
    plain.mount(container);
    const expected = container.innerHTML;
    plain.destroy();

    container.replaceChildren();
    const inert = chart(cfg);
    inert.mount(container);
    expect(container.innerHTML).toBe(expected);
    expect(container.hasAttribute('dir')).toBe(false);
    expect(mirrorGroup(chartSvg())).toBeNull();
  });

  it('registers no listener and writes no mirrorX', () => {
    const g = chart({ rtl: false }, false);
    const on = vi.spyOn(g, 'on');
    withRtl(g);
    expect(on).not.toHaveBeenCalled();
    g.mount(container);
    const handle = getInternal(g).mountOf()!.handle;
    expect(handle.mirrorX).toBeUndefined();
  });
});

describe('withRtl mounts a mirrored chart (AC1-AC3)', () => {
  it('sets dir=rtl on the container and mirrors both the chart svg and the sticky overlay', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    expect(container.getAttribute('dir')).toBe('rtl');
    const handle = getInternal(g).mountOf()!.handle;
    const width = LABEL_W + handle.getTimeScale().totalWidth;
    for (const root of [chartSvg(), overlay()]) {
      const group = mirrorGroup(root)!;
      expect(group.getAttribute('transform')).toBe(`matrix(-1 0 0 1 ${width} 0)`);
      expect(root.children).toHaveLength(1); // everything lives inside the group
    }
    // Header labels and row labels are counter-flipped, nothing else is.
    for (const t of chartSvg().querySelectorAll('text')) expect(t.getAttribute('transform')).toMatch(/^matrix\(-1 0 0 1 /);
  });

  it('keeps the grid structure and ARIA semantics (the group is transparent to AT)', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    const svg = chartSvg();
    expect(svg.getAttribute('role')).toBe('grid');
    expect(svg.querySelectorAll('[role="row"]')).toHaveLength(2);
    expect(svg.querySelector('.fg-rtl')!.hasAttribute('role')).toBe(false);
    expect(svg.querySelectorAll('.fg-task[data-task-id]')).toHaveLength(2);
  });

  it('survives a repaint without double-wrapping (re-render, store mutation)', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    g.addTask(task('c', '2026-01-19', '2026-01-21'));
    g.refresh();
    expect(chartSvg().querySelectorAll('g.fg-rtl')).toHaveLength(1);
    expect(chartSvg().querySelectorAll('.fg-task[data-task-id]')).toHaveLength(3);
  });

  it('restores an absent dir on destroy, and a prior dir value, and is idempotent', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    g.destroy();
    g.destroy();
    expect(container.hasAttribute('dir')).toBe(false);

    container.setAttribute('dir', 'ltr');
    const g2 = chart({ rtl: true });
    g2.mount(container);
    expect(container.getAttribute('dir')).toBe('rtl');
    g2.unmount();
    expect(container.getAttribute('dir')).toBe('ltr');
    g2.unmount(); // idempotent
    expect(container.getAttribute('dir')).toBe('ltr');
  });

  it('re-applies on remount and restores on every teardown', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    g.mount(container); // implicit remount: previous handle destroyed first
    expect(container.getAttribute('dir')).toBe('rtl');
    expect(chartSvg().querySelectorAll('g.fg-rtl')).toHaveLength(1);
    g.unmount();
    expect(container.hasAttribute('dir')).toBe(false);
    g.mount(container);
    expect(container.getAttribute('dir')).toBe('rtl');
  });

  it('applies regardless of mixin application order', () => {
    const g = withInteraction(withRender(withRtl(createGantt({ tasks: TASKS, rtl: true }))));
    g.mount(container);
    expect(mirrorGroup(chartSvg())).not.toBeNull();
  });
});

describe('handle.mirrorX (spec section 2)', () => {
  it('is W - x with W = label column + timeline width, and an involution (property)', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    const handle = getInternal(g).mountOf()!.handle;
    const W = handle.getLabelColumnWidth() + handle.getTimeScale().totalWidth;
    expect(handle.mirrorX!(0)).toBe(W);
    expect(handle.mirrorX!(W)).toBe(0);
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (x) => {
        expect(handle.mirrorX!(handle.mirrorX!(x))).toBeCloseTo(x, 6);
      }),
    );
  });

  it('reverses chronological order: a task that starts earlier is painted further right (AC1, property)', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    const handle = getInternal(g).mountOf()!.handle;
    const scale = handle.getTimeScale();
    const days = (n: number): string => scale.range.start.add({ days: n }).toPlainDate().toString();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 1, max: 40 }), (d, gap) => {
        const xa = handle.mirrorX!(LABEL_W + scale.dateToX(days(d)));
        const xb = handle.mirrorX!(LABEL_W + scale.dateToX(days(d + gap)));
        expect(xa).toBeGreaterThan(xb);
      }),
    );
  });

  it('follows the label column width live (withResponsive narrows it at runtime)', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    const handle = getInternal(g).mountOf()!.handle;
    handle.setOptions({ labelColumnWidth: 80 });
    const W = 80 + handle.getTimeScale().totalWidth;
    expect(handle.mirrorX!(10)).toBe(W - 10);
    expect(mirrorGroup(chartSvg())!.getAttribute('transform')).toBe(`matrix(-1 0 0 1 ${W} 0)`);
  });
});

describe('logical-scroll zoom anchor (spec section 8.2)', () => {
  function stubScroll(el: HTMLElement, clientWidth: number, scrollLeft: number): { get(): number } {
    let sl = scrollLeft;
    Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { get: () => sl, set: (v: number) => void (sl = v), configurable: true });
    return { get: () => sl };
  }

  it('lands at the mirrored scroll offset of the LTR result (sign flipped, magnitude equal)', () => {
    const cfg = { tasks: [task('a', '2026-01-05', '2026-03-30')] };
    const ltr = withRender(createGantt(cfg));
    ltr.mount(container);
    const ltrScroll = stubScroll(container, 400, 300);
    ltr.zoomTo('day');
    const expected = ltrScroll.get();
    ltr.destroy();
    container.replaceChildren();

    const rtl = withRtl(withRender(createGantt({ ...cfg, rtl: true })));
    rtl.mount(container);
    const rtlScroll = stubScroll(container, 400, -300);
    rtl.zoomTo('day');
    expect(expected).not.toBe(0);
    expect(rtlScroll.get()).toBe(-expected);
  });

  it('clamps to 0 (never a positive scrollLeft) when the anchor is left of the viewport start', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    const scroll = stubScroll(container, 100000, 0);
    g.zoomTo('day');
    expect(scroll.get() <= 0).toBe(true);
  });
});

describe('scrollToTask / scrollToDate under a negative scrollLeft (AC4)', () => {
  function stub(el: HTMLElement, clientWidth: number, scrollLeft: number): { get(): number } {
    let sl = scrollLeft;
    Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(el, 'scrollTop', { get: () => 0, set: () => undefined, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { get: () => sl, set: (v: number) => void (sl = v), configurable: true });
    return { get: () => sl };
  }
  const many = (): TaskInput[] =>
    Array.from({ length: 10 }, (_, i) => task(`t${i}`, `2026-0${1 + (i % 6)}-05`, `2026-0${1 + (i % 6)}-09`));

  it.each(['start', 'center', 'end', 'nearest'] as const)(
    'align %s: the RTL scroll offset is the negation of the LTR one at the mirrored start',
    (align) => {
      for (const id of ['t0', 't3', 't5']) {
        const ltr = withViewport(withRender(createGantt({ tasks: many() })));
        ltr.mount(container);
        const l = stub(container, 500, 0);
        ltr.scrollToTask(toTaskId(id), { align });
        const want = l.get();
        ltr.destroy();
        container.replaceChildren();

        const rtl = withViewport(withRtl(withRender(createGantt({ tasks: many(), rtl: true }))));
        rtl.mount(container);
        const r = stub(container, 500, 0);
        rtl.scrollToTask(toTaskId(id), { align });
        expect(Math.abs(r.get())).toBe(want);
        expect(r.get() <= 0).toBe(true);
        rtl.destroy();
        container.replaceChildren();
      }
    },
  );

  it('scrollToDate writes a non-positive value and reads the logical offset', () => {
    const g = chart({ rtl: true, tasks: many() });
    g.mount(container);
    const s = stub(container, 500, -200);
    g.scrollToDate('2026-03-01', { align: 'start' });
    const scale = getInternal(g).mountOf()!.handle.getTimeScale();
    expect(s.get()).toBe(-Math.max(0, LABEL_W + scale.dateToX('2026-03-01')));
  });
});

describe('interaction through the real coordinator (AC5, AC12)', () => {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId: number }) {
      super(type, init);
      this.pointerId = init.pointerId;
    }
  }
  const PE: typeof PointerEvent =
    (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ?? (PointerEventPolyfill as unknown as typeof PointerEvent);
  const fire = (target: EventTarget, type: string, x: number, y = 50, bubbles = false): void => {
    target.dispatchEvent(new PE(type, { pointerId: 1, clientX: x, clientY: y, bubbles, cancelable: true }));
  };
  const geometry = (id: string): { x: number; width: number } => {
    const bar = container.querySelector(`.fg-task[data-task-id="${id}"] .fg-task__bar`)!;
    return { x: Number(bar.getAttribute('x')), width: Number(bar.getAttribute('width')) };
  };

  it('dragging a bar visually LEFT moves it LATER, visually RIGHT moves it EARLIER (24 px/day)', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    const moved = vi.fn();
    g.on('task:moved', moved);
    const grp = container.querySelector('.fg-task[data-task-id="a"]')!;
    const before = g.getTask(toTaskId('a'))!;

    fire(grp, 'pointerdown', 300, 50, true);
    fire(window, 'pointermove', 300 - 48);
    fire(window, 'pointerup', 300 - 48);
    const later = g.getTask(toTaskId('a'))!;
    expect(later.start.toString() > before.start.toString()).toBe(true);
    expect(moved).toHaveBeenCalledTimes(1);

    // The commit repainted the chart: the old group is detached, so look it up again.
    fire(container.querySelector('.fg-task[data-task-id="a"]')!, 'pointerdown', 300, 50, true);
    fire(window, 'pointermove', 300 + 96);
    fire(window, 'pointerup', 300 + 96);
    const earlier = g.getTask(toTaskId('a'))!;
    expect(earlier.start.toString() < before.start.toString()).toBe(true);
  });

  it('the LTR twin moves the opposite way for the same pointer delta', () => {
    const g = chart({});
    g.mount(container);
    const grp = container.querySelector('.fg-task[data-task-id="a"]')!;
    const before = g.getTask(toTaskId('a'))!;
    fire(grp, 'pointerdown', 300, 50, true);
    fire(window, 'pointermove', 300 - 48);
    fire(window, 'pointerup', 300 - 48);
    expect(g.getTask(toTaskId('a'))!.start.toString() < before.start.toString()).toBe(true);
  });

  it('resize grabs the END edge at its mirrored (visually left) position and edits end only', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    const handle = getInternal(g).mountOf()!.handle;
    const grp = container.querySelector('.fg-task[data-task-id="a"]')!;
    const before = g.getTask(toTaskId('a'))!;
    const { x, width } = geometry('a');
    const visualEnd = handle.mirrorX!(x + width);
    const visualStart = handle.mirrorX!(x);
    expect(visualEnd).toBeLessThan(visualStart); // the end edge is the visually-left edge

    // A press at the visually RIGHT edge (the start) must NOT resize: it moves.
    fire(grp, 'pointerdown', visualStart, 50, true);
    fire(window, 'pointermove', visualStart - 48);
    fire(window, 'pointerup', visualStart - 48);
    const moved = g.getTask(toTaskId('a'))!;
    expect(moved.start.toString()).not.toBe(before.start.toString());

    // A press at the visually LEFT edge resizes: start stays, end grows when dragged further left.
    const mid = g.getTask(toTaskId('a'))!;
    const geo = geometry('a');
    const edge = handle.mirrorX!(geo.x + geo.width);
    fire(container.querySelector('.fg-task[data-task-id="a"]')!, 'pointerdown', edge, 50, true);
    fire(window, 'pointermove', edge - 48);
    fire(window, 'pointerup', edge - 48);
    const resized = g.getTask(toTaskId('a'))!;
    expect(resized.start.toString()).toBe(mid.start.toString());
    expect(resized.end.toString() > mid.end.toString()).toBe(true);
  });

  it.each(['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'])(
    'a drag across the spring-forward day commits the same dates in LTR and RTL (%s)',
    (timezone) => {
      const calendar = { ...DEFAULT_CALENDAR, timezone };
      const cfg = { calendar, tasks: [task('a', '2026-03-05T09:00', '2026-03-06T17:00')] };
      const commit = (rtl: boolean, dxVisual: number): Task => {
        container.replaceChildren();
        const g = chart({ ...cfg, ...(rtl ? { rtl: true } : {}) });
        g.mount(container);
        const grp = container.querySelector('.fg-task[data-task-id="a"]')!;
        fire(grp, 'pointerdown', 300, 50, true);
        fire(window, 'pointermove', 300 + dxVisual);
        fire(window, 'pointerup', 300 + dxVisual);
        const out = g.getTask(toTaskId('a'))!;
        g.destroy();
        return out;
      };
      // +5 days later (24 px/day): LTR moves the pointer right, RTL moves it equally far left.
      const ltr = commit(false, 5 * 24);
      const rtl = commit(true, -5 * 24);
      expect(rtl.start.toString()).toBe(ltr.start.toString());
      expect(rtl.end.toString()).toBe(ltr.end.toString());
      expect(rtl.start.toString().startsWith('2026-03-10')).toBe(true);
    },
  );

  it('a link drag from the START handle (visually right) starts at the mirrored origin and creates the right edge', () => {
    const g = chart({ rtl: true });
    g.mount(container);
    const handle = getInternal(g).mountOf()!.handle;
    const added = vi.fn();
    g.on('dependency:added', added);
    const aGrp = container.querySelector('.fg-task[data-task-id="a"]')!;
    const bGrp = container.querySelector('.fg-task[data-task-id="b"]')!;
    const startHandle = aGrp.querySelector('.fg-task__link-handle[data-handle-end="start"]')!;
    const cx = Number(startHandle.getAttribute('cx'));

    fire(startHandle, 'pointerdown', handle.mirrorX!(cx), 50, true);
    fire(window, 'pointermove', handle.mirrorX!(cx) + 40, 90);
    const preview = chartSvg().querySelector('.fg-dependency-preview')!;
    // origin is expressed in root user space = visual space, i.e. mirrored from the layout cx
    expect(preview.getAttribute('d')!.startsWith(`M ${handle.mirrorX!(cx)} `)).toBe(true);
    expect(preview.parentElement).toBe(chartSvg()); // appended to the root, outside the mirror group
    // drop onto b (jsdom elementFromPoint is not used: the drop target is the event target)
    bGrp.dispatchEvent(new PE('pointerup', { pointerId: 1, clientX: 10, clientY: 90, bubbles: true, cancelable: true }));
    fire(window, 'pointerup', 10, 90);
    expect(added).toHaveBeenCalledTimes(1);
    // START handle of a: a becomes the SUCCESSOR of b (drop -> owner), whatever the direction
    const dep = g.getDependencies().at(-1)!;
    expect([dep.from, dep.to]).toEqual([toTaskId('b'), toTaskId('a')]);
  });
});
