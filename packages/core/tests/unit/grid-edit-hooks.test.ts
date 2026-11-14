// @vitest-environment jsdom
//
// withEditHooks + withGrid (spec-grid-columns.md 4.4; PR G5): dblclick, contextmenu and keyboard activate on a
// grid cell report `part: 'cell'` + `columnId`, over the SVG renderer and the Canvas one, LTR and RTL. The
// `name` column keeps its part, and without the grid nothing changes (no `columnId` key at all).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import type { TaskActivatedPayload, TaskContextRequestedPayload } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { withGrid } from '../../src/grid/mixin.js';
import { withEditHooks } from '../../src/edit-hooks/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import { createCanvasRenderer, type CanvasRendererHandle } from '../../src/render/canvas-renderer.js';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const t = (name: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: toTaskId(name),
  name,
  start: '2026-01-05',
  end: '2026-01-09',
  progress: 0.25,
  type: 'task',
  ...extra,
});
const TASKS = [t('p', { type: 'summary' }), t('a', { parent: toTaskId('p') }), t('c')];

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function listen(g: ReturnType<typeof withEditHooks>) {
  const activated: TaskActivatedPayload[] = [];
  const context: TaskContextRequestedPayload[] = [];
  g.on('task:activated', (p) => activated.push(p));
  g.on('task:context-requested', (p) => context.push(p));
  return { activated, context };
}
const dbl = (el: EventTarget, x = 10, y = 10): void => {
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
};
const ctx = (el: EventTarget, x = 10, y = 10): MouseEvent => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
  el.dispatchEvent(e);
  return e;
};
const key = (el: EventTarget, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};

describe.each([false, true])('SVG, rtl=%s', (rtl) => {
  function make(grid: boolean) {
    let g = withInteraction(withRender(createGantt({ tasks: TASKS, ...(rtl ? { rtl: true } : {}) })));
    if (rtl) g = withRtl(g);
    if (grid) g = withGrid(g);
    const hooked = withEditHooks(g);
    const seen = listen(hooked);
    hooked.mount(container);
    return seen;
  }
  const pinned = (task: string, sel: string): Element =>
    container.querySelector(`.fg-timeline__sticky-column [data-task-id="${task}"] ${sel}`)!;
  const real = (task: string, col: string): Element =>
    container.querySelector(`.fg-timeline__row[data-task-id="${task}"] [data-column-id="${col}"]`)!;

  it('dblclick and contextmenu on a pinned or real cell report the cell and its column', () => {
    const { activated, context } = make(true);
    dbl(pinned('a', '[data-column-id="end"]'), 5, 6);
    ctx(real('c', 'duration'), 7, 8);
    expect(activated).toEqual([{ taskId: 'a', part: 'cell', columnId: 'end', source: 'pointer', clientX: 5, clientY: 6 }]);
    expect(context).toHaveLength(1);
    expect(context[0]).toMatchObject({ taskId: 'c', part: 'cell', columnId: 'duration', source: 'pointer' });
  });

  it('the blank part of a pinned cell resolves by x against the column offsets, from the inline-start edge', () => {
    const { activated, context } = make(true);
    const pin = container.querySelector('.fg-timeline__sticky-column')!;
    const left = 100;
    const r = (l: number, t: number, w: number, h: number): DOMRect =>
      ({ left: l, top: t, right: l + w, bottom: t + h, x: l, y: t, width: w, height: h, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(pin, 'getBoundingClientRect').mockReturnValue(r(left, 0, 652, 600));
    ['p', 'a', 'c'].forEach((id, i) =>
      vi.spyOn(container.querySelector(`.fg-timeline__row[data-task-id="${id}"]`)!, 'getBoundingClientRect').mockReturnValue(r(0, 40 + i * 30, 2000, 30)),
    );
    // Offsets: name 0..220, start 220..340, end 340..460, duration 460..556, progress 556..652.
    const at = (d: number): number => (rtl ? left + 652 - d : left + d);
    dbl(pin, at(280), 80); // row `a`, `start`
    ctx(pin, at(600), 115); // row `c`, `progress`
    dbl(pin, at(100), 80); // the blank part of the name column
    dbl(pin, at(280), 10); // above every row
    expect(activated).toHaveLength(2);
    expect(activated[0]).toMatchObject({ taskId: 'a', part: 'cell', columnId: 'start' });
    expect(context[0]).toMatchObject({ taskId: 'c', part: 'cell', columnId: 'progress' });
    expect(activated[1]).toMatchObject({ taskId: 'a', part: 'label' });
    expect('columnId' in activated[1]!).toBe(false);
  });

  it('the name column keeps its part and carries no columnId', () => {
    const { activated } = make(true);
    dbl(container.querySelector('.fg-timeline__sticky-column .fg-timeline__row-label[data-task-id="a"]')!);
    expect(activated).toHaveLength(1);
    expect(activated[0]).toMatchObject({ taskId: 'a', part: 'label' });
    expect('columnId' in activated[0]!).toBe(false);
  });

  it('a bar keeps part bar next to the grid', () => {
    const { activated } = make(true);
    dbl(container.querySelector('.fg-timeline__row[data-task-id="c"] .fg-task__bar')!);
    expect(activated[0]).toMatchObject({ taskId: 'c', part: 'bar' });
  });

  it('F2 and ContextMenu from a focused cell report the cell; the name cell and the row report the row', () => {
    const { activated, context } = make(true);
    const cell = real('a', 'progress');
    const e = key(cell, 'F2');
    expect(e.defaultPrevented).toBe(true);
    expect(activated).toHaveLength(1);
    expect(activated[0]).toMatchObject({ taskId: 'a', part: 'cell', columnId: 'progress', source: 'keyboard' });
    expect(Number.isFinite(activated[0]!.clientX) && Number.isFinite(activated[0]!.clientY)).toBe(true);
    key(cell, 'ContextMenu');
    expect(context[0]).toMatchObject({ taskId: 'a', part: 'cell', columnId: 'progress', source: 'keyboard' });
    const nameCell = container.querySelector('.fg-timeline__row[data-task-id="a"] .fg-timeline__row-cell')!;
    key(nameCell, 'F2');
    expect(activated[1]).toMatchObject({ taskId: 'a', part: 'row' });
    expect('columnId' in activated[1]!).toBe(false);
    key(container.querySelector('.fg-timeline__row[data-task-id="c"]')!, 'F2');
    expect(activated[2]).toMatchObject({ taskId: 'c', part: 'row' });
  });

  it('Enter on a non-parent cell activates; Enter on a parent row still only toggles', () => {
    const { activated } = make(true);
    const cell = real('a', 'start') as SVGElement;
    container.querySelector<SVGElement>('.fg-timeline__row[data-task-id="a"]')!.focus(); // the roving row
    cell.setAttribute('tabindex', '-1');
    cell.focus(); // keyboard-nav acts on the roving row (a cell focus does not move it)
    key(cell, 'Enter');
    expect(activated[0]).toMatchObject({ part: 'cell', columnId: 'start' });
    const parent = container.querySelector<SVGElement>('.fg-timeline__row[data-task-id="p"]')!;
    parent.focus();
    expect(key(parent, 'Enter').defaultPrevented).toBe(true); // the collapse toggle
    expect(activated).toHaveLength(1);
  });

  it('a column header is not a task gesture', () => {
    const { activated, context } = make(true);
    const head = container.querySelector('[data-column-id="start"].fg-grid__head-text')!;
    dbl(head);
    ctx(head);
    key(head, 'F2');
    expect(activated).toHaveLength(0);
    expect(context).toHaveLength(0);
  });

  it('without the grid the payloads are the pre-grid ones', () => {
    const { activated, context } = make(false);
    dbl(container.querySelector('.fg-timeline__row[data-task-id="c"] .fg-task__bar')!);
    ctx(container.querySelector('.fg-timeline__row[data-task-id="c"] .fg-timeline__row-label')!);
    key(container.querySelector('.fg-timeline__row[data-task-id="c"]')!, 'F2');
    expect(activated.map((p) => p.part)).toEqual(['bar', 'row']);
    expect(context.map((p) => p.part)).toEqual(['label']);
    for (const p of [...activated, ...context]) expect('columnId' in p).toBe(false);
  });
});

describe('collapseBelow', () => {
  it('a collapsed (name only) grid reports no cell, and the cells come back after it widens', () => {
    const all: { cb: () => void }[] = [];
    class RO {
      constructor(public cb: () => void) { all.push(this); }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', RO);
    vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => (f(0), 0));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const width = (w: number): void => {
      Object.defineProperty(container, 'clientWidth', { value: w, configurable: true });
      all.forEach((r) => r.cb());
    };
    const g = withEditHooks(withGrid(withInteraction(withRender(createGantt({ tasks: TASKS })))));
    const { activated } = listen(g);
    g.mount(container);
    width(300);
    expect(container.querySelector('.fg-timeline__row[data-task-id="c"] [data-column-id]')).toBeNull();
    dbl(container.querySelector('.fg-timeline__sticky-column .fg-timeline__row-label[data-task-id="c"]')!);
    expect(activated[0]).toMatchObject({ part: 'label' });
    expect('columnId' in activated[0]!).toBe(false);
    width(600);
    dbl(container.querySelector('.fg-timeline__sticky-column [data-task-id="c"] [data-column-id="end"]')!);
    expect(activated[1]).toMatchObject({ part: 'cell', columnId: 'end' });
  });
});

// --- Canvas -----------------------------------------------------------------------------------
const rect = (left: number, width: number): DOMRect =>
  ({ left, top: 0, right: left + width, bottom: 600, x: left, y: 0, width, height: 600, toJSON: () => ({}) }) as DOMRect;
const W = 220 + 120 + 120 + 96 + 96;

describe.each([false, true])('Canvas, rtl=%s', (rtl) => {
  async function mountCanvas(grid: boolean) {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() =>
      new Proxy({}, { get: () => () => ({ data: [0, 0, 0, 255] }), set: () => true })) as never);
    let base = withRender(createGantt({ tasks: TASKS, ...(rtl ? { rtl: true } : {}) }));
    if (rtl) base = withRtl(base);
    const g = withEditHooks(grid ? withGrid(base) : base);
    const seen = listen(g);
    const internal = getInternal(g);
    const handle = createCanvasRenderer(
      container,
      { tasks: internal.tasks.all(), dependencies: [] },
      { viewportHeight: 600, ...(rtl ? { rtl: true } : {}), paintHooks: internal.paints } as never,
      createSvgRenderer,
    ) as CanvasRendererHandle;
    internal.setMount({
      renderer: 'canvas', handle, fx: () => {}, ui: () => {}, focusedId: () => undefined, anchored: () => {}, refresh: () => {},
    } as never);
    internal.emit('renderer:selected', { renderer: 'canvas', taskCount: 0 });
    if (grid) await vi.waitFor(() => expect(handle.getRenderState().options.grid).toBeDefined());
    vi.spyOn(handle.canvas, 'getBoundingClientRect').mockReturnValue(rect(0, 5000));
    vi.spyOn(handle.canvas.nextElementSibling!, 'getBoundingClientRect').mockReturnValue(rect(rtl ? 600 - W : 0, W));
    return { handle, ...seen };
  }
  // Pointer x in the pinned zone, `d` px from the inline-start edge.
  const px = (d: number): number => (rtl ? 600 - d : d);
  const Y = 32 + 12 + 24; // the second row (`a`; `p` is expanded)

  it('reports the cell under the pointer, the name column keeps label', async () => {
    const { handle, activated, context } = await mountCanvas(true);
    dbl(handle.canvas, px(230), Y);
    ctx(handle.canvas, px(600), Y);
    dbl(handle.canvas, px(60), Y);
    expect(activated[0]).toMatchObject({ taskId: 'a', part: 'cell', columnId: 'start', source: 'pointer' });
    expect(context[0]).toMatchObject({ taskId: 'a', part: 'cell', columnId: 'progress' });
    expect(activated[1]).toMatchObject({ taskId: 'a', part: 'label' });
    expect('columnId' in activated[1]!).toBe(false);
  });

  it('F2 on a focused a11y-layer gridcell reports the cell', async () => {
    const { handle, activated } = await mountCanvas(true);
    const cell = handle.interactionRoot.querySelector('[data-row-index] [data-column-id="duration"]')!;
    key(cell, 'F2');
    expect(activated[0]).toMatchObject({ part: 'cell', columnId: 'duration', source: 'keyboard' });
  });

  it('without the grid a pointer in the label column is a plain label hit', async () => {
    const { handle, activated } = await mountCanvas(false);
    dbl(handle.canvas, px(60), Y);
    expect(activated[0]).toMatchObject({ part: 'label' });
    expect('columnId' in activated[0]!).toBe(false);
  });
});
