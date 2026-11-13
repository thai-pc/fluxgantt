// @vitest-environment jsdom
//
// Grid keyboard model on the SVG renderer, after the APG treegrid pattern (spec-grid-columns.md section 9; PR
// G4): row mode, cell mode and header mode, LTR and RTL, column memory, expand/collapse/parent, the keys the
// grid must NOT claim (#126 Alt+Arrow and Alt+Enter, Space, Delete, g, Shift+Arrow), one Tab stop, focus
// across a full repaint and a row patch, `collapseBelow`, and that the claim is synchronous while the action
// follows from the lazy chunk. Real focus rings, pinning and the accessibility tree are Playwright's.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withViewport } from '../../src/viewport/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { withGrid } from '../../src/grid/mixin.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import type { GridOptions } from '../../src/grid/types.js';

const id = toTaskId;
const t = (name: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: id(name),
  name,
  start: '2026-01-05',
  end: '2026-01-09',
  progress: 0.25,
  type: 'task',
  ...extra,
});
// p (summary) > a, b ; q (summary, no children yet shown as leaf? no: a real parent) > r ; c, d top-level leaves.
const TASKS = [
  t('p', { type: 'summary' }),
  t('a', { parent: id('p') }),
  t('b', { parent: id('p'), end: '2026-01-14' }),
  t('q', { type: 'summary' }),
  t('r', { parent: id('q') }),
  t('c'),
  t('d', { end: '2026-01-14' }),
];

beforeAll(() => import('../../src/grid/resize-ui.js'));
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

let container: HTMLElement;
beforeEach(() => {
  vi.setSystemTime(new Date('2035-01-01T00:00:00Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Setup {
  rtl?: boolean;
  grid?: GridOptions;
  interaction?: boolean;
  tasks?: TaskInput[];
}
function make(s: Setup = {}) {
  let g = withRender(createGantt({ tasks: s.tasks ?? TASKS, ...(s.rtl ? { rtl: true } : {}) }));
  if (s.interaction !== false) g = withViewport(withInteraction(g));
  if (s.rtl) g = withRtl(g);
  const grid = withGrid(g, s.grid);
  grid.mount(container);
  return grid;
}
const rowOf = (task: string) => container.querySelector<SVGElement>(`[role=row][data-task-id="${task}"]`)!;
const cellOf = (task: string, col: number) =>
  rowOf(task).querySelector<SVGElement>(`[role=gridcell][aria-colindex="${col + 1}"]`)!;
const active = () => document.activeElement as Element;
/** Where focus is, in the grid's own terms: `row:p`, `cell:p:2`, `head:1` or `other`. */
const where = (): string => {
  const a = active();
  if (!a || !container.contains(a)) return 'other';
  const role = a.getAttribute('role');
  const col = Number(a.getAttribute('aria-colindex')) - 1;
  if (role === 'columnheader') return `head:${col}`;
  const task = a.closest('[data-task-id]')?.getAttribute('data-task-id');
  return role === 'gridcell' ? `cell:${task}:${col}` : role === 'row' ? `row:${task}` : 'other';
};
interface Mods {
  alt?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  composing?: boolean;
}
/** A key on the focused element; waits for the lazy half's action. */
async function press(k: string, m: Mods = {}, target: Element = active()): Promise<KeyboardEvent> {
  const e = new KeyboardEvent('keydown', {
    key: k,
    altKey: !!m.alt,
    shiftKey: !!m.shift,
    ctrlKey: !!m.ctrl,
    metaKey: !!m.meta,
    isComposing: !!m.composing,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(e);
  await flush();
  return e;
}
const focusRow = (task: string) => rowOf(task).focus();
const tabStops = () => container.querySelectorAll('svg.fg-timeline [tabindex="0"]').length;

describe.each([
  ['LTR', false],
  ['RTL', true],
])('grid keyboard model, %s', (_name, rtl) => {
  // Logical Right/Left: physical keys swap when mirrored.
  const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  const mk = (s: Setup = {}) => make({ rtl, ...s });

  describe('row mode', () => {
    it('Right on an expanded parent enters the first (name) cell; on a leaf too', async () => {
      mk();
      focusRow('p');
      const e = await press(fwd);
      expect(e.defaultPrevented).toBe(true);
      expect(where()).toBe('cell:p:0');
      focusRow('c');
      await press(fwd);
      expect(where()).toBe('cell:c:0');
    });

    it('Right on a collapsed parent expands it and keeps the row focus', async () => {
      const g = mk();
      g.collapseAll();
      focusRow('p');
      expect(g.isCollapsed(id('p'))).toBe(true);
      const e = await press(fwd);
      expect(e.defaultPrevented).toBe(true);
      expect(g.isCollapsed(id('p'))).toBe(false);
      expect(where()).toBe('row:p');
      expect(rowOf('a')).not.toBeNull(); // the children are back
    });

    it('Left on an expanded parent collapses it and keeps the row focus', async () => {
      const g = mk();
      focusRow('p');
      const e = await press(back);
      expect(e.defaultPrevented).toBe(true);
      expect(g.isCollapsed(id('p'))).toBe(true);
      expect(where()).toBe('row:p');
    });

    it('Left on a child moves to the parent row and selects it; on a collapsed child parent too', async () => {
      const g = mk();
      focusRow('b');
      const e = await press(back);
      expect(e.defaultPrevented).toBe(true);
      expect(where()).toBe('row:p');
      expect(g.getSelection()).toContain(id('p'));
      expect(tabStops()).toBe(1);
      expect(rowOf('p').getAttribute('tabindex')).toBe('0');
      // keyboard-nav followed the move: ArrowDown continues from the parent.
      await press('ArrowDown');
      expect(where()).toBe('row:a');
    });

    it('Left on a collapsed child parent (a nested parent) moves up a level', async () => {
      const g = mk({
        tasks: [t('p', { type: 'summary' }), t('m', { type: 'summary', parent: id('p') }), t('n', { parent: id('m') }), t('z')],
      });
      g.toggleCollapse(id('m'));
      focusRow('m');
      expect(g.isCollapsed(id('m'))).toBe(true);
      await press(back);
      expect(where()).toBe('row:p');
    });

    it('Left on a top-level leaf or collapsed top-level parent does nothing and is not prevented', async () => {
      const g = mk();
      focusRow('c');
      const e = await press(back);
      expect(e.defaultPrevented).toBe(false);
      expect(where()).toBe('row:c');
      g.collapseAll();
      focusRow('q');
      const e2 = await press(back);
      expect(e2.defaultPrevented).toBe(false);
      expect(g.isCollapsed(id('q'))).toBe(true);
      expect(where()).toBe('row:q');
    });

    it('Ctrl/Cmd+Home and End move to the first and last row (selection follows)', async () => {
      const g = mk();
      focusRow('c');
      const e = await press('End', { ctrl: true });
      expect(e.defaultPrevented).toBe(true);
      expect(where()).toBe('row:d');
      expect(g.getSelection()).toEqual([id('d')]);
      await press('Home', { meta: true });
      expect(where()).toBe('row:p');
    });

    it('bare Home/End/Page keys keep their #119 row meaning (not claimed here)', async () => {
      mk();
      focusRow('c');
      await press('End');
      expect(where()).toBe('row:d');
      await press('Home');
      expect(where()).toBe('row:p');
    });

    it('Up on the first row enters header mode on the last header focused', async () => {
      mk();
      focusRow('p');
      const e = await press('ArrowUp');
      expect(e.defaultPrevented).toBe(true);
      expect(where()).toBe('head:0');
    });
  });

  describe('cell mode', () => {
    it('Right/Left move between cells, clamp at the last, and Left from the first returns to the row', async () => {
      mk();
      focusRow('c');
      await press(fwd);
      expect(where()).toBe('cell:c:0');
      for (let i = 1; i <= 4; i++) {
        await press(fwd);
        expect(where()).toBe(`cell:c:${i}`);
      }
      const e = await press(fwd); // last cell: clamped, still claimed (no horizontal scroll)
      expect(e.defaultPrevented).toBe(true);
      expect(where()).toBe('cell:c:4');
      await press(back);
      expect(where()).toBe('cell:c:3');
      for (let i = 0; i < 3; i++) await press(back);
      expect(where()).toBe('cell:c:0');
      await press(back);
      expect(where()).toBe('row:c');
    });

    it('Home and End are the first and last cell of the row', async () => {
      mk();
      focusRow('c');
      await press(fwd);
      await press('End');
      expect(where()).toBe('cell:c:4');
      await press('Home');
      expect(where()).toBe('cell:c:0');
    });

    it('Escape returns to row mode', async () => {
      mk();
      cellOf('c', 2).setAttribute('tabindex', '-1');
      cellOf('c', 2).focus();
      await flush();
      const e = await press('Escape');
      expect(e.defaultPrevented).toBe(true);
      expect(where()).toBe('row:c');
    });

    it('Down/Up keep the column (column memory) and selection follows the row', async () => {
      const g = mk();
      focusRow('c');
      await press(fwd);
      await press(fwd);
      await press(fwd);
      expect(where()).toBe('cell:c:2');
      const down = await press('ArrowDown');
      expect(down.defaultPrevented).toBe(true); // keyboard-nav's, not ours
      expect(where()).toBe('cell:d:2');
      expect(g.getSelection()).toEqual([id('d')]);
      await press('ArrowUp');
      expect(where()).toBe('cell:c:2');
      await press('ArrowUp');
      expect(where()).toBe('cell:r:2'); // q is collapsed? no: q is expanded, so r precedes c
      expect(tabStops()).toBe(1);
    });

    it('Page and Ctrl+Home/End keep the column', async () => {
      mk();
      focusRow('c');
      await press(fwd);
      await press(fwd);
      expect(where()).toBe('cell:c:1');
      await press('End', { ctrl: true });
      expect(where()).toBe('cell:d:1');
      await press('Home', { ctrl: true });
      expect(where()).toBe('cell:p:1');
      await press('PageDown');
      expect(where().endsWith(':1')).toBe(true);
      expect(where().startsWith('cell:')).toBe(true);
      expect(tabStops()).toBe(1);
    });

    it('Up from a cell in row 0 goes to that column header, and Down returns to the same cell', async () => {
      mk();
      focusRow('p');
      await press(fwd);
      await press(fwd);
      await press(fwd);
      expect(where()).toBe('cell:p:2');
      const e = await press('ArrowUp');
      expect(e.defaultPrevented).toBe(true);
      expect(where()).toBe('head:2');
      await press(fwd);
      expect(where()).toBe('head:3');
      await press('ArrowDown');
      expect(where()).toBe('cell:p:3');
    });

    it('Escape from a header returns to a ROW, not a cell; header Home/End move among headers', async () => {
      mk();
      focusRow('p');
      await press(fwd);
      await press(fwd);
      await press('ArrowUp');
      expect(where()).toBe('head:1');
      await press('End');
      expect(where()).toBe('head:4');
      await press('Home');
      expect(where()).toBe('head:0');
      await press('Escape');
      expect(where()).toBe('row:p');
    });

    it('Ctrl+Home on a header is the first header', async () => {
      mk();
      focusRow('p');
      await press('ArrowUp');
      await press('End');
      await press('Home', { ctrl: true });
      expect(where()).toBe('head:0');
    });

    it('a cell is script-focusable only: the chart stays one Tab stop', async () => {
      mk();
      expect(tabStops()).toBe(1);
      focusRow('c');
      await press(fwd);
      await press(fwd);
      expect(where()).toBe('cell:c:1');
      expect(tabStops()).toBe(1);
      expect(active().getAttribute('tabindex')).toBe('-1');
      expect(container.querySelectorAll('svg.fg-timeline [tabindex]:not([tabindex="-1"])')).toHaveLength(1);
    });
  });

  describe('keys the grid does not own', () => {
    it('Alt+Arrow moves and Alt+Shift+Arrow resizes the task from a focused cell (#126), Alt+Enter links', async () => {
      const g = mk();
      focusRow('c');
      await press(fwd);
      await press(fwd);
      expect(where()).toBe('cell:c:1');
      const before = String(g.getTask(id('c'))!.start);
      const e = await press(fwd, { alt: true });
      expect(e.defaultPrevented).toBe(true);
      expect(where()).toBe('cell:c:1'); // not claimed by the grid: no cell move
      expect(String(g.getTask(id('c'))!.start)).not.toBe(before);
      const end = String(g.getTask(id('c'))!.end);
      await press(fwd, { alt: true, shift: true });
      expect(String(g.getTask(id('c'))!.end)).not.toBe(end);
      await press('d', { shift: true });
      await press('Enter', { alt: true }); // no anchor row: handled (or not) exactly as from a row
    });

    it('Alt+Arrow works from a row exactly as before', async () => {
      const g = mk();
      focusRow('c');
      const before = String(g.getTask(id('c'))!.start);
      await press(fwd, { alt: true });
      expect(String(g.getTask(id('c'))!.start)).not.toBe(before);
      expect(where()).toBe('row:c');
    });

    it('Shift+Left/Right, Space, g and Delete from a cell are keyboard-nav business', async () => {
      const g = mk();
      focusRow('c');
      await press(fwd);
      await press(fwd);
      const s = await press(fwd, { shift: true });
      expect(s.defaultPrevented).toBe(false);
      expect(where()).toBe('cell:c:1');
      await press(' ');
      expect(g.getSelection()).toContain(id('c'));
      const del = await press('Delete');
      expect(del.defaultPrevented).toBe(true); // still deletes the selection (no "clear cell")
      expect(g.getTask(id('c'))).toBeUndefined();
    });

    it('Enter and F2 are unclaimed (reserved for editing)', async () => {
      const g = mk();
      focusRow('p');
      await press(fwd);
      expect(where()).toBe('cell:p:0');
      const f2 = await press('F2');
      expect(f2.defaultPrevented).toBe(false);
      const en = await press('Enter'); // keyboard-nav: a parent row toggles collapse
      expect(en.defaultPrevented).toBe(true);
      expect(g.isCollapsed(id('p'))).toBe(true);
    });

    it('modifier combinations the grid does not own are not prevented', async () => {
      mk();
      focusRow('c');
      await press(fwd);
      for (const m of [{ ctrl: true }, { meta: true }, { ctrl: true, shift: true }] as Mods[]) {
        const e = await press(fwd, m);
        expect(e.defaultPrevented).toBe(false);
      }
      expect(where()).toBe('cell:c:0');
    });

    it('ignores a key during IME composition, a synthetic re-entry and an earlier handler\'s preventDefault', async () => {
      mk();
      focusRow('c');
      const e = await press(fwd, { composing: true });
      expect(e.defaultPrevented).toBe(false);
      expect(where()).toBe('row:c');
      const early = (ev: Event) => ev.preventDefault();
      container.addEventListener('keydown', early, true);
      container.removeEventListener('keydown', early, true);
      // an earlier capture listener (registered BEFORE the grid's would be needed; one on the document runs first)
      document.addEventListener('keydown', early, true);
      const e2 = await press(fwd);
      document.removeEventListener('keydown', early, true);
      expect(e2.defaultPrevented).toBe(true);
      expect(where()).toBe('row:c'); // we did not act on it
    });
  });

  describe('focus across repaints', () => {
    it('a full repaint (updateTask) keeps the focused cell', async () => {
      const g = mk();
      focusRow('c');
      await press(fwd);
      await press(fwd);
      await press(fwd);
      expect(where()).toBe('cell:c:2');
      g.updateTask(id('c'), { name: 'changed' });
      await flush();
      expect(where()).toBe('cell:c:2');
      (g as unknown as { setDensity(d: string): void }).setDensity('compact');
      await flush();
      expect(where()).toBe('cell:c:2');
    });

    it('a row patch (programmatic select) keeps the focused cell on the focused row', async () => {
      const g = mk();
      focusRow('c');
      await press(fwd);
      await press(fwd);
      g.select(id('c'));
      await flush();
      expect(where()).toBe('cell:c:1');
    });

    it('row mode stays row mode across a repaint', async () => {
      const g = mk();
      focusRow('c');
      g.updateTask(id('c'), { name: 'changed' });
      await flush();
      expect(where()).toBe('row:c');
    });

    it('clicking (focusing) a row clears cell mode: the next repaint restores the row', async () => {
      const g = mk();
      focusRow('c');
      await press(fwd);
      await press(fwd);
      focusRow('d');
      await flush();
      g.updateTask(id('d'), { name: 'changed' });
      await flush();
      expect(where()).toBe('row:d');
    });

    it('a header keeps focus across a repaint (G3) and cell mode does not leak into it', async () => {
      const g = mk();
      focusRow('p');
      await press(fwd);
      await press('ArrowUp');
      expect(where()).toBe('head:0');
      g.updateTask(id('c'), { name: 'changed' });
      await flush();
      expect(where()).toBe('head:0');
    });
  });
});

describe('the SVG cell ring', () => {
  it('is one sticky element in the layer, inset into the cell, carrying the row-frame rule, and goes with the focus', async () => {
    make();
    focusRow('c');
    await press('ArrowRight');
    await press('ArrowRight');
    const ringEl = () => container.querySelectorAll<HTMLElement>('.fg-timeline__layer > .fg-grid__ring');
    expect(ringEl()).toHaveLength(1);
    const r = ringEl()[0]!;
    expect(r.classList.contains('fg-grid__cell')).toBe(true);
    expect(r.style.insetInlineStart).toBe('224px'); // the Start column begins at 220, inset 4
    expect(r.style.width).toBe('112px');
    expect(r.querySelector('style')!.textContent).toContain('.fg-timeline__focus-row');
    expect(r.style.position).toBe('sticky');
    // a header ring is the same element without the row frame and pinned to the top
    await press('ArrowUp'); // c is not row 0: nothing
    focusRow('p');
    await press('ArrowUp');
    expect(ringEl()).toHaveLength(1);
    expect(ringEl()[0]!.classList.contains('fg-grid__cell')).toBe(false);
    expect(ringEl()[0]!.querySelector('style')).toBeNull();
    (active() as HTMLElement).blur();
    expect(ringEl()).toHaveLength(0);
  });

  it('is not added on Canvas-less charts that never focus a cell, and no invisible node is added to the pinned svg', async () => {
    make();
    const pinned = container.querySelector('svg.fg-timeline__sticky-column')!;
    const before = pinned.querySelectorAll('*').length;
    focusRow('c');
    await press('ArrowRight');
    await press('ArrowRight');
    expect(pinned.querySelectorAll('*').length).toBe(before);
    expect(container.querySelectorAll('.fg-grid__ring')).toHaveLength(1);
  });
});

describe('RTL specifics', () => {
  it('the physical ArrowRight is "back" and ArrowLeft is "forward"', async () => {
    const g = make({ rtl: true });
    focusRow('p');
    await press('ArrowRight'); // logical Left on an expanded parent: collapse
    expect(g.isCollapsed(id('p'))).toBe(true);
    await press('ArrowLeft'); // logical Right on a collapsed parent: expand
    expect(g.isCollapsed(id('p'))).toBe(false);
    await press('ArrowLeft'); // enter the first cell
    expect(where()).toBe('cell:p:0');
    await press('ArrowLeft');
    expect(where()).toBe('cell:p:1');
    await press('ArrowRight');
    await press('ArrowRight');
    expect(where()).toBe('row:p');
  });
});

describe('collapseBelow', () => {
  it('with only the name column, cell mode is one cell: Right enters it and clamps, Left leaves', async () => {
    const ro = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor() {
          ro();
        }
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 300 });
    make({ grid: { collapseBelow: 480 } });
    vi.unstubAllGlobals();
    expect(container.querySelectorAll('svg.fg-timeline [role=columnheader]')).toHaveLength(1);
    focusRow('c');
    await press('ArrowRight');
    expect(where()).toBe('cell:c:0');
    const e = await press('ArrowRight');
    expect(e.defaultPrevented).toBe(true);
    expect(where()).toBe('cell:c:0');
    await press('End');
    expect(where()).toBe('cell:c:0');
    await press('ArrowLeft');
    expect(where()).toBe('row:c');
  });
});

describe('resizable:false', () => {
  it('cell mode and header mode still work (they are navigation, not resizing)', async () => {
    make({ grid: { resizable: false } });
    focusRow('c');
    await press('ArrowRight');
    await press('ArrowRight');
    expect(where()).toBe('cell:c:1');
    await press('ArrowDown');
    expect(where()).toBe('cell:d:1');
    expect(container.querySelectorAll('.fg-grid__sizer')).toHaveLength(0);
  });
});

describe('without a grid nothing changes', () => {
  it('bare Left/Right and Ctrl+Home/End are not prevented and move nothing', async () => {
    const g = withInteraction(withRender(createGantt({ tasks: TASKS })));
    g.mount(container);
    const row = container.querySelector<SVGElement>('[role=row][data-task-id="p"]')!;
    row.focus();
    for (const [k, m] of [
      ['ArrowRight', {}],
      ['ArrowLeft', {}],
      ['ArrowRight', { shift: true }],
      ['Home', { ctrl: true }],
      ['End', { ctrl: true }],
      ['F2', {}],
    ] as [string, Mods][]) {
      const e = await press(k, m, row);
      expect(e.defaultPrevented, k).toBe(false);
      expect(document.activeElement).toBe(row);
    }
    expect(g.isCollapsed(id('p'))).toBe(false);
  });
});

describe('the claim is synchronous, the action follows from the lazy chunk', () => {
  it('preventDefault is decided on the first key; the focus moves after the chunk resolves', async () => {
    make();
    focusRow('c');
    const seen = vi.fn();
    container.querySelector('svg.fg-timeline')!.addEventListener('keydown', seen); // keyboard-nav's root
    const e = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    active().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true); // Alt+Left-style fall-through is impossible
    expect(seen).not.toHaveBeenCalled(); // stopped in the capture phase: keyboard-nav never saw it
    expect(where()).toBe('row:c'); // the action is deferred to the lazy half
    await flush();
    expect(where()).toBe('cell:c:0');
  });

  it('an unclaimed key is not delayed and reaches keyboard-nav', async () => {
    make();
    focusRow('c');
    const seen = vi.fn();
    container.querySelector('svg.fg-timeline')!.addEventListener('keydown', seen);
    const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }); // top-level leaf
    active().dispatchEvent(e);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('property: any key sequence leaves focus on a real row, cell or header and never throws', () => {
  const KEYS = [
    ['ArrowRight', {}],
    ['ArrowLeft', {}],
    ['ArrowUp', {}],
    ['ArrowDown', {}],
    ['Home', {}],
    ['End', {}],
    ['Home', { ctrl: true }],
    ['End', { ctrl: true }],
    ['PageDown', {}],
    ['PageUp', {}],
    ['Escape', {}],
  ] as const;
  it('holds over random sequences and trees', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: KEYS.length - 1 }), { minLength: 1, maxLength: 14 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 2 }),
        async (seq, rtl, collapsed) => {
          container.replaceChildren();
          const g = make({ rtl });
          if (collapsed === 1) g.collapseAll();
          if (collapsed === 2) g.toggleCollapse(id('p'));
          focusRow('p') ;
          for (const i of seq) {
            const [k, m] = KEYS[i]!;
            await press(k, m as Mods);
            const w = where();
            expect(w).not.toBe('other');
            const a = active();
            expect(a.isConnected).toBe(true);
            if (!w.startsWith('head')) {
              const task = a.closest('[data-task-id]')!.getAttribute('data-task-id')!;
              expect(g.getTask(id(task))).toBeDefined();
              expect(rowOf(task)).not.toBeNull(); // visible: it has a row element
            }
            expect(tabStops()).toBe(1);
          }
          g.destroy();
        },
      ),
      { numRuns: 25 },
    );
  }, 60_000);
});
