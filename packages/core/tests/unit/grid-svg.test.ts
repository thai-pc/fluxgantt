// @vitest-environment jsdom
//
// withGrid on the SVG renderer (spec-grid-columns.md 5.2, 9.1): structure, roles, truncation, the row
// patch, pinned-width ownership, RTL ordering, collapseBelow, exports, and the no-grid regression.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withResponsive } from '../../src/responsive/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { withIo } from '../../src/io/mixin.js';
import { withGrid } from '../../src/grid/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import { toTaskId } from '../../src/types.js';
import type { SvgRendererHandle } from '../../src/render/svg-renderer.js';
import type { TaskInput } from '../../src/store/index.js';
import type { GridColumnInput } from '../../src/grid/types.js';

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
const TASKS = [t('p', { type: 'summary' }), t('a', { parent: id('p') }), t('b', { parent: id('p'), end: '2026-01-14' }), t('c')];

let container: HTMLElement;
beforeEach(() => {
  vi.setSystemTime(new Date('2035-01-01T00:00:00Z')); // no today rule
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const handleOf = (g: object): SvgRendererHandle => getInternal(g).mountOf()!.handle as SvgRendererHandle;
const svgOf = () => container.querySelector('svg.fg-timeline') as SVGSVGElement;
const column = () => container.querySelector('.fg-timeline__sticky-column') as SVGSVGElement;
const corner = () => container.querySelector('.fg-timeline__sticky-corner') as SVGSVGElement;
const rowEl = (name: string) => svgOf().querySelector(`.fg-timeline__row[data-task-id="${name}"]`) as SVGElement;
/** The visible text of a label/cell: its last child (a cut one has a <title> before it). */
const shown = (e: Element): string => e.lastChild!.textContent!;
const cells = (name: string) => [...rowEl(name).querySelectorAll('[role=gridcell]')];

function mount(config: Record<string, unknown> = {}, columns?: GridColumnInput[], opts: Record<string, unknown> = {}) {
  const g = withGrid(withInteraction(withRender(createGantt({ tasks: TASKS, ...config }))), { ...(columns ? { columns } : {}), ...opts });
  g.mount(container);
  return g;
}

describe('structure and roles', () => {
  it('sums the column widths into the pinned width and owns it', () => {
    const g = mount();
    const h = handleOf(g);
    expect(h.getLabelColumnWidth()).toBe(220 + 120 + 120 + 96 + 96);
    expect(h.fixedLabelWidth).toBe(true);
    expect(column().getAttribute('width')).toBe('652');
    expect(corner().getAttribute('width')).toBe('652');
  });

  it('exposes aria-colcount, aria-rowcount (+ header) and shifted aria-rowindex', () => {
    mount();
    const svg = svgOf();
    expect(svg.getAttribute('role')).toBe('treegrid');
    expect(svg.getAttribute('aria-colcount')).toBe('5');
    expect(svg.getAttribute('aria-rowcount')).toBe('5'); // 4 rows + the header
    expect([...svg.querySelectorAll('.fg-timeline__row')].map((r) => r.getAttribute('aria-rowindex'))).toEqual(['2', '3', '4', '5']);
  });

  it('has a real header row of columnheaders with colindex and an accessible name', () => {
    mount();
    const head = svgOf().querySelector('[role=row][aria-rowindex="1"]')!;
    const hs = [...head.querySelectorAll('[role=columnheader]')];
    expect(hs.map((h) => h.getAttribute('aria-colindex'))).toEqual(['1', '2', '3', '4', '5']);
    expect(hs.map((h) => h.getAttribute('data-column-id'))).toEqual(['name', 'start', 'end', 'duration', 'progress']);
    expect(hs[1]!.getAttribute('aria-label')).toBe('Start, column 2 of 5');
    expect(hs.map((h) => h.textContent)).toEqual(['Name', 'Start', 'End', 'Duration', 'Progress']);
    // the header row comes BEFORE the data rows in document order, outside the rows group
    expect(head.parentElement).toBe(svgOf());
    expect(head.compareDocumentPosition(rowEl('p')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives every data row one gridcell per column (name cell is column 1), with column ids', () => {
    mount();
    const row = rowEl('c');
    const own = [row.querySelector('.fg-timeline__row-cell')!, ...row.querySelectorAll('.fg-grid__cells [role=gridcell]')];
    expect(own.map((c) => c.getAttribute('aria-colindex'))).toEqual(['1', '2', '3', '4', '5']);
    expect([...row.querySelectorAll('.fg-grid__cells [role=gridcell]')].map((c) => `${c.getAttribute('data-column-id')}=${c.textContent}`)).toEqual([
      'start=Jan 5, 2026', 'end=Jan 9, 2026', 'duration=4d', 'progress=25%',
    ]);
  });

  it('end/duration/progress cells are end-anchored, start cells are not', () => {
    mount();
    const byCol = Object.fromEntries(cells('c').slice(0).map((c) => [c.getAttribute('data-column-id'), c]));
    expect(byCol.start!.getAttribute('text-anchor')).toBeNull();
    expect(byCol.duration!.getAttribute('text-anchor')).toBe('end');
    expect(byCol.progress!.getAttribute('x')).toBe(String(220 + 120 + 120 + 96 + 96 - 8));
  });

  it('the pinned overlays are aria-hidden clones without roles, tabindex, ids or focusable content', () => {
    mount();
    for (const layer of [column(), corner()]) {
      expect(layer.getAttribute('aria-hidden')).toBe('true');
      expect(layer.querySelectorAll('[role],[tabindex],[id],[aria-label],a,button,input').length).toBe(0);
    }
    // the column clone carries each cell text and the row's dataset (a click resolves to the row)
    const cloneRow = column().querySelector('g[data-task-id="c"]')!;
    expect(cloneRow.getAttribute('data-row-index')).toBe('3');
    expect([...cloneRow.querySelectorAll('text')].map((x) => x.textContent)).toEqual(['Jan 5, 2026', 'Jan 9, 2026', '4d', '25%']);
    expect(corner().textContent).toBe('NameStartEndDurationProgress');
  });

  it('draws one divider per inner column boundary in the chart, the column and (header height) the corner', () => {
    mount();
    expect(svgOf().querySelectorAll(':scope > g > line').length).toBeGreaterThan(0);
    const xs = [...column().querySelectorAll(':scope > g:first-child line, :scope > g > line')].map((l) => l.getAttribute('x1'));
    expect(xs).toContain('219.5');
    expect(corner().querySelectorAll('line')).toHaveLength(4);
  });

  it('hides the real cells live (scoped style) and leaves them visible to a plain serialization', () => {
    mount();
    const css = [...svgOf().querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toContain('.fg-timeline__layer>.fg-timeline .fg-grid__cells');
    expect(css).not.toContain('/*');
    expect(corner().querySelector('style')).toBeNull();
  });

  it('one custom column: header, value, format, alignment', () => {
    const g = mount({}, [
      { id: 'name' },
      { id: 'owner', header: 'Owner', align: 'center', width: 120, value: (task) => String(task.meta?.owner ?? '-'), format: (v) => `@${v}` },
    ]);
    expect(svgOf().getAttribute('aria-colcount')).toBe('2');
    const cell = cells('a').find((c) => c.getAttribute('data-column-id') === 'owner')!;
    expect(cell.textContent).toBe('@-');
    expect(cell.getAttribute('text-anchor')).toBe('middle');
    expect(handleOf(g).getLabelColumnWidth()).toBe(340);
  });
});

describe('truncation (ellipsis, full text in the accessible name and <title>)', () => {
  const LONG = 'A very long task name that cannot possibly fit inside a narrow name column';

  it('cuts the name in the chart and the clone, and exposes the full name', () => {
    mount({ tasks: [t('x', { name: LONG })] }, [{ id: 'name', width: 140 }]);
    const label = svgOf().querySelector('.fg-timeline__row-label')!;
    expect(shown(label).endsWith('…')).toBe(true);
    expect(shown(label).length).toBeLessThan(LONG.length);
    expect(label.querySelector('title')!.textContent).toBe(LONG);
    expect(label.parentElement!.getAttribute('aria-label')).toBe(LONG);
    const clone = column().querySelector('.fg-timeline__row-label')!;
    expect(shown(clone)).toBe(shown(label));
    expect(clone.querySelector('title')!.textContent).toBe(LONG);
  });

  it('leaves a short name untouched (no title, no aria-label override)', () => {
    mount();
    const label = svgOf().querySelector('.fg-timeline__row-label')!;
    expect(label.querySelector('title')).toBeNull();
    expect(label.parentElement!.hasAttribute('aria-label')).toBe(false);
  });

  it('cuts a long custom cell on a grapheme boundary and keeps the full text in aria-label and <title>', () => {
    const long = 'e\u0301'.repeat(100);
    mount({}, [{ id: 'name' }, { id: 'x', header: 'X', width: 90, value: () => long } as GridColumnInput]);
    const cell = cells('c').find((c) => c.getAttribute('data-column-id') === 'x')!;
    expect(cell.getAttribute('aria-label')).toBe(long);
    expect(cell.querySelector('title')!.textContent).toBe(long);
    const shown = cell.lastChild!.textContent!;
    expect(shown.endsWith('…')).toBe(true);
    expect(shown.slice(0, -1).length % 2).toBe(0); // whole e+accent pairs only
    expect(shown.at(-2)).toBe('\u0301');
  });

  it('cuts a header that does not fit and keeps the full header as the title', () => {
    mount({}, [{ id: 'name' }, { id: 'x', header: 'Estimated effort in person-hours', width: 80, value: () => 1 } as GridColumnInput]);
    const h = svgOf().querySelector('[data-column-id=x][role=columnheader]')!;
    expect(shown(h.querySelector('text')!).endsWith('…')).toBe(true);
    expect(h.querySelector('title')!.textContent).toBe('Estimated effort in person-hours');
  });
});

describe('repaint and the row patch', () => {
  it('a selection patch equals a forced full render byte for byte and rebuilds only the changed rows', () => {
    const g = mount();
    const before = [...svgOf().querySelectorAll('.fg-timeline__row')];
    const colBefore = column().outerHTML;
    g.select(id('b'));
    const after = [...svgOf().querySelectorAll('.fg-timeline__row')];
    expect(after.map((r, i) => r !== before[i])).toEqual([false, false, true, false]);
    expect(cells('b')).toHaveLength(5 - 1 + 1); // the 4 grid cells + the name gridcell
    expect(column().outerHTML).toBe(colBefore); // the pinned column is not touched by a patch
    const patched = container.querySelector('.fg-timeline__layer')!.outerHTML;
    handleOf(g).setOptions({});
    expect(container.querySelector('.fg-timeline__layer')!.outerHTML).toBe(patched);
  });

  it('a patch re-truncates a long name on the rebuilt row', () => {
    const LONG = 'x'.repeat(200);
    const g = mount({ tasks: [t('a', { name: LONG }), t('b')] });
    g.select(id('a'));
    const label = rowEl('a').querySelector('.fg-timeline__row-label')!;
    expect(shown(label).length).toBeLessThan(200);
    expect(label.querySelector('title')!.textContent).toBe(LONG);
  });

  it('data changes repaint the values', () => {
    const g = mount();
    g.updateTask(id('c'), { progress: 0.9, name: 'Renamed' });
    expect(cells('c').at(-1)!.textContent).toBe('90%');
    expect(column().querySelector('g[data-task-id="c"] text:last-child')!.textContent).toBe('90%');
  });

  it('collapse/zoom repaints do not re-read custom values (memoized per data revision)', () => {
    const value = vi.fn(() => 'v');
    const g = mount({}, [{ id: 'name' }, { id: 'x', header: 'X', value } as GridColumnInput]);
    const calls = value.mock.calls.length;
    g.zoomTo('month');
    g.toggleCollapse(id('p'));
    expect(value.mock.calls.length).toBeLessThanOrEqual(calls + 0);
  });

  it('setGridColumns repaints once with the new width; an invalid list throws and changes nothing', () => {
    const g = mount();
    const spy = vi.spyOn(handleOf(g), 'setOptions');
    g.setGridColumns([{ id: 'name', width: 150 }, { id: 'progress' }]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(handleOf(g).getLabelColumnWidth()).toBe(150 + 96);
    expect(svgOf().getAttribute('aria-colcount')).toBe('2');
    expect(g.getGridColumns().map((c) => c.id)).toEqual(['name', 'progress']);
    const html = container.innerHTML;
    expect(() => g.setGridColumns([{ id: 'nope bad' } as never])).toThrow(RangeError);
    expect(container.innerHTML).toBe(html);
    expect(g.getGridColumns()).toHaveLength(2);
  });

  it('getGridColumns returns a fresh array of public descriptors', () => {
    const g = mount();
    const a = g.getGridColumns();
    expect(a).not.toBe(g.getGridColumns());
    expect(a[0]).toEqual({ id: 'name', header: 'Name', width: 220, minWidth: 48, maxWidth: 600, align: 'start', builtIn: true });
  });

  it('remount repaints the grid at the right width', () => {
    const g = mount();
    g.unmount();
    expect(container.querySelector('svg')).toBeNull();
    g.mount(container);
    expect(handleOf(g).getLabelColumnWidth()).toBe(652);
    expect(svgOf().querySelectorAll('[role=columnheader]')).toHaveLength(5);
  });

  it('is identical across view modes (the grid does not depend on the time scale)', () => {
    const g = mount();
    const grab = () => [...rowEl('c').querySelectorAll('.fg-grid__cells')].map((c) => c.outerHTML).join('') + corner().outerHTML + column().querySelector('g[data-task-id="c"]')!.outerHTML;
    const week = grab();
    g.zoomTo('month');
    expect(grab()).toBe(week);
  });
});

describe('pinned width ownership', () => {
  function stubResponsive() {
    class RO {
      static all: RO[] = [];
      constructor(readonly cb: () => void) { RO.all.push(this); }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', RO);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })));
    return RO;
  }

  it.each([['grid outermost'], ['responsive outermost']])('withResponsive does not narrow the grid (%s)', (order) => {
    const RO = stubResponsive();
    Object.defineProperty(container, 'clientWidth', { value: 360, configurable: true });
    const base = withInteraction(withRender(createGantt({ tasks: TASKS })));
    const off = { collapseBelow: 0 };
    const g = order === 'grid outermost' ? withGrid(withResponsive(base), off) : withResponsive(withGrid(base, off));
    g.mount(container);
    for (const ro of RO.all) ro.cb();
    expect(handleOf(g).getLabelColumnWidth()).toBe(652);
    expect(svgOf().getAttribute('aria-colcount')).toBe('5');
  });

  it('without the grid, withResponsive still owns the width', () => {
    const RO = stubResponsive();
    Object.defineProperty(container, 'clientWidth', { value: 360, configurable: true });
    const g = withResponsive(withInteraction(withRender(createGantt({ tasks: TASKS }))));
    g.mount(container);
    for (const ro of RO.all) ro.cb();
    expect(handleOf(g).fixedLabelWidth).toBeUndefined();
    expect(handleOf(g).getLabelColumnWidth()).not.toBe(160);
  });
});

describe('RTL', () => {
  const build = (order: 'grid-last' | 'rtl-last') => {
    const base = withInteraction(withRender(createGantt({ tasks: TASKS, rtl: true })));
    const g = order === 'grid-last' ? withGrid(withRtl(base)) : withRtl(withGrid(base));
    g.mount(container);
    return g;
  };

  it.each(['grid-last', 'rtl-last'] as const)('mirrors the grid content in all four roots (%s)', (order) => {
    build(order);
    for (const root of [svgOf(), column(), corner()]) {
      expect(root.firstElementChild!.classList.contains('fg-rtl')).toBe(true);
    }
    // every grid text is counter-flipped about its own x, so glyphs stay upright
    for (const text of [...rowEl('c').querySelectorAll('.fg-grid__cells text'), ...column().querySelectorAll('g[data-task-id="c"] text'), ...corner().querySelectorAll('text')]) {
      expect(text.getAttribute('transform')).toBe(`matrix(-1 0 0 1 ${2 * Number(text.getAttribute('x'))} 0)`);
    }
    // end-anchored cells keep text-anchor=end under the group's direction=rtl (probed in the e2e suite)
    expect(cells('c').find((c) => c.getAttribute('data-column-id') === 'duration')!.getAttribute('text-anchor')).toBe('end');
    expect(svgOf().querySelector('.fg-rtl')!.getAttribute('direction')).toBe('rtl');
  });

  it('a row patch flips the cells of the rebuilt row', () => {
    const g = build('grid-last');
    g.select(id('c'));
    for (const text of rowEl('c').querySelectorAll('.fg-grid__cells text')) expect(text.getAttribute('transform') ?? '').toMatch(/^matrix\(-1 0 0 1 /);
  });
});

describe('collapseBelow', () => {
  function stubObserver() {
    const all: { cb: () => void; disconnected: boolean }[] = [];
    class RO {
      private readonly rec: { cb: () => void; disconnected: boolean };
      constructor(cb: () => void) { this.rec = { cb, disconnected: false }; all.push(this.rec); }
      observe(): void {}
      disconnect(): void { this.rec.disconnected = true; }
    }
    vi.stubGlobal('ResizeObserver', RO);
    return all;
  }
  const width = (w: number) => Object.defineProperty(container, 'clientWidth', { value: w, configurable: true });
  const fire = (all: { cb: () => void; disconnected: boolean }[]) => all.filter((r) => !r.disconnected).forEach((r) => r.cb());

  it('shows only the name column below the threshold, with hysteresis, and getGridColumns still lists all', () => {
    const all = stubObserver();
    const g = mount();
    const full = handleOf(g).getLabelColumnWidth();
    width(300); fire(all);
    expect(handleOf(g).getLabelColumnWidth()).toBe(220);
    expect(svgOf().getAttribute('aria-colcount')).toBe('1');
    expect(g.getGridColumns()).toHaveLength(5);
    width(490); fire(all); // below 480 + 16: stays collapsed
    expect(handleOf(g).getLabelColumnWidth()).toBe(220);
    width(496); fire(all);
    expect(handleOf(g).getLabelColumnWidth()).toBe(full);
    expect(svgOf().getAttribute('aria-colcount')).toBe('5');
  });

  it('a container that is already narrow at mount paints the name column straight away', () => {
    stubObserver();
    width(300);
    const g = mount();
    expect(handleOf(g).getLabelColumnWidth()).toBe(220);
    expect(svgOf().getAttribute('aria-colcount')).toBe('1');
    expect(g.getGridColumns()).toHaveLength(5);
  });

  it('a hidden (0 px) container changes nothing; collapseBelow:0 observes nothing', () => {
    const all = stubObserver();
    const g = mount();
    width(0); fire(all);
    expect(handleOf(g).getLabelColumnWidth()).toBe(652);
    g.unmount();
    all.length = 0;
    const g2 = withGrid(withRender(createGantt({ tasks: TASKS })), { collapseBelow: 0 });
    g2.mount(container);
    expect(all).toHaveLength(0);
  });

  it('disconnects its observer when the chart unmounts', () => {
    const all = stubObserver();
    const g = mount();
    expect(all.filter((r) => !r.disconnected)).toHaveLength(1);
    g.unmount();
    expect(all.every((r) => r.disconnected)).toBe(true);
  });

  it('works where ResizeObserver does not exist', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    expect(() => mount()).not.toThrow();
  });
});

describe('exports include the grid', () => {
  it('exportSvg carries the header, the cells and the cut name, and no opacity:0', () => {
    const g = withGrid(withIo(withRender(createGantt({ tasks: [t('a', { name: 'N'.repeat(120) })] }))));
    g.mount(container);
    const svg = g.exportSvg();
    for (const s of ['>Name<', '>Start<', 'Jan 5, 2026', '4d', '25%', 'fg-grid__cells', '…']) expect(svg).toContain(s);
    expect(svg).not.toContain('opacity');
    expect(svg).not.toContain('<style');
    expect(svg).not.toContain('aria-colcount="0"');
  });
});

describe('Canvas', () => {
  it('warns once and paints nothing when the chart mounted on the Canvas renderer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = withGrid(withRender(createGantt({ tasks: TASKS })));
    const internal = getInternal(g);
    internal.setMount({ renderer: 'canvas', handle: { canvas: {} } as never, fx: () => {}, ui: () => {}, focusedId: () => undefined, anchored: () => {}, refresh: () => {} });
    internal.emit('renderer:selected', { renderer: 'canvas', taskCount: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('SVG renderer only');
  });
});

describe('without withGrid nothing changes (regression)', () => {
  it('the chart keeps its single label column, row indices and responsive width', () => {
    const g = withInteraction(withRender(createGantt({ tasks: TASKS })));
    g.mount(container);
    const svg = svgOf();
    expect(svg.hasAttribute('aria-colcount')).toBe(false);
    expect(svg.getAttribute('aria-rowcount')).toBe('4');
    expect([...svg.querySelectorAll('.fg-timeline__row')].map((r) => r.getAttribute('aria-rowindex'))).toEqual(['1', '2', '3', '4']);
    expect(svg.querySelector('[role=columnheader],.fg-grid__cells,.fg-rtl')).toBeNull();
    expect(handleOf(g).getLabelColumnWidth()).toBe(160);
    expect(handleOf(g).fixedLabelWidth).toBeUndefined();
    expect(corner().childElementCount).toBe(0);
    expect(svg.querySelector('.fg-timeline__row-cell')!.hasAttribute('aria-colindex')).toBe(false);
    expect(svg.style.font).toBe('');
  });

  it('long names are not truncated and no <title> is added', () => {
    const g = withRender(createGantt({ tasks: [t('a', { name: 'x'.repeat(300) })] }));
    g.mount(container);
    expect(svgOf().querySelector('.fg-timeline__row-label')!.textContent).toHaveLength(300);
    expect(svgOf().querySelector('title')).toBeNull();
  });

  it('keys behave identically with and without the grid (cell navigation is a later PR)', () => {
    const run = (withG: boolean) => {
      const c = document.createElement('div');
      document.body.appendChild(c);
      const base = withInteraction(withRender(createGantt({ tasks: TASKS })));
      const g = withG ? withGrid(base) : base;
      g.mount(c);
      const first = c.querySelector('.fg-timeline__row[data-task-id="p"]') as SVGElement;
      first.focus();
      const out: string[] = [];
      for (const [key, init] of [
        ['ArrowRight', {}], ['ArrowLeft', {}], ['ArrowRight', { shiftKey: true }], ['Home', { ctrlKey: true }],
        ['End', { ctrlKey: true }], ['F2', {}], ['Enter', {}], ['ArrowDown', {}], ['ArrowUp', {}], ['PageDown', {}],
      ] as const) {
        const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
        (c.querySelector('[role=row][tabindex="0"]') ?? first).dispatchEvent(ev);
        out.push(`${key}${JSON.stringify(init)}:${ev.defaultPrevented}:${c.querySelector('[role=row][tabindex="0"]')?.getAttribute('data-task-id')}:${g.getSelection?.().join(',') ?? ''}`);
      }
      c.remove();
      return out;
    };
    expect(run(true)).toEqual(run(false));
  });
});

describe('application order', () => {
  it.each(['grid first', 'grid last', 'grid between'] as const)('paints the same grid when composed %s', (order) => {
    const cfg = { tasks: TASKS, rtl: true };
    const g =
      order === 'grid first'
        ? withRtl(withInteraction(withRender(withGrid(createGantt(cfg)))))
        : order === 'grid last'
          ? withGrid(withRtl(withInteraction(withRender(createGantt(cfg)))))
          : withRtl(withGrid(withInteraction(withRender(createGantt(cfg)))));
    g.mount(container);
    expect(handleOf(g).getLabelColumnWidth()).toBe(652);
    expect(svgOf().querySelectorAll('[role=columnheader]')).toHaveLength(5);
    // the mirror ran after the grid in every order: the header clones are flipped too
    for (const text of corner().querySelectorAll('text')) expect(text.getAttribute('transform')).toMatch(/^matrix\(-1 0 0 1 /);
  });
});
