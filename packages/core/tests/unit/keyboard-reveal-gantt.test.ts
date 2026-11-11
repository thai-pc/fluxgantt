// @vitest-environment jsdom
//
// `g` (go to bar) through a full instance (spec-keyboard-horizontal-reveal.md §7): the key is
// delegated to `scrollToTask`, so it needs `withViewport`; arrows never scroll horizontally.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withViewport } from '../../src/viewport/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const LABEL_W = 160;
const task = (id: string, start: string, end: string, type: 'task' | 'milestone' = 'task'): TaskInput => ({
  id: toTaskId(id),
  name: id,
  start,
  end,
  progress: 0,
  type,
});
const TASKS = [
  task('near', '2026-01-05', '2026-01-09'),
  task('far', '2026-06-01', '2026-06-03'),
  task('ms', '2026-07-01', '2026-07-01', 'milestone'),
  task('wide', '2026-02-01', '2026-12-01'),
];

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => container.remove());

function stub(el: HTMLElement, w: number, left = 0) {
  let sl = left;
  const writes: number[] = [];
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
  Object.defineProperty(el, 'scrollTop', { get: () => 0, set: () => undefined, configurable: true });
  Object.defineProperty(el, 'scrollLeft', {
    get: () => sl,
    set: (v: number) => {
      writes.push(v);
      sl = v;
    },
    configurable: true,
  });
  return { left: () => sl, writes, set: (v: number) => (sl = v) };
}

const row = (id: string) => container.querySelector(`.fg-timeline__row[data-task-id="${id}"]`) as SVGElement;
function press(id: string, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  row(id).dispatchEvent(ev);
  return ev;
}
function focus(id: string): void {
  row(id).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

type Order = 'viewport-first' | 'interaction-first';
function chart(order: Order, config: Record<string, unknown> = {}) {
  const base = withRender(createGantt({ tasks: TASKS, viewMode: 'day', ...config }));
  return order === 'viewport-first'
    ? withInteraction(withViewport(base))
    : withViewport(withInteraction(base));
}

describe.each<Order>(['viewport-first', 'interaction-first'])('g with withViewport (%s)', (order) => {
  it('scrolls a far-right bar into view beside the pinned label column, prevented', () => {
    const g = chart(order);
    g.mount(container);
    const s = stub(container, 800);
    focus('far');
    const scale = getInternal(g).mountOf()!.handle.getTimeScale();
    const ev = press('far', 'g');
    expect(ev.defaultPrevented).toBe(true);
    expect(s.left()).toBe(LABEL_W + scale.dateToX('2026-06-03') - 800);
    expect(s.left()).toBeGreaterThan(0);
  });

  it('leaves a bar that is already visible alone', () => {
    const g = chart(order);
    g.mount(container);
    const s = stub(container, 800);
    focus('near');
    press('near', 'g');
    expect(s.left()).toBe(0);
  });

  it('aligns the START of a bar wider than the viewport', () => {
    const g = chart(order);
    g.mount(container);
    const s = stub(container, 400);
    focus('wide');
    const scale = getInternal(g).mountOf()!.handle.getTimeScale();
    press('wide', 'g');
    expect(s.left()).toBe(scale.dateToX('2026-02-01'));
  });

  it('matches scrollToTask exactly for a milestone (half-diagonal padding)', () => {
    const g = chart(order);
    g.mount(container);
    const s = stub(container, 800);
    focus('ms');
    press('ms', 'g');
    const viaKey = s.left();
    s.set(0);
    g.scrollToTask(toTaskId('ms'));
    expect(viaKey).toBe(s.left());
    expect(viaKey).toBeGreaterThan(0);
  });

  it('uses live geometry after a zoom change', () => {
    const g = chart(order);
    g.mount(container);
    const s = stub(container, 800);
    focus('far');
    press('far', 'g');
    const day = s.left();
    g.zoomTo('week');
    s.set(0);
    stub(container, 800);
    focus('far');
    press('far', 'g');
    expect(s.left()).not.toBe(day);
  });

  it('RTL: negative scrollLeft mirroring the LTR offset', () => {
    const ltr = chart(order);
    ltr.mount(container);
    const l = stub(container, 800);
    focus('far');
    press('far', 'g');
    const want = l.left();
    ltr.destroy();
    container.replaceChildren();

    const rtl = withRtl(chart(order, { rtl: true }));
    rtl.mount(container);
    const r = stub(container, 800);
    focus('far');
    press('far', 'g');
    expect(r.left()).toBeLessThan(0);
    expect(Math.abs(r.left())).toBe(want);
  });

  it('reduced motion: scrollTo is never asked to smooth-scroll', () => {
    const g = chart(order);
    g.mount(container);
    stub(container, 800);
    const calls: unknown[] = [];
    (container as unknown as { scrollTo: (o: unknown) => void }).scrollTo = (o) => calls.push(o);
    focus('far');
    press('far', 'g');
    expect(JSON.stringify(calls)).not.toContain('smooth');
  });

  it('ArrowUp/ArrowDown never write scrollLeft', () => {
    const g = chart(order);
    g.mount(container);
    const s = stub(container, 800);
    focus('near');
    press('near', 'ArrowDown');
    press('far', 'ArrowDown');
    press('ms', 'ArrowUp');
    expect(s.writes).toEqual([]);
  });
});

describe('g without withViewport', () => {
  it('does not throw, scroll or prevent the event', () => {
    const g = withInteraction(withRender(createGantt({ tasks: TASKS, viewMode: 'day' })));
    g.mount(container);
    const s = stub(container, 800);
    focus('far');
    let ev!: KeyboardEvent;
    expect(() => (ev = press('far', 'g'))).not.toThrow();
    expect(ev.defaultPrevented).toBe(false);
    expect(s.writes).toEqual([]);
  });
});

describe('Home / End on a full instance', () => {
  it('move row focus and selection', () => {
    const g = chart('viewport-first');
    g.mount(container);
    stub(container, 800);
    focus('far');
    press('far', 'End');
    expect(g.getSelection()).toEqual([toTaskId('wide')]);
    press('wide', 'Home');
    expect(g.getSelection()).toEqual([toTaskId('near')]);
  });
});
