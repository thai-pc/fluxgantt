// @vitest-environment jsdom
//
// `withEditHooks()` (spec-host-edit-hooks.md §10): task:activated / task:context-requested from
// dblclick, contextmenu, keyboard and touch long-press, over the real SVG renderer, plus a faked
// Canvas-style handle (row-wide `hitTestRow`) for the Canvas hit path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import type { TaskActivatedPayload, TaskContextRequestedPayload } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withEditHooks } from '../../src/edit-hooks/mixin.js';
import type { EditHooksOptions } from '../../src/edit-hooks/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import type { MountState } from '../../src/gantt-internal.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

interface PtrInit {
  x?: number;
  y?: number;
  pointerType?: string;
  pointerId?: number;
  isPrimary?: boolean;
  button?: number;
}
function ptr(type: string, target: EventTarget, init: PtrInit = {}): MouseEvent {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x ?? 10,
    clientY: init.y ?? 10,
    button: init.button ?? 0,
  });
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(e, 'isPrimary', { value: init.isPrimary ?? true });
  target.dispatchEvent(e);
  return e;
}
function key(target: EventTarget, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
function ctxMenu(target: EventTarget, x = 10, y = 10): MouseEvent {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
  target.dispatchEvent(e);
  return e;
}
function dbl(target: EventTarget, x = 10, y = 10): void {
  target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const rowEl = (id: string): SVGElement =>
  container.querySelector(`.fg-timeline__row[data-task-id="${id}"]`) as SVGElement;
const barEl = (id: string): Element => rowEl(id).querySelector('.fg-task__bar')!;

interface Opts {
  interaction?: boolean;
  readOnly?: boolean;
  hooks?: EditHooksOptions;
  hier?: boolean;
  mount?: boolean;
}
function setup(o: Opts = {}) {
  const tasks: TaskInput[] = [
    taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
    taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
  ];
  if (o.hier) {
    tasks.push(
      taskInput('p', '2026-01-05T09:00', '2026-01-09T09:00'),
      taskInput('k', '2026-01-05T09:00', '2026-01-07T09:00', { parent: toTaskId('p') }),
    );
  }
  let g = withRender(createGantt({ tasks, ...(o.readOnly ? { readOnly: true } : {}) }));
  if (o.interaction !== false) g = withInteraction(g);
  const gantt = withEditHooks(g, o.hooks);
  const activated: TaskActivatedPayload[] = [];
  const context: TaskContextRequestedPayload[] = [];
  gantt.on('task:activated', (p) => activated.push(p));
  gantt.on('task:context-requested', (p) => context.push(p));
  if (o.mount !== false) gantt.mount(container);
  return { gantt, activated, context };
}

describe('withEditHooks — SVG grid area', () => {
  it('dblclick / right-click on the grid cell of a row reports that row with part row', () => {
    const { context, activated } = setup();
    const cell = container.querySelector('.fg-timeline__grid-cell') as SVGElement;
    expect(cell).not.toBeNull();
    const rows = ['a', 'b'].map((id) => rowEl(id));
    rows.forEach((r, i) =>
      vi.spyOn(r, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100 + i * 40, 50, 40)),
    );
    dbl(cell, 300, 160);
    expect(activated).toHaveLength(1);
    expect(activated[0]).toMatchObject({ taskId: 'b', part: 'row', source: 'pointer' });
    ctxMenu(cell, 300, 110);
    expect(context[0]).toMatchObject({ taskId: 'a', part: 'row', source: 'pointer' });
    dbl(cell, 300, 20); // above every row (header area): nothing
    expect(activated).toHaveLength(1);
  });
});

describe('withEditHooks — headless / lifecycle', () => {
  it('applying to an unmounted instance does nothing and destroy is safe before and after mount', () => {
    const base = withEditHooks(createGantt({ tasks: [] }));
    expect(() => base.destroy()).not.toThrow();
    const { gantt } = setup();
    expect(() => {
      gantt.destroy();
      gantt.destroy();
    }).not.toThrow();
  });

  it('remount re-installs on the new handle and the old listeners are gone', () => {
    const { gantt, activated } = setup();
    gantt.unmount();
    container.replaceChildren();
    gantt.mount(container);
    dbl(barEl('a'));
    expect(activated).toHaveLength(1);
  });

  it('destroy removes listeners and clears a pending long-press timer', () => {
    vi.useFakeTimers();
    const { gantt, context } = setup();
    const bar = barEl('a');
    ptr('pointerdown', bar, { pointerType: 'touch' });
    gantt.destroy();
    vi.advanceTimersByTime(1000);
    expect(context).toHaveLength(0);
  });
});

describe('withEditHooks — double-click', () => {
  it('reports part bar / label / row and the pointer position', () => {
    const { activated } = setup();
    dbl(barEl('a'), 33, 44);
    dbl(rowEl('a').querySelector('.fg-timeline__row-label')!);
    // The gridcell wrapper is neither bar, label nor toggle.
    dbl(rowEl('a').querySelector('.fg-timeline__row-cell')!);
    expect(activated.map((p) => p.part)).toEqual(['bar', 'label', 'row']);
    expect(activated[0]).toMatchObject({ taskId: 'a', source: 'pointer', clientX: 33, clientY: 44 });
  });

  it('a link handle counts as the bar', () => {
    const { activated } = setup();
    dbl(rowEl('a').querySelector('.fg-task__link-handle')!);
    expect(activated[0]!.part).toBe('bar');
  });

  it('the collapse toggle glyph, empty space and the svg root emit nothing', () => {
    const { activated } = setup({ hier: true });
    dbl(rowEl('p').querySelector('.fg-timeline__row-toggle')!);
    dbl(container.querySelector('svg')!);
    expect(activated).toHaveLength(0);
  });

  it('non-finite coordinates and an unknown / removed id are dropped', () => {
    const { gantt, activated } = setup();
    const bar = barEl('a');
    const nan = new MouseEvent('dblclick', { bubbles: true, clientX: 1, clientY: 1 });
    Object.defineProperty(nan, 'clientX', { value: Number.NaN });
    bar.dispatchEvent(nan);
    expect(activated).toHaveLength(0);
    rowEl('a').setAttribute('data-task-id', 'ghost');
    dbl(bar);
    expect(activated).toHaveLength(0);
    gantt.removeTask(toTaskId('b'));
    expect(activated).toHaveLength(0);
  });

  it('ignores a dblclick 10 px from the last pointerdown, emits for 2 px', () => {
    const { activated } = setup();
    const bar = barEl('a');
    ptr('pointerdown', bar, { x: 100, y: 100 });
    dbl(bar, 110, 100);
    expect(activated).toHaveLength(0);
    ptr('pointerdown', bar, { x: 100, y: 100 });
    dbl(bar, 102, 100);
    expect(activated).toHaveLength(1);
  });

  it('full pointer sequence then dblclick leaves the task selected, one selection:changed, nothing moved', () => {
    const { gantt, activated } = setup();
    const changed = vi.fn();
    const moved = vi.fn();
    const resized = vi.fn();
    gantt.on('selection:changed', changed);
    gantt.on('task:moved', moved);
    gantt.on('task:resized', resized);
    const before = gantt.getTask(toTaskId('a'));
    for (let i = 0; i < 2; i++) {
      // Re-query each time: selecting repaints and replaces the row nodes.
      ptr('pointerdown', barEl('a'), { x: 100, y: 100 });
      ptr('pointerup', window, { x: 100, y: 100 });
    }
    dbl(barEl('a'), 100, 100);
    expect(activated).toHaveLength(1);
    expect(gantt.getSelection()).toEqual([toTaskId('a')]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(moved).not.toHaveBeenCalled();
    expect(resized).not.toHaveBeenCalled();
    expect(gantt.getTask(toTaskId('a'))).toEqual(before);
  });

  it('is a pure observer: does not prevent the event', () => {
    setup();
    const e = new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 });
    barEl('a').dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('fires in a readOnly chart', () => {
    const { activated, context } = setup({ readOnly: true });
    dbl(barEl('a'));
    ctxMenu(barEl('a'));
    expect(activated).toHaveLength(1);
    expect(context).toHaveLength(1);
  });

  it('works without withInteraction', () => {
    const { activated } = setup({ interaction: false });
    dbl(barEl('a'));
    expect(activated).toHaveLength(1);
  });
});

describe('withEditHooks — contextmenu', () => {
  it('does not prevent the native menu unless the host calls preventDefault', () => {
    const { gantt } = setup();
    expect(ctxMenu(barEl('a')).defaultPrevented).toBe(false); // no handler
    gantt.on('task:context-requested', () => {});
    expect(ctxMenu(barEl('a')).defaultPrevented).toBe(false); // handler ignoring it
    gantt.on('task:context-requested', (p) => p.preventDefault());
    expect(ctxMenu(barEl('a')).defaultPrevented).toBe(true);
  });

  it('payload carries id / part / source / coords; preventDefault is idempotent and safe after the fact', () => {
    const { context } = setup();
    ctxMenu(barEl('b'), 7, 8);
    expect(context[0]).toMatchObject({ taskId: 'b', part: 'bar', source: 'pointer', clientX: 7, clientY: 8 });
    expect(() => {
      context[0]!.preventDefault();
      context[0]!.preventDefault();
    }).not.toThrow();
  });

  it('empty space and the toggle glyph: no event, native menu untouched', () => {
    const { gantt, context } = setup({ hier: true });
    gantt.on('task:context-requested', (p) => p.preventDefault());
    expect(ctxMenu(container.querySelector('svg')!).defaultPrevented).toBe(false);
    expect(ctxMenu(rowEl('p').querySelector('.fg-timeline__row-toggle')!).defaultPrevented).toBe(false);
    expect(context).toHaveLength(0);
  });

  it('a throwing host handler leaves the native menu allowed and the error isolated', () => {
    const { gantt } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    gantt.on('task:context-requested', () => {
      throw new Error('boom');
    });
    let e: MouseEvent | undefined;
    expect(() => {
      e = ctxMenu(barEl('a'));
    }).not.toThrow();
    expect(e!.defaultPrevented).toBe(false);
  });

  it('does not select the task', () => {
    const { gantt } = setup();
    ctxMenu(barEl('a'));
    expect(gantt.getSelection()).toEqual([]);
  });
});

describe('withEditHooks — keyboard', () => {
  it('Enter on a leaf activates (with and without withInteraction) and prevents the keydown', () => {
    for (const interaction of [true, false]) {
      container.replaceChildren();
      const { gantt, activated } = setup({ interaction });
      const e = key(rowEl('a'), 'Enter');
      expect(activated).toHaveLength(1);
      expect(activated[0]).toMatchObject({ taskId: 'a', part: 'row', source: 'keyboard' });
      expect(Number.isFinite(activated[0]!.clientX) && Number.isFinite(activated[0]!.clientY)).toBe(true);
      expect(e.defaultPrevented).toBe(true);
      gantt.destroy();
    }
  });

  it('Enter on a summary with withInteraction toggles collapse once and does NOT activate (listener-order pin)', () => {
    const { activated } = setup({ hier: true });
    // keyboard-nav toggles its ROVING row (moved by arrows), which is the row that has focus.
    key(rowEl('a'), 'ArrowDown');
    key(rowEl('b'), 'ArrowDown');
    expect(rowEl('p').getAttribute('tabindex')).toBe('0');
    key(rowEl('p'), 'Enter');
    expect(activated).toHaveLength(0);
    expect(container.querySelector('.fg-timeline__row[data-task-id="k"]')).toBeNull();
  });

  it('Enter on a summary without withInteraction activates', () => {
    const { activated } = setup({ hier: true, interaction: false });
    key(rowEl('p'), 'Enter');
    expect(activated).toHaveLength(1);
  });

  it('F2 activates on a summary row even with withInteraction (collapse untouched)', () => {
    const { activated } = setup({ hier: true });
    key(rowEl('p'), 'F2');
    expect(activated).toHaveLength(1);
    expect(container.querySelector('.fg-timeline__row[data-task-id="k"]')).not.toBeNull();
  });

  it('modifiers, repeat and composing are ignored for Enter/F2', () => {
    const { activated } = setup();
    key(rowEl('a'), 'Enter', { ctrlKey: true });
    key(rowEl('a'), 'Enter', { metaKey: true });
    key(rowEl('a'), 'Enter', { altKey: true });
    key(rowEl('a'), 'F2', { shiftKey: true });
    key(rowEl('a'), 'Enter', { repeat: true });
    key(rowEl('a'), 'Enter', { isComposing: true });
    expect(activated).toHaveLength(0);
  });

  it('a keydown whose target is not inside a row is ignored', () => {
    const { activated, context } = setup();
    key(container.querySelector('svg')!, 'Enter');
    key(container.querySelector('svg')!, 'ContextMenu');
    expect(activated).toHaveLength(0);
    expect(context).toHaveLength(0);
  });

  it('ContextMenu key and Shift+F10 emit once each, even when a native contextmenu follows', () => {
    const { gantt, context } = setup();
    gantt.on('task:context-requested', (p) => p.preventDefault());
    const k1 = key(rowEl('a'), 'ContextMenu');
    expect(k1.defaultPrevented).toBe(true);
    const native = ctxMenu(rowEl('a'));
    expect(native.defaultPrevented).toBe(true); // forwarded decision
    key(rowEl('b'), 'F10', { shiftKey: true });
    ctxMenu(rowEl('b'));
    expect(context.map((p) => [p.taskId, p.source])).toEqual([
      ['a', 'keyboard'],
      ['b', 'keyboard'],
    ]);
  });

  it('a native contextmenu after a key press the host did not prevent is not prevented and not re-emitted', () => {
    const { context } = setup();
    key(rowEl('a'), 'ContextMenu');
    expect(ctxMenu(rowEl('a')).defaultPrevented).toBe(false);
    expect(context).toHaveLength(1);
  });

  it('a later mouse right-click is a fresh pointer event (dedupe flag cleared by pointerdown)', () => {
    const { context } = setup();
    key(rowEl('a'), 'ContextMenu');
    ptr('pointerdown', barEl('b'), { button: 2 });
    ctxMenu(barEl('b'));
    expect(context.map((p) => p.source)).toEqual(['keyboard', 'pointer']);
  });

  it('F10 without Shift does nothing', () => {
    const { context } = setup();
    key(rowEl('a'), 'F10');
    expect(context).toHaveLength(0);
  });

  it('a degenerate row rect falls back to a finite anchor', () => {
    const { activated } = setup();
    vi.spyOn(rowEl('a'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));
    key(rowEl('a'), 'Enter');
    expect(Number.isFinite(activated[0]!.clientX)).toBe(true);
    expect(activated[0]!.clientX).toBe(160);
  });
});

describe('withEditHooks — touch long-press', () => {
  const touch = (target: EventTarget, type: string, init: PtrInit = {}): MouseEvent =>
    ptr(type, target, { pointerType: 'touch', ...init });

  it('fires at longPressMs (default 500) with source long-press and the last position', () => {
    vi.useFakeTimers();
    const { context } = setup();
    const bar = barEl('a');
    touch(bar, 'pointerdown', { x: 20, y: 30 });
    vi.advanceTimersByTime(499);
    expect(context).toHaveLength(0);
    touch(bar, 'pointermove', { x: 23, y: 31 });
    vi.advanceTimersByTime(1);
    expect(context).toHaveLength(1);
    expect(context[0]).toMatchObject({ taskId: 'a', source: 'long-press', part: 'bar', clientX: 23, clientY: 31 });
  });

  it('is cancelled by pointerup, pointercancel, a second pointerdown and an 8 px move', () => {
    vi.useFakeTimers();
    const { context } = setup();
    const bar = barEl('a');
    touch(bar, 'pointerdown');
    touch(bar, 'pointerup');
    vi.advanceTimersByTime(600);
    touch(bar, 'pointerdown');
    touch(bar, 'pointercancel');
    vi.advanceTimersByTime(600);
    touch(bar, 'pointerdown', { x: 10, y: 10 });
    touch(bar, 'pointermove', { x: 10, y: 18 });
    vi.advanceTimersByTime(600);
    touch(bar, 'pointerdown', { pointerId: 1 });
    touch(bar, 'pointerdown', { pointerId: 2, isPrimary: false });
    vi.advanceTimersByTime(600);
    expect(context).toHaveLength(0);
  });

  it('a 7 px move does not cancel off a bar (8 px slop), but a 4 px move cancels on a bar (drag threshold)', () => {
    vi.useFakeTimers();
    const { context } = setup();
    const label = rowEl('a').querySelector('.fg-timeline__row-label')!;
    touch(label, 'pointerdown', { x: 10, y: 10 });
    touch(label, 'pointermove', { x: 10, y: 17 });
    vi.advanceTimersByTime(500);
    expect(context).toHaveLength(1);
    touch(label, 'pointerup');
    touch(barEl('a'), 'pointerdown', { x: 10, y: 10 });
    touch(barEl('a'), 'pointermove', { x: 10, y: 13 }); // 3 px: still pending
    touch(barEl('a'), 'pointermove', { x: 10, y: 14 }); // 4 px: a drag wins
    vi.advanceTimersByTime(600);
    expect(context).toHaveLength(1);
  });

  it('honours a custom longPressMs and longPressMs: 0 / negative / NaN disables it', () => {
    vi.useFakeTimers();
    let s = setup({ hooks: { longPressMs: 200 } });
    touch(barEl('a'), 'pointerdown');
    vi.advanceTimersByTime(200);
    expect(s.context).toHaveLength(1);
    s.gantt.destroy();
    for (const ms of [0, -5, Number.NaN]) {
      container.replaceChildren();
      s = setup({ hooks: { longPressMs: ms } });
      touch(barEl('a'), 'pointerdown');
      vi.advanceTimersByTime(5000);
      expect(s.context).toHaveLength(0);
      s.gantt.destroy();
    }
  });

  it('mouse and pen-less non-touch pointers never long-press', () => {
    vi.useFakeTimers();
    const { context } = setup();
    ptr('pointerdown', barEl('a'), { pointerType: 'mouse' });
    ptr('pointerdown', barEl('a'), { pointerType: 'pen', pointerId: 3 });
    vi.advanceTimersByTime(2000);
    expect(context).toHaveLength(0);
  });

  it('a hold on the collapse toggle or empty space does not start a timer', () => {
    vi.useFakeTimers();
    const { context } = setup({ hier: true });
    touch(rowEl('p').querySelector('.fg-timeline__row-toggle')!, 'pointerdown');
    touch(container.querySelector('svg')!, 'pointerdown');
    vi.advanceTimersByTime(2000);
    expect(context).toHaveLength(0);
  });

  it('native touch contextmenu never emits; it is prevented only if the host prevented the long-press', () => {
    vi.useFakeTimers();
    const { gantt, context } = setup();
    touch(barEl('a'), 'pointerdown');
    vi.advanceTimersByTime(500);
    expect(ctxMenu(barEl('a')).defaultPrevented).toBe(false); // host ignored it
    gantt.on('task:context-requested', (p) => p.preventDefault());
    touch(barEl('a'), 'pointerup');
    touch(barEl('a'), 'pointerdown');
    vi.advanceTimersByTime(500);
    expect(ctxMenu(barEl('a')).defaultPrevented).toBe(true);
    expect(context).toHaveLength(2); // the two long-presses, no event from either native menu
  });

  it('the task removed before the timer fires emits nothing', () => {
    vi.useFakeTimers();
    const { gantt, context } = setup();
    touch(barEl('a'), 'pointerdown');
    gantt.removeTask(toTaskId('a'));
    vi.advanceTimersByTime(500);
    expect(context).toHaveLength(0);
  });

  it('a repainted row (node replaced) still emits for the surviving task', () => {
    vi.useFakeTimers();
    const { gantt, context } = setup();
    touch(barEl('a'), 'pointerdown');
    gantt.updateTask(toTaskId('b'), { name: 'renamed' });
    vi.advanceTimersByTime(500);
    expect(context).toHaveLength(1);
    expect(context[0]!.taskId).toBe('a');
  });
});

describe('withEditHooks — Canvas-style handle (row-wide hit test)', () => {
  function canvasSetup(hit: { taskId: string; rowIndex: number; hitToggle: boolean } | undefined) {
    const gantt = withEditHooks(withRender(createGantt({ tasks: [taskInput('a', '2026-01-05', '2026-01-06')] })));
    const internal = getInternal(gantt);
    const canvas = document.createElement('div');
    const root = document.createElement('div');
    canvas.getBoundingClientRect = () => new DOMRect(100, 0, 500, 300);
    const handle = {
      interactionRoot: root,
      pointerEventTarget: canvas,
      getLabelColumnWidth: () => 160,
      hitTestRow: () => (hit ? { ...hit, taskId: toTaskId(hit.taskId) } : undefined),
    };
    internal.setMount({ renderer: 'canvas', handle } as unknown as MountState);
    const activated: TaskActivatedPayload[] = [];
    gantt.on('task:activated', (p) => activated.push(p));
    internal.emit('renderer:selected', { renderer: 'canvas', taskCount: 1 });
    return { canvas, root, activated, internal };
  }

  it('row hit: row outside the label column, label inside it', () => {
    const { canvas, activated } = canvasSetup({ taskId: 'a', rowIndex: 0, hitToggle: false });
    dbl(canvas, 400, 10);
    dbl(canvas, 150, 10);
    expect(activated.map((p) => p.part)).toEqual(['row', 'label']);
  });

  it('hitToggle and a miss emit nothing; a stale id is dropped', () => {
    expect(canvasSetup({ taskId: 'a', rowIndex: 0, hitToggle: true }).activated).toHaveLength(0);
    const t = canvasSetup({ taskId: 'a', rowIndex: 0, hitToggle: true });
    dbl(t.canvas, 400, 10);
    expect(t.activated).toHaveLength(0);
    const m = canvasSetup(undefined);
    dbl(m.canvas, 400, 10);
    expect(m.activated).toHaveLength(0);
    const s = canvasSetup({ taskId: 'ghost', rowIndex: 0, hitToggle: false });
    dbl(s.canvas, 400, 10);
    expect(s.activated).toHaveLength(0);
  });
});

describe('withEditHooks — review fixes', () => {
  const touch = (target: EventTarget, type: string, init: PtrInit = {}): MouseEvent =>
    ptr(type, target, { pointerType: 'touch', ...init });

  // --- #1: a long-press must never coexist with a drag --------------------------------------
  describe('long-press vs drag', () => {
    it('control: a quick 48 px touch drag on a bar moves the task', () => {
      vi.useFakeTimers();
      const { gantt, context } = setup();
      const moved = vi.fn();
      gantt.on('task:moved', moved);
      const bar = barEl('a');
      touch(bar, 'pointerdown', { x: 100, y: 50 });
      touch(bar, 'pointermove', { x: 148, y: 50 });
      touch(bar, 'pointerup', { x: 148, y: 50 });
      vi.advanceTimersByTime(600);
      expect(moved).toHaveBeenCalledTimes(1);
      expect(context).toHaveLength(0); // the drag cancelled the pending long-press
    });

    it('after the long-press fires, moving the finger commits no move and the release does not select', () => {
      vi.useFakeTimers();
      const { gantt, context } = setup();
      const moved = vi.fn();
      const selected = vi.fn();
      gantt.on('task:moved', moved);
      gantt.on('selection:changed', selected);
      const bar = barEl('a');
      const before = gantt.getTask(toTaskId('a'))!.start;
      touch(bar, 'pointerdown', { x: 100, y: 50 });
      vi.advanceTimersByTime(500);
      expect(context).toHaveLength(1);
      touch(bar, 'pointermove', { x: 148, y: 50 });
      touch(bar, 'pointermove', { x: 300, y: 50 });
      touch(bar, 'pointerup', { x: 300, y: 50 });
      expect(moved).not.toHaveBeenCalled();
      expect(gantt.getTask(toTaskId('a'))!.start).toBe(before);
      expect(selected).not.toHaveBeenCalled();
    });

    it('a 5 px jitter on a bar neither fires the long-press nor leaves it pending', () => {
      vi.useFakeTimers();
      const { context } = setup();
      touch(barEl('a'), 'pointerdown', { x: 100, y: 50 });
      touch(barEl('a'), 'pointermove', { x: 105, y: 50 });
      vi.advanceTimersByTime(600);
      expect(context).toHaveLength(0);
    });

    it('after the gesture ends a fresh drag works again', () => {
      vi.useFakeTimers();
      const { gantt } = setup();
      const moved = vi.fn();
      gantt.on('task:moved', moved);
      touch(barEl('a'), 'pointerdown', { x: 100, y: 50 });
      vi.advanceTimersByTime(500);
      touch(barEl('a'), 'pointerup', { x: 100, y: 50 });
      touch(barEl('a'), 'pointerdown', { x: 100, y: 50 });
      touch(barEl('a'), 'pointermove', { x: 148, y: 50 });
      touch(barEl('a'), 'pointerup', { x: 148, y: 50 });
      expect(moved).toHaveBeenCalledTimes(1);
    });
  });

  // --- #5: no emission after unmount ---------------------------------------------------------
  it('a long-press timer pending across unmount() emits nothing', () => {
    vi.useFakeTimers();
    const { gantt, context } = setup();
    touch(barEl('a'), 'pointerdown');
    vi.advanceTimersByTime(150);
    gantt.unmount();
    vi.advanceTimersByTime(1000);
    expect(context).toHaveLength(0);
  });

  // --- #6: repeat / dedupe ordering ----------------------------------------------------------
  it('a held ContextMenu key (repeat keydown) does not re-emit the keyup contextmenu as a pointer event', () => {
    const { gantt, context } = setup();
    gantt.on('task:context-requested', (p) => p.preventDefault());
    key(rowEl('a'), 'ContextMenu');
    key(rowEl('a'), 'ContextMenu', { repeat: true });
    key(rowEl('a'), 'ContextMenu', { repeat: true });
    const native = ctxMenu(rowEl('a'));
    expect(context.map((p) => p.source)).toEqual(['keyboard']);
    expect(native.defaultPrevented).toBe(true);
  });

  // --- #7: Android's native touch contextmenu beating the timer ------------------------------
  it('a native touch contextmenu while the press is pending reports the long-press now and honours preventDefault', () => {
    vi.useFakeTimers();
    const { gantt, context } = setup();
    gantt.on('task:context-requested', (p) => p.preventDefault());
    touch(barEl('a'), 'pointerdown', { x: 20, y: 30 });
    vi.advanceTimersByTime(400);
    const native = ctxMenu(barEl('a'), 20, 30);
    expect(context.map((p) => p.source)).toEqual(['long-press']);
    expect(native.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(1000); // the timer was cancelled: no second event
    expect(context).toHaveLength(1);
  });

  // --- #10: mixin order pin ------------------------------------------------------------------
  it('withInteraction applied AFTER withEditHooks: Enter on a summary still collapses once, no activation', () => {
    const tasks: TaskInput[] = [
      taskInput('p', '2026-01-05T09:00', '2026-01-09T09:00'),
      taskInput('k', '2026-01-05T09:00', '2026-01-07T09:00', { parent: toTaskId('p') }),
    ];
    const gantt = withInteraction(withEditHooks(withRender(createGantt({ tasks }))));
    const activated: TaskActivatedPayload[] = [];
    gantt.on('task:activated', (p) => activated.push(p));
    gantt.mount(container);
    key(rowEl('p'), 'Enter');
    expect(activated).toHaveLength(0);
    expect(container.querySelector('.fg-timeline__row[data-task-id="k"]')).toBeNull();
    key(rowEl('p'), 'F2');
    expect(activated).toHaveLength(1);
  });
});

describe('withEditHooks — Canvas keyboard path', () => {
  function canvasKeyboard(anchor: boolean) {
    const gantt = withEditHooks(withRender(createGantt({ tasks: [taskInput('a', '2026-01-05', '2026-01-06')] })));
    const internal = getInternal(gantt);
    const canvas = document.createElement('div');
    const root = document.createElement('div');
    root.innerHTML = '<div data-row-index="0" data-task-id="a" tabindex="0"></div>';
    document.body.appendChild(root);
    const row = root.firstElementChild as HTMLElement;
    row.getBoundingClientRect = () => new DOMRect(0, 63, 1, 32); // the meaningless 1 px layer
    root.getBoundingClientRect = () => new DOMRect(0, 0, 1, 1);
    const handle = {
      interactionRoot: root,
      pointerEventTarget: canvas,
      getLabelColumnWidth: () => 160,
      hitTestRow: () => undefined,
      destroy: () => undefined,
      ...(anchor ? { getRowAnchor: () => ({ clientX: 111, clientY: 222 }) } : {}),
    };
    internal.setMount({
      renderer: 'canvas',
      handle,
      stopFx: () => undefined,
      stopUi: () => undefined,
    } as unknown as MountState);
    const activated: TaskActivatedPayload[] = [];
    const context: TaskContextRequestedPayload[] = [];
    gantt.on('task:activated', (p) => activated.push(p));
    gantt.on('task:context-requested', (p) => context.push(p));
    internal.emit('renderer:selected', { renderer: 'canvas', taskCount: 1 });
    return { gantt, root, row, canvas, activated, context, cleanup: () => root.remove() };
  }

  it('anchors on the painted row geometry, not the hidden layer rect', () => {
    const t = canvasKeyboard(true);
    key(t.row, 'F2');
    key(t.row, 'ContextMenu');
    expect(t.activated[0]).toMatchObject({ clientX: 111, clientY: 222, source: 'keyboard' });
    expect(t.context[0]).toMatchObject({ clientX: 111, clientY: 222 });
    t.cleanup();
  });

  it('without a painted-row anchor the row rect is used', () => {
    const t = canvasKeyboard(false);
    key(t.row, 'F2');
    expect(t.activated[0]).toMatchObject({ clientX: 0.5, clientY: 79 });
    t.cleanup();
  });

  it('a keyboard-generated contextmenu targeting the ARIA layer gets the host preventDefault, and is not re-emitted', () => {
    const t = canvasKeyboard(true);
    t.gantt.on('task:context-requested', (p) => p.preventDefault());
    key(t.row, 'ContextMenu');
    const native = ctxMenu(t.row);
    expect(native.defaultPrevented).toBe(true);
    expect(t.context).toHaveLength(1);
    t.cleanup();
  });

  it('the ARIA-layer contextmenu is left alone when the host did not prevent, and after another key', () => {
    const t = canvasKeyboard(true);
    key(t.row, 'ContextMenu');
    expect(ctxMenu(t.row).defaultPrevented).toBe(false);
    t.gantt.on('task:context-requested', (p) => p.preventDefault());
    key(t.row, 'ContextMenu');
    key(t.row, 'Tab'); // unrelated key clears the dedupe flag
    expect(ctxMenu(t.row).defaultPrevented).toBe(false);
    t.cleanup();
  });

  it('destroy removes the ARIA-layer contextmenu listener', () => {
    const t = canvasKeyboard(true);
    t.gantt.on('task:context-requested', (p) => p.preventDefault());
    key(t.row, 'ContextMenu');
    t.gantt.destroy();
    expect(ctxMenu(t.row).defaultPrevented).toBe(false);
    t.cleanup();
  });
});
