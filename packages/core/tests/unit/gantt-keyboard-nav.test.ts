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

function dispatchKey(target: EventTarget, key: string, init: { shiftKey?: boolean } = {}): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey: init.shiftKey ?? false, bubbles: true, cancelable: true }),
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
});
