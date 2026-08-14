// @vitest-environment jsdom
//
// Interaction — roving-tabindex keyboard navigation tests (spec-keyboard-nav.md §12.1). Runs
// under jsdom (per-file override; the rest of core stays `environment: 'node'`), mirroring
// `selection.test.ts`'s setup style.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { enableKeyboardNav, type KeyboardNavOptions } from '../../src/interaction/keyboard-nav.js';
import { toTaskId, type Task, type TaskId } from '../../src/types.js';

function task(id: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: toTaskId(id),
    name: id,
    start,
    end,
    progress: 0.5,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function dispatchKey(
  target: EventTarget,
  key: string,
  init: { shiftKey?: boolean; bubbles?: boolean } = {},
): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey: init.shiftKey ?? false, bubbles: init.bubbles ?? true, cancelable: true }),
  );
}

describe('enableKeyboardNav — DOM interaction', () => {
  let container: HTMLElement;
  let tasks: Task[];
  let selection: Set<TaskId>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tasks = [
      task('t1', '2026-01-05T09:00', '2026-01-07T09:00'),
      task('t2', '2026-01-10T09:00', '2026-01-12T09:00'),
      task('t3', '2026-01-15T09:00', '2026-01-17T09:00'),
    ];
    selection = new Set();
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function setup(options?: Partial<KeyboardNavOptions>) {
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const onRangeSelect = vi.fn();
    const onDeleteSelected = vi.fn();
    const nav = enableKeyboardNav(handle, {
      onSelect,
      onToggle,
      onRangeSelect,
      onDeleteSelected,
      getTasks: () => tasks,
      density: 'default',
      isReadOnly: () => false,
      getSelection: () => [...selection],
      ...options,
    });
    return { handle, nav, onSelect, onToggle, onRangeSelect, onDeleteSelected };
  }

  function rowFor(handle: ReturnType<typeof createSvgRenderer>, id: string): SVGElement {
    return handle.svg.querySelector(`.fg-timeline__row[data-task-id="${id}"]`) as SVGElement;
  }

  it('initial focus resolves to the first row when no selection exists', () => {
    const { nav } = setup();
    expect(nav.getFocusedTaskId()).toBe(toTaskId('t1'));
  });

  it('initial focus resolves to the first SELECTED row when a selection exists at setup time', () => {
    selection = new Set([toTaskId('t2')]);
    const { nav } = setup();
    expect(nav.getFocusedTaskId()).toBe(toTaskId('t2'));
  });

  it('ArrowDown moves focus to the next row and calls onSelect (replace semantics)', () => {
    const { handle, nav, onSelect } = setup();
    dispatchKey(rowFor(handle, 't1'), 'ArrowDown');
    expect(nav.getFocusedTaskId()).toBe(toTaskId('t2'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(toTaskId('t2'));
  });

  it('ArrowUp moves focus to the previous row', () => {
    const { handle, nav, onSelect } = setup();
    dispatchKey(rowFor(handle, 't1'), 'ArrowDown'); // t1 -> t2
    dispatchKey(rowFor(handle, 't2'), 'ArrowUp'); // t2 -> t1
    expect(nav.getFocusedTaskId()).toBe(toTaskId('t1'));
    expect(onSelect).toHaveBeenLastCalledWith(toTaskId('t1'));
  });

  it('ArrowUp at the first row is a no-op (no wraparound)', () => {
    const { handle, nav, onSelect } = setup();
    dispatchKey(rowFor(handle, 't1'), 'ArrowUp');
    expect(nav.getFocusedTaskId()).toBe(toTaskId('t1'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ArrowDown at the last row is a no-op (no wraparound)', () => {
    const { handle, nav, onSelect } = setup();
    dispatchKey(rowFor(handle, 't1'), 'ArrowDown'); // t1 -> t2
    dispatchKey(rowFor(handle, 't2'), 'ArrowDown'); // t2 -> t3
    onSelect.mockClear();
    dispatchKey(rowFor(handle, 't3'), 'ArrowDown'); // no-op
    expect(nav.getFocusedTaskId()).toBe(toTaskId('t3'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Shift+ArrowDown extends a range from a fixed anchor and does NOT change the anchor across a sequence', () => {
    const { handle, nav, onRangeSelect, onSelect } = setup();
    dispatchKey(rowFor(handle, 't1'), 'ArrowDown', { shiftKey: true }); // anchor=t1, focus=t2
    expect(onRangeSelect).toHaveBeenNthCalledWith(1, toTaskId('t1'), toTaskId('t2'));
    dispatchKey(rowFor(handle, 't2'), 'ArrowDown', { shiftKey: true }); // anchor=t1, focus=t3
    expect(onRangeSelect).toHaveBeenNthCalledWith(2, toTaskId('t1'), toTaskId('t3'));
    expect(nav.getFocusedTaskId()).toBe(toTaskId('t3'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a plain Arrow after a Shift+Arrow sequence resets the anchor to the new focus', () => {
    const { handle, onRangeSelect, onSelect } = setup();
    dispatchKey(rowFor(handle, 't1'), 'ArrowDown', { shiftKey: true }); // anchor=t1, focus=t2
    dispatchKey(rowFor(handle, 't2'), 'ArrowDown'); // plain -> anchor=t3, focus=t3, onSelect
    expect(onSelect).toHaveBeenCalledWith(toTaskId('t3'));
    onRangeSelect.mockClear();
    dispatchKey(rowFor(handle, 't3'), 'ArrowUp', { shiftKey: true }); // anchor should now be t3
    expect(onRangeSelect).toHaveBeenCalledWith(toTaskId('t3'), toTaskId('t2'));
  });

  it('Space toggles the focused row and calls preventDefault', () => {
    const { handle, onToggle } = setup();
    const row = rowFor(handle, 't1');
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    row.dispatchEvent(event);
    expect(onToggle).toHaveBeenCalledWith(toTaskId('t1'));
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('ArrowLeft/ArrowRight are no-ops and do NOT call preventDefault (reserved for future cell nav)', () => {
    const { handle, onSelect } = setup();
    const row = rowFor(handle, 't1');
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      const spy = vi.spyOn(event, 'preventDefault');
      row.dispatchEvent(event);
      expect(spy).not.toHaveBeenCalled();
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Enter is unbound (v1): no callback fires', () => {
    const { handle, onSelect, onToggle, onRangeSelect, onDeleteSelected } = setup();
    dispatchKey(rowFor(handle, 't1'), 'Enter');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
    expect(onRangeSelect).not.toHaveBeenCalled();
    expect(onDeleteSelected).not.toHaveBeenCalled();
  });

  it('Delete calls onDeleteSelected when the focused row is selected', () => {
    selection = new Set([toTaskId('t1')]);
    const { handle, onDeleteSelected } = setup();
    dispatchKey(rowFor(handle, 't1'), 'Delete');
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it('Backspace also calls onDeleteSelected', () => {
    selection = new Set([toTaskId('t1')]);
    const { handle, onDeleteSelected } = setup();
    dispatchKey(rowFor(handle, 't1'), 'Backspace');
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it('Delete is gated by isReadOnly: no-op, no preventDefault, onDeleteSelected not called', () => {
    selection = new Set([toTaskId('t1')]);
    const { handle, onDeleteSelected } = setup({ isReadOnly: () => true });
    const row = rowFor(handle, 't1');
    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    const spy = vi.spyOn(event, 'preventDefault');
    row.dispatchEvent(event);
    expect(onDeleteSelected).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('Delete on a focused-but-unselected row still invokes onDeleteSelected (deletes whatever IS selected, if anything)', () => {
    const { handle, onDeleteSelected } = setup(); // no selection at all
    dispatchKey(rowFor(handle, 't1'), 'Delete');
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it('stale focus re-resolution: focusedTaskId no longer present in a fresh layoutRows() clamps rather than throwing', () => {
    const { handle, nav, onSelect } = setup();
    dispatchKey(rowFor(handle, 't1'), 'ArrowDown'); // focus -> t2
    expect(nav.getFocusedTaskId()).toBe(toTaskId('t2'));

    // Externally mutate the task list (simulating host-app removal) WITHOUT going through
    // this module's own onDeleteSelected path — the next keydown must re-resolve against a
    // fresh layoutRows() call (spec §4.3), not trust the cached index.
    tasks = tasks.filter((t) => t.id !== toTaskId('t2'));
    onSelect.mockClear();

    // Dispatch on t1's row (still in the DOM from the last render) — the module still reads
    // fresh `getTasks()` internally.
    dispatchKey(rowFor(handle, 't1'), 'ArrowDown');
    // Clamped to the last row (t3) per spec §4.6.
    expect(nav.getFocusedTaskId()).toBe(toTaskId('t3'));
  });

  it('clamping to an empty grid: focusedTaskId becomes undefined, no throw', () => {
    const { handle, nav } = setup();
    tasks = [];
    expect(() => dispatchKey(rowFor(handle, 't1'), 'ArrowDown')).not.toThrow();
    expect(nav.getFocusedTaskId()).toBeUndefined();
  });

  it('a keydown whose target is outside any row is ignored', () => {
    const { handle, onSelect } = setup();
    dispatchKey(handle.svg, 'ArrowDown'); // svg root itself, not inside a .fg-timeline__row
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disposer: called once -> subsequent keydowns have no effect; called twice does not throw', () => {
    const { handle, nav, onSelect } = setup();
    nav.dispose();
    expect(() => nav.dispose()).not.toThrow();
    dispatchKey(rowFor(handle, 't1'), 'ArrowDown');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
