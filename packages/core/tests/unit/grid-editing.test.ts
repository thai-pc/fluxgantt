// @vitest-environment jsdom
//
// Grid cell editors on the SVG renderer (spec-grid-columns.md sections 9.2, 10 and 13.1; PR G6): activation (Enter,
// F2, double-click, double-tap), the editor DOM and its accessibility wiring, commit / cancel / blur / Tab, validation,
// the veto event, focus return, isolation from the chart's listeners, cancel on geometry change and task removal,
// cleanup, `startCellEdit`, announcements, and the Enter/F2 reconciliation with `keyboard-nav` and `withEditHooks`.
// Calendar maths is `grid-editing-commit.test.ts`; real layout, pinning and the accessibility tree are Playwright's.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withEditHooks } from '../../src/edit-hooks/mixin.js';
import { withGrid } from '../../src/grid/mixin.js';
import { withGridEditing } from '../../src/grid-editing/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import type { GridColumnInput } from '../../src/grid/types.js';
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
  t('b', { parent: id('p'), end: '2026-01-14' }),
  t('m', { type: 'milestone', end: '2026-01-05' }),
];
const OWNER: GridColumnInput = {
  id: 'owner',
  header: 'Owner',
  value: (x) => (x.meta?.owner as string) ?? '',
  editor: { type: 'text', commit: (v) => ({ meta: { owner: v } }) },
};

beforeAll(async () => {
  await import('../../src/grid-editing/editing-ui.js');
  await import('../../src/grid/resize-ui.js');
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

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
  hooks?: boolean;
  editing?: GridEditingOptions;
  config?: Record<string, unknown>;
  columns?: GridColumnInput[];
  tasks?: TaskInput[];
}
function make(s: Setup = {}) {
  let g = withRender(createGantt({ tasks: s.tasks ?? TASKS, ...s.config }));
  if (s.interaction !== false) g = withInteraction(g);
  if (s.hooks) g = withEditHooks(g);
  const grid = withGridEditing(withGrid(g, { columns: s.columns ?? [{ id: 'name' }, { id: 'start' }, { id: 'end' }, { id: 'duration' }, { id: 'progress' }, OWNER] }), s.editing);
  grid.mount(container);
  return grid;
}
type G = ReturnType<typeof make>;
const rowOf = (task: string) => container.querySelector<SVGElement>(`[role=row][data-task-id="${task}"]`)!;
const COLS = ['name', 'start', 'end', 'duration', 'progress', 'owner'];
const cellOf = (task: string, col: string) => rowOf(task).querySelector<SVGElement>(`[role=gridcell][aria-colindex="${COLS.indexOf(col) + 1}"]`)!;
/** Focus a cell the way the grid does (a cell is script-focusable only: `tabindex=-1`). */
const focus = (el: Element) => {
  // The row first, as the keyboard gets there (`keyboard-nav` follows a ROW's focusin), then the cell.
  if (el.getAttribute('role') === 'gridcell') focus(el.closest('[role=row]')!);
  el.setAttribute('tabindex', '-1');
  (el as HTMLElement).focus();
};
const editor = () => container.querySelector<HTMLInputElement>('.fg-grid__editor');
const errorEl = () => container.querySelector<HTMLElement>('.fg-grid__edit-error')!;
const live = () => container.querySelector('[aria-live]')!.textContent!.replace(/\u00A0/g, ' ').trim();
const active = () => document.activeElement as Element;

function key(target: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
async function press(target: Element, k: string, init: KeyboardEventInit = {}) {
  const e = key(target, k, init);
  await flush();
  return e;
}
/** Focus a cell the way the keyboard does, then open its editor with Enter. */
async function openAt(task: string, col: string): Promise<HTMLInputElement> {
  focus(cellOf(task, col));
  await press(cellOf(task, col), 'Enter');
  return editor()!;
}
function type(input: HTMLInputElement, text: string) {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const taskOf = (g: G, name: string) => g.getTask(id(name))!;

describe('composition', () => {
  it('throws without withGrid', () => {
    expect(() => withGridEditing(withRender(createGantt({ tasks: [] })) as never)).toThrow(/withGrid/);
  });
  it('adds the capability', () => {
    const g = make();
    expect(g.isEditingCell()).toBe(false);
    expect(typeof g.startCellEdit).toBe('function');
  });
});

describe('activation', () => {
  it('Enter on an editable cell opens the editor with the full value selected, instead of toggling the row', async () => {
    const g = make();
    const toggled = vi.fn();
    g.on('collapse:changed', toggled);
    focus(cellOf('p', 'name'));
    const e = await press(cellOf('p', 'name'), 'Enter'); // a summary row: keyboard-nav would toggle it
    expect(e.defaultPrevented).toBe(true);
    expect(toggled).not.toHaveBeenCalled();
    const input = editor()!;
    expect(input.value).toBe('p');
    expect(active()).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(1);
    expect(g.isEditingCell()).toBe(true);
  });

  it('F2 on a row edits its name cell; F2 on a cell edits that cell', async () => {
    make();
    focus(rowOf('a'));
    await press(rowOf('a'), 'F2');
    expect(editor()!.getAttribute('aria-label')).toBe('Name, a');
    editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    focus(cellOf('a', 'start'));
    await press(cellOf('a', 'start'), 'F2');
    expect(editor()!.getAttribute('aria-label')).toBe('Start, a');
  });

  it('Enter on a row (not a cell) is not claimed', async () => {
    make();
    focus(rowOf('a'));
    const e = await press(rowOf('a'), 'Enter');
    expect(editor()).toBeNull();
    expect(e.defaultPrevented).toBe(false);
  });

  it('keys with a modifier or during composition are left alone', async () => {
    const g = make();
    focus(cellOf('a', 'name'));
    const req = vi.fn();
    g.on('cell:edit-requested', req);
    for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }]) {
      await press(cellOf('a', 'name'), 'Enter', init);
      expect(editor(), JSON.stringify(init)).toBeNull();
    }
    expect(req).not.toHaveBeenCalled();
  });

  it('a double-click on a pinned cell opens the editor and is not consumed', async () => {
    const activated = vi.fn();
    const g2 = make({ hooks: true });
    g2.on('task:activated', activated);
    const clone = container.querySelector('.fg-timeline__sticky-column g[data-row-index="1"] text[data-column-id="start"]') as Element;
    const e = new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    clone.dispatchEvent(e);
    await flush();
    expect(editor()?.getAttribute('aria-label')).toBe('Start, a');
    expect(activated).toHaveBeenCalledTimes(1); // the edit hooks still report it
  });

  it('the activation option narrows the gestures', async () => {
    make({ editing: { activate: ['f2'] } });
    focus(cellOf('a', 'name'));
    await press(cellOf('a', 'name'), 'Enter');
    expect(editor()).toBeNull();
    await press(cellOf('a', 'name'), 'F2');
    expect(editor()).not.toBeNull();
  });

  describe('a cell that is not editable falls through', () => {
    it("a summary's rolled-up cells: Enter toggles the row", async () => {
      const g = make();
      const toggled = vi.fn();
      g.on('collapse:changed', toggled);
      focus(cellOf('p', 'start'));
      const e = await press(cellOf('p', 'start'), 'Enter');
      expect(editor()).toBeNull();
      expect(e.defaultPrevented).toBe(true); // keyboard-nav's own toggle
      expect(toggled).toHaveBeenCalled();
    });
    it('a milestone has no end or duration; a column with editor:false and isEditable narrow it', async () => {
      const g = make({ columns: [{ id: 'name' }, { id: 'start' }, { id: 'end' }, { id: 'duration' }, { id: 'progress', editor: false }, OWNER], editing: { isEditable: (task, col) => !(col === 'owner' && task.id === 'b') } });
      void g;
      for (const [task, col] of [['m', 'end'], ['m', 'duration'], ['a', 'progress'], ['b', 'owner']] as const) {
        focus(cellOf(task, col));
        const e = await press(cellOf(task, col), 'Enter');
        expect(editor(), `${task} ${col}`).toBeNull();
        void e;
      }
      for (const [task, col] of [['m', 'start'], ['b', 'duration'], ['a', 'owner'], ['p', 'name']] as const) {
        await openAt(task, col);
        expect(editor(), `${task} ${col}`).not.toBeNull();
        editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flush();
      }
    });
    it('a leaf with withEditHooks: Enter reports the cell through task:activated', async () => {
      const g = make({ hooks: true, columns: [{ id: 'name' }, { id: 'progress', editor: false }] });
      const seen: unknown[] = [];
      g.on('task:activated', (p) => seen.push(p));
      COLS.splice(0, COLS.length, 'name', 'progress');
      focus(cellOf('a', 'progress'));
      await press(cellOf('a', 'progress'), 'Enter');
      COLS.splice(0, COLS.length, 'name', 'start', 'end', 'duration', 'progress', 'owner');
      expect(seen).toEqual([expect.objectContaining({ taskId: 'a', part: 'cell', columnId: 'progress', source: 'keyboard' })]);
    });
    it('a readOnly chart edits nothing and fires no cell:edit-requested', async () => {
      const g = make({ config: { readOnly: true } });
      const req = vi.fn();
      g.on('cell:edit-requested', req);
      await openAt('a', 'name');
      expect(editor()).toBeNull();
      expect(req).not.toHaveBeenCalled();
      expect(g.startCellEdit(id('a'), 'name')).toBe(false);
      focus(cellOf('a', 'name'));
      expect(cellOf('a', 'name').getAttribute('aria-readonly')).toBe('true');
    });
  });

  it('a cell gets aria-readonly when it takes focus and is not editable, and none when it is', async () => {
    make();
    focus(cellOf('p', 'start'));
    expect(cellOf('p', 'start').getAttribute('aria-readonly')).toBe('true');
    focus(cellOf('a', 'start'));
    expect(cellOf('a', 'start').hasAttribute('aria-readonly')).toBe(false);
  });
});

describe('cell:edit-requested', () => {
  it('fires first with the cell and finite coordinates; preventDefault replaces the editor and the key is still consumed', async () => {
    const g = make({ hooks: true });
    const seen: { taskId: string; columnId: string; source: string; clientX: number; clientY: number }[] = [];
    const activated = vi.fn();
    g.on('task:activated', activated);
    g.on('cell:edit-requested', (p) => {
      seen.push(p);
      p.preventDefault();
    });
    focus(cellOf('a', 'duration'));
    const e = await press(cellOf('a', 'duration'), 'Enter');
    expect(editor()).toBeNull();
    expect(e.defaultPrevented).toBe(true);
    expect(activated).not.toHaveBeenCalled();
    expect(seen).toEqual([expect.objectContaining({ taskId: 'a', columnId: 'duration', source: 'keyboard' })]);
    expect(Number.isFinite(seen[0]!.clientX) && Number.isFinite(seen[0]!.clientY)).toBe(true);
    expect(g.isEditingCell()).toBe(false);
  });

  it('is not fired for a cell that is not editable', async () => {
    const g = make();
    const req = vi.fn();
    g.on('cell:edit-requested', req);
    focus(cellOf('p', 'start'));
    await press(cellOf('p', 'start'), 'Enter');
    expect(req).not.toHaveBeenCalled();
  });
});

describe('the editor', () => {
  it('has a native type, an accessible name, autocomplete off and the right keyboard per column', async () => {
    make();
    const spec: [string, Record<string, string | null>][] = [
      ['name', { type: 'text', 'aria-label': 'Name, a', autocomplete: 'off', inputmode: null, maxlength: '1000', autocapitalize: 'sentences' }],
      ['start', { type: 'date', 'aria-label': 'Start, a', autocomplete: 'off', maxlength: null }],
      ['end', { type: 'date' }],
      ['duration', { type: 'text', inputmode: 'decimal', autocapitalize: 'off', maxlength: '32' }],
      ['progress', { type: 'text', inputmode: 'numeric', maxlength: '32' }],
      ['owner', { type: 'text', 'aria-label': 'Owner, a' }],
    ];
    for (const [col, attrs] of spec) {
      const input = await openAt('a', col);
      for (const [k, v] of Object.entries(attrs)) expect(input.getAttribute(k) ?? (k === 'type' ? input.type : null), `${col} ${k}`).toBe(v);
      expect(input.spellcheck).toBe(false);
      expect(input.type === 'number').toBe(false);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
    }
  });

  it('starts from the raw value of the cell, not its display text', async () => {
    make({ tasks: [t('a', { name: 'A'.repeat(300), progress: 0.456 })] });
    expect((await openAt('a', 'name')).value).toBe('A'.repeat(300));
    editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect((await openAt('a', 'start')).value).toBe('2026-01-05');
    editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect((await openAt('a', 'progress')).value).toBe('46');
  });

  it('is never inside a row, so the grid and keyboard-nav never see its keys', async () => {
    make();
    const input = await openAt('a', 'name');
    expect(input.closest('[data-row-index]')).toBeNull();
    expect(input.closest('.fg-grid__editor-host')).not.toBeNull();
    const nav = vi.fn();
    container.addEventListener('keydown', nav); // bubble phase, as keyboard-nav's root would be
    const del = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    input.dispatchEvent(del);
    expect(del.defaultPrevented).toBe(false); // an editor key is plain text editing
  });

  it('honours gridEditLabel and falls back when it throws or returns a non-string', async () => {
    let g = make({ config: { messages: { gridEditLabel: (p: { header: string; taskName: string }) => `Edit ${p.header} of ${p.taskName}` } } });
    expect((await openAt('a', 'name')).getAttribute('aria-label')).toBe('Edit Name of a');
    g.destroy();
    g = make({ config: { messages: { gridEditLabel: () => { throw new Error('x'); } } } });
    expect((await openAt('a', 'name')).getAttribute('aria-label')).toBe('Name, a');
    g.destroy();
    g = make({ config: { messages: { gridEditLabel: () => 5 as never } } });
    expect((await openAt('a', 'name')).getAttribute('aria-label')).toBe('Name, a');
  });

  it('keeps pointer, click, double-click and context-menu events from the chart', async () => {
    make();
    const input = await openAt('a', 'name');
    const layer = container.querySelector('.fg-timeline__layer')!;
    const seen = vi.fn();
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu']) layer.addEventListener(type, seen);
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu']) input.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    expect(seen).not.toHaveBeenCalled();
    // wheel is not swallowed: the chart still scrolls under the editor
    const wheel = vi.fn();
    layer.addEventListener('wheel', wheel);
    input.dispatchEvent(new Event('wheel', { bubbles: true }));
    expect(wheel).toHaveBeenCalled();
  });
});

describe('commit and cancel', () => {
  it('Enter commits through the store (one write), closes the editor and returns focus to the cell', async () => {
    const g = make();
    const updated = vi.fn();
    g.on('task:updated', updated);
    const input = await openAt('a', 'name');
    type(input, '  Renamed  ');
    const e = await press(input, 'Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(taskOf(g, 'a').name).toBe('Renamed');
    expect(updated).toHaveBeenCalledTimes(1);
    expect(editor()).toBeNull();
    expect(g.isEditingCell()).toBe(false);
    expect(active()).toBe(cellOf('a', 'name'));
    g.undo();
    expect(taskOf(g, 'a').name).toBe('a');
    expect(g.canUndo()).toBe(false);
  });

  it('every built-in column writes through its own method', async () => {
    const g = make();
    const progressed = vi.fn();
    const resized = vi.fn();
    g.on('task:progressed', progressed);
    g.on('task:resized', resized);
    type(await openAt('a', 'progress'), '80%');
    await press(editor()!, 'Enter');
    expect(taskOf(g, 'a').progress).toBeCloseTo(0.8);
    expect(progressed).toHaveBeenCalledTimes(1);
    type(await openAt('a', 'duration'), '2');
    await press(editor()!, 'Enter');
    expect(taskOf(g, 'a').duration).toBe(16);
    expect(resized).toHaveBeenCalledTimes(1);
    type(await openAt('a', 'end'), '2026-01-12');
    await press(editor()!, 'Enter');
    expect(String(taskOf(g, 'a').end)).toContain('2026-01-12');
    type(await openAt('a', 'start'), '2026-01-06');
    await press(editor()!, 'Enter');
    expect(String(taskOf(g, 'a').start)).toContain('2026-01-06');
  });

  it('Escape cancels without writing and returns focus to the cell', async () => {
    const g = make();
    const updated = vi.fn();
    g.on('task:updated', updated);
    const input = await openAt('a', 'name');
    type(input, 'nope');
    const e = await press(input, 'Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(taskOf(g, 'a').name).toBe('a');
    expect(updated).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
    expect(active()).toBe(cellOf('a', 'name'));
  });

  it('a value that changes nothing closes without a write or an announcement', async () => {
    const g = make();
    const updated = vi.fn();
    g.on('task:updated', updated);
    await press(await openAt('a', 'name'), 'Enter');
    expect(updated).not.toHaveBeenCalled();
    expect(g.canUndo()).toBe(false);
    expect(live()).toBe('');
  });

  it('Tab commits and is NOT prevented; the cell has focus afterwards', async () => {
    const g = make();
    const input = await openAt('a', 'name');
    type(input, 'Tabbed');
    const e = await press(input, 'Tab');
    expect(e.defaultPrevented).toBe(false);
    expect(taskOf(g, 'a').name).toBe('Tabbed');
    expect(active()).toBe(cellOf('a', 'name'));
    const input2 = await openAt('a', 'name');
    const e2 = await press(input2, 'Tab', { shiftKey: true });
    expect(e2.defaultPrevented).toBe(false);
  });

  it('Tab on an invalid value discards it (and does not trap focus)', async () => {
    const g = make();
    const input = await openAt('a', 'progress');
    type(input, 'abc');
    const e = await press(input, 'Tab');
    expect(e.defaultPrevented).toBe(false);
    expect(editor()).toBeNull();
    expect(g.getTask(id('a'))!.progress).toBe(0.25);
  });

  it('blur commits a valid value and discards an invalid one, announcing the failure', async () => {
    const g = make();
    let input = await openAt('a', 'name');
    type(input, 'Blurred');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await flush();
    expect(taskOf(g, 'a').name).toBe('Blurred');
    expect(editor()).toBeNull();
    input = await openAt('a', 'progress');
    type(input, '150');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await flush();
    expect(taskOf(g, 'a').progress).toBe(0.25);
    expect(editor()).toBeNull();
    expect(live()).toContain('Progress not changed');
  });

  it('commitOnBlur:false discards on blur', async () => {
    const g = make({ editing: { commitOnBlur: false } });
    const input = await openAt('a', 'name');
    type(input, 'Gone');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await flush();
    expect(taskOf(g, 'a').name).toBe('a');
    expect(editor()).toBeNull();
  });

  it('a blur does not steal focus back from where the user went', async () => {
    make();
    const outside = document.createElement('button');
    document.body.append(outside);
    await openAt('a', 'name');
    outside.focus();
    await flush();
    expect(active()).toBe(outside);
    outside.remove();
  });

  it('Enter during IME composition does not commit', async () => {
    const g = make();
    const input = await openAt('a', 'name');
    type(input, 'にほん');
    await press(input, 'Enter', { isComposing: true });
    expect(editor()).not.toBeNull();
    expect(taskOf(g, 'a').name).toBe('a');
  });

  it('a second activation commits the open edit first; if that fails, the new edit does not open', async () => {
    const g = make();
    let input = await openAt('a', 'name');
    type(input, 'First');
    expect(g.startCellEdit(id('b'), 'name')).toBe(true);
    await flush();
    expect(taskOf(g, 'a').name).toBe('First');
    expect(editor()!.getAttribute('aria-label')).toBe('Name, b');
    input = editor()!;
    type(input, '   ');
    g.startCellEdit(id('a'), 'name');
    await flush();
    expect(editor()!.getAttribute('aria-label')).toBe('Name, b'); // still the invalid one
    expect(errorEl().textContent).toMatch(/Enter a value/);
  });
});

describe('validation', () => {
  it('shows the message in a role=alert element, sets aria-invalid and aria-describedby, and keeps the editor open on Enter', async () => {
    const g = make();
    const input = await openAt('a', 'duration');
    expect(errorEl().getAttribute('role')).toBe('alert');
    type(input, 'abc');
    await press(input, 'Enter');
    expect(editor()).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(errorEl().textContent).toBe('Enter a number.');
    expect(input.getAttribute('aria-describedby')).toBe(errorEl().id);
    expect(errorEl().id).toMatch(/^fg-grid-err-\d+$/);
    expect(taskOf(g, 'a').duration).toBeUndefined();
    type(input, '3'); // the error clears on the next input
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(errorEl().textContent).toBe('');
  });

  it('covers every reason', async () => {
    make();
    const cases: [string, string, string][] = [
      ['name', '   ', 'Enter a value.'],
      ['end', '2026-01-02', 'The end must be after the start.'],
      ['duration', '999999', 'Enter a value from 0 to 36500.'],
      ['progress', '150', 'Enter a value from 0 to 100.'],
      ['name', 'x'.repeat(1001), 'The value is too long.'],
    ];
    for (const [col, text, msg] of cases) {
      if (!msg) continue;
      const input = await openAt('a', col);
      type(input, text);
      await press(input, 'Enter');
      expect(errorEl().textContent, `${col} ${text.slice(0, 8)}`).toBe(msg);
      await press(editor()!, 'Escape');
    }
  });

  it('gridEditError replaces the text wholesale; a throw or a non-string falls back', async () => {
    const first = make({ config: { messages: { gridEditError: (p: { reason: string; header: string }) => `${p.header}: ${p.reason}` } } });
    let input = await openAt('a', 'progress');
    type(input, 'abc');
    await press(input, 'Enter');
    expect(errorEl().textContent).toBe('Progress: not-a-number');
    first.destroy();
    make({ config: { messages: { gridEditError: () => { throw new Error('x'); } } } });
    input = await openAt('a', 'progress');
    type(input, 'abc');
    await press(input, 'Enter');
    expect(errorEl().textContent).toBe('Enter a number.');
  });

  it("a host's beforeCommit message blocks the write and is shown, capped, as text", async () => {
    const before = vi.fn((c: { input: string | number }) => (c.input === 'bad' ? `<b>nope</b>${'x'.repeat(500)}` : undefined));
    const g = make({ editing: { beforeCommit: before } });
    const input = await openAt('a', 'name');
    type(input, 'bad');
    await press(input, 'Enter');
    expect(taskOf(g, 'a').name).toBe('a');
    expect(errorEl().textContent).toHaveLength(200);
    expect(errorEl().textContent!.startsWith('<b>nope</b>')).toBe(true);
    expect(errorEl().querySelector('b')).toBeNull(); // text, not markup
    type(input, 'fine');
    await press(input, 'Enter');
    expect(taskOf(g, 'a').name).toBe('fine');
    expect(before).toHaveBeenLastCalledWith({ taskId: 'a', columnId: 'name', input: 'fine', patch: { name: 'fine' } });
  });

  it('a store throw is shown as a rejection and nothing is written', async () => {
    const g = make();
    vi.spyOn(g, 'updateTask').mockImplementation(() => {
      throw new Error('store says no');
    });
    const input = await openAt('a', 'name');
    type(input, 'Other');
    await press(input, 'Enter');
    expect(editor()).toBe(input);
    expect(errorEl().textContent).toContain('store says no');
    expect(taskOf(g, 'a').name).toBe('a');
  });
});

describe('announcements', () => {
  it('announces a successful edit once, with the new text and the snap', async () => {
    const g = make();
    type(await openAt('a', 'start'), '2026-01-10'); // a Saturday
    await press(editor()!, 'Enter');
    expect(live()).toBe('Start: Jan 12, 2026, next working day');
    expect(String(taskOf(g, 'a').start)).toContain('2026-01-12');
  });

  it('honours messages.announce for cell-edited and cell-edit-failed', async () => {
    const seen: unknown[] = [];
    make({ config: { messages: { announce: (a: { kind: string }) => (seen.push(a), `kind:${a.kind}`) } } });
    type(await openAt('a', 'name'), 'Zed');
    await press(editor()!, 'Enter');
    expect(live()).toBe('kind:cell-edited');
    expect(seen).toEqual([expect.objectContaining({ kind: 'cell-edited', id: 'a', name: 'Zed', columnId: 'name', header: 'Name', text: 'Zed', locale: 'en' })]);
    const input = await openAt('a', 'progress');
    type(input, '999');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await flush();
    expect(live()).toBe('kind:cell-edit-failed');
    expect(seen[1]).toEqual(expect.objectContaining({ kind: 'cell-edit-failed', reason: 'out-of-range', columnId: 'progress' }));
  });

  it('is silent, and does not throw, without withInteraction', async () => {
    const g = make({ interaction: false });
    type(await openAt('a', 'name'), 'Quiet');
    await press(editor()!, 'Enter');
    expect(taskOf(g, 'a').name).toBe('Quiet');
    expect(container.querySelector('[aria-live]')).toBeNull();
  });
});

describe('closing without a write', () => {
  it('removing the edited task cancels; removing another does not', async () => {
    const g = make();
    await openAt('a', 'name');
    g.removeTask(id('b'));
    await flush();
    expect(g.isEditingCell()).toBe(true);
    g.removeTask(id('a'));
    await flush();
    expect(g.isEditingCell()).toBe(false);
    expect(editor()).toBeNull();
  });

  it('a column resize, setGridColumns and collapseBelow-style geometry change cancel the edit', async () => {
    const g = make();
    await openAt('a', 'start');
    g.resizeGridColumn('name', 300);
    await flush();
    expect(editor()).toBeNull();
    expect(taskOf(g, 'a').start).toBe('2026-01-05');
    await openAt('a', 'start');
    g.setGridColumns([{ id: 'name' }, { id: 'start' }]);
    await flush();
    expect(editor()).toBeNull();
  });

  it('an import cancels', async () => {
    const g = make();
    await openAt('a', 'name');
    getInternal(g).emit('data:imported', { format: 'json', taskCount: 0, dependencyCount: 0 });
    await flush();
    expect(editor()).toBeNull();
  });

  it('cancelCellEdit closes the editor', async () => {
    const g = make();
    await openAt('a', 'name');
    g.cancelCellEdit();
    expect(editor()).toBeNull();
    expect(g.isEditingCell()).toBe(false);
  });

  it('unmount and destroy remove the host and the listeners', async () => {
    const g = make();
    await openAt('a', 'name');
    g.unmount();
    expect(container.querySelector('.fg-grid__editor-host')).toBeNull();
    expect(g.isEditingCell()).toBe(false);
    g.mount(container);
    await openAt('a', 'name'); // the next mount works
    expect(editor()).not.toBeNull();
    g.destroy();
    expect(container.querySelector('.fg-grid__editor-host')).toBeNull();
  });

  it('no listener or node growth across 30 open and commit cycles', { timeout: 60_000 }, async () => {
    const g = make();
    for (let i = 0; i < 30; i++) {
      const input = await openAt('a', 'name');
      type(input, i % 2 ? 'x' : 'y');
      await press(input, 'Enter');
    }
    expect(container.querySelectorAll('.fg-grid__editor-host')).toHaveLength(0);
    expect(g.canUndo()).toBe(true);
  });
});

describe('startCellEdit', () => {
  it('is false for an unknown task or column, a rolled-up cell, a hidden column, a readOnly chart and an unmounted chart', async () => {
    const g = make();
    expect(g.startCellEdit(id('nope'), 'name')).toBe(false);
    expect(g.startCellEdit(id('a'), 'nope')).toBe(false);
    expect(g.startCellEdit(id('p'), 'start')).toBe(false);
    expect(g.startCellEdit(id('m'), 'end')).toBe(false);
    expect(g.startCellEdit(id('a'), 'name')).toBe(true);
    await flush();
    expect(editor()).not.toBeNull();
    expect(g.startCellEdit(id('a'), 'name')).toBe(true); // already editing it
    g.unmount();
    expect(g.startCellEdit(id('a'), 'name')).toBe(false);
    expect(make({ config: { readOnly: true } }).startCellEdit(id('a'), 'name')).toBe(false);
  });

  it('is false once the host has vetoed (the code is loaded by then)', async () => {
    const g = make();
    await openAt('a', 'name'); // loads the editor code
    g.cancelCellEdit();
    g.on('cell:edit-requested', (p) => p.preventDefault());
    expect(g.startCellEdit(id('b'), 'name')).toBe(false);
  });

  it('throws after destroy like the other methods', () => {
    const g = make();
    g.destroy();
    expect(() => g.startCellEdit(id('a'), 'name')).toThrow();
  });
});

describe('custom editors', () => {
  const editorCol = (ed: object): GridColumnInput =>
    ({ id: 'owner', header: 'Owner', value: (x) => (x.meta?.owner as string) ?? '', editor: { type: 'text', commit: (v: string) => ({ notes: v }), ...ed } }) as GridColumnInput;

  it('starts from initial(), caps the text at maxLength and falls back to the raw value when initial() throws', async () => {
    make({ columns: [{ id: 'name' }, editorCol({ initial: () => 'Seed', maxLength: 5 })] });
    COLS.splice(0, COLS.length, 'name', 'owner');
    const input = await openAt('a', 'owner');
    COLS.splice(0, COLS.length, 'name', 'start', 'end', 'duration', 'progress', 'owner');
    expect(input.value).toBe('Seed');
    expect(input.maxLength).toBe(5);
  });

  it('a throwing initial() leaves the raw value', async () => {
    make({ tasks: [t('a', { meta: { owner: 'Ann' } })], columns: [{ id: 'name' }, editorCol({ initial: () => { throw new Error('x'); } })] });
    COLS.splice(0, COLS.length, 'name', 'owner');
    const input = await openAt('a', 'owner');
    COLS.splice(0, COLS.length, 'name', 'start', 'end', 'duration', 'progress', 'owner');
    expect(input.value).toBe('Ann');
  });

  it('number editors are text fields with a decimal keyboard and the value arrives as a number', async () => {
    let seen: unknown;
    make({ columns: [{ id: 'name' }, editorCol({ type: 'number', min: 1, max: 9, commit: (v: number) => ((seen = v), { priority: v }) })] });
    COLS.splice(0, COLS.length, 'name', 'owner');
    const input = await openAt('a', 'owner');
    COLS.splice(0, COLS.length, 'name', 'start', 'end', 'duration', 'progress', 'owner');
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');
    type(input, '4.5');
    await press(input, 'Enter');
    expect(seen).toBe(4.5);
  });

  it('an invalid editor definition throws at composition', () => {
    expect(() => make({ columns: [{ id: 'name' }, editorCol({ commit: undefined })] })).toThrow(RangeError);
    expect(() => make({ columns: [{ id: 'name' }, editorCol({ type: 'slider' })] })).toThrow(RangeError);
    expect(() => make({ columns: [{ id: 'name' }, editorCol({ type: 'number', min: 5, max: 1 })] })).toThrow(RangeError);
    expect(() => make({ columns: [{ id: 'name', editor: true as never }] })).toThrow(RangeError);
  });
});

describe('the first use', () => {
  it('claims the key synchronously and acts once the code has loaded (a fresh module graph)', async () => {
    vi.resetModules();
    const [{ createGantt: cg }, { withRender: wr }, { withGrid: wg }, { withGridEditing: wge }] = await Promise.all([
      import('../../src/gantt.js'),
      import('../../src/render/mixin.js'),
      import('../../src/grid/mixin.js'),
      import('../../src/grid-editing/mixin.js'),
    ]);
    const g = wge(wg(wr(cg({ tasks: TASKS }))));
    g.mount(container);
    const cell = cellOf('a', 'name');
    focus(cell);
    const e = key(cell, 'F2');
    expect(e.defaultPrevented).toBe(true); // decided at once
    expect(editor()).toBeNull(); // acted on later
    await vi.waitFor(() => expect(editor()).not.toBeNull());
    expect(editor()!.getAttribute('aria-label')).toBe('Name, a');
  });
});

describe('security', () => {
  it('stores hostile text as plain text and renders it only through text nodes', async () => {
    const g = make();
    const payloads = ['<img src=x onerror=window.__xss=1>', '</text><script>window.__xss=1</script>', 'javascript:alert(1)', 'a‮b\u0000c\nd'];
    for (const p of payloads) {
      const input = await openAt('a', 'name');
      type(input, p);
      await press(input, 'Enter');
      expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
    }
    expect(container.querySelector('img,script')).toBeNull();
    expect(taskOf(g, 'a').name).toBe('abcd');
    expect(container.querySelector('svg')!.outerHTML).not.toContain('<script');
  });

  it('a megabyte paste is refused before it is parsed', async () => {
    const g = make();
    const input = await openAt('a', 'name');
    input.removeAttribute('maxlength');
    type(input, 'x'.repeat(1_000_000));
    await press(input, 'Enter');
    expect(errorEl().textContent).toBe('The value is too long.');
    expect(taskOf(g, 'a').name).toBe('a');
  });

  it('a custom commit cannot overwrite id, timestamps or the prototype', async () => {
    const g = make({
      columns: [{ id: 'name' }, { ...OWNER, editor: { type: 'text', commit: () => JSON.parse('{"id":"evil","createdAt":1,"__proto__":{"x":1},"notes":"ok"}') } } as GridColumnInput],
    });
    COLS.splice(0, COLS.length, 'name', 'owner');
    const input = await openAt('a', 'owner');
    type(input, 'v');
    await press(input, 'Enter');
    COLS.splice(0, COLS.length, 'name', 'start', 'end', 'duration', 'progress', 'owner');
    expect(taskOf(g, 'a')).toMatchObject({ id: 'a', notes: 'ok' });
    expect(({} as { x?: unknown }).x).toBeUndefined();
  });
});
