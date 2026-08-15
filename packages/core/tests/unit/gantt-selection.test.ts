// Headless facade tests — select()/selectAll()/deselect()/getSelection() (spec-selection.md
// §12.2). Runs under vitest's default `node` environment — the programmatic selection API
// needs no DOM. DOM/interaction wiring tests live in gantt-dom.test.ts (jsdom).
import { describe, it, expect, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

describe('Gantt#select — single/array/replace semantics', () => {
  it('select(id) replaces prior selection (not additive)', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-01', '2026-01-02'), taskInput('b', '2026-01-02', '2026-01-03')],
    });
    gantt.select(toTaskId('a'));
    expect(gantt.getSelection()).toEqual([toTaskId('a')]);
    gantt.select(toTaskId('b'));
    expect(gantt.getSelection()).toEqual([toTaskId('b')]);
  });

  it('select([a, b]) accepts an array', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-01', '2026-01-02'), taskInput('b', '2026-01-02', '2026-01-03')],
    });
    gantt.select([toTaskId('a'), toTaskId('b')]);
    expect(new Set(gantt.getSelection())).toEqual(new Set([toTaskId('a'), toTaskId('b')]));
  });

  it('select() with an unknown id is silently dropped, does not throw, getSelection() unaffected', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-01', '2026-01-02')] });
    expect(() => gantt.select(toTaskId('does-not-exist'))).not.toThrow();
    expect(gantt.getSelection()).toEqual([]);
  });

  it('select() with a mix of known + unknown ids keeps only the known one', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-01', '2026-01-02')] });
    gantt.select([toTaskId('a'), toTaskId('ghost')]);
    expect(gantt.getSelection()).toEqual([toTaskId('a')]);
  });
});

describe('Gantt#select — hierarchy expansion', () => {
  function multiLevelGantt() {
    return createGantt({
      tasks: [
        taskInput('grandparent', '2026-01-01', '2026-01-10', { type: 'summary' }),
        taskInput('parent', '2026-01-01', '2026-01-08', { type: 'summary', parent: toTaskId('grandparent') }),
        taskInput('child', '2026-01-01', '2026-01-05', { parent: toTaskId('parent') }),
        taskInput('grandchild', '2026-01-01', '2026-01-03', { parent: toTaskId('child') }),
        taskInput('unrelated', '2026-02-01', '2026-02-02'),
      ],
    });
  }

  it('select(parentId) with 2+ levels of descendants includes parent + ALL descendants, every level', () => {
    const gantt = multiLevelGantt();
    gantt.select(toTaskId('grandparent'));
    expect(new Set(gantt.getSelection())).toEqual(
      new Set([toTaskId('grandparent'), toTaskId('parent'), toTaskId('child'), toTaskId('grandchild')]),
    );
    expect(gantt.getSelection()).not.toContain(toTaskId('unrelated'));
  });

  it('select(childId) (a leaf with a parent) contains ONLY that child — no "select up"', () => {
    const gantt = multiLevelGantt();
    gantt.select(toTaskId('grandchild'));
    expect(gantt.getSelection()).toEqual([toTaskId('grandchild')]);
  });

  it('selectAll() equals every task id in the store, hierarchy included', () => {
    const gantt = multiLevelGantt();
    gantt.selectAll();
    expect(new Set(gantt.getSelection())).toEqual(
      new Set(gantt.getTasks().map((t) => t.id)),
    );
  });

  it('deselect() empties the selection', () => {
    const gantt = multiLevelGantt();
    gantt.select(toTaskId('grandparent'));
    gantt.deselect();
    expect(gantt.getSelection()).toEqual([]);
  });
});

describe("Gantt#select — 'selection:changed' emission discipline", () => {
  it('fires exactly once per call that changes the set', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-01', '2026-01-02'), taskInput('b', '2026-01-02', '2026-01-03')],
    });
    const onChanged = vi.fn();
    gantt.on('selection:changed', onChanged);

    gantt.select(toTaskId('a'));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenLastCalledWith([toTaskId('a')]);

    gantt.select(toTaskId('b'));
    expect(onChanged).toHaveBeenCalledTimes(2);

    gantt.deselect();
    expect(onChanged).toHaveBeenCalledTimes(3);
  });

  it('is suppressed when select() is called again with the same (possibly reordered) id set', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-01', '2026-01-02'), taskInput('b', '2026-01-02', '2026-01-03')],
    });
    const onChanged = vi.fn();
    gantt.on('selection:changed', onChanged);

    gantt.select([toTaskId('a'), toTaskId('b')]);
    expect(onChanged).toHaveBeenCalledTimes(1);

    gantt.select([toTaskId('b'), toTaskId('a')]); // same set, reordered
    expect(onChanged).toHaveBeenCalledTimes(1); // suppressed

    gantt.deselect();
    gantt.deselect(); // already empty — suppressed
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('select() with only unknown ids never fires selection:changed (empty -> empty is a no-op)', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-01', '2026-01-02')] });
    const onChanged = vi.fn();
    gantt.on('selection:changed', onChanged);
    gantt.select(toTaskId('ghost'));
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('Gantt — toggling a selected parent off cascades to descendants (simulated via select+deselect sequencing)', () => {
  it('deselect() after selecting a parent removes every descendant too, even one independently selected first', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('parent', '2026-01-01', '2026-01-08', { type: 'summary' }),
        taskInput('child', '2026-01-01', '2026-01-05', { parent: toTaskId('parent') }),
      ],
    });
    // Independently select the child first.
    gantt.select(toTaskId('child'));
    expect(gantt.getSelection()).toEqual([toTaskId('child')]);

    // Selecting the parent replaces the selection with parent + child (expansion + Set dedup).
    gantt.select(toTaskId('parent'));
    expect(new Set(gantt.getSelection())).toEqual(new Set([toTaskId('parent'), toTaskId('child')]));

    // Deselecting clears both — no leftover descendant.
    gantt.deselect();
    expect(gantt.getSelection()).toEqual([]);
  });
});

describe('Gantt#removeTask — selection pruning', () => {
  it('removing a selected task (or one of its descendants) prunes getSelection() and fires selection:changed once', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('parent', '2026-01-01', '2026-01-08', { type: 'summary' }),
        taskInput('child', '2026-01-01', '2026-01-05', { parent: toTaskId('parent') }),
        taskInput('other', '2026-02-01', '2026-02-02'),
      ],
    });
    gantt.select([toTaskId('parent'), toTaskId('other')]); // expands to parent+child+other
    expect(new Set(gantt.getSelection())).toEqual(
      new Set([toTaskId('parent'), toTaskId('child'), toTaskId('other')]),
    );

    const onChanged = vi.fn();
    gantt.on('selection:changed', onChanged);

    gantt.removeTask(toTaskId('parent')); // cascades to remove child too

    expect(gantt.getSelection()).toEqual([toTaskId('other')]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenLastCalledWith([toTaskId('other')]);
  });

  it('removing a task that is neither selected nor an ancestor of a selected task does NOT fire selection:changed', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-01', '2026-01-02'), taskInput('b', '2026-01-02', '2026-01-03')],
    });
    gantt.select(toTaskId('a'));

    const onChanged = vi.fn();
    gantt.on('selection:changed', onChanged);

    gantt.removeTask(toTaskId('b'));

    expect(onChanged).not.toHaveBeenCalled();
    expect(gantt.getSelection()).toEqual([toTaskId('a')]);
  });
});

describe('Gantt#getSelection — post-destroy() posture', () => {
  it('returns [] after destroy()', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-01', '2026-01-02')] });
    gantt.select(toTaskId('a'));
    expect(gantt.getSelection()).toEqual([toTaskId('a')]);
    gantt.destroy();
    expect(gantt.getSelection()).toEqual([]);
  });
});
