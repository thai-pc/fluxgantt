// @vitest-environment jsdom
//
// withGrid on the Canvas renderer (spec-grid-columns.md 4.3, 5.4, 9.1; PR G2). jsdom has no 2D context and
// no layout: every canvas gets its own recording context and rects are stubbed, so these tests pin the paint
// calls on the label canvas, the hidden a11y layer's structure, the hit-test column, the exports and the
// SVG parity of the cell text. Real pixels, sticky pinning and the CDP accessibility tree are Playwright's.
// The renderer is built directly and wired through the real `withGrid` mixin (`renderer:selected`), so the
// lazy `canvas-grid` chunk is loaded exactly as a Canvas mount loads it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withRender, CANVAS_AUTO_SWITCH_THRESHOLD } from '../../src/render/mixin.js';
import { withIo } from '../../src/io/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { withGrid } from '../../src/grid/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import { createCanvasRenderer, type CanvasRendererHandle } from '../../src/render/canvas-renderer.js';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { exportCanvasPng } from '../../src/io/export-canvas-png.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import type { GridColumnInput, GridOptions } from '../../src/grid/types.js';

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
const TASKS = [
  t('p', { type: 'summary' }),
  t('a', { parent: id('p') }),
  t('b', { parent: id('p'), end: '2026-01-14', progress: 1 }),
  t('c', { name: 'N'.repeat(120) }),
];
const W = 220 + 120 + 120 + 96 + 96; // the default five columns
const HEAD = ['Name', 'Start', 'End', 'Duration', 'Progress'];

// --- Recording 2D contexts, one per canvas ---------------------------------------------------
interface Rec {
  calls: { name: string; args: unknown[] }[];
  props: Record<string, unknown>;
}
const ctxByCanvas = new WeakMap<HTMLCanvasElement, { rec: Rec; ctx: CanvasRenderingContext2D }>();
const makeCtx = (): { ctx: CanvasRenderingContext2D; rec: Rec } => {
  const rec: Rec = { calls: [], props: { textAlign: 'start', direction: 'ltr' } };
  const ctx = new Proxy(rec.props, {
    get: (target, k: string) => {
      if (k in target) return target[k];
      if (k === 'getImageData') return () => ({ data: [0, 0, 0, 255] });
      return (...args: unknown[]): void => void rec.calls.push({ name: k, args });
    },
    set: (target, k: string, v: unknown) => {
      if (k === 'textAlign') rec.calls.push({ name: 'textAlign=', args: [v] });
      target[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
};
const recOf = (c: HTMLCanvasElement): Rec => ctxByCanvas.get(c)!.rec;
const texts = (r: Rec): string[] => r.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0] as string);
const count = (r: Rec, n: string): number => r.calls.filter((c) => c.name === n).length;

let container: HTMLElement;
let png: Rec | undefined;
beforeEach(() => {
  vi.setSystemTime(new Date('2035-01-01T00:00:00Z')); // no today rule
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let entry = ctxByCanvas.get(this);
    if (!entry) ctxByCanvas.set(this, (entry = makeCtx()));
    return entry.ctx;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
    png = ctxByCanvas.get(this)?.rec;
    cb(new Blob(['png'], { type: 'image/png' }));
  } as never);
  png = undefined;
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rect = (left: number, width: number, top = 0, height = 600): DOMRect =>
  ({ left, top, right: left + width, bottom: top + height, x: left, y: top, width, height, toJSON: () => ({}) }) as DOMRect;

interface Setup {
  tasks?: TaskInput[];
  columns?: GridColumnInput[];
  grid?: GridOptions;
  rtl?: boolean;
  critical?: string[];
  config?: Record<string, unknown>;
}
/** A Canvas chart wired through the real mixin; resolves once the lazy painter has repainted it. */
async function mountCanvas(s: Setup = {}) {
  const base = withIo(withRender(createGantt({ tasks: s.tasks ?? TASKS, rtl: s.rtl, ...s.config })));
  const g = withGrid(s.rtl ? withRtl(base) : base, { ...(s.columns ? { columns: s.columns } : {}), ...s.grid });
  const internal = getInternal(g);
  const input = {
    tasks: internal.tasks.all(),
    dependencies: [],
    ...(s.critical ? { criticalPath: { criticalTaskIds: s.critical.map(id) } as never } : {}),
  };
  const handle = createCanvasRenderer(
    container,
    input,
    { viewportHeight: 600, ...(s.rtl ? { rtl: true } : {}), paintHooks: internal.paints } as never,
    createSvgRenderer,
  ) as CanvasRendererHandle;
  internal.setMount({
    renderer: 'canvas',
    handle,
    fx: () => {},
    ui: () => {},
    focusedId: () => undefined,
    anchored: () => {},
    refresh: () => {},
  } as never);
  internal.emit('renderer:selected', { renderer: 'canvas', taskCount: 0 });
  await vi.waitFor(() => expect(handle.getRenderState().options.grid).toBeDefined());
  const label = container.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas-labels')!;
  const layer = handle.interactionRoot;
  /** One clean paint of the label canvas. */
  const repaint = (): Rec => {
    recOf(label).calls.length = 0;
    handle.setOptions({});
    return recOf(label);
  };
  return { g, internal, handle, label, layer, repaint };
}

describe('the label canvas paints the grid', () => {
  it('paints the header band, the five headers, the cells and the dividers on the label canvas only', async () => {
    const { handle, label, repaint } = await mountCanvas();
    const r = repaint();
    const all = texts(r);
    expect(all.slice(-HEAD.length)).toEqual(HEAD); // the header goes last (over the clipped rows)
    expect(all).toContain('Jan 5, 2026');
    expect(all).toContain('Jan 14, 2026');
    expect(all).toContain('4d');
    expect(all).toContain('25%');
    expect(all).toContain('100%');
    expect(handle.getLabelColumnWidth()).toBe(W);
    expect(label.width).toBe(W);
    // the header band: a fillRect of the pinned width x the header height in --fg-bg-subtle
    expect(r.calls.some((c) => c.name === 'fillRect' && c.args[2] === W && c.args[3] === 32)).toBe(true);
    // four inner dividers plus the closing label divider are stroked
    expect(count(r, 'stroke')).toBeGreaterThanOrEqual(3);
    // the chart canvas never receives cell text
    const main = texts(recOf(handle.canvas));
    for (const h of ['Start', 'Duration', 'Progress', 'Jan 5, 2026', '25%']) expect(main).not.toContain(h);
  });

  it('cuts a long name with an ellipsis inside the name column and keeps the toggle', async () => {
    const { repaint } = await mountCanvas();
    const names = texts(repaint());
    expect(names.some((n) => n.startsWith('NNN') && n.endsWith('…'))).toBe(true);
    expect(names).not.toContain('N'.repeat(120));
  });

  it('clips the name and its toggle to the name column and fills the cells outside that clip', async () => {
    const { repaint } = await mountCanvas();
    const r = repaint();
    const rects = r.calls.filter((c) => c.name === 'rect').map((c) => c.args);
    expect(rects.some((a) => a[2] === 220)).toBe(true); // the name clip
    expect(rects.some((a) => a[2] === W)).toBe(true); // the row-band clip
  });

  it('aligns cells with physical values in layout space (start left, end right)', async () => {
    const { repaint } = await mountCanvas();
    const aligns = repaint().calls.filter((c) => c.name === 'textAlign=').map((c) => c.args[0]);
    expect(aligns).toContain('left');
    expect(aligns).toContain('right'); // duration and progress are end-aligned
    expect(aligns).not.toContain('end');
  });

  it('does not warn that the grid paints nothing in Canvas', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mountCanvas();
    expect(warn).not.toHaveBeenCalled();
  });

  it('repaints with a new width and columns on setGridColumns, and the a11y layer follows', async () => {
    const { g, handle, layer } = await mountCanvas();
    g.setGridColumns([{ id: 'name', width: 200 }, { id: 'progress' }]);
    expect(handle.getLabelColumnWidth()).toBe(296);
    expect(layer.getAttribute('aria-colcount')).toBe('2');
    expect(handle.getRenderState().options.labelColumnWidth).toBe(296);
  });

  it('the grid owns the width: withResponsive-style writers are told to stand down', async () => {
    const { handle } = await mountCanvas();
    expect(handle.fixedLabelWidth).toBe(true);
  });
});

describe('without the grid the Canvas chart is unchanged', () => {
  it('has no colcount or header row, row indices start at 1, and the hit carries no columnId', () => {
    const g = withRender(createGantt({ tasks: TASKS }));
    const internal = getInternal(g);
    const h = createCanvasRenderer(container, { tasks: internal.tasks.all(), dependencies: [] }, { viewportHeight: 600 });
    const layer = h.interactionRoot;
    expect(layer.hasAttribute('aria-colcount')).toBe(false);
    expect(layer.getAttribute('aria-rowcount')).toBe('4');
    expect([...layer.querySelectorAll('[role=row]')].map((r) => r.getAttribute('aria-rowindex'))).toEqual(['1', '2', '3', '4']);
    expect(layer.querySelector('[role=columnheader]')).toBeNull();
    expect(layer.querySelector('.fg-timeline-canvas__row-cell')!.hasAttribute('aria-colindex')).toBe(false);
    vi.spyOn(h.canvas, 'getBoundingClientRect').mockReturnValue(rect(0, 5000));
    vi.spyOn(h.canvas.nextElementSibling!, 'getBoundingClientRect').mockReturnValue(rect(0, 160));
    const hit = h.hitTestRow(10, 40)!;
    expect(hit.taskId).toBe('p');
    expect('columnId' in hit).toBe(false);
  });
});

describe('the hidden a11y layer', () => {
  it('has aria-colcount, a columnheader row at aria-rowindex 1 and data rows from 2', async () => {
    const { layer } = await mountCanvas();
    expect(layer.getAttribute('role')).toBe('treegrid');
    expect(layer.getAttribute('aria-colcount')).toBe('5');
    expect(layer.getAttribute('aria-rowcount')).toBe('5'); // 4 rows + the header
    const rows = [...layer.children];
    const head = rows[0]!;
    expect(head.getAttribute('role')).toBe('row');
    expect(head.getAttribute('aria-rowindex')).toBe('1');
    expect(head.hasAttribute('data-row-index')).toBe(false); // keyboard-nav and selection skip it
    const hs = [...head.querySelectorAll('[role=columnheader]')];
    expect(hs.map((h) => h.textContent)).toEqual(HEAD);
    expect(hs.map((h) => h.getAttribute('aria-colindex'))).toEqual(['1', '2', '3', '4', '5']);
    expect(hs.map((h) => h.getAttribute('data-column-id'))).toEqual(['name', 'start', 'end', 'duration', 'progress']);
    expect(hs.map((h) => h.getAttribute('aria-label'))).toEqual(HEAD);
    expect(rows.slice(1).map((r) => r.getAttribute('aria-rowindex'))).toEqual(['2', '3', '4', '5']);
    expect(rows.slice(1).map((r) => r.getAttribute('data-row-index'))).toEqual(['0', '1', '2', '3']);
  });

  it('gives every row a name cell at colindex 1 and real gridcells with the full text', async () => {
    const { layer } = await mountCanvas();
    const row = layer.querySelector('[data-task-id="b"][role=row]')!;
    const name = row.querySelector('.fg-timeline-canvas__row-cell')!;
    expect(name.getAttribute('role')).toBe('gridcell');
    expect(name.getAttribute('aria-colindex')).toBe('1');
    const cells = [...row.querySelectorAll(':scope > [role=gridcell]')].slice(1); // after the name cell
    expect(cells.map((c) => c.getAttribute('aria-colindex'))).toEqual(['2', '3', '4', '5']);
    expect(cells.map((c) => c.getAttribute('data-column-id'))).toEqual(['start', 'end', 'duration', 'progress']);
    expect(cells.map((c) => c.textContent)).toEqual(['Jan 5, 2026', 'Jan 14, 2026', '7d', '100%']);
  });

  it('keeps the FULL name in the layer and the bar label (critical, selected) when the painted name is cut', async () => {
    const { layer, handle } = await mountCanvas({ critical: ['c'] });
    handle.update({ ...handle.getRenderState().input, selectedTaskIds: [id('c')] });
    const row = layer.querySelector('[data-task-id="c"][role=row]')!;
    expect(row.querySelector('.fg-timeline-canvas__row-label')!.textContent).toBe('N'.repeat(120)); // not cut
    const bar = row.querySelector('.fg-timeline-canvas__task')!;
    const label = bar.getAttribute('aria-label')!;
    expect(label).toContain('critical path');
    expect(label).toContain('selected');
    // H1 (G1 review): no aria-label may replace the name of the cell or the row
    expect(row.getAttribute('aria-label')).toBeNull();
    expect(row.querySelector('.fg-timeline-canvas__row-cell')!.getAttribute('aria-label')).toBeNull();
  });

  it('counts the header in aria-rowcount and keeps rows contiguous after a collapse', async () => {
    const { layer, handle } = await mountCanvas();
    handle.update({ ...handle.getRenderState().input, collapsedIds: new Set([id('p')]) });
    expect(layer.getAttribute('aria-rowcount')).toBe('3'); // p, c + header
    expect([...layer.children].map((r) => r.getAttribute('aria-rowindex'))).toEqual(['1', '2', '3']);
  });

  it('renders hostile text only as text', async () => {
    const evil = '</text><script>window.__xss=1</script>';
    const { layer, repaint } = await mountCanvas({
      tasks: [t('a', { name: evil })],
      columns: [{ id: 'name' }, { id: 'x', header: evil, value: () => evil }],
    });
    expect(layer.querySelector('script')).toBeNull();
    expect(layer.querySelector('[data-column-id="x"]')!.textContent).toBe(evil);
    expect(layer.querySelector('[role=columnheader][data-column-id="x"]')!.getAttribute('aria-label')).toBe(evil);
    expect(texts(repaint()).join('')).toContain('<script>'); // painted by fillText: pixels, not markup
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it('a throwing gridColumnLabel falls back to the header text', async () => {
    const { layer } = await mountCanvas({
      config: { messages: { gridColumnLabel: () => { throw new Error('boom'); } } },
    });
    expect(layer.querySelector('[role=columnheader]')!.getAttribute('aria-label')).toBe('Name');
  });
});

describe('hit testing', () => {
  /** Stubs the chart canvas (scrolled by `scroll`) and the pinned label canvas, LTR or RTL. */
  function place(h: CanvasRendererHandle, rtl = false, scroll = 0): void {
    vi.spyOn(h.canvas, 'getBoundingClientRect').mockReturnValue(rect(-scroll, 5000));
    const left = rtl ? 600 - W : 0;
    vi.spyOn(h.canvas.nextElementSibling!, 'getBoundingClientRect').mockReturnValue(rect(left, W));
  }

  it('reports the column under the pointer in the pinned zone, name included', async () => {
    const { handle } = await mountCanvas();
    place(handle);
    const y = 32 + 12 + 24; // the second row
    const col = (x: number) => handle.hitTestRow(x, y)?.columnId;
    expect(col(10)).toBe('name');
    expect(col(219)).toBe('name');
    expect(col(220)).toBe('start');
    expect(col(339)).toBe('start');
    expect(col(340)).toBe('end');
    expect(col(470)).toBe('duration');
    expect(col(600)).toBe('progress');
    expect(col(W - 1)).toBe('progress');
    expect(handle.hitTestRow(10, y)).toMatchObject({ taskId: 'a', rowIndex: 1 });
  });

  it('reports no column in the chart area, even when it is scrolled under the pinned zone', async () => {
    const { handle } = await mountCanvas();
    place(handle, false, 300);
    const hit = handle.hitTestRow(W + 50, 32 + 12);
    expect(hit?.taskId).toBe('p');
    expect(hit && 'columnId' in hit).toBe(false);
  });

  it('a click on a cell resolves the same row a label click does (selection reads taskId)', async () => {
    const { handle } = await mountCanvas();
    place(handle);
    const y = 32 + 12 + 48;
    const label = handle.hitTestRow(30, y)!;
    const cell = handle.hitTestRow(500, y)!;
    expect([cell.taskId, cell.rowIndex]).toEqual([label.taskId, label.rowIndex]);
    expect(cell.onLabel).toBe(true);
  });

  it('never reports a toggle hit past the name column, and still reports it inside', async () => {
    const { handle } = await mountCanvas();
    place(handle);
    const y = 32 + 12; // the summary row p
    expect(handle.hitTestRow(14, y)!.hitToggle).toBe(true);
    expect(handle.hitTestRow(14, y)!.columnId).toBe('name');
    expect(handle.hitTestRow(240, y)!.hitToggle).toBe(false);
  });

  it('does not resolve a header click to a row', async () => {
    const { handle } = await mountCanvas();
    place(handle);
    expect(handle.hitTestRow(250, 10)).toBeUndefined();
  });

  it('measures from the inline-start (right) edge under RTL', async () => {
    const { handle } = await mountCanvas({ rtl: true });
    place(handle, true);
    const y = 32 + 12 + 24;
    const right = 600; // the pinned column's right edge
    expect(handle.hitTestRow(right - 10, y)?.columnId).toBe('name');
    expect(handle.hitTestRow(right - 230, y)?.columnId).toBe('start');
    expect(handle.hitTestRow(right - 600, y)?.columnId).toBe('progress');
  });
});

describe('RTL', () => {
  it('paints in layout space under the label canvas mirror, with the same anchors as LTR', async () => {
    const ltr = await mountCanvas();
    const ltrCalls = ltr.repaint().calls.filter((c) => c.name === 'fillText').map((c) => [c.args[0], c.args[1]]);
    container.replaceChildren();
    const rtl = await mountCanvas({ rtl: true });
    const r = rtl.repaint();
    const rtlCalls = r.calls.filter((c) => c.name === 'fillText').map((c) => [c.args[0], c.args[1]]);
    // fillTextAt counter-flips each text about its anchor, so the layout x arguments are unchanged
    expect(rtlCalls).toEqual(ltrCalls);
    expect(r.calls.some((c) => c.name === 'transform' && c.args[0] === -1 && c.args[4] === W)).toBe(true); // the mirror
    expect(rtl.handle.getRenderState().options.rtl).toBe(true);
  });

  it('swaps physical alignment at each cell through fillTextAt (start text anchors right)', async () => {
    const { repaint } = await mountCanvas({ rtl: true });
    const aligns = repaint().calls.filter((c) => c.name === 'textAlign=').map((c) => c.args[0]);
    expect(aligns).toContain('right'); // a layout-left (start) cell is flipped to the physical right
    expect(aligns).toContain('left');
  });
});

describe('collapseBelow and durationUnit behave as in SVG', () => {
  class FakeObserver {
    static last: FakeObserver | undefined;
    constructor(public cb: () => void) {
      FakeObserver.last = this;
    }
    observe(): void {}
    disconnect(): void {}
  }
  it('paints only the name column in a narrow container (and a one-column treegrid)', async () => {
    vi.stubGlobal('ResizeObserver', FakeObserver);
    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true });
    const { handle, layer, repaint } = await mountCanvas({ grid: { collapseBelow: 480 } });
    expect(handle.getLabelColumnWidth()).toBe(220);
    expect(layer.getAttribute('aria-colcount')).toBe('1');
    expect(texts(repaint()).slice(-1)).toEqual(['Name']);
    expect(layer.querySelector('[data-column-id="start"]')).toBeNull();
  });

  it('shows all columns in a wide container, and collapseBelow: 0 disables the observer', async () => {
    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true });
    const { handle } = await mountCanvas({ grid: { collapseBelow: 0 } });
    expect(handle.getLabelColumnWidth()).toBe(W);
  });

  it('durationUnit hours shows hours in the cell, the a11y layer and the CSV', async () => {
    const { layer, repaint, g } = await mountCanvas({ grid: { durationUnit: 'hours' } });
    expect(texts(repaint())).toContain('32h');
    expect(layer.querySelector('[data-task-id="a"][role=row] [data-column-id="duration"]')!.textContent).toBe('32h');
    expect(g.exportGridCsv().split('\r\n')[2]).toBe('a,2026-01-05,2026-01-09,32,25');
  });
});

describe('exports include the grid', () => {
  it('exportGridCsv works in Canvas mode', async () => {
    const { g } = await mountCanvas();
    const csv = g.exportGridCsv().split('\r\n');
    expect(csv[0]).toBe('Name,Start,End,Duration,Progress');
    expect(csv).toHaveLength(5);
    expect(csv[1]).toBe('p,2026-01-05,2026-01-09,4,25');
  });

  it('Canvas-mode exportSvg carries the header, the cells, the cut name, and no opacity:0', async () => {
    const { g } = await mountCanvas();
    const svg = g.exportSvg();
    for (const s of ['>Name<', '>Start<', '>Progress<', 'Jan 5, 2026', '4d', '25%', 'fg-grid__cells', '…']) expect(svg).toContain(s);
    expect(svg).not.toContain('opacity');
    expect(svg).not.toContain('<style');
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelectorAll('[role=columnheader]')).toHaveLength(5);
  });

  it('exportSvg and exportPng leave the live chart and its grid untouched', async () => {
    const { g, handle, layer } = await mountCanvas();
    const before = layer.innerHTML;
    g.exportSvg();
    expect(layer.innerHTML).toBe(before);
    expect(handle.getRenderState().options.grid).toBeDefined();
  });

  it('exportPng paints the header, every cell and the cut name onto the export canvas', async () => {
    const { handle } = await mountCanvas();
    await exportCanvasPng(handle, { scale: 1 });
    const out = texts(png!);
    expect(png).toBeDefined();
    for (const h of HEAD) expect(out).toContain(h);
    for (const s of ['Jan 5, 2026', 'Jan 14, 2026', '4d', '7d', '25%', '100%']) expect(out).toContain(s);
    expect(out.some((n) => n.startsWith('NNN') && n.endsWith('…'))).toBe(true);
    // every row (the export is not windowed): 4 rows x 4 cells + 4 names + 5 headers + chart header labels
    expect(out.filter((x) => x === '25%' || x === '100%')).toHaveLength(4);
  });

  it('exportPng of a chart without the grid is unchanged (no header, plain names)', async () => {
    const g = withIo(withRender(createGantt({ tasks: TASKS })));
    const internal = getInternal(g);
    const h = createCanvasRenderer(container, { tasks: internal.tasks.all(), dependencies: [] }, { viewportHeight: 600 });
    await exportCanvasPng(h, { scale: 1 });
    const out = texts(png!);
    expect(out).toContain('p');
    expect(out).not.toContain('Progress');
  });
});

describe('parity with the SVG renderer', () => {
  it('shows the same name and cell text for the same data (long names, hierarchy, hours)', async () => {
    const tasks = [
      t('p', { type: 'summary', name: 'Project plan: an unusually long task name that has to be cut' }),
      t('a', { parent: id('p'), name: 'Requirements: an unusually long task name that has to be cut' }),
      t('b', { parent: id('p'), end: '2026-01-14', progress: 1 }),
      t('c', { name: 'Ünïcödé 日本語のとても長いタスク名 that is far too long to fit the column' }),
    ];
    const columns: GridColumnInput[] = [
      { id: 'name', width: 160 },
      { id: 'start' },
      { id: 'end', width: 90 },
      { id: 'duration' },
      { id: 'progress', width: 64 },
      { id: 'who', header: 'Owner of the work package', width: 100, value: (x) => `${x.id} - a custom value that is far too long` },
    ];
    // SVG
    const svgHost = document.createElement('div');
    document.body.appendChild(svgHost);
    const sg = withGrid(withRender(createGantt({ tasks })), { columns });
    sg.mount(svgHost);
    const column = svgHost.querySelector('.fg-timeline__sticky-column')!;
    const own = (e: Element): string => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    const svgNames = [...column.querySelectorAll('.fg-timeline__row-label')].map(own);
    const svgCells = [...column.querySelectorAll('g[data-task-id]')].map((row) => [...row.querySelectorAll('text')].map(own));
    const svgHeads = [...svgHost.querySelectorAll('.fg-timeline__sticky-corner text')].map(own);
    svgHost.remove();
    // Canvas
    const cv = await mountCanvas({ tasks, columns });
    const all = texts(cv.repaint());
    const heads = all.slice(-columns.length);
    const body = all.slice(0, -columns.length);
    const nameCount = tasks.length;
    const canvasNames = body.slice(0, nameCount);
    const canvasCells = tasks.map((_, i) => body.slice(nameCount + i * (columns.length - 1), nameCount + (i + 1) * (columns.length - 1)));
    expect(heads).toEqual(svgHeads);
    expect(canvasNames).toEqual(svgNames);
    expect(canvasCells).toEqual(svgCells);
    expect(svgNames.some((n) => n.endsWith('…'))).toBe(true); // the data does exercise the cut
    expect(svgCells.flat().some((n) => n.endsWith('…'))).toBe(true);
  });
});

describe('through the real mount() path', () => {
  it('a project past the auto-switch threshold mounts on Canvas and gets the grid, with no warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const n = CANVAS_AUTO_SWITCH_THRESHOLD + 1;
    const tasks = Array.from({ length: n }, (_, i) => t(`t${i}`, { name: `Task ${i}` }));
    const g = withGrid(withIo(withRender(createGantt({ tasks }))));
    g.mount(container);
    await vi.waitFor(() => expect(container.querySelector('canvas.fg-timeline-canvas-labels')).not.toBeNull(), { timeout: 30_000 });
    const label = container.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas-labels')!;
    await vi.waitFor(() => expect(label.width).toBe(W), { timeout: 30_000 });
    expect(texts(recOf(label))).toContain('Progress');
    const layer = container.querySelector('.fg-timeline-a11y-layer')!;
    expect(layer.getAttribute('aria-colcount')).toBe('5');
    expect(layer.getAttribute('aria-rowcount')).toBe(String(n + 1));
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('withGrid'))).toEqual([]);
    g.unmount();
  }, 60_000);
});
