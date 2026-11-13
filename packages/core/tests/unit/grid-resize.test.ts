// @vitest-environment jsdom
//
// Grid column resize on the SVG renderer (spec-grid-columns.md sections 7 and 9; PR G3): the capability
// (clamping, events, resizable:false, headless), the drag handles (sizers), Escape cancel, the RTL sign, the
// keyboard path on a focused column header and its announcement, and that the row Alt+Arrow keys are untouched.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { withGrid } from '../../src/grid/mixin.js';
import { announceGrid } from '../../src/grid/announce.js';
import { getInternal } from '../../src/gantt-internal.js';
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
const TASKS = [t('a'), t('b', { end: '2026-01-14' })];
const W = 220 + 120 + 120 + 96 + 96;

/** The lazy half is fetched on first use; load it once so a flush is enough for the queued action to run. */
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
  interaction?: boolean;
  rtl?: boolean;
  config?: Record<string, unknown>;
  grid?: GridOptions;
  mount?: boolean;
}
function make(s: Setup = {}) {
  let g = withRender(createGantt({ tasks: TASKS, ...(s.rtl ? { rtl: true } : {}), ...s.config }));
  if (s.interaction !== false) g = withInteraction(g);
  if (s.rtl) g = withRtl(g);
  const grid = withGrid(g, s.grid);
  if (s.mount !== false) grid.mount(container);
  return grid;
}
const handleOf = (g: object) => getInternal(g).mountOf()!.handle;
const heads = () => [...container.querySelectorAll<SVGElement>('svg.fg-timeline [role=columnheader]')];
const head = (col: string) => heads().find((h) => h.getAttribute('data-column-id') === col)!;
const sizers = () => [...container.querySelectorAll<HTMLElement>('.fg-grid__sizer')];
const live = () => container.querySelector('[aria-live]')!.textContent!.replace(/\u00A0/g, '');
const widthOf = (g: ReturnType<typeof make>, col: string) => g.getGridColumns().find((c) => c.id === col)!.width;

function ptr(type: string, init: { clientX?: number; clientY?: number } = {}): Event {
  const E = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const e = new E(type, { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperties(e, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: 'mouse' } });
  return e;
}
async function key(el: Element, k: string, mods: { alt?: boolean; shift?: boolean } = {}): Promise<KeyboardEvent> {
  const e = new KeyboardEvent('keydown', { key: k, altKey: !!mods.alt, shiftKey: !!mods.shift, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  await flush(); // the header actions run in the lazy half
  return e;
}
/** Focus a header the way the keyboard does and let the focus listeners run. */
const focusHead = (col: string) => {
  head(col).focus();
  return head(col);
};

describe('resizeGridColumn', () => {
  it('clamps to [minWidth, maxWidth], rounds, and reports whether anything changed', () => {
    const g = make({ grid: { columns: [{ id: 'name' }, { id: 'start', minWidth: 60, maxWidth: 200 }] } });
    expect(g.resizeGridColumn('start', 150.4)).toBe(true);
    expect(widthOf(g, 'start')).toBe(150);
    expect(g.resizeGridColumn('start', 150)).toBe(false);
    expect(g.resizeGridColumn('start', 1)).toBe(true);
    expect(widthOf(g, 'start')).toBe(60);
    expect(g.resizeGridColumn('start', 10_000)).toBe(true);
    expect(widthOf(g, 'start')).toBe(200);
    expect(g.resizeGridColumn('start', 200)).toBe(false); // already at the maximum
    expect(g.resizeGridColumn('nope', 100)).toBe(false);
    expect(g.resizeGridColumn('start', NaN)).toBe(false);
    expect(g.resizeGridColumn('start', Infinity)).toBe(false);
  });

  it('writes the pinned width and repaints exactly once, emitting one column:resized with every width', () => {
    const g = make();
    const internal = getInternal(g);
    let renders = 0;
    internal.paints!.unshift((e) => {
      if (e.column) renders++;
    });
    const seen: unknown[] = [];
    g.on('column:resized', (p) => seen.push(p));
    expect(g.resizeGridColumn('end', 150)).toBe(true);
    expect(renders).toBe(1);
    expect(handleOf(g).getLabelColumnWidth()).toBe(W + 30);
    expect(container.querySelector('.fg-timeline__sticky-column')!.getAttribute('width')).toBe(String(W + 30));
    expect(seen).toEqual([{ columnId: 'end', width: 150, widths: { name: 220, start: 120, end: 150, duration: 96, progress: 96 } }]);
    g.resizeGridColumn('end', 150); // no change: no render, no event
    expect(renders).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it('works headless (no mount) and is not gated by readOnly', () => {
    const g = make({ mount: false, config: { readOnly: true } });
    const seen: unknown[] = [];
    g.on('column:resized', (p) => seen.push(p));
    expect(g.resizeGridColumn('start', 200)).toBe(true);
    expect(widthOf(g, 'start')).toBe(200);
    expect(seen).toHaveLength(1);
    g.mount(container);
    expect(handleOf(g).getLabelColumnWidth()).toBe(W + 80); // the width survives the mount
  });

  it('resizable:false freezes the widths: false, no event, no sizers, no header mode, headers take no focus', async () => {
    const g = make({ grid: { resizable: false } });
    const seen: unknown[] = [];
    g.on('column:resized', (p) => seen.push(p));
    expect(g.resizeGridColumn('start', 200)).toBe(false);
    expect(seen).toHaveLength(0);
    expect(sizers()).toHaveLength(0);
    expect(heads().some((h) => h.hasAttribute('tabindex'))).toBe(false);
    const row0 = container.querySelector<SVGElement>('.fg-timeline__row[data-row-index="0"]')!;
    row0.focus();
    const up = await key(row0, 'ArrowUp'); // header mode does not exist
    expect(up.defaultPrevented).toBe(false);
    const e = await key(head('start'), 'ArrowRight', { alt: true });
    expect(e.defaultPrevented).toBe(false);
    expect(widthOf(g, 'start')).toBe(120);
  });

  it('throws after destroy like the other capabilities', () => {
    const g = make();
    g.destroy();
    expect(() => g.resizeGridColumn('start', 200)).toThrow();
  });
});

describe('drag handles', () => {
  const guide = () => container.querySelector('.fg-grid__guide');
  /** pointerdown starts the drag in the lazy half: wait until the guide exists. */
  const press = async (s: Element, clientX: number) => {
    s.dispatchEvent(ptr('pointerdown', { clientX }));
    await vi.waitFor(() => expect(guide()).not.toBeNull());
  };

  it('has one sizer per column divider, centred on it, rebuilt (not duplicated) by a repaint', () => {
    const g = make();
    expect(sizers().map((s) => s.style.getPropertyValue('--fg-x'))).toEqual(['220px', '340px', '460px', '556px', '652px']);
    g.resizeGridColumn('start', 140);
    expect(container.querySelectorAll('.fg-grid__ov')).toHaveLength(1);
    expect(sizers().map((s) => s.style.getPropertyValue('--fg-x'))).toEqual(['220px', '360px', '480px', '576px', '672px']);
  });

  it('has no handle for a fixed column (minWidth equals maxWidth)', () => {
    make({ grid: { columns: [{ id: 'name' }, { id: 'start', minWidth: 100, maxWidth: 100, width: 100 }, { id: 'end' }] } });
    expect(sizers().map((s) => s.style.getPropertyValue('--fg-x'))).toEqual(['220px', '440px']);
  });

  it('commits once on release, shows a guide meanwhile, and the sizer hides the gesture from the chart layer', async () => {
    const g = make();
    const layer = container.querySelector('.fg-timeline__layer')!;
    const leaked: string[] = [];
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'click']) layer.addEventListener(t, () => leaked.push(t));
    const seen: unknown[] = [];
    g.on('column:resized', (p) => seen.push(p));
    const s = sizers()[1]!; // the start column's end edge
    await press(s, 100);
    s.dispatchEvent(ptr('pointermove', { clientX: 130 }));
    expect(seen).toHaveLength(0); // nothing is written while dragging
    expect(widthOf(g, 'start')).toBe(120);
    s.dispatchEvent(ptr('pointerup', { clientX: 150 }));
    s.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(guide()).toBeNull();
    expect(widthOf(g, 'start')).toBe(170);
    expect(seen).toHaveLength(1);
    expect(leaked).toEqual([]);
    expect(g.getSelection()).toEqual([]);
  });

  it('survives a repaint mid-drag: the release still commits, nothing is left behind', async () => {
    const g = make();
    const seen: unknown[] = [];
    g.on('column:resized', (p) => seen.push(p));
    await press(sizers()[1]!, 100);
    g.updateTask(id('a'), { name: 'renamed' }); // a host-driven full repaint replaces every sizer
    expect(guide()).not.toBeNull();
    document.body.dispatchEvent(ptr('pointermove', { clientX: 140 }));
    document.body.dispatchEvent(ptr('pointerup', { clientX: 140 }));
    expect(guide()).toBeNull();
    expect(widthOf(g, 'start')).toBe(160);
    expect(seen).toHaveLength(1);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false); // the Escape listener is gone
  });

  it('clamps the drag to the column limits', async () => {
    const g = make({ grid: { columns: [{ id: 'name' }, { id: 'start', maxWidth: 130 }] } });
    const s = sizers()[1]!;
    await press(s, 0);
    s.dispatchEvent(ptr('pointerup', { clientX: 500 }));
    expect(widthOf(g, 'start')).toBe(130);
  });

  it('Escape cancels: no write, no event, the guide goes, and a later release does nothing', async () => {
    const g = make();
    const seen: unknown[] = [];
    g.on('column:resized', (p) => seen.push(p));
    const s = sizers()[2]!;
    await press(s, 100);
    s.dispatchEvent(ptr('pointermove', { clientX: 160 }));
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(guide()).toBeNull();
    s.dispatchEvent(ptr('pointerup', { clientX: 160 }));
    expect(widthOf(g, 'end')).toBe(120);
    expect(seen).toHaveLength(0);
  });

  it('pointercancel cancels, a secondary button never starts a drag, and a second press cancels the first', async () => {
    const g = make();
    const s = sizers()[0]!;
    const right = ptr('pointerdown', { clientX: 0 });
    Object.defineProperty(right, 'button', { value: 2 });
    s.dispatchEvent(right);
    await flush();
    expect(guide()).toBeNull();
    await press(s, 0);
    s.dispatchEvent(ptr('pointermove', { clientX: 50 }));
    s.dispatchEvent(ptr('pointercancel'));
    s.dispatchEvent(ptr('pointerup', { clientX: 50 }));
    expect(widthOf(g, 'name')).toBe(220);
    await press(s, 0);
    sizers()[1]!.dispatchEvent(ptr('pointerdown', { clientX: 0 })); // a second press drops the first drag (and starts its own)
    await flush();
    expect(container.querySelectorAll('.fg-grid__guide')).toHaveLength(1);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(guide()).toBeNull();
  });

  it('mirrors the sign under RTL: dragging toward the chart (left) grows the column', async () => {
    const g = make({ rtl: true });
    await press(sizers()[1]!, 500);
    sizers()[1]!.dispatchEvent(ptr('pointerup', { clientX: 470 }));
    expect(widthOf(g, 'start')).toBe(150);
    await press(sizers()[1]!, 500);
    sizers()[1]!.dispatchEvent(ptr('pointerup', { clientX: 520 }));
    expect(widthOf(g, 'start')).toBe(130);
  });

  it('does not leave the guide or the Escape listener behind when the chart is destroyed', async () => {
    const g = make();
    await press(sizers()[0]!, 0);
    g.destroy();
    expect(guide()).toBeNull();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
  });

  it('paints no handles on the throwaway export renderer of a Canvas mount', () => {
    const g = make({ mount: false });
    // no svg mount: the hook has no env, so a paint event with a corner changes nothing
    const internal = getInternal(g);
    const layer = document.createElement('div');
    const corner = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
    layer.append(corner);
    for (const hook of internal.paints!) hook({ svg: document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement, column: corner, corner: corner as never });
    expect(layer.querySelector('.fg-grid__ov')).toBeNull();
  });
});

describe('header mode', () => {
  it('keeps the chart ONE Tab stop: the headers are script-focusable only and the active row is the stop', () => {
    make();
    expect(heads().map((h) => h.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '-1', '-1']);
    const stops = [...container.querySelectorAll('svg.fg-timeline [tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) >= 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.getAttribute('role')).toBe('row');
  });

  it('ArrowUp on the first row enters the headers (the first time the first column) before keyboard-nav sees it', async () => {
    const g = make();
    const row0 = container.querySelector<SVGElement>('.fg-timeline__row[data-row-index="0"]')!;
    row0.focus();
    const e = await key(row0, 'ArrowUp');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(head('name'));
    expect(g.getSelection()).toEqual([]); // keyboard-nav's select-follows-focus never ran
  });

  it('ArrowUp on another row, or with a modifier, is left alone', async () => {
    make();
    const row1 = container.querySelector<SVGElement>('.fg-timeline__row[data-row-index="1"]')!;
    row1.focus();
    expect((await key(row1, 'ArrowUp')).defaultPrevented).toBe(true); // keyboard-nav moves to row 0
    expect(document.activeElement!.getAttribute('data-row-index')).toBe('0');
    const row0 = document.activeElement!;
    expect((await key(row0, 'ArrowUp', { shift: true })).defaultPrevented).toBe(false);
    expect((await key(row0, 'ArrowUp', { alt: true })).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(row0);
  });

  it('ArrowDown returns to the first row and Escape to the last focused row', async () => {
    make();
    const row1 = container.querySelector<SVGElement>('.fg-timeline__row[data-row-index="1"]')!;
    row1.focus();
    await key(row1, 'ArrowUp'); // row 0
    await key(document.activeElement!, 'ArrowUp'); // header
    expect(document.activeElement).toBe(head('name'));
    await key(head('name'), 'ArrowDown');
    expect(document.activeElement!.getAttribute('data-row-index')).toBe('0');
    await key(document.activeElement!, 'ArrowUp');
    // go back via Escape: the roving row is the one keyboard-nav last focused (row 0)
    const e = await key(head('name'), 'Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement!.getAttribute('role')).toBe('row');
  });

  it('keeps focus on the header across a host-driven repaint (no header -> row bounce)', async () => {
    const g = make();
    focusHead('end');
    const moves: string[] = [];
    container.addEventListener('focusin', (e) => moves.push((e.target as Element).getAttribute('role') ?? ''));
    g.updateTask(id('a'), { name: 'again' }); // full repaint
    g.select([id('b')]); // row patch
    await flush();
    expect(document.activeElement).toBe(head('end'));
    expect(moves.filter((m) => m === 'columnheader').length).toBeGreaterThan(0);
  });

  it('keeps a focused ROW focused across a full repaint with the grid composed', () => {
    const g = make();
    const row = container.querySelector<SVGElement>('.fg-timeline__row[data-task-id="b"]')!;
    row.focus();
    g.updateTask(id('a'), { name: 'again' });
    expect(document.activeElement!.getAttribute('data-task-id')).toBe('b');
    expect(document.activeElement!.getAttribute('role')).toBe('row');
  });

  it('Alt+Right grows by 16 px, Alt+Shift+Right by 2 px, Alt+Left shrinks, and the focus survives the repaint', async () => {
    const g = make();
    const seen: number[] = [];
    g.on('column:resized', (p) => seen.push(p.width));
    let e = await key(focusHead('start'), 'ArrowRight', { alt: true });
    expect(e.defaultPrevented).toBe(true);
    expect(widthOf(g, 'start')).toBe(136);
    expect(document.activeElement).toBe(head('start'));
    await key(head('start'), 'ArrowRight', { alt: true, shift: true });
    expect(widthOf(g, 'start')).toBe(138);
    await key(head('start'), 'ArrowLeft', { alt: true });
    expect(widthOf(g, 'start')).toBe(122);
    expect(seen).toEqual([136, 138, 122]);
    // at the minimum the key is still consumed (Alt+Left is History Back) and nothing is emitted
    g.resizeGridColumn('start', 48);
    e = await key(head('start'), 'ArrowLeft', { alt: true });
    expect(e.defaultPrevented).toBe(true);
    expect(seen).toHaveLength(4);
    expect(document.activeElement).toBe(head('start'));
  });

  it('is RTL-aware: toward the chart grows, so Alt+Left grows under RTL', async () => {
    const g = make({ rtl: true });
    await key(focusHead('start'), 'ArrowLeft', { alt: true });
    expect(widthOf(g, 'start')).toBe(136);
    await key(head('start'), 'ArrowRight', { alt: true });
    expect(widthOf(g, 'start')).toBe(120);
  });

  it('works in a readOnly chart and without withInteraction (silently)', async () => {
    const g = make({ interaction: false, config: { readOnly: true } });
    await key(focusHead('end'), 'ArrowRight', { alt: true });
    expect(widthOf(g, 'end')).toBe(136);
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('ignores Ctrl/Meta+Alt and IME composition', async () => {
    const g = make();
    const h = focusHead('start');
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, isComposing: true, bubbles: true, cancelable: true }));
    await flush();
    expect(widthOf(g, 'start')).toBe(120);
  });

  it('Left/Right/Home/End move between headers (logical under RTL)', async () => {
    make();
    focusHead('name');
    await key(head('name'), 'ArrowRight');
    expect(document.activeElement).toBe(head('start'));
    await key(head('start'), 'End');
    expect(document.activeElement).toBe(head('progress'));
    const atEnd = await key(head('progress'), 'ArrowRight');
    expect(atEnd.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(head('progress'));
    await key(head('progress'), 'Home');
    expect(document.activeElement).toBe(head('name'));
  });

  it('under RTL ArrowLeft moves to the next header', async () => {
    make({ rtl: true });
    focusHead('name');
    await key(head('name'), 'ArrowLeft');
    expect(document.activeElement).toBe(head('start'));
  });

  it('draws a focus ring over the focused header and removes it on blur', async () => {
    make();
    focusHead('end');
    await flush();
    const ring = container.querySelector<HTMLElement>('.fg-grid__ring')!;
    expect(ring.style.insetInlineStart).toBe('340px');
    expect(ring.style.width).toBe('120px');
    (document.activeElement as HTMLElement).blur();
    expect(container.querySelector('.fg-grid__ring')).toBeNull();
  });

  it('leaves the row Alt+Arrow move and resize (#126) alone', async () => {
    const g = make();
    const row = container.querySelector<SVGElement>('.fg-timeline__row[data-task-id="a"]')!;
    row.focus();
    const before = g.getTask(id('a'))!;
    const e = await key(row, 'ArrowRight', { alt: true });
    expect(e.defaultPrevented).toBe(true);
    expect(g.getTask(id('a'))!.start.toString()).not.toBe(before.start.toString());
    expect(g.getGridColumns().map((c) => c.width)).toEqual([220, 120, 120, 96, 96]);
  });
});

describe('announcements', () => {
  it('announces the new width in English through the interaction live region', async () => {
    make();
    await key(focusHead('start'), 'ArrowRight', { alt: true });
    expect(live()).toBe('Start: 136 pixels wide');
    await key(head('start'), 'ArrowRight', { alt: true });
    expect(live()).toBe('Start: 152 pixels wide');
  });

  it('uses messages.announce for the column-resized kind', async () => {
    const calls: unknown[] = [];
    const announce = vi.fn((a: unknown) => {
      calls.push(a);
      return 'custom';
    });
    make({ config: { messages: { announce } } });
    await key(focusHead('start'), 'ArrowRight', { alt: true });
    expect(live()).toBe('custom');
    expect(calls[0]).toEqual({ kind: 'column-resized', columnId: 'start', header: 'Start', width: 136, locale: 'en' });
  });

  it('English fallback for a throwing or non-string host function', async () => {
    container.replaceChildren();
    make({ config: { messages: { announce: () => { throw new Error('x'); } } } });
    await key(focusHead('end'), 'ArrowLeft', { alt: true });
    expect(live()).toBe('End: 104 pixels wide');
    container.replaceChildren();
    make({ config: { messages: { announce: () => 42 as never } } });
    await key(focusHead('end'), 'ArrowLeft', { alt: true });
    expect(live()).toBe('End: 104 pixels wide');
  });

  it('announceGrid caps the length, strips unsafe characters and is silent without a region', () => {
    const g = make({ mount: false });
    const internal = getInternal(g);
    const a = { kind: 'column-resized', columnId: 'x', header: 'X', width: 1, locale: 'en' } as const;
    announceGrid(internal, a, 'nothing'); // no writer: no throw
    const written: string[] = [];
    internal.announce = (s) => written.push(s);
    announceGrid(internal, a, 'a\u0007b' + 'z'.repeat(1000));
    expect(written[0]).toHaveLength(400);
    expect(written[0]!.startsWith('a b')).toBe(true);
  });
});
