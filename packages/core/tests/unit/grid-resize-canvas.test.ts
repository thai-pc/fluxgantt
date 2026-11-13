// @vitest-environment jsdom
//
// withGrid column resize on the Canvas renderer (spec-grid-columns.md section 7; PR G3). Set-up copied from
// grid-canvas.test.ts. jsdom has no 2D context and
// no layout: every canvas gets its own recording context and rects are stubbed, so these tests pin the paint
// calls on the label canvas, the hidden a11y layer's structure, the hit-test column, the exports and the
// SVG parity of the cell text. Real pixels, sticky pinning and the CDP accessibility tree are Playwright's.
// The renderer is built directly and wired through the real `withGrid` mixin (`renderer:selected`), so the
// lazy `canvas-grid` chunk is loaded exactly as a Canvas mount loads it.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withIo } from '../../src/io/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { withGrid } from '../../src/grid/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import { createCanvasRenderer, type CanvasRendererHandle } from '../../src/render/canvas-renderer.js';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
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

let container: HTMLElement;
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
    cb(new Blob(['png'], { type: 'image/png' }));
  } as never);
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
  const base = withIo(withRender(createGantt({ tasks: s.tasks ?? TASKS, ...(s.rtl ? { rtl: true } : {}), ...s.config })));
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


const down = (clientX: number, clientY: number, init: Record<string, unknown> = {}): PointerEvent => {
  const E = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const e = new E('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX, clientY });
  Object.defineProperties(e, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: 'mouse', configurable: true }, ...Object.fromEntries(Object.entries(init).map(([k, v]) => [k, { value: v }])) });
  return e as PointerEvent;
};
const ptr = (type: string, clientX: number): Event => {
  const e = down(clientX, 10);
  Object.defineProperty(e, 'type', { value: type });
  return new (e.constructor as typeof MouseEvent)(type, { bubbles: true, clientX, clientY: 10 });
};
const up = (target: Element, clientX: number): void => {
  const e = ptr('pointerup', clientX);
  Object.defineProperties(e, { pointerId: { value: 1 } });
  target.dispatchEvent(e);
};
const heads = (layer: Element) => [...layer.querySelectorAll<HTMLElement>('[role=columnheader]')];
beforeAll(() => import('../../src/grid/resize-ui.js'));
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const key = async (el: Element, k: string, alt = false): Promise<KeyboardEvent> => {
  const e = new KeyboardEvent('keydown', { key: k, altKey: alt, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  await flush(); // the header actions run in the lazy half
  return e;
};
const widthOf = (g: { getGridColumns(): readonly { id: string; width: number }[] }, c: string) => g.getGridColumns().find((x) => x.id === c)!.width;

describe('pointer resize in the header band', () => {
  it('a press within 4 px of a divider drags it, swallows the event, and commits once on release', async () => {
    const { g, handle, label } = await mountCanvas();
    label.getBoundingClientRect = () => rect(0, W);
    const seen: unknown[] = [];
    g.on('column:resized', (p) => seen.push(p));
    const other = vi.fn();
    handle.pointerEventTarget.addEventListener('pointerdown', other);
    handle.pointerEventTarget.dispatchEvent(down(342, 10)); // start column ends at 340
    expect(other).not.toHaveBeenCalled();
    expect(container.querySelector('.fg-grid__guide')).not.toBeNull();
    handle.pointerEventTarget.dispatchEvent(ptr('pointermove', 372));
    expect(seen).toHaveLength(0);
    up(handle.pointerEventTarget, 372);
    expect(container.querySelector('.fg-grid__guide')).toBeNull();
    expect(widthOf(g, 'start')).toBe(150);
    expect(handle.getLabelColumnWidth()).toBe(W + 30);
    expect(seen).toHaveLength(1);
  });

  it('ignores presses below the header band and away from a divider', async () => {
    const { handle, label } = await mountCanvas();
    label.getBoundingClientRect = () => rect(0, W);
    const other = vi.fn();
    handle.pointerEventTarget.addEventListener('pointerdown', other);
    handle.pointerEventTarget.dispatchEvent(down(340, 40)); // a row, not the header
    handle.pointerEventTarget.dispatchEvent(down(300, 10)); // mid column
    expect(other).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.fg-grid__guide')).toBeNull();
  });

  it('a touch press has a 16 px zone', async () => {
    const { handle, label } = await mountCanvas();
    label.getBoundingClientRect = () => rect(0, W);
    handle.pointerEventTarget.dispatchEvent(down(346, 10, { pointerType: 'touch' }));
    expect(container.querySelector('.fg-grid__guide')).not.toBeNull();
  });

  it('under RTL the inline-start edge is the right edge and dragging toward the chart (left) grows', async () => {
    const { g, handle, label } = await mountCanvas({ rtl: true });
    label.getBoundingClientRect = () => rect(1000, W);
    handle.mirrorX = (x: number) => 2000 - x;
    handle.pointerEventTarget.dispatchEvent(down(1000 + W - 340, 10));
    handle.pointerEventTarget.dispatchEvent(ptr('pointermove', 1000 + W - 380));
    up(handle.pointerEventTarget, 1000 + W - 380);
    expect(widthOf(g, 'start')).toBe(160);
  });

  it('Escape cancels', async () => {
    const { g, handle, label } = await mountCanvas();
    label.getBoundingClientRect = () => rect(0, W);
    handle.pointerEventTarget.dispatchEvent(down(340, 10));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    up(handle.pointerEventTarget, 400);
    expect(widthOf(g, 'start')).toBe(120);
    expect(container.querySelector('.fg-grid__guide')).toBeNull();
  });

  it('resizable:false installs nothing', async () => {
    const { handle, label } = await mountCanvas({ grid: { resizable: false } });
    label.getBoundingClientRect = () => rect(0, W);
    const other = vi.fn();
    handle.pointerEventTarget.addEventListener('pointerdown', other);
    handle.pointerEventTarget.dispatchEvent(down(340, 10));
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe('keyboard resize on a Canvas column header', () => {
  it('makes the headers script-focusable only: the chart stays one Tab stop', async () => {
    const { layer } = await mountCanvas();
    expect(heads(layer).map((h) => h.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '-1', '-1']);
    expect([...layer.querySelectorAll('[tabindex="0"]')].every((e) => e.getAttribute('role') === 'row')).toBe(true);
  });

  it('ArrowUp on the first row enters the headers, ArrowDown returns to row 0, Escape to the roving row', async () => {
    const { layer } = await mountCanvas();
    const row0 = layer.querySelector<HTMLElement>('[role=row][data-row-index="0"]')!;
    row0.focus();
    const up = await key(document.activeElement!, 'ArrowUp');
    expect(up.defaultPrevented).toBe(true);
    expect(document.activeElement!.getAttribute('data-column-id')).toBe('name');
    await key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement!.getAttribute('data-row-index')).toBe('0');
    await key(document.activeElement!, 'ArrowUp');
    await key(document.activeElement!, 'Escape');
    expect(document.activeElement!.getAttribute('role')).toBe('row');
  });

  it('Alt+Right resizes, the header keeps focus through the a11y rebuild and the row focus does not take it', async () => {
    const { g, layer } = await mountCanvas();
    heads(layer)[1]!.focus();
    await key(document.activeElement!, 'ArrowRight', true);
    expect(widthOf(g, 'start')).toBe(136);
    const active = document.activeElement as HTMLElement;
    expect(active.getAttribute('role')).toBe('columnheader');
    expect(active.getAttribute('data-column-id')).toBe('start');
  });

  it('paints a frame on the focused header and none after blur', async () => {
    const { layer, label, handle } = await mountCanvas();
    const frames = () => recOf(label).calls.filter((c) => c.name === 'strokeRect' && c.args[1] !== undefined && (c.args[3] as number) < 40);
    recOf(label).calls.length = 0;
    heads(layer)[2]!.focus();
    expect(frames().some((c) => (c.args[0] as number) >= 340 && (c.args[2] as number) < 130)).toBe(true);
    recOf(label).calls.length = 0;
    (document.activeElement as HTMLElement).blur();
    handle.setOptions({});
    expect(frames()).toHaveLength(0);
  });

  it('Left/Right move between headers', async () => {
    const { layer } = await mountCanvas();
    heads(layer)[0]!.focus();
    await key(document.activeElement!, 'ArrowRight');
    expect(document.activeElement!.getAttribute('data-column-id')).toBe('start');
    await key(document.activeElement!, 'End');
    expect(document.activeElement!.getAttribute('data-column-id')).toBe('progress');
  });
});

describe('hover cursor and fixed columns', () => {
  it('shows the resize cursor over a divider and hides the hover from competing pointermove listeners (canvas-drag resets the cursor)', async () => {
    const { handle, label } = await mountCanvas();
    label.getBoundingClientRect = () => rect(0, W);
    const canvas = handle.pointerEventTarget;
    const rival = vi.fn(() => {
      canvas.style.cursor = ''; // what canvas-drag's hover does with no bar claim
    });
    canvas.addEventListener('pointermove', rival);
    const move = (x: number, y: number) => canvas.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }), { pointerType: 'mouse' }));
    move(340, 10);
    expect(canvas.style.cursor).toBe('col-resize');
    move(341, 10);
    expect(rival).not.toHaveBeenCalled();
    expect(canvas.style.cursor).toBe('col-resize');
    move(300, 10);
    expect(rival).toHaveBeenCalledTimes(1);
    expect(canvas.style.cursor).toBe('');
  });

  it('has no hot zone for a fixed column', async () => {
    const { handle, label } = await mountCanvas({ columns: [{ id: 'name' }, { id: 'start', width: 100, minWidth: 100, maxWidth: 100 }, { id: 'end' }] });
    label.getBoundingClientRect = () => rect(0, 440);
    const other = vi.fn();
    handle.pointerEventTarget.addEventListener('pointerdown', other);
    handle.pointerEventTarget.dispatchEvent(down(320, 10)); // the fixed start column ends at 320
    expect(other).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.fg-grid__guide')).toBeNull();
  });

  it('a repaint mid-drag does not break the drag', async () => {
    const { g, handle, label } = await mountCanvas();
    label.getBoundingClientRect = () => rect(0, W);
    handle.pointerEventTarget.dispatchEvent(down(340, 10));
    handle.setOptions({}); // a full repaint
    up(handle.pointerEventTarget, 380);
    expect(container.querySelector('.fg-grid__guide')).toBeNull();
    expect(widthOf(g, 'start')).toBe(160);
  });
});

// --- G4: the keyboard model on the Canvas a11y layer (real cells, rebuilt on every focus change) ---------------
describe('keyboard cell navigation on Canvas (G4)', () => {
  const rows = (layer: Element) => [...layer.querySelectorAll<HTMLElement>('[role=row][data-task-id]')];
  const row = (layer: Element, task: string) => rows(layer).find((r) => r.getAttribute('data-task-id') === task)!;
  const cellIn = (layer: Element, task: string, col: number) =>
    row(layer, task).querySelector<HTMLElement>(`[role=gridcell][aria-colindex="${col + 1}"]`)!;
  const where = (): string => {
    const a = document.activeElement as HTMLElement;
    const task = a.closest('[data-task-id]')?.getAttribute('data-task-id');
    return a.getAttribute('role') === 'gridcell' ? `cell:${task}:${Number(a.getAttribute('aria-colindex')) - 1}` : `${a.getAttribute('role')}:${task}`;
  };
  const rings = (label: HTMLCanvasElement) =>
    recOf(label).calls.filter((c) => c.name === 'strokeRect' && (c.args[3] as number) > 20 && (c.args[3] as number) < 40 && (c.args[1] as number) > 32);

  it('Right enters the name cell, Right/Left/Home/End move, Left from the first cell and Escape return to the row', async () => {
    const { layer } = await mountCanvas();
    row(layer, 'c').focus();
    const e = await key(document.activeElement!, 'ArrowRight');
    expect(e.defaultPrevented).toBe(true);
    expect(where()).toBe('cell:c:0');
    await key(document.activeElement!, 'ArrowRight');
    await key(document.activeElement!, 'ArrowRight');
    expect(where()).toBe('cell:c:2');
    await key(document.activeElement!, 'End');
    expect(where()).toBe('cell:c:4');
    await key(document.activeElement!, 'Home');
    expect(where()).toBe('cell:c:0');
    await key(document.activeElement!, 'ArrowLeft');
    expect(where()).toBe('row:c');
    await key(document.activeElement!, 'ArrowRight');
    await key(document.activeElement!, 'ArrowRight');
    await key(document.activeElement!, 'Escape');
    expect(where()).toBe('row:c');
  });

  it('a focused cell survives the a11y rebuild; a new focused row keeps the column; the roving row stays the only Tab stop', async () => {
    const { handle, layer, internal } = await mountCanvas();
    row(layer, 'c').focus();
    await key(document.activeElement!, 'ArrowRight');
    await key(document.activeElement!, 'ArrowRight');
    await key(document.activeElement!, 'ArrowRight');
    expect(where()).toBe('cell:c:2');
    handle.setOptions({}); // a plain repaint
    expect(where()).toBe('cell:c:2');
    handle.update({ tasks: internal.tasks.all(), dependencies: [], focusedTaskId: id('b') }); // what keyboard-nav's Down does
    expect(where()).toBe('cell:b:2');
    expect([...layer.querySelectorAll('[tabindex="0"]')].every((e) => e.getAttribute('role') === 'row')).toBe(true);
    expect(cellIn(layer, 'b', 2).getAttribute('tabindex')).toBe('-1');
  });

  it('Left on a child selects the parent and the renderer follows the stub focusin onto the parent row', async () => {
    const { g, layer } = await mountCanvas();
    row(layer, 'a').focus();
    await key(document.activeElement!, 'ArrowLeft'); // a is a child of p
    // (no interaction mixin here, so no keyboard-nav: the renderer's own focus handling does the move)
    expect(g.getSelection()).toContain(id('p'));
  });

  it('paints a ring on the focused cell and none once focus returns to the row; the bar ring is not painted in cell mode', async () => {
    const { handle, layer, label } = await mountCanvas();
    row(layer, 'c').focus();
    await key(document.activeElement!, 'ArrowRight');
    recOf(label).calls.length = 0;
    await key(document.activeElement!, 'ArrowRight'); // name -> start (x 220..340)
    handle.setOptions({});
    expect(rings(label).some((c) => (c.args[0] as number) > 220 && (c.args[0] as number) < 260)).toBe(true);
    recOf(label).calls.length = 0;
    await key(document.activeElement!, 'Escape');
    handle.setOptions({});
    expect(rings(label).some((c) => (c.args[0] as number) > 220 && (c.args[0] as number) < 260)).toBe(false);
  });

  it('Up on a cell of row 0 goes to that header and Down returns to the cell', async () => {
    const { layer } = await mountCanvas();
    row(layer, 'p').focus();
    await key(document.activeElement!, 'ArrowRight');
    await key(document.activeElement!, 'ArrowRight');
    await key(document.activeElement!, 'ArrowRight');
    await key(document.activeElement!, 'ArrowUp');
    expect(document.activeElement!.getAttribute('data-column-id')).toBe('end');
    await key(document.activeElement!, 'ArrowDown');
    expect(where()).toBe('cell:p:2');
  });

  it('under RTL the physical keys swap', async () => {
    const { layer } = await mountCanvas({ rtl: true });
    row(layer, 'c').focus();
    await key(document.activeElement!, 'ArrowLeft'); // logical Right
    expect(where()).toBe('cell:c:0');
    await key(document.activeElement!, 'ArrowLeft');
    expect(where()).toBe('cell:c:1');
    await key(document.activeElement!, 'ArrowRight');
    await key(document.activeElement!, 'ArrowRight');
    expect(where()).toBe('row:c');
  });
});
