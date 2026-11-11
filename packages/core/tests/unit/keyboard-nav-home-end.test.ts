// @vitest-environment jsdom
//
// Home / End / PageUp / PageDown / `g` (spec-keyboard-horizontal-reveal.md §7). jsdom has no layout,
// so `clientHeight` is stubbed and scroll setters are spied on.
import { describe, it, expect, vi } from 'vitest';
import { enableKeyboardNav } from '../../src/interaction/keyboard-nav.js';
import type { InteractiveRendererHandle } from '../../src/render/interactive-renderer-handle.js';
import { ROW_HEIGHT } from '../../src/render/renderer-base.js';
import { toTaskId, type Density, type Task, type TaskId } from '../../src/types.js';

function makeTasks(n: number): Task[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => ({
    id: toTaskId(`t${i}`),
    name: `t${i}`,
    start: '2026-01-05T09:00',
    end: '2026-01-07T09:00',
    progress: 0,
    type: 'task' as const,
    createdAt: now,
    updatedAt: now,
  }));
}

function setup(o: {
  n: number;
  density?: Density;
  clientHeight?: number;
  reveal?: boolean;
  tag?: 'svg' | 'div';
  collapsed?: Set<TaskId>;
  /** Makes t1..t(k) children of t0. */
  childrenOfFirst?: number;
}) {
  const density = o.density ?? 'default';
  let tasks = makeTasks(o.n).map((t, i) =>
    i >= 1 && i <= (o.childrenOfFirst ?? 0) ? { ...t, parent: toTaskId('t0') } : t,
  );
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientHeight', { value: o.clientHeight ?? 0 });
  const top: number[] = [];
  const left: number[] = [];
  Object.defineProperty(container, 'scrollTop', { get: () => 0, set: (v: number) => top.push(v) });
  Object.defineProperty(container, 'scrollLeft', { get: () => 0, set: (v: number) => left.push(v) });
  const root =
    o.tag === 'div'
      ? document.createElement('div')
      : document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const els = tasks.map((t, i) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-row-index', String(i));
    g.setAttribute('data-task-id', t.id);
    root.appendChild(g);
    return g;
  });
  container.appendChild(root);
  document.body.appendChild(container);
  const onSelect = vi.fn();
  const onRangeSelect = vi.fn();
  const onReveal = vi.fn(() => true);
  const nav = enableKeyboardNav({ interactionRoot: root, container } as unknown as InteractiveRendererHandle, {
    onSelect,
    onToggle: vi.fn(),
    onRangeSelect,
    onDeleteSelected: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDuplicateSelected: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    ...(o.reveal === false ? {} : { onReveal }),
    getTasks: () => tasks,
    density,
    isReadOnly: () => false,
    getSelection: () => [],
    getCollapsedIds: () => o.collapsed ?? new Set<TaskId>(),
    onToggleCollapse: vi.fn(),
  });
  function press(index: number, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    nav.focusTask(toTaskId(`t${index}`));
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    els[index]!.dispatchEvent(ev);
    return ev;
  }
  const focused = () => nav.getFocusedTaskId();
  return {
    press,
    focused,
    onSelect,
    onRangeSelect,
    onReveal,
    top,
    left,
    removeAll: () => (tasks = []),
    dispose: () => {
      nav.dispose();
      container.remove();
    },
  };
}

const id = (i: number) => toTaskId(`t${i}`);

describe('Home / End', () => {
  it('focus the first / last row, select, and preventDefault', () => {
    const t = setup({ n: 10 });
    const ev = t.press(4, 'Home');
    expect(ev.defaultPrevented).toBe(true);
    expect(t.focused()).toBe(id(0));
    expect(t.onSelect).toHaveBeenLastCalledWith(id(0));
    t.press(4, 'End');
    expect(t.focused()).toBe(id(9));
    expect(t.onSelect).toHaveBeenLastCalledWith(id(9));
    t.dispose();
  });

  it('are a no-op (not prevented) when already at the target', () => {
    const t = setup({ n: 5 });
    expect(t.press(0, 'Home').defaultPrevented).toBe(false);
    expect(t.press(4, 'End').defaultPrevented).toBe(false);
    expect(t.onSelect).not.toHaveBeenCalled();
    t.dispose();
  });

  it('Shift extends the range from the unchanged anchor', () => {
    const t = setup({ n: 10 });
    t.press(4, 'End', { shiftKey: true });
    expect(t.onRangeSelect).toHaveBeenCalledWith(id(4), id(9));
    expect(t.onSelect).not.toHaveBeenCalled();
    t.dispose();
  });

  it('are ignored (not prevented) with Ctrl, Meta or Alt', () => {
    const t = setup({ n: 10 });
    for (const m of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      for (const k of ['Home', 'End', 'PageDown', 'PageUp']) {
        expect(t.press(5, k, { [m]: true }).defaultPrevented).toBe(false);
      }
    }
    expect(t.onSelect).not.toHaveBeenCalled();
    t.dispose();
  });

  it('single row, empty grid and stale focus do not throw', () => {
    const one = setup({ n: 1 });
    expect(one.press(0, 'End').defaultPrevented).toBe(false);
    one.dispose();
    const stale = setup({ n: 5 });
    stale.removeAll();
    expect(() => stale.press(2, 'Home')).not.toThrow();
    expect(stale.focused()).toBeUndefined();
    stale.dispose();
  });

  it('skip collapsed rows (the layout is the visible rows)', () => {
    const t = setup({ n: 8, childrenOfFirst: 4, collapsed: new Set([toTaskId('t0')]) });
    // Visible rows: t0, t5, t6, t7.
    t.press(5, 'PageDown');
    t.press(0, 'End');
    expect(t.focused()).toBe(id(7));
    t.press(7, 'Home');
    expect(t.focused()).toBe(id(0));
    t.dispose();
  });
});

describe('PageUp / PageDown', () => {
  // page = max(1, floor((clientHeight - 32) / ROW_HEIGHT) - 1)
  it('moves page rows for several height x density combos and clamps at both ends', () => {
    for (const density of ['compact', 'default', 'comfortable'] as const) {
      for (const clientHeight of [232, 500, 900]) {
        const page = Math.max(1, Math.floor((clientHeight - 32) / ROW_HEIGHT[density]) - 1);
        const t = setup({ n: 200, density, clientHeight });
        t.press(50, 'PageDown');
        expect(t.focused()).toBe(id(50 + page));
        t.press(50, 'PageUp');
        expect(t.focused()).toBe(id(50 - page));
        t.press(198, 'PageDown');
        expect(t.focused()).toBe(id(199));
        t.press(1, 'PageUp');
        expect(t.focused()).toBe(id(0));
        t.dispose();
      }
    }
  });

  it('moves 1 row when the container is unlaid-out (clientHeight <= 32)', () => {
    for (const clientHeight of [0, 32]) {
      const t = setup({ n: 10, clientHeight });
      t.press(3, 'PageDown');
      expect(t.focused()).toBe(id(4));
      t.dispose();
    }
  });

  it('reveals vertically on SVG and not on a canvas-like root', () => {
    const svg = setup({ n: 100, clientHeight: 232 });
    svg.press(0, 'PageDown');
    expect(svg.top.length).toBe(1);
    svg.dispose();
    const cv = setup({ n: 100, clientHeight: 232, tag: 'div' });
    cv.press(0, 'PageDown');
    expect(cv.top).toEqual([]);
    cv.dispose();
  });

  it('Shift+PageDown extends the range', () => {
    const t = setup({ n: 50, clientHeight: 232 });
    t.press(2, 'PageDown', { shiftKey: true });
    expect(t.onRangeSelect).toHaveBeenCalledTimes(1);
    expect(t.onRangeSelect.mock.calls[0]![0]).toBe(id(2));
    t.dispose();
  });
});

describe('g (reveal)', () => {
  it('calls onReveal with the focused id, prevents default, and moves nothing', () => {
    const t = setup({ n: 5 });
    const ev = t.press(3, 'g');
    expect(ev.defaultPrevented).toBe(true);
    expect(t.onReveal).toHaveBeenCalledWith(id(3));
    expect(t.onReveal).toHaveBeenCalledTimes(1);
    expect(t.focused()).toBe(id(3));
    expect(t.onSelect).not.toHaveBeenCalled();
    expect(t.top).toEqual([]);
    expect(t.left).toEqual([]);
    t.dispose();
  });

  it('is ignored with Ctrl/Meta/Alt and for the capital G', () => {
    const t = setup({ n: 5 });
    for (const m of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(t.press(1, 'g', { [m]: true }).defaultPrevented).toBe(false);
    }
    expect(t.press(1, 'G', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(t.onReveal).not.toHaveBeenCalled();
    t.dispose();
  });

  it('is not prevented when onReveal reports nothing handled', () => {
    const t = setup({ n: 5 });
    t.onReveal.mockReturnValue(false);
    expect(t.press(1, 'g').defaultPrevented).toBe(false);
    t.dispose();
  });

  it('is inert (not prevented) without onReveal', () => {
    const t = setup({ n: 5, reveal: false });
    expect(t.press(1, 'g').defaultPrevented).toBe(false);
    t.dispose();
  });
});

describe('arrows never write scrollLeft', () => {
  it('ArrowUp/ArrowDown only ever touch scrollTop', () => {
    const t = setup({ n: 40, clientHeight: 232 });
    for (let i = 0; i < 39; i++) t.press(i, 'ArrowDown');
    for (let i = 39; i > 0; i--) t.press(i, 'ArrowUp');
    expect(t.left).toEqual([]);
    t.dispose();
  });
});
