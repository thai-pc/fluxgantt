// @vitest-environment jsdom
//
// The seams the grid-columns mixins build on (spec-grid-columns.md, PR G0): the multi-consumer
// `handle.paintHooks` on the SVG renderer, `handle.fixedLabelWidth` versus `withResponsive`, and
// `internal.announce` (the `withInteraction` live region reused by other mixins). Nothing here
// needs a grid; the seams are exercised directly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withResponsive } from '../../src/responsive/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import { toTaskId } from '../../src/types.js';
import type { SvgRendererHandle, PaintEvent } from '../../src/render/svg-renderer.js';
import type { TaskInput } from '../../src/store/index.js';

const t = (id: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: toTaskId(id),
  name: id,
  start: '2026-01-05',
  end: '2026-01-09',
  progress: 0,
  type: 'task',
  ...extra,
});
const TASKS = [t('a'), t('b'), t('c')];

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

const svgHandle = (g: ReturnType<typeof withRender>): SvgRendererHandle => {
  const h = getInternal(g).mountOf()!.handle;
  if (!('paintHooks' in h)) throw new Error('expected the SVG renderer');
  return h;
};
const mount = () => {
  const g = withInteraction(withRender(createGantt({ tasks: TASKS })));
  g.mount(container);
  return g;
};

describe('SvgRendererHandle.paintHooks', () => {
  it('calls every consumer, in array order, after a full render', () => {
    const g = mount();
    const h = svgHandle(g);
    const order: string[] = [];
    h.paintHooks.push(() => order.push('first'), () => order.push('second'));
    h.setOptions({});
    expect(order).toEqual(['first', 'second']);
    h.paintHooks.unshift(() => order.push('zeroth'));
    order.length = 0;
    h.setOptions({});
    expect(order).toEqual(['zeroth', 'first', 'second']);
  });

  it('a full render passes all four pinned roots and no rows', () => {
    const g = mount();
    const h = svgHandle(g);
    let seen: PaintEvent | undefined;
    h.paintHooks.push((e) => (seen = e));
    h.setOptions({});
    expect(seen!.svg).toBe(h.svg);
    expect(seen!.overlay).toBe(container.querySelector('.fg-timeline__sticky-header'));
    expect(seen!.column).toBe(container.querySelector('.fg-timeline__sticky-column'));
    expect(seen!.corner).toBe(container.querySelector('.fg-timeline__sticky-corner'));
    expect(seen!.rows).toBeUndefined();
  });

  it('a selection patch reports exactly the rebuilt rows (live nodes, in the chart)', () => {
    const g = mount();
    const h = svgHandle(g);
    const events: PaintEvent[] = [];
    h.paintHooks.push((e) => events.push(e));
    g.select(toTaskId('b'));
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.overlay).toBeUndefined();
    expect(e.column).toBeUndefined();
    expect(e.rows).toHaveLength(1); // only b's painted selection state changed
    const rows = [...h.svg.querySelectorAll('.fg-timeline__row')];
    for (const r of e.rows!) expect(rows).toContain(r);
    expect(e.rows![0]!.getAttribute('aria-selected')).toBe('true');
    expect(e.rows![0]!.getAttribute('data-task-id')).toBe('b');
  });

  it('a patch that changes no row reports an empty list', () => {
    const g = mount();
    const h = svgHandle(g);
    g.select(toTaskId('b'));
    const events: PaintEvent[] = [];
    h.paintHooks.push((e) => events.push(e));
    g.select(toTaskId('b'));
    for (const e of events) expect(e.rows ?? []).toHaveLength(0);
  });

  it('a hook removed from the array is no longer called', () => {
    const g = mount();
    const h = svgHandle(g);
    const hook = vi.fn();
    h.paintHooks.push(hook);
    h.setOptions({});
    hook.mockClear();
    h.paintHooks.splice(h.paintHooks.indexOf(hook), 1);
    h.setOptions({});
    expect(hook).not.toHaveBeenCalled();
  });

  it('each mount has its own (empty) list and a destroyed renderer paints nothing', () => {
    const g = mount();
    const first = svgHandle(g);
    const hook = vi.fn();
    first.paintHooks.push(hook);
    g.unmount();
    hook.mockClear();
    first.setOptions({});
    expect(hook).not.toHaveBeenCalled();
    g.mount(container);
    expect(svgHandle(g).paintHooks).toHaveLength(0);
  });
});

describe('withRtl through paintHooks', () => {
  it('registers one hook and still mirrors after a selection patch', () => {
    const g = withRtl(withInteraction(withRender(createGantt({ tasks: TASKS, rtl: true }))));
    g.mount(container);
    const h = svgHandle(g);
    expect(h.paintHooks).toHaveLength(1);
    const before = h.svg.querySelectorAll('g.fg-rtl').length;
    expect(before).toBeGreaterThan(0);
    const column = container.querySelector('.fg-timeline__sticky-column')!;
    expect(column.querySelector(':scope > g.fg-rtl')).not.toBeNull();
    g.select(toTaskId('b'));
    expect(h.svg.querySelectorAll('g.fg-rtl').length).toBe(before);
    // The rebuilt rows sit inside the mirror group, not beside it.
    const row = h.svg.querySelector('.fg-timeline__row[aria-selected="true"]')!;
    expect(row.closest('g.fg-rtl')).not.toBeNull();
  });

  it('a second consumer added by another mixin runs alongside the mirror hook', () => {
    const g = withRtl(withRender(createGantt({ tasks: TASKS, rtl: true })));
    g.mount(container);
    const h = svgHandle(g);
    const other = vi.fn();
    h.paintHooks.push(other);
    h.setOptions({});
    expect(other).toHaveBeenCalledTimes(1);
    expect(h.svg.querySelector('g.fg-rtl')).not.toBeNull();
  });
});

describe('handle.fixedLabelWidth versus withResponsive', () => {
  function stubs(width: number): { fire(): void } {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, media: '', addEventListener() {}, removeEventListener() {} })));
    const cbs: Array<() => void> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { cbs.push(cb); }
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    });
    Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
    return { fire: () => cbs.forEach((c) => c()) };
  }

  it('without the flag, responsive narrows the column on a small container', () => {
    stubs(393);
    const g = withResponsive(withRender(createGantt({ tasks: TASKS })));
    g.mount(container);
    expect(svgHandle(g).getLabelColumnWidth()).toBeLessThan(160);
  });

  it('with the flag set before the first measure, the column keeps the width the owner gave it', () => {
    const ro = stubs(393);
    const g = withRender(createGantt({ tasks: TASKS }));
    // A grid-like owner: sets the flag as soon as the handle exists.
    g.on('renderer:selected', () => {
      svgHandle(g).fixedLabelWidth = true;
    });
    withResponsive(g);
    g.mount(container);
    expect(svgHandle(g).getLabelColumnWidth()).toBe(160);
    ro.fire();
    expect(svgHandle(g).getLabelColumnWidth()).toBe(160);
  });

  it('setting the flag after responsive narrowed the column stops further writes', () => {
    const ro = stubs(393);
    const g = withResponsive(withRender(createGantt({ tasks: TASKS })));
    g.mount(container);
    const narrow = svgHandle(g).getLabelColumnWidth();
    svgHandle(g).fixedLabelWidth = true;
    Object.defineProperty(container, 'clientWidth', { value: 1440, configurable: true });
    ro.fire();
    expect(svgHandle(g).getLabelColumnWidth()).toBe(narrow);
  });
});

describe('internal.announce', () => {
  const live = (): HTMLElement => container.querySelector('[aria-live="polite"]')!;

  it('is undefined without withInteraction and while unmounted', () => {
    const plain = withRender(createGantt({ tasks: TASKS }));
    plain.mount(container);
    expect(getInternal(plain).announce).toBeUndefined();
    const g = withInteraction(withRender(createGantt({ tasks: TASKS })));
    expect(getInternal(g).announce).toBeUndefined();
  });

  it('writes plain text into the one polite region, alternating a no-break space', () => {
    const g = mount();
    const say = getInternal(g).announce!;
    say('Column resized <b>x</b>');
    expect(live().textContent).toBe('Column resized <b>x</b> ');
    expect(live().querySelector('b')).toBeNull();
    say('Column resized <b>x</b>');
    expect(live().textContent).toBe('Column resized <b>x</b>');
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it('caps the length and is cleared when the mount is torn down', () => {
    const g = mount();
    getInternal(g).announce!('x'.repeat(1000));
    expect(live().textContent!.length).toBeLessThanOrEqual(401);
    g.unmount();
    expect(getInternal(g).announce).toBeUndefined();
    g.mount(container);
    expect(getInternal(g).announce).toBeTypeOf('function');
  });

  it('the built-in keyboard announcements land in the same region the writer feeds', () => {
    const g = mount();
    g.select(toTaskId('a'));
    const row = container.querySelector<SVGElement>('[data-task-id="a"][role=row]')!;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    expect(live().textContent).toContain('a');
    expect(live().textContent).toContain('moved');
  });
});

describe('internal.announce survives an unmount during the gesture (review H1)', () => {
  it('unmounting from a task:moved listener does not make Alt+Arrow throw', () => {
    const g = mount();
    g.on('task:moved', () => g.unmount());
    g.select(toTaskId('a'));
    const row = container.querySelector<SVGElement>('[data-task-id="a"][role=row]')!;
    expect(() =>
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true })),
    ).not.toThrow();
    expect(getInternal(g).announce).toBeUndefined();
  });
});
