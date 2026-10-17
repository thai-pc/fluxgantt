// @vitest-environment jsdom
//
// Keyboard reveal (spec-keyboard-focus-scroll.md §9): ArrowUp/ArrowDown scroll the SVG container
// by the minimum so the newly focused row is fully below the 32px header band and inside the
// viewport. jsdom has no layout, so `clientHeight`/`scrollTop` are faked on the container.
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { enableKeyboardNav } from '../../src/interaction/keyboard-nav.js';
import type { InteractiveRendererHandle } from '../../src/render/interactive-renderer-handle.js';
import { ROW_HEIGHT, layoutRows } from '../../src/render/renderer-base.js';
import { toTaskId, type Density, type Task, type TaskId } from '../../src/types.js';

const HEADER = 32;
const DENSITIES: Density[] = ['compact', 'default', 'comfortable', 'touch'];

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

function setup(opts: {
  n: number;
  density?: Density;
  clientHeight: number;
  scrollTop: number;
  tag?: 'svg' | 'div';
}) {
  const density = opts.density ?? 'default';
  const tasks = makeTasks(opts.n);
  const container = document.createElement('div');
  let scrollTop = opts.scrollTop;
  const writes: number[] = [];
  Object.defineProperty(container, 'clientHeight', { value: opts.clientHeight });
  Object.defineProperty(container, 'scrollLeft', { value: 0, writable: true });
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      writes.push(v);
      scrollTop = v;
    },
  });
  const root =
    opts.tag === 'div'
      ? document.createElement('div')
      : document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const rowEls = tasks.map((t, i) => {
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
  const handle = { interactionRoot: root } as unknown as InteractiveRendererHandle;
  const nav = enableKeyboardNav(handle, {
    onSelect,
    onToggle: vi.fn(),
    onRangeSelect,
    onDeleteSelected: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDuplicateSelected: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    getTasks: () => tasks,
    density,
    isReadOnly: () => false,
    getSelection: () => [],
    getCollapsedIds: () => new Set<TaskId>(),
    onToggleCollapse: vi.fn(),
  });
  const rowY = layoutRows(tasks, density, new Set<TaskId>()).map((r) => r.y);
  /** Focus row `index` (pointer-style, no scroll) and press `key` on it. */
  function press(index: number, key: string, shiftKey = false): void {
    nav.focusTask(tasks[index]!.id);
    rowEls[index]!.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    );
  }
  return {
    nav,
    container,
    rowEls,
    writes,
    rowY,
    h: ROW_HEIGHT[density],
    onSelect,
    onRangeSelect,
    press,
    getScrollTop: () => scrollTop,
    dispose: () => {
      nav.dispose();
      container.remove();
    },
  };
}

describe('keyboard reveal — SVG vertical scroll', () => {
  it('ArrowDown onto a row below the fold scrolls its bottom flush with the viewport', () => {
    const t = setup({ n: 40, clientHeight: 232, scrollTop: 0 }); // band = 200px
    t.press(5, 'ArrowDown'); // next row 6: y=192, bottom 224 > 200
    expect(t.getScrollTop()).toBe(t.rowY[6]! + t.h - 200);
    t.dispose();
  });

  it('ArrowUp onto a row above scrollTop pins that row to the top of the band', () => {
    const t = setup({ n: 40, clientHeight: 232, scrollTop: 400 });
    t.press(5, 'ArrowUp'); // row 4: y=128 < 400
    expect(t.getScrollTop()).toBe(t.rowY[4]);
    t.dispose();
  });

  it('writes nothing for a row already fully visible, incl. flush top and bottom edges', () => {
    const top = setup({ n: 40, clientHeight: 232, scrollTop: 64 }); // band [64, 264)
    top.press(1, 'ArrowDown'); // row 2: y=64, flush top
    expect(top.getScrollTop()).toBe(64);
    top.press(6, 'ArrowDown'); // row 7: y=224..256, inside
    expect(top.getScrollTop()).toBe(64);
    top.dispose();
    const bottom = setup({ n: 40, clientHeight: 232, scrollTop: 56 }); // band [56, 256)
    bottom.press(6, 'ArrowDown'); // row 7 ends at exactly 256
    expect(bottom.getScrollTop()).toBe(56);
    bottom.dispose();
  });

  it('a row taller than the band pins to its top', () => {
    const t = setup({ n: 10, density: 'touch', clientHeight: 32 + 20, scrollTop: 300 });
    t.press(1, 'ArrowDown'); // row 2: y=96, band 20 < 48
    expect(t.getScrollTop()).toBe(t.rowY[2]);
    t.dispose();
  });

  it('Shift+Arrow scrolls like the plain arrow and keeps the range callbacks', () => {
    const t = setup({ n: 40, clientHeight: 232, scrollTop: 0 });
    t.press(5, 'ArrowDown', true);
    expect(t.getScrollTop()).toBe(t.rowY[6]! + t.h - 200);
    expect(t.onRangeSelect).toHaveBeenCalledTimes(1);
    expect(t.onSelect).not.toHaveBeenCalled();
    t.dispose();
    const u = setup({ n: 40, clientHeight: 232, scrollTop: 400 });
    u.press(5, 'ArrowUp', true);
    expect(u.getScrollTop()).toBe(u.rowY[4]);
    u.dispose();
  });

  it('does not write when clientHeight <= 32 (unlaid-out container)', () => {
    for (const clientHeight of [0, 32]) {
      const t = setup({ n: 10, clientHeight, scrollTop: 0 });
      t.press(3, 'ArrowDown');
      expect(t.writes).toEqual([]);
      t.dispose();
    }
  });

  it('does not write at the ends (no wraparound)', () => {
    const t = setup({ n: 5, clientHeight: 232, scrollTop: 0 });
    t.press(4, 'ArrowDown');
    t.press(0, 'ArrowUp');
    expect(t.writes).toEqual([]);
    t.dispose();
  });

  it('never writes scrollTop for a non-SVG interaction root (Canvas reveals its own row)', () => {
    const t = setup({ n: 40, clientHeight: 232, scrollTop: 0, tag: 'div' });
    t.press(30, 'ArrowDown');
    expect(t.writes).toEqual([]);
    t.dispose();
  });

  it('pointer paths (focusTask, focusin) never write scrollTop', () => {
    const t = setup({ n: 40, clientHeight: 232, scrollTop: 0 });
    t.nav.focusTask(toTaskId('t30'));
    t.rowEls[35]!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(t.writes).toEqual([]);
    expect(t.nav.getFocusedTaskId()).toBe(toTaskId('t35'));
    t.dispose();
  });

  it('works for all four densities', () => {
    for (const density of DENSITIES) {
      const t = setup({ n: 60, density, clientHeight: 32 + 200, scrollTop: 0 });
      t.press(9, 'ArrowDown');
      expect(t.getScrollTop()).toBe(Math.max(0, t.rowY[10]! + t.h - 200));
      t.dispose();
    }
  });

  it('property: result is visible-or-pinned-top, minimal, and never touches scrollLeft', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 80 }),
        fc.constantFrom(...DENSITIES),
        fc.integer({ min: 33, max: 900 }),
        fc.integer({ min: 0, max: 4000 }),
        fc.integer({ min: 0, max: 79 }),
        fc.boolean(),
        (n, density, clientHeight, scrollTop, rawFrom, down) => {
          const from = rawFrom % n;
          const to = from + (down ? 1 : -1);
          fc.pre(to >= 0 && to < n);
          const t = setup({ n, density, clientHeight, scrollTop });
          t.press(from, down ? 'ArrowDown' : 'ArrowUp');
          const band = clientHeight - HEADER;
          const y = t.rowY[to]!;
          const after = t.getScrollTop();
          const wasVisible = y >= scrollTop && y + t.h <= scrollTop + band;
          if (wasVisible) expect(after).toBe(scrollTop);
          else if (t.h > band) expect(after).toBe(y);
          else {
            expect(y).toBeGreaterThanOrEqual(after);
            expect(y + t.h).toBeLessThanOrEqual(after + band);
          }
          expect((t.container as unknown as { scrollLeft: number }).scrollLeft).toBe(0);
          t.dispose();
        },
      ),
      { numRuns: 200 },
    );
  });
});
