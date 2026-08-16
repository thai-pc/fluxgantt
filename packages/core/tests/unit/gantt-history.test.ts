// Undo/redo facade unit + integration tests (spec-undo-redo.md §8.2/§8.3). Headless (`node`
// environment, no mount() needed — undo/redo has no DOM dependency).
import { describe, it, expect, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { toTaskId, type Task } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

describe('undo/redo — push/pop/basic semantics', () => {
  it('addTask then undo() removes it; canUndo false, canRedo true; redo() re-adds the exact task (identity fidelity)', () => {
    const gantt = createGantt({});
    const task = gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));

    expect(gantt.undo()).toBe(true);
    expect(gantt.getTasks()).toEqual([]);
    expect(gantt.canUndo()).toBe(false);
    expect(gantt.canRedo()).toBe(true);

    expect(gantt.redo()).toBe(true);
    expect(gantt.getTask(task.id)).toEqual(task);
  });

  it('undo()/redo() on an empty stack return false, throw nothing, do NOT fire history:changed', () => {
    const gantt = createGantt({});
    const onHistory = vi.fn();
    gantt.on('history:changed', onHistory);

    expect(gantt.undo()).toBe(false);
    expect(gantt.redo()).toBe(false);
    expect(onHistory).not.toHaveBeenCalled();
  });

  it('moveTask: undo restores the exact prior Task snapshot; redo re-applies the exact next snapshot', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    const before = gantt.getTask(toTaskId('a'))!;
    const after = gantt.moveTask(toTaskId('a'), '2026-01-08T09:00');

    gantt.undo();
    expect(gantt.getTask(toTaskId('a'))).toEqual(before);
    gantt.redo();
    expect(gantt.getTask(toTaskId('a'))).toEqual(after);
  });

  it('resizeTask: undo/redo round-trips', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00', { duration: 8 })],
    });
    const before = gantt.getTask(toTaskId('a'))!;
    const after = gantt.resizeTask(toTaskId('a'), 16);

    gantt.undo();
    expect(gantt.getTask(toTaskId('a'))).toEqual(before);
    gantt.redo();
    expect(gantt.getTask(toTaskId('a'))).toEqual(after);
  });

  it('setProgress: undo/redo round-trips', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    const before = gantt.getTask(toTaskId('a'))!;
    const after = gantt.setProgress(toTaskId('a'), 0.5);

    gantt.undo();
    expect(gantt.getTask(toTaskId('a'))).toEqual(before);
    gantt.redo();
    expect(gantt.getTask(toTaskId('a'))).toEqual(after);
  });

  it('updateTask: undo/redo round-trips', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    const before = gantt.getTask(toTaskId('a'))!;
    const after = gantt.updateTask(toTaskId('a'), { name: 'Renamed' });

    gantt.undo();
    expect(gantt.getTask(toTaskId('a'))).toEqual(before);
    gantt.redo();
    expect(gantt.getTask(toTaskId('a'))).toEqual(after);
  });

  it('removeTask on a task with 2 levels of hierarchy descendants + 2 touching dependencies: undo() restores ALL of them in ONE call; redo() removes them all again', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('root', '2026-01-05T09:00', '2026-01-10T09:00', { type: 'summary' }),
        taskInput('child', '2026-01-05T09:00', '2026-01-06T09:00', { parent: toTaskId('root') }),
        taskInput('grandchild', '2026-01-05T09:00', '2026-01-06T09:00', { parent: toTaskId('child') }),
        taskInput('other', '2026-01-07T09:00', '2026-01-08T09:00'),
      ],
      dependencies: [
        { from: toTaskId('grandchild'), to: toTaskId('other'), type: 'FS' },
        { from: toTaskId('other'), to: toTaskId('child'), type: 'FS' },
      ],
    });
    const tasksBefore = gantt.getTasks();
    const depsBefore = gantt.getDependencies();

    gantt.removeTask(toTaskId('root'));
    expect(gantt.getTasks().map((t) => t.id)).toEqual([toTaskId('other')]);
    expect(gantt.getDependencies()).toEqual([]);

    expect(gantt.undo()).toBe(true);
    expect(new Set(gantt.getTasks().map((t) => t.id))).toEqual(new Set(tasksBefore.map((t) => t.id)));
    expect(new Set(gantt.getDependencies().map((d) => d.id))).toEqual(new Set(depsBefore.map((d) => d.id)));

    expect(gantt.redo()).toBe(true);
    expect(gantt.getTasks().map((t) => t.id)).toEqual([toTaskId('other')]);
    expect(gantt.getDependencies()).toEqual([]);
  });

  it('linkTasks -> undo() removes the dependency; redo() recreates it with the SAME DependencyId', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
      ],
    });
    const dep = gantt.linkTasks(toTaskId('a'), toTaskId('b'));

    expect(gantt.undo()).toBe(true);
    expect(gantt.getDependencies()).toEqual([]);

    expect(gantt.redo()).toBe(true);
    expect(gantt.getDependencies()).toEqual([dep]);
    expect(gantt.getDependencies()[0]!.id).toBe(dep.id);
  });

  it('unlinkTasks -> undo() recreates the dependency with the original id; redo() removes it again; repeated cycles keep the identical id', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
      ],
      dependencies: [{ from: toTaskId('a'), to: toTaskId('b'), type: 'FS' }],
    });
    const original = gantt.getDependencies()[0]!;

    gantt.unlinkTasks(toTaskId('a'), toTaskId('b'));
    expect(gantt.getDependencies()).toEqual([]);

    // Repeated undo -> redo -> undo -> redo cycles keep producing the identical id every time.
    for (let i = 0; i < 3; i++) {
      expect(gantt.undo()).toBe(true);
      expect(gantt.getDependencies()[0]!.id).toBe(original.id);
      expect(gantt.redo()).toBe(true);
      expect(gantt.getDependencies()).toEqual([]);
    }
  });
});

describe('undo/redo — depth-cap eviction', () => {
  it('historyLimit: 3, 5 addTask calls -> undo() 3 times undoes the LAST 3; the first 2 stay permanently un-undoable', () => {
    const gantt = createGantt({ historyLimit: 3 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      gantt.addTask(taskInput(id, '2026-01-05T09:00', '2026-01-06T09:00'));
    }
    expect(gantt.getTasks()).toHaveLength(5);

    expect(gantt.undo()).toBe(true);
    expect(gantt.undo()).toBe(true);
    expect(gantt.undo()).toBe(true);
    expect(gantt.canUndo()).toBe(false);

    // e, d, c undone -> a, b remain
    expect(new Set(gantt.getTasks().map((t) => t.id))).toEqual(new Set([toTaskId('a'), toTaskId('b')]));
  });

  it('historyLimit: 0 -> every mutation still applies normally, but canUndo() is always false', () => {
    const gantt = createGantt({ historyLimit: 0 });
    gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    expect(gantt.getTasks()).toHaveLength(1);
    expect(gantt.canUndo()).toBe(false);
    expect(gantt.undo()).toBe(false);
  });

  it('a negative historyLimit throws at construction', () => {
    expect(() => createGantt({ historyLimit: -1 })).toThrow(/historyLimit/);
  });

  it('a non-integer historyLimit throws at construction', () => {
    expect(() => createGantt({ historyLimit: 1.5 })).toThrow(/historyLimit/);
  });
});

describe('undo/redo — redo-clear-on-new-mutation', () => {
  it('addTask(a), addTask(b), undo() (canRedo true), addTask(c) -> canRedo becomes false; redo() returns false', () => {
    const gantt = createGantt({});
    gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    gantt.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));

    gantt.undo(); // removes b
    expect(gantt.canRedo()).toBe(true);

    gantt.addTask(taskInput('c', '2026-01-07T09:00', '2026-01-08T09:00'));
    expect(gantt.canRedo()).toBe(false);
    expect(gantt.redo()).toBe(false);
    expect(gantt.getTasks().map((t) => t.id).sort()).toEqual([toTaskId('a'), toTaskId('c')].sort());
  });
});

describe('undo/redo — history:changed timing', () => {
  it('fires once per top-level mutation call (not per internal op)', () => {
    const gantt = createGantt({});
    const onHistory = vi.fn();
    gantt.on('history:changed', onHistory);

    gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    expect(onHistory).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire for select/selectAll/deselect/computeCriticalPath()', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    const onHistory = vi.fn();
    gantt.on('history:changed', onHistory);

    gantt.select(toTaskId('a'));
    gantt.selectAll();
    gantt.deselect();
    gantt.computeCriticalPath();

    expect(onHistory).not.toHaveBeenCalled();
  });

  it('does NOT fire for construction-seeded config.tasks/config.dependencies; canUndo() is false immediately after construction', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
      ],
      dependencies: [{ from: toTaskId('a'), to: toTaskId('b'), type: 'FS' }],
    });
    expect(gantt.canUndo()).toBe(false);

    const onHistory = vi.fn();
    gantt.on('history:changed', onHistory);
    expect(onHistory).not.toHaveBeenCalled();
  });

  it('payload { canUndo, canRedo } is correct at each fire', () => {
    const gantt = createGantt({});
    const states: { canUndo: boolean; canRedo: boolean }[] = [];
    gantt.on('history:changed', (state) => states.push(state));

    const task = gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    expect(states[0]).toEqual({ canUndo: true, canRedo: false });

    gantt.undo();
    expect(states[1]).toEqual({ canUndo: false, canRedo: true });

    gantt.redo();
    expect(states[2]).toEqual({ canUndo: true, canRedo: false });

    void task;
  });
});

describe('undo/redo — event source marker', () => {
  it('normal addTask/moveTask/linkTasks: the 3rd callback argument is not present (undefined, arg-count-sensitive)', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
      ],
    });
    const onAdded = vi.fn();
    const onMoved = vi.fn();
    const onDepAdded = vi.fn();
    gantt.on('task:added', onAdded);
    gantt.on('task:moved', onMoved);
    gantt.on('dependency:added', onDepAdded);

    gantt.addTask(taskInput('c', '2026-01-08T09:00', '2026-01-09T09:00'));
    gantt.moveTask(toTaskId('a'), '2026-01-10T09:00');
    gantt.linkTasks(toTaskId('a'), toTaskId('b'));

    expect(onAdded.mock.calls[0]!.length).toBe(1);
    expect(onMoved.mock.calls[0]!.length).toBe(2);
    expect(onDepAdded.mock.calls[0]!.length).toBe(1);
  });

  it('undo()-driven emits carry { source: "undo" } as the 3rd arg on every task:*/dependency:* event', () => {
    const gantt = createGantt({});
    const onAdded = vi.fn();
    const onRemoved = vi.fn();
    gantt.on('task:added', onAdded);
    gantt.on('task:removed', onRemoved);

    gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    gantt.undo();

    expect(onRemoved).toHaveBeenCalledWith(toTaskId('a'), { source: 'undo' });
  });

  it('redo()-driven emits carry { source: "redo" } as the 3rd arg', () => {
    const gantt = createGantt({});
    const onAdded = vi.fn();
    gantt.on('task:added', onAdded);

    gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    gantt.undo();
    gantt.redo();

    expect(onAdded).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: toTaskId('a') }), {
      source: 'redo',
    });
  });

  it('undo() of a moveTask carries source on task:moved', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    gantt.moveTask(toTaskId('a'), '2026-01-08T09:00');

    const onMoved = vi.fn();
    gantt.on('task:moved', onMoved);
    gantt.undo();

    expect(onMoved).toHaveBeenCalledTimes(1);
    expect(onMoved.mock.calls[0]![2]).toEqual({ source: 'undo' });
  });
});

describe('undo/redo — excluded-from-history sanity', () => {
  it('select()/selectAll()/deselect() never affect canUndo()/canRedo()', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    gantt.select(toTaskId('a'));
    gantt.selectAll();
    gantt.deselect();
    expect(gantt.canUndo()).toBe(false);
    expect(gantt.canRedo()).toBe(false);
  });

  it('computeCriticalPath() never affects canUndo()/canRedo()', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    gantt.computeCriticalPath();
    expect(gantt.canUndo()).toBe(false);
    expect(gantt.canRedo()).toBe(false);
  });
});

describe('undo/redo — readOnly / destroy posture', () => {
  it('readOnly: true — addTask/undo/redo all still work (unaffected by readOnly)', () => {
    const gantt = createGantt({ readOnly: true });
    gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    expect(gantt.canUndo()).toBe(true);
    expect(gantt.undo()).toBe(true);
    expect(gantt.getTasks()).toEqual([]);
    expect(gantt.redo()).toBe(true);
    expect(gantt.getTasks()).toHaveLength(1);
  });

  it('after destroy(): undo()/redo() throw; canUndo()/canRedo() return false without throwing', () => {
    const gantt = createGantt({});
    gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    gantt.destroy();

    expect(() => gantt.undo()).toThrow();
    expect(() => gantt.redo()).toThrow();
    expect(gantt.canUndo()).toBe(false);
    expect(gantt.canRedo()).toBe(false);
  });
});

describe('undo/redo — selection hygiene', () => {
  it('addTask(a), select(a), undo() removes a -> getSelection() no longer contains a, selection:changed fires', () => {
    const gantt = createGantt({});
    const task = gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    gantt.select(task.id);
    expect(gantt.getSelection()).toEqual([task.id]);

    const onSelectionChanged = vi.fn();
    gantt.on('selection:changed', onSelectionChanged);
    gantt.undo();

    expect(gantt.getSelection()).toEqual([]);
    expect(onSelectionChanged).toHaveBeenCalledWith([]);
  });

  it('symmetric case via redo() of a removeTask that had the task selected beforehand', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    gantt.select(toTaskId('a'));
    gantt.removeTask(toTaskId('a'));
    expect(gantt.getSelection()).toEqual([]);

    gantt.undo(); // restores a
    gantt.select(toTaskId('a'));
    expect(gantt.getSelection()).toEqual([toTaskId('a')]);

    const onSelectionChanged = vi.fn();
    gantt.on('selection:changed', onSelectionChanged);
    gantt.redo(); // removes a again

    expect(gantt.getSelection()).toEqual([]);
    expect(onSelectionChanged).toHaveBeenCalledWith([]);
  });
});

// --- Integration: grouped-entry correctness (spec §8.3) -------------------------------------

describe('undo/redo — cascade-grouped entry (integration)', () => {
  it('a moveTask that cascades 2 successors fires history:changed exactly once; a single undo()/redo() reverts/reapplies all 3', () => {
    const gantt = createGantt({
      schedulingMode: 'auto',
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-05T17:00', { duration: 8 }),
        taskInput('b', '2026-01-06T09:00', '2026-01-06T17:00', { duration: 8 }),
        taskInput('c', '2026-01-07T09:00', '2026-01-07T17:00', { duration: 8 }),
      ],
      dependencies: [
        { from: toTaskId('a'), to: toTaskId('b'), type: 'FS' },
        { from: toTaskId('b'), to: toTaskId('c'), type: 'FS' },
      ],
    });
    const before: Record<string, Task> = {
      a: gantt.getTask(toTaskId('a'))!,
      b: gantt.getTask(toTaskId('b'))!,
      c: gantt.getTask(toTaskId('c'))!,
    };

    const onHistory = vi.fn();
    gantt.on('history:changed', onHistory);

    gantt.moveTask(toTaskId('a'), '2026-01-09T09:00'); // pushes a well past b and c's current starts

    expect(onHistory).toHaveBeenCalledTimes(1); // ONE entry for the whole cascade-grouped move

    // Confirm the cascade actually shifted b and c (sanity — otherwise the "one undo reverts
    // all 3" assertion below would be vacuously true).
    expect(gantt.getTask(toTaskId('b'))).not.toEqual(before.b);
    expect(gantt.getTask(toTaskId('c'))).not.toEqual(before.c);

    const afterMove: Record<string, Task> = {
      a: gantt.getTask(toTaskId('a'))!,
      b: gantt.getTask(toTaskId('b'))!,
      c: gantt.getTask(toTaskId('c'))!,
    };

    expect(gantt.undo()).toBe(true);
    expect(gantt.getTask(toTaskId('a'))).toEqual(before.a);
    expect(gantt.getTask(toTaskId('b'))).toEqual(before.b);
    expect(gantt.getTask(toTaskId('c'))).toEqual(before.c);

    expect(gantt.redo()).toBe(true);
    expect(gantt.getTask(toTaskId('a'))).toEqual(afterMove.a);
    expect(gantt.getTask(toTaskId('b'))).toEqual(afterMove.b);
    expect(gantt.getTask(toTaskId('c'))).toEqual(afterMove.c);
  });
});
