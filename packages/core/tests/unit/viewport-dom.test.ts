// @vitest-environment jsdom
//
// `withViewport()` DOM tests (spec-viewport-api.md §9.2). jsdom has no layout engine, so container
// geometry is stubbed with `defineProperty` (as gantt-dom.test.ts does) and expectations are
// computed with the test's own arithmetic from the documented row/header geometry.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withResponsive } from '../../src/responsive/mixin.js';
import { withViewport } from '../../src/viewport/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import type { MountState } from '../../src/gantt-internal.js';
import { ROW_HEIGHT } from '../../src/render/renderer-base.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const HEADER = 32;
const LABEL_W = 160;

function manyTasks(n: number): TaskInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: toTaskId(`t${i}`),
    name: `Task ${i}`,
    start: '2026-01-05',
    end: '2026-01-09',
    progress: 0,
    type: 'task' as const,
  }));
}

interface Geo {
  top: number;
  left: number;
}
function stubGeometry(el: HTMLElement, w: number, h: number, init: Partial<Geo> = {}): Geo {
  const geo: Geo = { top: init.top ?? 0, left: init.left ?? 0 };
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: h, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    get: () => geo.top,
    set: (v: number) => {
      geo.top = v;
    },
    configurable: true,
  });
  Object.defineProperty(el, 'scrollLeft', {
    get: () => geo.left,
    set: (v: number) => {
      geo.left = v;
    },
    configurable: true,
  });
  return geo;
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

function mounted(tasks: TaskInput[], extra: Record<string, unknown> = {}, h = 300) {
  const g = withViewport(withRender(createGantt({ tasks, ...extra })));
  g.mount(container);
  const geo = stubGeometry(container, 800, h);
  return { g, geo };
}

describe('scrollToTask (SVG)', () => {
  it('scrolls a below-the-fold row to the bottom edge (nearest)', () => {
    const { g, geo } = mounted(manyTasks(40));
    expect(g.scrollToTask(toTaskId('t30'))).toBe(true);
    // 30 rows, plus the row's own height, minus the row band (the pinned header is not part of it)
    expect(geo.top).toBe(30 * ROW_HEIGHT.default + ROW_HEIGHT.default - (300 - HEADER));
  });

  it('leaves an already-visible row untouched', () => {
    const { g, geo } = mounted(manyTasks(40));
    geo.top = 0;
    geo.left = 0;
    g.scrollToTask(toTaskId('t1'));
    expect(geo.top).toBe(0);
  });

  it('nearest scrolls up to the row start when it is above the viewport', () => {
    const { g, geo } = mounted(manyTasks(40));
    geo.top = 600;
    g.scrollToTask(toTaskId('t2'));
    expect(geo.top).toBe(2 * ROW_HEIGHT.default);
  });

  it.each([
    ['start', 10 * 32],
    ['center', 10 * 32 + 16 - (300 - HEADER) / 2],
    ['end', 10 * 32 + 32 - (300 - HEADER)],
  ] as const)('align %s', (align, expected) => {
    const { g, geo } = mounted(manyTasks(40));
    g.scrollToTask(toTaskId('t10'), { align });
    expect(geo.top).toBe(expected);
  });

  it('a container no taller than the pinned header gets no vertical write (horizontal untouched)', () => {
    const { g, geo } = mounted(manyTasks(40), {}, HEADER);
    geo.top = 123;
    g.scrollToTask(toTaskId('t30'), { align: 'start' });
    expect(geo.top).toBe(123);
  });

  it('start lands the row directly under the band for the first and the last row', () => {
    const { g, geo } = mounted(manyTasks(40));
    g.scrollToTask(toTaskId('t0'), { align: 'start' });
    expect(geo.top).toBe(0);
    g.scrollToTask(toTaskId('t39'), { align: 'start' });
    expect(geo.top).toBe(39 * ROW_HEIGHT.default);
  });

  it('clamps the target at 0', () => {
    const { g, geo } = mounted(manyTasks(5));
    g.scrollToTask(toTaskId('t0'), { align: 'center' });
    expect(geo.top).toBe(0);
  });

  it('scrolls horizontally to a task far to the right', () => {
    const tasks = manyTasks(2);
    tasks.push({
      id: toTaskId('far'),
      name: 'Far',
      start: '2026-06-01',
      end: '2026-06-03',
      progress: 0,
      type: 'task',
    });
    const { g, geo } = mounted(tasks, { viewMode: 'day' });
    const scale = getInternal(g).mountOf()!.handle.getTimeScale();
    const x1 = LABEL_W + scale.dateToX('2026-06-03');
    g.scrollToTask(toTaskId('far'));
    expect(geo.left).toBe(x1 - 800);
  });

  it('handles a milestone (zero width)', () => {
    const tasks = manyTasks(3);
    tasks.push({
      id: toTaskId('ms'),
      name: 'M',
      start: '2026-01-07',
      end: '2026-01-07',
      progress: 0,
      type: 'milestone',
    });
    const { g } = mounted(tasks);
    expect(g.scrollToTask(toTaskId('ms'))).toBe(true);
  });

  it('pads a milestone by its painted half-diagonal so the whole diamond is visible', () => {
    const tasks = manyTasks(3);
    tasks.push({
      id: toTaskId('ms'),
      name: 'M',
      start: '2026-06-03',
      end: '2026-06-03',
      progress: 0,
      type: 'milestone',
    });
    const { g, geo } = mounted(tasks, { viewMode: 'day' });
    const scale = getInternal(g).mountOf()!.handle.getTimeScale();
    const cx = LABEL_W + scale.dateToX('2026-06-03');
    const half = (32 * 0.6) / Math.SQRT2; // default density row height 32, glyph side 0.6 * row
    g.scrollToTask(toTaskId('ms'));
    expect(geo.left).toBeCloseTo(cx + half - 800, 6);
  });

  it('does not move focus or selection', () => {
    const { g } = mounted(manyTasks(40));
    g.select([toTaskId('t1')]);
    const active = document.activeElement;
    g.scrollToTask(toTaskId('t30'));
    expect(document.activeElement).toBe(active);
    expect(g.getSelection()).toEqual([toTaskId('t1')]);
  });

  it('smooth uses container.scrollTo, and falls back to assignment under reduced motion', () => {
    const { g, geo } = mounted(manyTasks(40));
    const scrollTo = vi.fn();
    (container as unknown as { scrollTo: unknown }).scrollTo = scrollTo;
    g.scrollToTask(toTaskId('t30'), { behavior: 'smooth' });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));

    scrollTo.mockClear();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    geo.top = 0;
    g.scrollToTask(toTaskId('t30'), { behavior: 'smooth' });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(geo.top).toBeGreaterThan(0);
  });

  it('smooth without Element.scrollTo (plain jsdom) assigns instead', () => {
    const { g, geo } = mounted(manyTasks(40));
    expect(typeof container.scrollTo).not.toBe('function');
    g.scrollToTask(toTaskId('t30'), { behavior: 'smooth' });
    expect(geo.top).toBeGreaterThan(0);
  });

  it('writes no NaN with unstubbed (zero) geometry', () => {
    const g = withViewport(withRender(createGantt({ tasks: manyTasks(5) })));
    g.mount(container);
    expect(() => g.scrollToTask(toTaskId('t3'))).not.toThrow();
    expect(Number.isNaN(container.scrollTop)).toBe(false);
    expect(Number.isNaN(container.scrollLeft)).toBe(false);
  });
});

describe('scrollToTask with collapsed ancestors', () => {
  const nested: TaskInput[] = [
    { id: toTaskId('p'), name: 'P', start: '2026-01-05', end: '2026-01-30', progress: 0, type: 'task' },
    { id: toTaskId('c'), name: 'C', start: '2026-01-05', end: '2026-01-20', progress: 0, type: 'task', parent: toTaskId('p') },
    { id: toTaskId('gc'), name: 'GC', start: '2026-01-06', end: '2026-01-10', progress: 0, type: 'task', parent: toTaskId('c') },
  ];

  it('expands collapsed ancestors by default and emits collapse:changed once', () => {
    const { g } = mounted(nested);
    g.collapseAll();
    const seen: unknown[] = [];
    g.on('collapse:changed', (ids) => seen.push(ids));
    expect(g.scrollToTask(toTaskId('gc'))).toBe(true);
    expect(seen).toHaveLength(1);
    expect(g.isCollapsed(toTaskId('p'))).toBe(false);
    expect(g.isCollapsed(toTaskId('c'))).toBe(false);
    expect(container.querySelector('[data-task-id="gc"]')).not.toBeNull();
  });

  it('expand:false is a no-op returning false', () => {
    const { g, geo } = mounted(nested);
    g.collapseAll();
    const seen: unknown[] = [];
    g.on('collapse:changed', (ids) => seen.push(ids));
    expect(g.scrollToTask(toTaskId('gc'), { expand: false })).toBe(false);
    expect(seen).toEqual([]);
    expect(geo.top).toBe(0);
    expect(g.isCollapsed(toTaskId('p'))).toBe(true);
  });
});

describe('scrollToTask (Canvas coordinate model)', () => {
  it('uses row.y and clientHeight - header (sticky header), over a stubbed canvas mount', () => {
    const g = withViewport(createGantt({ tasks: manyTasks(100) }));
    const geo = stubGeometry(container, 800, 332);
    const handle = {
      container,
      getLabelColumnWidth: () => LABEL_W,
      getTimeScale: () => ({ dateToX: () => 0, totalWidth: 5000 }),
      setOptions: vi.fn(),
    };
    getInternal(g).setMount({ renderer: 'canvas', handle } as unknown as MountState);
    g.scrollToTask(toTaskId('t60'));
    // row band = 332 - 32 = 300 tall; row 60 bottom = 61 * 32
    expect(geo.top).toBe(61 * ROW_HEIGHT.default - 300);
  });
});

describe('scrollToDate', () => {
  it('centres a date, and reports in-range', () => {
    const { g, geo } = mounted(manyTasks(2), { viewMode: 'day' });
    const scale = getInternal(g).mountOf()!.handle.getTimeScale();
    const x = LABEL_W + scale.dateToX('2026-01-07');
    expect(g.scrollToDate('2026-01-07')).toBe(true);
    expect(geo.left).toBe(Math.max(0, x - 400));
  });

  it('accepts string, Date, ZonedDateTime-free inputs equivalently, and honours align', () => {
    const { g, geo } = mounted(manyTasks(2), { viewMode: 'day', timezone: 'UTC' });
    g.scrollToDate('2026-01-08T00:00:00Z', { align: 'start' });
    const a = geo.left;
    g.scrollToDate(new Date('2026-01-08T00:00:00Z'), { align: 'start' });
    expect(geo.left).toBe(a);
  });

  it.each(['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'])('works in %s (incl. DST day)', (timezone) => {
    const tasks = manyTasks(1);
    tasks[0] = { ...tasks[0]!, start: '2026-03-02', end: '2026-03-20' };
    const { g, geo } = mounted(tasks, { viewMode: 'day', calendar: { workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'], workingHours: [{ start: '09:00', end: '17:00' }], holidays: [], timezone } });
    expect(g.scrollToDate('2026-03-08')).toBe(true); // spring-forward day in New York
    expect(Number.isFinite(geo.left)).toBe(true);
  });

  it('returns false out of range but still scrolls', () => {
    const { g, geo } = mounted(manyTasks(2), { viewMode: 'day' });
    expect(g.scrollToDate('2030-01-01', { align: 'start' })).toBe(false);
    expect(geo.left).toBeGreaterThan(0);
  });

  it('throws on garbage and Invalid Date', () => {
    const { g } = mounted(manyTasks(2));
    expect(() => g.scrollToDate('garbage')).toThrow();
    expect(() => g.scrollToDate(new Date(NaN))).toThrow();
  });
});

describe('setDensity (mounted)', () => {
  it('repaints once at the new row height and keeps the top row anchored', () => {
    const { g, geo } = mounted(manyTasks(40));
    const handle = getInternal(g).mountOf()!.handle;
    const spy = vi.spyOn(handle, 'setOptions');
    geo.top = 10 * 32; // row 10 at the top edge
    const seen: unknown[] = [];
    g.on('viewport:changed', (p) => seen.push(p));
    g.setDensity('compact');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(geo.top).toBe(10 * ROW_HEIGHT.compact);
    expect(seen).toEqual([{ viewMode: 'week', density: 'compact' }]);
  });

  it('a remount keeps the density (no flash at config.density)', () => {
    const { g } = mounted(manyTasks(3));
    g.setDensity('comfortable');
    g.unmount();
    g.mount(container);
    const rects = container.querySelectorAll('.fg-timeline__row');
    expect(rects.length).toBeGreaterThan(0);
    const svg = container.querySelector('svg')!;
    expect(Number(svg.getAttribute('height'))).toBe(HEADER + 3 * ROW_HEIGHT.comfortable);
  });

  it('pins HEADER_HEIGHT to the rendered SVG geometry', () => {
    const { g } = mounted(manyTasks(4));
    const h = Number(container.querySelector('svg')!.getAttribute('height'));
    expect(h - 4 * ROW_HEIGHT.default).toBe(HEADER);
    g.destroy();
  });

  it('rolls the slot back and emits nothing when setOptions throws', () => {
    const { g } = mounted(manyTasks(3));
    const handle = getInternal(g).mountOf()!.handle;
    vi.spyOn(handle, 'setOptions').mockImplementation(() => {
      throw new Error('dimension guard');
    });
    const seen: unknown[] = [];
    g.on('viewport:changed', (p) => seen.push(p));
    expect(() => g.setDensity('compact')).toThrow('dimension guard');
    expect(getInternal(g).density).toBeUndefined();
    expect(seen).toEqual([]);
  });
});

describe('withResponsive interplay', () => {
  function coarseStub() {
    const listeners = new Set<() => void>();
    const mql = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    vi.stubGlobal('matchMedia', () => mql);
    return {
      flip(v: boolean) {
        mql.matches = v;
        for (const fn of listeners) fn();
      },
    };
  }

  it.each(['viewport-outer', 'responsive-outer'] as const)(
    'setDensity pins density against coarse/fine flips (%s)',
    (order) => {
      const mq = coarseStub();
      const base = withRender(createGantt({ tasks: manyTasks(3) }));
      const g =
        order === 'viewport-outer'
          ? withViewport(withResponsive(base))
          : withResponsive(withViewport(base));
      g.mount(container);
      expect(getInternal(g).density).toBe('touch'); // before pinning, touch density applies
      g.setDensity('compact');
      mq.flip(false);
      mq.flip(true);
      expect(getInternal(g).density).toBe('compact');
      const svg = container.querySelector('svg')!;
      expect(Number(svg.getAttribute('height'))).toBe(HEADER + 3 * ROW_HEIGHT.compact);
    },
  );
});

describe('nearest: item already covering the viewport', () => {
  it('does not move horizontally when a long bar already fills the viewport', () => {
    const tasks = manyTasks(2);
    tasks.push({
      id: toTaskId('long'),
      name: 'Long',
      start: '2026-01-05',
      end: '2026-06-30',
      progress: 0,
      type: 'task',
    });
    const { g, geo } = mounted(tasks, { viewMode: 'day' });
    const scale = getInternal(g).mountOf()!.handle.getTimeScale();
    const x0 = LABEL_W + scale.dateToX('2026-01-05');
    geo.left = x0 + 300; // bar starts left of the viewport and ends right of it
    expect(g.scrollToTask(toTaskId('long'))).toBe(true);
    expect(geo.left).toBe(x0 + 300);
  });
});

describe('scrollToDate DateInput forms', () => {
  it('string, Date, ZonedDateTime and PlainDate give the same scroll, at an exact offset', () => {
    const { g, geo } = mounted(manyTasks(2), { viewMode: 'day', timezone: 'UTC' });
    const scale = getInternal(g).mountOf()!.handle.getTimeScale();
    const expected = Math.max(0, LABEL_W + scale.dateToX('2026-01-08T00:00:00Z') - 400);
    const inputs = [
      '2026-01-08T00:00:00Z',
      new Date('2026-01-08T00:00:00Z'),
      Temporal.ZonedDateTime.from('2026-01-08T00:00:00[UTC]'),
      Temporal.PlainDate.from('2026-01-08'),
    ];
    for (const input of inputs) {
      geo.left = 0;
      expect(g.scrollToDate(input)).toBe(true);
      expect(geo.left).toBe(expected);
    }
  });

  it('spring-forward day in New York lands one day column after the previous day', () => {
    const tasks = manyTasks(1);
    tasks[0] = { ...tasks[0]!, start: '2026-03-02', end: '2026-03-20' };
    const { g, geo } = mounted(tasks, {
      viewMode: 'day',
      calendar: { workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'], workingHours: [{ start: '09:00', end: '17:00' }], holidays: [], timezone: 'America/New_York' },
    });
    const ppd = getInternal(g).mountOf()!.handle.getTimeScale().dateToX('2026-03-09') -
      getInternal(g).mountOf()!.handle.getTimeScale().dateToX('2026-03-08');
    g.scrollToDate('2026-03-07', { align: 'start' });
    const a = geo.left;
    g.scrollToDate('2026-03-08', { align: 'start' });
    const b = geo.left;
    g.scrollToDate('2026-03-09', { align: 'start' });
    expect(b - a).toBeGreaterThan(0);
    expect(geo.left - b).toBe(ppd);
  });
});

describe('setDensity (Canvas stub)', () => {
  function canvasMounted(setOptions = vi.fn()) {
    const g = withViewport(createGantt({ tasks: manyTasks(100) }));
    const geo = stubGeometry(container, 800, 332);
    const handle = {
      container,
      getLabelColumnWidth: () => LABEL_W,
      getTimeScale: () => ({ dateToX: () => 0, totalWidth: 5000 }),
      setOptions,
    };
    getInternal(g).setMount({ renderer: 'canvas', handle } as unknown as MountState);
    return { g, geo };
  }

  it('anchors the top row with no header term', () => {
    const { g, geo } = canvasMounted();
    geo.top = 10 * ROW_HEIGHT.default;
    g.setDensity('compact');
    expect(geo.top).toBe(10 * ROW_HEIGHT.compact);
  });

  it('rolls back the slot, writes no scroll and emits nothing when setOptions throws', () => {
    const { g, geo } = canvasMounted(
      vi.fn(() => {
        throw new Error('dimension guard');
      }),
    );
    geo.top = 10 * ROW_HEIGHT.default;
    const seen: unknown[] = [];
    g.on('viewport:changed', (p) => seen.push(p));
    expect(() => g.setDensity('compact')).toThrow('dimension guard');
    expect(getInternal(g).density).toBeUndefined();
    expect(geo.top).toBe(10 * ROW_HEIGHT.default);
    expect(seen).toEqual([]);
  });
});

describe('setDensity focus and pre-mount interplay', () => {
  it('keeps focus on the same row after a mounted setDensity', () => {
    const g = withViewport(withInteraction(withRender(createGantt({ tasks: manyTasks(5) }))));
    g.mount(container);
    const first = container.querySelector('.fg-timeline__row[data-task-id="t0"]') as unknown as HTMLElement;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    const row = container.querySelector('.fg-timeline__row[data-task-id="t1"]');
    expect(document.activeElement).toBe(row);
    g.setDensity('compact');
    const after = container.querySelector('.fg-timeline__row[data-task-id="t1"]');
    expect(after).not.toBeNull();
    expect((document.activeElement as Element).getAttribute('data-task-id')).toBe('t1');
  });

  it('pre-mount setDensity + withResponsive coarse: first mount stays at the pinned density', () => {
    const mql = { matches: true, addEventListener: () => undefined, removeEventListener: () => undefined };
    vi.stubGlobal('matchMedia', () => mql);
    const g = withViewport(withResponsive(withRender(createGantt({ tasks: manyTasks(3) }))));
    g.setDensity('compact');
    g.mount(container);
    expect(getInternal(g).density).toBe('compact');
    const svg = container.querySelector('svg')!;
    expect(Number(svg.getAttribute('height'))).toBe(HEADER + 3 * ROW_HEIGHT.compact);
  });
});
