// @vitest-environment jsdom
//
// Interaction — roving-tabindex keyboard navigation tests (spec-keyboard-nav.md §12.1). Runs
// under jsdom (per-file override; the rest of core stays `environment: 'node'`), mirroring
// `selection.test.ts`'s setup style.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { enableKeyboardNav, type KeyboardNavOptions } from '../../src/interaction/keyboard-nav.js';
import type { InteractiveRendererHandle } from '../../src/render/interactive-renderer-handle.js';
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
  init: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; bubbles?: boolean } = {},
): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      shiftKey: init.shiftKey ?? false,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
      bubbles: init.bubbles ?? true,
      cancelable: true,
    }),
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
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onDuplicateSelected = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const nav = enableKeyboardNav(handle, {
      onSelect,
      onToggle,
      onRangeSelect,
      onDeleteSelected,
      onUndo,
      onRedo,
      onDuplicateSelected,
      onZoomIn,
      onZoomOut,
      getTasks: () => tasks,
      density: 'default',
      isReadOnly: () => false,
      getSelection: () => [...selection],
      ...options,
    });
    return {
      handle,
      nav,
      onSelect,
      onToggle,
      onRangeSelect,
      onDeleteSelected,
      onUndo,
      onRedo,
      onDuplicateSelected,
      onZoomIn,
      onZoomOut,
    };
  }

  function rowFor(handle: ReturnType<typeof createSvgRenderer>, id: string): SVGElement {
    return handle.svg.querySelector(`.fg-timeline__row[data-task-id="${id}"]`) as SVGElement;
  }

  it('handle.interactionRoot aliases handle.svg (Ticket 2 aliasing guarantee)', () => {
    const { handle } = setup();
    expect(handle.interactionRoot).toBe(handle.svg);
  });

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

  it('Ctrl+z fires onUndo, calls preventDefault, does not fire onRedo', () => {
    const { handle, onUndo, onRedo } = setup();
    const row = rowFor(handle, 't1');
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    const spy = vi.spyOn(event, 'preventDefault');
    row.dispatchEvent(event);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });

  it('Meta+z (Cmd on Mac) also fires onUndo', () => {
    const { handle, onUndo, onRedo } = setup();
    const row = rowFor(handle, 't1');
    const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true });
    const spy = vi.spyOn(event, 'preventDefault');
    row.dispatchEvent(event);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });

  it('Ctrl+Shift+Z fires onRedo, not onUndo', () => {
    const { handle, onUndo, onRedo } = setup();
    const row = rowFor(handle, 't1');
    const event = new KeyboardEvent('keydown', {
      key: 'Z',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(event, 'preventDefault');
    row.dispatchEvent(event);
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });

  it('Meta+Shift+Z also fires onRedo', () => {
    const { handle, onUndo, onRedo } = setup();
    const row = rowFor(handle, 't1');
    const event = new KeyboardEvent('keydown', {
      key: 'Z',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(event, 'preventDefault');
    row.dispatchEvent(event);
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });

  it('plain z/Z with no Ctrl/Cmd is a no-op: neither onUndo nor onRedo fires, preventDefault not called', () => {
    const { handle, onUndo, onRedo } = setup();
    const row = rowFor(handle, 't1');

    const plainZ = new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true });
    const plainZSpy = vi.spyOn(plainZ, 'preventDefault');
    row.dispatchEvent(plainZ);

    const shiftOnlyZ = new KeyboardEvent('keydown', {
      key: 'Z',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const shiftOnlyZSpy = vi.spyOn(shiftOnlyZ, 'preventDefault');
    row.dispatchEvent(shiftOnlyZ);

    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
    expect(plainZSpy).not.toHaveBeenCalled();
    expect(shiftOnlyZSpy).not.toHaveBeenCalled();
  });

  it('Ctrl+z and Ctrl+Shift+Z are gated by isReadOnly: no-op, no preventDefault', () => {
    const { handle, onUndo, onRedo } = setup({ isReadOnly: () => true });
    const row = rowFor(handle, 't1');

    const undoEvent = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    const undoSpy = vi.spyOn(undoEvent, 'preventDefault');
    row.dispatchEvent(undoEvent);

    const redoEvent = new KeyboardEvent('keydown', {
      key: 'Z',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const redoSpy = vi.spyOn(redoEvent, 'preventDefault');
    row.dispatchEvent(redoEvent);

    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
    expect(undoSpy).not.toHaveBeenCalled();
    expect(redoSpy).not.toHaveBeenCalled();
  });

  it('Ctrl+z on a keydown target outside any row is ignored', () => {
    const { handle, onUndo } = setup();
    dispatchKey(handle.svg, 'z', { ctrlKey: true }); // svg root itself, not inside a .fg-timeline__row
    expect(onUndo).not.toHaveBeenCalled();
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

  describe('Ctrl/Cmd+D — duplicate keybinding', () => {
    it('Ctrl+d fires onDuplicateSelected, calls preventDefault', () => {
      const { handle, onDuplicateSelected } = setup();
      const row = rowFor(handle, 't1');
      const event = new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true });
      const spy = vi.spyOn(event, 'preventDefault');
      row.dispatchEvent(event);
      expect(onDuplicateSelected).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalled();
    });

    it('Cmd+d (metaKey) also fires onDuplicateSelected', () => {
      const { handle, onDuplicateSelected } = setup();
      const row = rowFor(handle, 't1');
      const event = new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true, cancelable: true });
      const spy = vi.spyOn(event, 'preventDefault');
      row.dispatchEvent(event);
      expect(onDuplicateSelected).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalled();
    });

    it('Ctrl+Shift+d (key "D", shiftKey true) also fires onDuplicateSelected — Shift state does not gate it', () => {
      const { handle, onDuplicateSelected } = setup();
      const row = rowFor(handle, 't1');
      const event = new KeyboardEvent('keydown', {
        key: 'D',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      const spy = vi.spyOn(event, 'preventDefault');
      row.dispatchEvent(event);
      expect(onDuplicateSelected).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalled();
    });

    // Sharpest regression-risk test in this ticket: the OPPOSITE assertion of the zoom
    // keybinding's "isReadOnly: () => true does NOT suppress zoom" test above. Duplicate
    // mutates #taskStore (like Delete/undo/redo), so it MUST be suppressed when read-only —
    // a future reader copying the most-recently-merged zoom precedent must not accidentally
    // leave this ungated.
    it('isReadOnly: () => true SUPPRESSES Ctrl+d — onDuplicateSelected NOT called, preventDefault NOT called', () => {
      const { handle, onDuplicateSelected } = setup({ isReadOnly: () => true });
      const row = rowFor(handle, 't1');
      const event = new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true });
      const spy = vi.spyOn(event, 'preventDefault');
      row.dispatchEvent(event);
      expect(onDuplicateSelected).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });

    it('plain d/D with no Ctrl/Cmd is a no-op: onDuplicateSelected not called, preventDefault not called', () => {
      const { handle, onDuplicateSelected } = setup();
      const row = rowFor(handle, 't1');

      const plainD = new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true });
      const plainDSpy = vi.spyOn(plainD, 'preventDefault');
      row.dispatchEvent(plainD);

      const shiftOnlyD = new KeyboardEvent('keydown', {
        key: 'D',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      const shiftOnlyDSpy = vi.spyOn(shiftOnlyD, 'preventDefault');
      row.dispatchEvent(shiftOnlyD);

      expect(onDuplicateSelected).not.toHaveBeenCalled();
      expect(plainDSpy).not.toHaveBeenCalled();
      expect(shiftOnlyDSpy).not.toHaveBeenCalled();
    });

    it('an unrelated key (e.g. "a") with Ctrl held is a no-op', () => {
      const { handle, onDuplicateSelected } = setup();
      dispatchKey(rowFor(handle, 't1'), 'a', { ctrlKey: true });
      expect(onDuplicateSelected).not.toHaveBeenCalled();
    });

    it('Ctrl+d on a keydown target outside any row is ignored', () => {
      const { handle, onDuplicateSelected } = setup();
      dispatchKey(handle.svg, 'd', { ctrlKey: true }); // svg root itself, not inside a .fg-timeline__row
      expect(onDuplicateSelected).not.toHaveBeenCalled();
    });
  });

  describe('Ctrl/Cmd+Plus/Minus — zoom keybindings', () => {
    it('Ctrl+= (no Shift) fires onZoomIn, calls preventDefault, does not fire onZoomOut', () => {
      const { handle, onZoomIn, onZoomOut } = setup();
      const row = rowFor(handle, 't1');
      const event = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
      const spy = vi.spyOn(event, 'preventDefault');
      row.dispatchEvent(event);
      expect(onZoomIn).toHaveBeenCalledTimes(1);
      expect(onZoomOut).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('Ctrl+Shift+= (literal Shift+Plus) also fires onZoomIn', () => {
      const { handle, onZoomIn } = setup();
      const row = rowFor(handle, 't1');
      const event = new KeyboardEvent('keydown', {
        key: '+',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      row.dispatchEvent(event);
      expect(onZoomIn).toHaveBeenCalledTimes(1);
    });

    it('Ctrl++ with shiftKey false (Numpad +) also fires onZoomIn', () => {
      const { handle, onZoomIn } = setup();
      const row = rowFor(handle, 't1');
      const event = new KeyboardEvent('keydown', {
        key: '+',
        ctrlKey: true,
        shiftKey: false,
        bubbles: true,
        cancelable: true,
      });
      row.dispatchEvent(event);
      expect(onZoomIn).toHaveBeenCalledTimes(1);
    });

    it('Meta+=/Meta+Shift+=/Meta++ (Cmd on Mac) all also fire onZoomIn', () => {
      const { handle, onZoomIn } = setup();
      const row = rowFor(handle, 't1');
      for (const init of [
        { key: '=', metaKey: true },
        { key: '+', metaKey: true, shiftKey: true },
        { key: '+', metaKey: true },
      ]) {
        row.dispatchEvent(
          new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }),
        );
      }
      expect(onZoomIn).toHaveBeenCalledTimes(3);
    });

    it('Ctrl+- fires onZoomOut, calls preventDefault, does not fire onZoomIn', () => {
      const { handle, onZoomIn, onZoomOut } = setup();
      const row = rowFor(handle, 't1');
      const event = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
      const spy = vi.spyOn(event, 'preventDefault');
      row.dispatchEvent(event);
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(onZoomIn).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('Meta+- also fires onZoomOut', () => {
      const { handle, onZoomOut } = setup();
      const row = rowFor(handle, 't1');
      const event = new KeyboardEvent('keydown', { key: '-', metaKey: true, bubbles: true, cancelable: true });
      row.dispatchEvent(event);
      expect(onZoomOut).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+_ (Shift+Minus) is NOT handled: neither onZoomIn nor onZoomOut fires, preventDefault not called', () => {
      const { handle, onZoomIn, onZoomOut } = setup();
      const row = rowFor(handle, 't1');
      const event = new KeyboardEvent('keydown', {
        key: '_',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      const spy = vi.spyOn(event, 'preventDefault');
      row.dispatchEvent(event);
      expect(onZoomIn).not.toHaveBeenCalled();
      expect(onZoomOut).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });

    it('plain +/=/- with no Ctrl/Cmd is a no-op: neither callback fires, preventDefault not called', () => {
      const { handle, onZoomIn, onZoomOut } = setup();
      const row = rowFor(handle, 't1');
      for (const key of ['+', '=', '-']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        const spy = vi.spyOn(event, 'preventDefault');
        row.dispatchEvent(event);
        expect(spy).not.toHaveBeenCalled();
      }
      expect(onZoomIn).not.toHaveBeenCalled();
      expect(onZoomOut).not.toHaveBeenCalled();
    });

    it('isReadOnly: () => true does NOT suppress zoom — onZoomIn/onZoomOut still fire, preventDefault still called', () => {
      const { handle, onZoomIn, onZoomOut } = setup({ isReadOnly: () => true });
      const row = rowFor(handle, 't1');

      const zoomInEvent = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
      const zoomInSpy = vi.spyOn(zoomInEvent, 'preventDefault');
      row.dispatchEvent(zoomInEvent);

      const zoomOutEvent = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
      const zoomOutSpy = vi.spyOn(zoomOutEvent, 'preventDefault');
      row.dispatchEvent(zoomOutEvent);

      expect(onZoomIn).toHaveBeenCalledTimes(1);
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(zoomInSpy).toHaveBeenCalled();
      expect(zoomOutSpy).toHaveBeenCalled();
    });

    it('Ctrl+= on a keydown target outside any row is ignored', () => {
      const { handle, onZoomIn } = setup();
      dispatchKey(handle.svg, '=', { ctrlKey: true }); // svg root itself, not inside a .fg-timeline__row
      expect(onZoomIn).not.toHaveBeenCalled();
    });
  });
});

// --- Minimal-mock structural test (Ticket 2, spec §12.4) — proves enableKeyboardNav is
// decoupled from SVG specifically: a bare object satisfying InteractiveRendererHandle (no
// `.svg` field) with hand-built row markup works identically to a real SvgRendererHandle.
describe('enableKeyboardNav — minimal InteractiveRendererHandle mock (SVG-decoupling proof)', () => {
  it('roving-tabindex ArrowDown navigation works against a bare interactionRoot, no .svg field required', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.setAttribute('role', 'grid');
    root.innerHTML = `
      <div class="fg-timeline__row" data-row-index="0" data-task-id="mock-1" tabindex="0"></div>
      <div class="fg-timeline__row" data-row-index="1" data-task-id="mock-2" tabindex="-1"></div>
    `;
    const handle: InteractiveRendererHandle = { interactionRoot: root, pointerEventTarget: root };
    const tasks = [
      task('mock-1', '2026-01-05T09:00', '2026-01-07T09:00'),
      task('mock-2', '2026-01-10T09:00', '2026-01-12T09:00'),
    ];
    const onSelect = vi.fn();
    const nav = enableKeyboardNav(handle, {
      onSelect,
      onToggle: vi.fn(),
      onRangeSelect: vi.fn(),
      onDeleteSelected: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onDuplicateSelected: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      getTasks: () => tasks,
      density: 'default',
      isReadOnly: () => false,
      getSelection: () => [],
    });

    expect(nav.getFocusedTaskId()).toBe(toTaskId('mock-1'));
    const row0 = root.querySelector('[data-task-id="mock-1"]') as HTMLElement;
    dispatchKey(row0, 'ArrowDown', { bubbles: true });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(toTaskId('mock-2'));
    expect(nav.getFocusedTaskId()).toBe(toTaskId('mock-2'));

    nav.dispose();
    root.remove();
  });
});
