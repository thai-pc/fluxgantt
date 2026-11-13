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

  it('a destroyed renderer paints nothing; a composition-time hook survives a remount', () => {
    const g = mount();
    const first = svgHandle(g);
    const late = vi.fn();
    first.paintHooks.push(late);
    const early = vi.fn();
    (getInternal(g).paints ??= []).push(early);
    g.unmount();
    late.mockClear();
    early.mockClear();
    first.setOptions({});
    expect(late).not.toHaveBeenCalled();
    g.mount(container);
    expect(early).toHaveBeenCalled(); // registered on the instance: sees the new mount's first paint
  });

  it('a hook registered at composition time sees the mount paint', () => {
    const g = withRender(createGantt({ tasks: TASKS }));
    const seen: PaintEvent[] = [];
    (getInternal(g).paints ??= []).push((e) => seen.push(e));
    g.mount(container);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]!.column).toBeDefined();
  });

  it('a throwing hook is reported, the others still run, and the renderer stays patchable', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = withInteraction(withRender(createGantt({ tasks: TASKS })));
    const after = vi.fn();
    getInternal(g).paints = [
      () => {
        throw new Error('boom');
      },
      after,
    ];
    g.mount(container);
    expect(err).toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
    after.mockClear();
    g.select(toTaskId('b')); // patch path: still dispatches
    expect(after.mock.calls.at(-1)![0].rows).toBeDefined();
    err.mockRestore();
  });

  it('dispatch runs over a snapshot: a hook removing itself does not skip the next one', () => {
    const g = mount();
    const h = svgHandle(g);
    const next = vi.fn();
    const self = (): void => {
      h.paintHooks.splice(h.paintHooks.indexOf(self), 1);
    };
    h.paintHooks.push(self, next);
    h.setOptions({});
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('withRtl through paintHooks', () => {
  it('registers one hook and still mirrors after a selection patch', () => {
    const g = withRtl(withInteraction(withRender(createGantt({ tasks: TASKS, rtl: true }))));
    g.mount(container);
    const h = svgHandle(g);
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

  const probe = (e: PaintEvent): void => {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('class', 'probe');
    if (e.column && !e.column.querySelector('.probe')) e.column.append(t);
  };
  it.each([['before withRtl'], ['after withRtl']])('content a hook adds to the column is mirrored (hook composed %s)', (when) => {
    const base = withRender(createGantt({ tasks: TASKS, rtl: true }));
    if (when === 'before withRtl') (getInternal(base).paints ??= []).push(probe);
    const g = withRtl(base);
    if (when === 'after withRtl') (getInternal(g).paints ??= []).push(probe);
    g.mount(container); // no extra repaint is needed: the mount paint already ran both
    const p = container.querySelector('.fg-timeline__sticky-column .probe')!;
    expect(p.closest('g.fg-rtl')).not.toBeNull();
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

  it('after unmount + mount, getLabelColumnWidth reports the painted width (remount memo reset)', () => {
    stubs(393);
    const g = withResponsive(withRender(createGantt({ tasks: TASKS })));
    g.mount(container);
    const narrow = g.getLabelColumnWidth();
    expect(narrow).toBeLessThan(160);
    g.unmount();
    g.mount(container);
    expect(g.getLabelColumnWidth()).toBe(svgHandle(g).getLabelColumnWidth());
    expect(Number(container.querySelector('.fg-timeline__sticky-column')!.getAttribute('width'))).toBe(g.getLabelColumnWidth());
  });

  it('the owner winning the width holds in either listener order, and the getter reports the painted width', () => {
    for (const ownerFirst of [true, false]) {
      const c = document.createElement('div');
      document.body.appendChild(c);
      Object.defineProperty(c, 'clientWidth', { value: 393, configurable: true });
      stubs(393);
      const base = withRender(createGantt({ tasks: TASKS }));
      const own = (): void => {
        base.on('renderer:selected', () => {
          const h = svgHandle(base);
          h.fixedLabelWidth = true;
          h.setOptions({ labelColumnWidth: 300 }); // what a grid does: write its own sum
        });
      };
      if (ownerFirst) own();
      const g = withResponsive(base);
      if (!ownerFirst) own();
      g.mount(c);
      expect(svgHandle(base).getLabelColumnWidth()).toBe(300);
      expect(g.getLabelColumnWidth()).toBe(300);
      c.remove();
    }
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
