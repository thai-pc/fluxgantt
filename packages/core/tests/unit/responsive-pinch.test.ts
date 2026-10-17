// @vitest-environment jsdom
//
// `withResponsive()` two-finger pinch zoom (spec-pinch-zoom.md). jsdom lacks `PointerEvent`, so
// events are `MouseEvent`s carrying `pointerId`/`pointerType`; geometry (`scrollLeft`,
// `clientWidth`, `getBoundingClientRect`) is stubbed because jsdom has no layout. The recognizer
// is driven at exact coordinates, so the 1.4 / 0.7 thresholds are asserted at their boundaries.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../../src/gantt.js';
import { getInternal } from '../../src/gantt-internal.js';
import { withRender } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withEditHooks } from '../../src/edit-hooks/mixin.js';
import { withResponsive } from '../../src/responsive/mixin.js';
import type { ResponsiveOptions } from '../../src/responsive/mixin.js';
import { toTaskId } from '../../src/types.js';
import type { ViewMode } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const TASKS: readonly TaskInput[] = [
  { id: toTaskId('a'), name: 'a', start: '2026-01-05', end: '2026-01-09', progress: 0, type: 'task' },
  { id: toTaskId('b'), name: 'b', start: '2026-01-26', end: '2026-02-27', progress: 0, type: 'task' },
];

let container: HTMLElement;
let mediaListeners: Set<() => void>;
let mql: { matches: boolean };

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mediaListeners = new Set();
  mql = {
    matches: true,
    addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn),
  } as never;
  vi.stubGlobal('matchMedia', () => mql);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Setup {
  readonly gantt: ReturnType<typeof build>;
  readonly svg: SVGElement;
  scroll: { left: number; top: number };
  readonly zoomed: ViewMode[];
}

function build(options?: ResponsiveOptions, extra: { readOnly?: boolean; hooks?: boolean } = {}) {
  let g = withInteraction(
    withRender(createGantt({ tasks: TASKS, ...(extra.readOnly ? { readOnly: true } : {}) })),
  );
  if (extra.hooks) g = withEditHooks(g);
  return withResponsive(g, options);
}

function setup(
  options?: ResponsiveOptions,
  extra: { readOnly?: boolean; hooks?: boolean; mode?: ViewMode; mount?: boolean } = {},
): Setup {
  const gantt = build(options, extra);
  gantt.zoomTo(extra.mode ?? 'week');
  const zoomed: ViewMode[] = [];
  gantt.on('viewport:changed', (p) => zoomed.push(p.viewMode));
  const scroll = { left: 400, top: 70 };
  if (extra.mount !== false) mountOn(gantt, scroll);
  return { gantt, svg: container.querySelector('svg')!, scroll, zoomed };
}

function mountOn(gantt: ReturnType<typeof build>, scroll: { left: number; top: number }): void {
  gantt.mount(container);
  // jsdom never scrolls: back the offsets with real storage so writes are observable.
  Object.defineProperty(container, 'scrollLeft', {
    get: () => scroll.left,
    set: (v: number) => {
      scroll.left = v;
    },
    configurable: true,
  });
  Object.defineProperty(container, 'scrollTop', {
    get: () => scroll.top,
    set: (v: number) => {
      scroll.top = v;
    },
    configurable: true,
  });
  Object.defineProperty(container, 'clientWidth', { value: 393, configurable: true });
}

function ptr(
  type: string,
  target: EventTarget,
  id: number,
  x: number,
  y: number,
  pointerType = 'touch',
): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  Object.defineProperty(e, 'isPrimary', { value: id === 1 });
  target.dispatchEvent(e);
  return e;
}

/** Two fingers `span` px apart, centred on (cx, 100); returns movers keyed to the same ids. */
function twoFingers(s: Setup, span: number, cx = 200): { spread(next: number): void; lift(): void } {
  ptr('pointerdown', s.svg, 1, cx - span / 2, 100);
  ptr('pointerdown', s.svg, 2, cx + span / 2, 100);
  return {
    spread(next: number): void {
      ptr('pointermove', s.svg, 1, cx - next / 2, 100);
      ptr('pointermove', s.svg, 2, cx + next / 2, 100);
    },
    lift(): void {
      ptr('pointerup', s.svg, 1, 0, 0);
      ptr('pointerup', s.svg, 2, 0, 0);
    },
  };
}

describe('pinch — recognition and thresholds', () => {
  it('exact thresholds: 1.39 none, 1.40 zoomIn; 0.71 none, 0.70 zoomOut', () => {
    const s = setup();
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100); // span 100
    ptr('pointermove', s.svg, 2, 139, 100);
    expect(s.zoomed).toEqual([]);
    ptr('pointermove', s.svg, 2, 140, 100);
    expect(s.zoomed).toEqual(['day']);
    expect(s.gantt.getViewMode()).toBe('day');
    ptr('pointerup', s.svg, 1, 0, 100);
    ptr('pointerup', s.svg, 2, 140, 100);
  });

  it('pinching in: 0.71 none, 0.70 zoomOut', () => {
    const s = setup();
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    ptr('pointermove', s.svg, 2, 71, 100);
    expect(s.zoomed).toEqual([]);
    ptr('pointermove', s.svg, 2, 70, 100);
    expect(s.zoomed).toEqual(['month']);
  });

  it('re-baselines after a step: continuous spread needs another 1.4x, reversal needs ~the start span', () => {
    const s = setup({}, { mode: 'month' });
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    ptr('pointermove', s.svg, 2, 140, 100); // week
    expect(s.zoomed).toEqual(['week']);
    ptr('pointermove', s.svg, 2, 190, 100); // 190/140 = 1.357
    expect(s.zoomed).toEqual(['week']);
    ptr('pointermove', s.svg, 2, 196, 100); // 196/140 = 1.4
    expect(s.zoomed).toEqual(['week', 'day']);
    // Undoing needs span <= 0.7 * 196 = 137.2, i.e. back near the start; a jitter does not flip it.
    ptr('pointermove', s.svg, 2, 150, 100);
    expect(s.zoomed).toEqual(['week', 'day']);
    ptr('pointermove', s.svg, 2, 137, 100);
    expect(s.zoomed).toEqual(['week', 'day', 'week']);
  });

  it('a violent jump still steps at most one level per move event', () => {
    const s = setup({}, { mode: 'year' });
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    ptr('pointermove', s.svg, 2, 1000, 100);
    expect(s.zoomed).toEqual(['quarter']);
  });

  it('boundary no-ops: pinch-spread at day and pinch-in at year emit nothing and do not write scrollLeft', () => {
    const s = setup({}, { mode: 'day' });
    const writes = vi.fn();
    let left = 400;
    Object.defineProperty(container, 'scrollLeft', {
      get: () => left,
      set: (v: number) => {
        writes(v);
        left = v;
      },
      configurable: true,
    });
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    ptr('pointermove', s.svg, 2, 300, 100);
    expect(s.zoomed).toEqual([]);
    expect(writes).not.toHaveBeenCalled();
    ptr('pointerup', s.svg, 1, 0, 100);
    ptr('pointerup', s.svg, 2, 0, 100);

    s.gantt.zoomTo('year');
    s.zoomed.length = 0;
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    writes.mockClear();
    ptr('pointermove', s.svg, 2, 10, 100);
    expect(s.zoomed).toEqual([]);
    expect(writes).not.toHaveBeenCalled();
  });

  it('PINCH_MIN_SPAN: a 10 px start never steps and re-baselines until the span reaches 30', () => {
    const s = setup();
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 10, 100);
    ptr('pointermove', s.svg, 2, 25, 100); // ratio 2.5 but baseline < 30
    ptr('pointermove', s.svg, 2, 30, 100); // baseline 25 < 30 -> re-baseline to 30, still no step
    expect(s.zoomed).toEqual([]);
    ptr('pointermove', s.svg, 2, 42, 100); // 42/30 = 1.4 -> step
    expect(s.zoomed).toEqual(['day']);
  });

  it('works with readOnly: true', () => {
    const s = setup({}, { readOnly: true });
    twoFingers(s, 100).spread(150);
    expect(s.zoomed).toEqual(['day']);
  });
});

describe('pinch — midpoint anchoring', () => {
  for (const labelWidth of [160, 96]) {
    it(`keeps the date under the midpoint (label column ${labelWidth})`, () => {
      const s = setup({ minLabelColumnWidth: labelWidth, labelColumnRatio: labelWidth === 96 ? 0.1 : 1 });
      Object.defineProperty(container, 'clientWidth', { value: 393, configurable: true });
      s.gantt.zoomTo('week'); // re-measure is not needed; the label width is whatever was pushed
      const mount = getInternal(s.gantt).getMountState()!;
      const h = mount.rendererHandle;
      const lw = h.getLabelColumnWidth();
      const mid = 230;
      const dateBefore = h.getTimeScale().xToDate(s.scroll.left + mid - lw);
      const top = s.scroll.top;
      twoFingers(s, 100, mid).spread(150);
      expect(s.zoomed).toEqual(['day']);
      const after = getInternal(s.gantt).getMountState()!.rendererHandle;
      const xAfter = after.getTimeScale().dateToX(dateBefore) + lw - s.scroll.left;
      expect(Math.abs(xAfter - mid)).toBeLessThan(1);
      expect(s.scroll.top).toBe(top);
    });
  }
});

describe('pinch — cancelling the first finger', () => {
  it('a first-finger pan stops writing scrollLeft once the second finger lands', () => {
    const s = setup();
    ptr('pointerdown', s.svg, 1, 300, 100);
    ptr('pointermove', s.svg, 1, 280, 100);
    expect(s.scroll.left).toBe(420);
    ptr('pointerdown', s.svg, 2, 340, 100);
    ptr('pointermove', s.svg, 1, 280, 100);
    ptr('pointermove', s.svg, 1, 270, 100); // span change < threshold: no zoom, and no pan write
    expect(s.scroll.left).toBe(420);
    expect(s.zoomed).toEqual([]);
  });

  it('finger on a bar then finger on empty space: no pan is created, a pointercancel is dispatched for both ids, nothing moves', () => {
    const s = setup();
    const cancelled: number[] = [];
    const spy = (e: Event): void => {
      cancelled.push((e as PointerEvent).pointerId);
    };
    window.addEventListener('pointercancel', spy);
    const moved = vi.fn();
    s.gantt.on('task:moved', moved);
    const bar = container.querySelector('.fg-task[data-task-id="a"] .fg-task__bar')!;
    ptr('pointerdown', bar, 1, 10, 40);
    ptr('pointerdown', s.svg, 2, 200, 100);
    expect(cancelled).toEqual([1, 2]);
    // Finger 2 landed after the pinch began, so it must not have started a pan either.
    ptr('pointermove', s.svg, 2, 150, 100);
    expect(s.scroll.left).toBe(400);
    ptr('pointermove', bar, 1, 90, 40);
    ptr('pointerup', bar, 1, 90, 40);
    ptr('pointerup', s.svg, 2, 150, 100);
    expect(moved).not.toHaveBeenCalled();
    window.removeEventListener('pointercancel', spy);
  });

  it('a drag already past its threshold is reverted: nothing commits when the second finger lands', () => {
    const s = setup();
    const moved = vi.fn();
    s.gantt.on('task:moved', moved);
    const before = String(s.gantt.getTask(toTaskId('a'))!.start);
    const bar = container.querySelector('.fg-task[data-task-id="a"] .fg-task__bar')!;
    ptr('pointerdown', bar, 1, 10, 40);
    ptr('pointermove', bar, 1, 60, 40); // well past the 4 px threshold
    ptr('pointerdown', s.svg, 2, 200, 100);
    ptr('pointermove', bar, 1, 120, 40);
    ptr('pointerup', bar, 1, 120, 40);
    expect(moved).not.toHaveBeenCalled();
    expect(String(s.gantt.getTask(toTaskId('a'))!.start)).toBe(before);
  });

  it('cancels a pending long-press (withEditHooks) when the second finger lands', () => {
    vi.useFakeTimers();
    const s = setup({}, { hooks: true });
    const ctx = vi.fn();
    s.gantt.on('task:context-requested', ctx);
    const bar = container.querySelector('.fg-task[data-task-id="a"] .fg-task__bar')!;
    ptr('pointerdown', bar, 1, 10, 40);
    ptr('pointerdown', s.svg, 2, 200, 100);
    vi.advanceTimersByTime(900);
    expect(ctx).not.toHaveBeenCalled();
  });
});

describe('pinch — lifecycle of the pair', () => {
  it('lifting a pair member ends the pinch; the remaining finger is inert; a fresh pinch works', () => {
    const s = setup();
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    ptr('pointerup', s.svg, 2, 100, 100);
    ptr('pointermove', s.svg, 1, 50, 100); // no pan jump, no zoom
    expect(s.scroll.left).toBe(400);
    expect(s.zoomed).toEqual([]);
    ptr('pointerup', s.svg, 1, 50, 100);
    const f = twoFingers(s, 100);
    f.spread(150);
    expect(s.zoomed).toEqual(['day']);
  });

  it('a third finger neither joins nor replaces the pair', () => {
    const s = setup();
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    ptr('pointerdown', s.svg, 3, 500, 100);
    ptr('pointermove', s.svg, 3, 900, 100); // not in the pair: ignored
    expect(s.zoomed).toEqual([]);
    ptr('pointerup', s.svg, 3, 900, 100); // not in the pair: pinch survives
    ptr('pointermove', s.svg, 2, 140, 100);
    expect(s.zoomed).toEqual(['day']);
  });

  it('a browser pointercancel drops the pointer, but our own synthetic cancel does not', () => {
    const s = setup();
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100); // synthetic cancels fire here and must not end it
    ptr('pointermove', s.svg, 2, 140, 100);
    expect(s.zoomed).toEqual(['day']);
    ptr('pointercancel', s.svg, 2, 140, 100); // the browser takes the gesture
    ptr('pointermove', s.svg, 1, -200, 100);
    expect(s.zoomed).toEqual(['day']);
  });

  it('mouse and pen never pinch; non-finite coordinates are ignored', () => {
    const s = setup();
    for (const t of ['mouse', 'pen']) {
      ptr('pointerdown', s.svg, 1, 0, 100, t);
      ptr('pointerdown', s.svg, 2, 100, 100, t);
      ptr('pointermove', s.svg, 2, 300, 100, t);
      ptr('pointerup', s.svg, 1, 0, 100, t);
      ptr('pointerup', s.svg, 2, 0, 100, t);
    }
    expect(s.zoomed).toEqual([]);

    const nan = (type: string, id: number): void => {
      const e = new MouseEvent(type, { bubbles: true });
      Object.defineProperty(e, 'clientX', { value: NaN });
      Object.defineProperty(e, 'clientY', { value: 5 });
      Object.defineProperty(e, 'pointerId', { value: id });
      Object.defineProperty(e, 'pointerType', { value: 'touch' });
      s.svg.dispatchEvent(e);
    };
    nan('pointerdown', 7); // ignored: not tracked
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    nan('pointermove', 2);
    expect(s.zoomed).toEqual([]);
    ptr('pointermove', s.svg, 2, 140, 100);
    expect(s.zoomed).toEqual(['day']);
  });

  it('an unknown pointer moving or lifting is a no-op', () => {
    const s = setup();
    expect(() => {
      ptr('pointermove', s.svg, 9, 1, 1);
      ptr('pointerup', s.svg, 9, 1, 1);
    }).not.toThrow();
  });
});

describe('pinch — options and listener lifecycle', () => {
  it('pinchZoom: false installs no pinch listeners and pan still works', () => {
    const s = setup({ pinchZoom: false });
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    ptr('pointermove', s.svg, 2, 300, 100);
    expect(s.zoomed).toEqual([]);
    ptr('pointermove', s.svg, 1, -20, 100); // finger 1 still pans
    expect(s.scroll.left).toBe(420);
  });

  it('removes pinch listeners when the pointer stops being coarse and re-installs when it returns', () => {
    const s = setup();
    mql.matches = false;
    for (const fn of [...mediaListeners]) fn();
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    ptr('pointermove', s.svg, 2, 300, 100);
    expect(s.zoomed).toEqual([]);
    ptr('pointerup', s.svg, 1, 0, 100);
    ptr('pointerup', s.svg, 2, 0, 100);
    mql.matches = true;
    for (const fn of [...mediaListeners]) fn();
    twoFingers(s, 100).spread(150);
    expect(s.zoomed).toEqual(['day']);
  });

  it('re-binds on remount', () => {
    const s = setup();
    s.gantt.unmount();
    container.replaceChildren();
    mountOn(s.gantt, s.scroll);
    const svg = container.querySelector('svg') as SVGElement;
    ptr('pointerdown', svg, 1, 0, 100);
    ptr('pointerdown', svg, 2, 100, 100);
    ptr('pointermove', svg, 2, 140, 100);
    expect(s.zoomed).toEqual(['day']);
  });

  it('destroy removes every listener, a later event is a no-op, and destroy mid-pinch does not throw', () => {
    const s = setup();
    const removed = vi.spyOn(container, 'removeEventListener');
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    s.gantt.destroy();
    expect(removed.mock.calls.map((c) => c[0]).filter((t) => t.startsWith('pointer')).sort()).toEqual([
      'pointercancel',
      'pointerdown',
      'pointermove',
      'pointerup',
    ]);
    expect(() => ptr('pointermove', s.svg, 2, 300, 100)).not.toThrow();
  });

  it('a viewport:changed listener that destroys the chart mid-step does not throw', () => {
    const s = setup();
    s.gantt.on('viewport:changed', () => s.gantt.destroy());
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    expect(() => ptr('pointermove', s.svg, 2, 140, 100)).not.toThrow();
  });

  it('a step with no mount state is a no-op', () => {
    const s = setup();
    ptr('pointerdown', s.svg, 1, 0, 100);
    ptr('pointerdown', s.svg, 2, 100, 100);
    const internal = getInternal(s.gantt);
    vi.spyOn(internal, 'getMountState').mockReturnValue(undefined);
    expect(() => ptr('pointermove', s.svg, 2, 140, 100)).not.toThrow();
    expect(s.zoomed).toEqual([]);
  });
});

describe('pinch — property: random pointer sequences', () => {
  it('never throws, drains touches, and steps at most once per move event', () => {
    const op = fc.record({
      kind: fc.constantFrom('down', 'move', 'up', 'cancel'),
      id: fc.integer({ min: 1, max: 3 }),
      x: fc.integer({ min: -50, max: 600 }),
      y: fc.integer({ min: 0, max: 200 }),
    });
    // ONE mount for every run (a jsdom paint per run made this the slowest test in the package);
    // each run ends by lifting every pointer, which is itself the "drains cleanly" assertion.
    const s = setup();
    const zi = vi.spyOn(s.gantt, 'zoomIn');
    const zo = vi.spyOn(s.gantt, 'zoomOut');
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
        for (const o of ops) {
          const before = zi.mock.calls.length + zo.mock.calls.length;
          ptr(`pointer${o.kind}`, container.querySelector('svg')!, o.id, o.x, o.y);
          const delta = zi.mock.calls.length + zo.mock.calls.length - before;
          expect(delta).toBeLessThanOrEqual(1);
          if (o.kind !== 'move') expect(delta).toBe(0);
        }
        for (const id of [1, 2, 3]) ptr('pointerup', container.querySelector('svg')!, id, 0, 0);
        // All released: a brand-new two-finger pinch must step from a clean state. The chart
        // repaints on a step, so re-resolve the surface the events are dispatched on.
        const surface = container.querySelector('svg') as SVGElement;
        const modeBefore = s.gantt.getViewMode();
        ptr('pointerdown', surface, 1, 100, 100);
        ptr('pointerdown', surface, 2, 200, 100);
        ptr('pointermove', surface, 2, 100 + 150, 100);
        if (modeBefore !== 'day') expect(s.gantt.getViewMode()).not.toBe(modeBefore);
        ptr('pointerup', surface, 1, 0, 0);
        ptr('pointerup', surface, 2, 0, 0);
      }),
      { numRuns: 25 },
    );
  });
});
