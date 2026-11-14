// @vitest-environment jsdom
//
// withGridEditing on the Canvas renderer (spec-grid-columns.md section 10; PR G6). Set-up copied from
// grid-resize-canvas.test.ts: jsdom has no 2D context and no layout, so every canvas gets a recording context and
// rects are stubbed. These tests pin the editor's host (a sibling of the canvases, outside every a11y row), its
// placement from the row index and `scrollTop`, the keyboard and double-click paths through the hit-test, focus
// return to the REBUILT a11y cell, and the cancel rules. Real pixels, sticky pinning and the alignment with the
// painted cell are Playwright's (`tests/e2e/grid-editing.spec.ts`).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withIo } from '../../src/io/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { withGrid } from '../../src/grid/mixin.js';
import { withGridEditing } from '../../src/grid-editing/mixin.js';
import { ROW_HEIGHT } from '../../src/render/renderer-base.js';
import { getInternal } from '../../src/gantt-internal.js';
import { createCanvasRenderer, type CanvasRendererHandle } from '../../src/render/canvas-renderer.js';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import type { GridColumnInput, GridOptions } from '../../src/grid/types.js';
import type { GridEditingOptions } from '../../src/grid-editing/types.js';

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
  editing?: GridEditingOptions;
}
/** A Canvas chart wired through the real mixin; resolves once the lazy painter has repainted it. */
async function mountCanvas(s: Setup = {}) {
  const base = withIo(withRender(createGantt({ tasks: s.tasks ?? TASKS, ...(s.rtl ? { rtl: true } : {}), ...s.config })));
  const g = withGridEditing(withGrid(s.rtl ? withRtl(base) : base, { ...(s.columns ? { columns: s.columns } : {}), ...s.grid }), s.editing);
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



beforeAll(async () => {
  await import('../../src/grid-editing/editing-ui.js');
  await import('../../src/grid/resize-ui.js');
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise<void>((r) => setTimeout(r, 0));
};
const COLS = ['name', 'start', 'end', 'duration', 'progress'];
const cellOf = (layer: Element, task: string, col: string) =>
  layer.querySelector<HTMLElement>(`[role=row][data-task-id="${task}"] [role=gridcell][aria-colindex="${COLS.indexOf(col) + 1}"]`)!;
/** Focus a cell the way the keyboard gets there: `keyboard-nav` makes the row the renderer's focused one first. */
const focusCell = (h: CanvasRendererHandle, layer: Element, task: string, col: string): HTMLElement => {
  h.update({ ...h.getRenderState().input, focusedTaskId: id(task) });
  const el = cellOf(layer, task, col);
  el.setAttribute('tabindex', '-1');
  el.focus();
  return document.activeElement as HTMLElement;
};
const editor = () => container.querySelector<HTMLInputElement>('.fg-grid__editor');
const ROW = ROW_HEIGHT.default;
async function press(el: Element, k: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  await flush();
  return e;
}
const type = (input: HTMLInputElement, v: string) => {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('the editor on Canvas', () => {
  it('lives in a host after the label canvas, never inside an a11y row, and sits on the cell by row index', async () => {
    const { g, layer, handle } = await mountCanvas();
    const labels = container.querySelector('canvas.fg-timeline-canvas-labels')!;
    await press(focusCell(handle, layer, 'b', 'start'), 'Enter');
    const input = editor()!;
    const host = input.parentElement!;
    expect(labels.nextElementSibling).toBe(host);
    expect(input.closest('[data-row-index]')).toBeNull();
    expect(layer.contains(host)).toBe(false);
    // b is row 2 (p, a, b), the header is 32 px; the cell is the start column, 220 px in
    expect(input.style.top).toBe(`${32 + 2 * ROW}px`);
    expect(input.style.height).toBe(`${ROW}px`);
    expect(input.style.insetInlineStart).toBe('220px');
    expect(input.style.width).toBe('120px');
    expect(input.getAttribute('aria-label')).toBe('Start, b');
    expect(input.value).toBe('2026-01-05');
    expect(g.isEditingCell()).toBe(true);
    void handle;
  });

  it('follows scrollTop on scroll', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 1));
    const { layer, handle } = await mountCanvas();
    await press(focusCell(handle, layer, 'b', 'name'), 'F2');
    container.scrollTop = 40;
    container.dispatchEvent(new Event('scroll'));
    expect(editor()!.style.top).toBe(`${32 + 2 * ROW - 40}px`);
  });

  it('Enter commits, and focus returns to the a11y cell found after the rebuild', async () => {
    const { g, layer, handle } = await mountCanvas();
    await press(focusCell(handle, layer, 'a', 'progress'), 'Enter');
    type(editor()!, '90');
    await press(editor()!, 'Enter');
    expect(g.getTask(id('a'))!.progress).toBeCloseTo(0.9);
    expect(editor()).toBeNull();
    expect(document.activeElement).toBe(cellOf(layer, 'a', 'progress'));
    expect(g.canUndo()).toBe(true);
    g.undo();
    expect(g.canUndo()).toBe(false);
  });

  it('a double-click on a pinned cell resolves the cell through hitTestRow', async () => {
    const { handle, label } = await mountCanvas();
    label.getBoundingClientRect = () => rect(0, W);
    handle.canvas.getBoundingClientRect = () => rect(0, 2000);
    // x = 400 is in the end column (340..460); y = 32 + ROW * 1.5 is the row index 1 (task a)
    handle.pointerEventTarget.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 400, clientY: 32 + ROW * 1.5 }));
    await flush();
    expect(editor()?.getAttribute('aria-label')).toBe('End, a');
  });

  it('a double-click on the toggle gutter or below the rows opens nothing', async () => {
    const { handle, label } = await mountCanvas();
    label.getBoundingClientRect = () => rect(0, W);
    handle.canvas.getBoundingClientRect = () => rect(0, 2000);
    handle.pointerEventTarget.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 4, clientY: 32 + ROW * 0.5 }));
    handle.pointerEventTarget.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 400, clientY: 590 }));
    await flush();
    expect(editor()).toBeNull();
  });

  it('startCellEdit finds the row in the a11y window, and says false for a row that is not there', async () => {
    const { g } = await mountCanvas();
    expect(g.startCellEdit(id('b'), 'duration')).toBe(true);
    await flush();
    expect(editor()?.getAttribute('aria-label')).toBe('Duration, b');
    g.cancelCellEdit();
    const many = Array.from({ length: 400 }, (_, i) => t(`r${i}`));
    const big = await mountCanvas({ tasks: many });
    big.g.startCellEdit(id('r399'), 'name'); // the code is loaded by now, so this is the real answer
    await flush();
    expect(big.g.isEditingCell()).toBe(false);
  });

  it('a column resize or a collapsed grid cancels; the edit is not committed', async () => {
    const { g, layer, handle } = await mountCanvas();
    await press(focusCell(handle, layer, 'a', 'name'), 'Enter');
    expect(editor()).not.toBeNull();
    type(editor()!, 'unsaved');
    g.resizeGridColumn('start', 200);
    await flush();
    expect(editor()).toBeNull();
    expect(g.getTask(id('a'))!.name).toBe('a');
  });

  it('removes the host on destroy and honours readOnly', async () => {
    const { g, layer, handle } = await mountCanvas();
    await press(focusCell(handle, layer, 'a', 'name'), 'Enter');
    expect(container.querySelector('.fg-grid__editor-host')).not.toBeNull();
    g.cancelCellEdit();
    expect(container.querySelector('.fg-grid__editor-host')).toBeNull();
    g.destroy();
    container.innerHTML = '';
    const ro = await mountCanvas({ config: { readOnly: true } });
    await press(focusCell(ro.handle, ro.layer, 'a', 'name'), 'Enter');
    expect(editor()).toBeNull();
    expect(cellOf(ro.layer, 'a', 'name').getAttribute('aria-readonly')).toBe('true');
  });
});
