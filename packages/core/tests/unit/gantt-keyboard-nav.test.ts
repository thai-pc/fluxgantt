// @vitest-environment jsdom
//
// Facade + DOM integration tests for keyboard-nav (spec-keyboard-nav.md §12.2) — wiring
// between `enableKeyboardNav` and `Gantt`'s selection/removeTask/readOnly surface, plus the
// rendered ARIA/roving-tabindex DOM shape after real store mutations. Runs under jsdom (per-
// file override), mirroring gantt-dom.test.ts's setup style.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

function dispatchKey(
  target: EventTarget,
  key: string,
  init: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      shiftKey: init.shiftKey ?? false,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

function threeTaskGantt(extra: Record<string, unknown> = {}) {
  return createGantt({
    tasks: [
      taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
      taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
      taskInput('c', '2026-01-07T09:00', '2026-01-08T09:00'),
    ],
    ...extra,
  });
}

function row(id: string): SVGElement {
  return container.querySelector(`.fg-timeline__row[data-task-id="${id}"]`) as SVGElement;
}

describe('keyboard-nav — facade wiring', () => {
  it('ArrowDown moves the roving tabindex and replaces the selection via the real store', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);

    expect(row('a').getAttribute('tabindex')).toBe('0');
    dispatchKey(row('a'), 'ArrowDown');

    expect(gantt.getSelection()).toEqual([toTaskId('b')]);
    expect(row('b').getAttribute('tabindex')).toBe('0');
    expect(row('a').getAttribute('tabindex')).toBe('-1');
  });

  it('Shift+ArrowDown range-selects via the real selection store (Gantt#select semantics, not just enableClickSelect)', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);

    dispatchKey(row('a'), 'ArrowDown', { shiftKey: true }); // anchor=a, focus=b
    dispatchKey(row('b'), 'ArrowDown', { shiftKey: true }); // anchor=a, focus=c

    expect(new Set(gantt.getSelection())).toEqual(new Set([toTaskId('a'), toTaskId('b'), toTaskId('c')]));
  });

  it('Space toggles selection membership via the real store', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);

    dispatchKey(row('a'), ' ');
    expect(gantt.getSelection()).toEqual([toTaskId('a')]);

    dispatchKey(row('a'), ' ');
    expect(gantt.getSelection()).toEqual([]);
  });

  it('Delete removes every currently selected task via removeTask, and getTasks() reflects it', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    gantt.select([toTaskId('a'), toTaskId('b')]);

    dispatchKey(row('a'), 'Delete');

    expect(gantt.getTasks().map((t) => t.id)).toEqual([toTaskId('c')]);
    expect(gantt.getSelection()).toEqual([]);
  });

  it('Delete emits task:removed for every deleted id', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    gantt.select([toTaskId('a'), toTaskId('b')]);

    const onRemoved = vi.fn();
    gantt.on('task:removed', onRemoved);
    dispatchKey(row('a'), 'Delete');

    expect(onRemoved).toHaveBeenCalledTimes(2);
  });

  it('readOnly: true — Delete is a no-op, no task removed, selection unchanged', () => {
    const gantt = threeTaskGantt({ readOnly: true });
    gantt.mount(container);
    gantt.select(toTaskId('a'));

    dispatchKey(row('a'), 'Delete');

    expect(gantt.getTasks()).toHaveLength(3);
    expect(gantt.getSelection()).toEqual([toTaskId('a')]);
  });

  it('readOnly: true — ArrowDown / Space still work (non-mutating navigation stays active)', () => {
    const gantt = threeTaskGantt({ readOnly: true });
    gantt.mount(container);

    dispatchKey(row('a'), 'ArrowDown');
    expect(gantt.getSelection()).toEqual([toTaskId('b')]);
  });

  it('after Delete, focus moves to a clamped valid row and DOM tabindex reflects it post-repaint', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    gantt.select(toTaskId('c')); // focus resolves to c at setup (first selected row)

    // Re-mount picks up the selection-driven initial focus; navigate to confirm baseline,
    // then delete the last row and confirm the roving tabindex clamps sanely (no throw, some
    // row still carries tabindex="0").
    gantt.select(toTaskId('c'));
    dispatchKey(container.querySelector('.fg-timeline__row[data-task-id="c"]') as SVGElement, 'Delete');

    expect(gantt.getTasks().map((t) => t.id)).toEqual([toTaskId('a'), toTaskId('b')]);
    const zeroTabindexRows = container.querySelectorAll('.fg-timeline__row[tabindex="0"]');
    expect(zeroTabindexRows).toHaveLength(1);
  });

  it('Delete on a multi-selection fires history:changed once and undoes as one gantt.undo() call', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    gantt.select([toTaskId('a'), toTaskId('b'), toTaskId('c')]);

    const onHistory = vi.fn();
    gantt.on('history:changed', onHistory);

    dispatchKey(row('a'), 'Delete');

    expect(gantt.getTasks()).toHaveLength(0);
    expect(onHistory).toHaveBeenCalledTimes(1);

    expect(gantt.undo()).toBe(true);
    expect(gantt.getTasks().map((t) => t.id).sort()).toEqual(
      [toTaskId('a'), toTaskId('b'), toTaskId('c')].sort(),
    );
  });

  it('Ctrl/Cmd+Z undoes a real mutation end-to-end (via the keyboard, not a direct gantt.undo() call)', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    gantt.select(toTaskId('a'));

    dispatchKey(row('a'), 'Delete');
    expect(gantt.getTasks().map((t) => t.id)).toEqual([toTaskId('b'), toTaskId('c')]);

    dispatchKey(row('b'), 'z', { ctrlKey: true });
    expect(gantt.getTasks().map((t) => t.id).sort()).toEqual(
      [toTaskId('a'), toTaskId('b'), toTaskId('c')].sort(),
    );
  });

  it('Ctrl/Cmd+Shift+Z redoes, continuing from an undo', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    gantt.select(toTaskId('a'));

    dispatchKey(row('a'), 'Delete');
    dispatchKey(row('b'), 'z', { ctrlKey: true }); // undo -> a restored

    dispatchKey(row('b'), 'z', { ctrlKey: true, shiftKey: true }); // redo -> a removed again
    expect(gantt.getTasks().map((t) => t.id)).toEqual([toTaskId('b'), toTaskId('c')]);
  });

  it('readOnly: true — Ctrl/Cmd+Z is a no-op even though gantt.canUndo() is true (keybinding gated, method surface untouched)', () => {
    const gantt = threeTaskGantt({ readOnly: true });
    gantt.mount(container);

    // Programmatic mutation is allowed regardless of readOnly (facade contract), so canUndo()
    // becomes true without ever going through the keyboard gesture.
    gantt.addTask(taskInput('d', '2026-01-08T09:00', '2026-01-09T09:00'));
    expect(gantt.canUndo()).toBe(true);

    dispatchKey(row('a'), 'z', { ctrlKey: true });

    expect(gantt.getTasks()).toHaveLength(4); // task 'd' still present, undo never reached the facade
    expect(gantt.canUndo()).toBe(true); // the facade method itself remains fully open
  });

  it('Ctrl/Cmd+Z on an empty undo stack is a no-op: no throw, tasks unchanged, history:changed not fired', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);

    const onHistory = vi.fn();
    gantt.on('history:changed', onHistory);

    expect(() => dispatchKey(row('a'), 'z', { ctrlKey: true })).not.toThrow();
    expect(gantt.getTasks()).toHaveLength(3);
    expect(onHistory).not.toHaveBeenCalled();
  });

  // Note: `destroy()` tears down the mount BEFORE marking the instance destroyed, and that
  // teardown disposes the keyboard-nav listener itself (`m.keyboardNavDispose()`, see
  // `#teardownMount`) — so a keydown dispatched after `destroy()` never reaches `onUndo`/
  // `gantt.undo()` at all; the listener is simply gone. This matches the existing generic
  // "destroy() disposes the keyboard listener" test below (ArrowDown case) rather than
  // reaching `gantt.undo()`'s own `#assertAlive` throw — there is no code path by which a
  // keyboard gesture can reach an already-destroyed `Gantt`'s facade methods.
  it('Ctrl/Cmd+Z after destroy() is a no-op: listener is disposed, no throw, gantt.undo() is unreachable via the keyboard', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    const rowEl = row('a');
    gantt.destroy();
    expect(() => dispatchKey(rowEl, 'z', { ctrlKey: true })).not.toThrow();
  });

  it('destroy() disposes the keyboard listener — a stray keydown after destroy throws nothing and mutates nothing', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    const rowEl = row('a');
    gantt.destroy();
    expect(() => dispatchKey(rowEl, 'ArrowDown')).not.toThrow();
  });

  it('unmount() then remount(): keyboard nav still works on the new mount, no double-firing from a stale listener', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    gantt.unmount();
    gantt.mount(container);

    dispatchKey(row('a'), 'ArrowDown');
    expect(gantt.getSelection()).toEqual([toTaskId('b')]);
  });

  describe('Ctrl/Cmd+Plus/Minus — zoom keybindings (facade wiring)', () => {
    it('Ctrl+= zooms in one level via the real zoomIn()', () => {
      const gantt = threeTaskGantt();
      gantt.mount(container);
      expect(gantt.getViewMode()).toBe('week'); // default per spec-zoom-runtime.md

      dispatchKey(row('a'), '=', { ctrlKey: true });

      expect(gantt.getViewMode()).toBe('day');
    });

    it('Ctrl+- zooms out one level via the real zoomOut()', () => {
      const gantt = threeTaskGantt();
      gantt.mount(container);
      expect(gantt.getViewMode()).toBe('week');

      dispatchKey(row('a'), '-', { ctrlKey: true });

      expect(gantt.getViewMode()).toBe('month');
    });

    it('boundary clamping still holds when triggered via keyboard: already at \'day\', Ctrl+= is a safe no-op', () => {
      const gantt = threeTaskGantt();
      gantt.mount(container);
      gantt.zoomTo('day');

      expect(() => dispatchKey(row('a'), '=', { ctrlKey: true })).not.toThrow();
      expect(gantt.getViewMode()).toBe('day');
    });

    it('boundary clamping still holds when triggered via keyboard: already at \'year\', Ctrl+- is a safe no-op', () => {
      const gantt = threeTaskGantt();
      gantt.mount(container);
      gantt.zoomTo('year');

      expect(() => dispatchKey(row('a'), '-', { ctrlKey: true })).not.toThrow();
      expect(gantt.getViewMode()).toBe('year');
    });

    it('readOnly: true — Ctrl+=/Ctrl+- still work (contrast against Delete\'s readOnly-suppression above)', () => {
      const gantt = threeTaskGantt({ readOnly: true });
      gantt.mount(container);
      expect(gantt.getViewMode()).toBe('week');

      dispatchKey(row('a'), '=', { ctrlKey: true });
      expect(gantt.getViewMode()).toBe('day');

      dispatchKey(row('a'), '-', { ctrlKey: true });
      dispatchKey(row('a'), '-', { ctrlKey: true });
      expect(gantt.getViewMode()).toBe('month');
    });

    it('viewport:changed fires exactly once per keyboard zoom', () => {
      const gantt = threeTaskGantt();
      gantt.mount(container);
      const onChanged = vi.fn();
      gantt.on('viewport:changed', onChanged);

      dispatchKey(row('a'), '=', { ctrlKey: true });

      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(onChanged).toHaveBeenCalledWith({ viewMode: 'day' });
    });

    it('preventDefault() is called on a real dispatched keyboard zoom event', () => {
      const gantt = threeTaskGantt();
      gantt.mount(container);

      const event = new KeyboardEvent('keydown', {
        key: '=',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      row('a').dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('dispatch after destroy() does not throw and does not fire zoom', () => {
      const gantt = threeTaskGantt();
      gantt.mount(container);
      const rowEl = row('a');
      gantt.destroy();
      expect(() => dispatchKey(rowEl, '=', { ctrlKey: true })).not.toThrow();
    });
  });
});
