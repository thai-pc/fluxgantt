import { describe, it, expect } from 'vitest';
import { TaskStore } from '../../src/store/task-store.js';
import { effect } from '../../src/signals.js';
import type { TaskInput } from '../../src/store/task-store.js';

const base: TaskInput = {
  name: 'Task',
  start: '2026-01-01',
  end: '2026-01-02',
  progress: 0,
  type: 'task',
};

describe('TaskStore — CRUD', () => {
  it('add generates id + timestamps and stores the task', () => {
    const store = new TaskStore();
    const t = store.add(base);
    expect(t.id).toMatch(/^task-/);
    expect(t.createdAt).toBeInstanceOf(Date);
    expect(store.size).toBe(1);
    expect(store.get(t.id)).toEqual(t);
  });

  it('add respects a provided id', () => {
    const store = new TaskStore();
    const t = store.add({ ...base, id: 'task-fixed' as never });
    expect(t.id).toBe('task-fixed');
  });

  it('update merges the patch and bumps updatedAt, keeping createdAt', () => {
    const store = new TaskStore();
    const t = store.add(base);
    const updated = store.update(t.id, { name: 'Renamed', progress: 0.5 });
    expect(updated.name).toBe('Renamed');
    expect(updated.progress).toBe(0.5);
    expect(updated.createdAt).toEqual(t.createdAt);
  });

  it('update throws for a non-existent task', () => {
    const store = new TaskStore();
    expect(() => store.update('task-x' as never, { name: 'x' })).toThrow();
  });

  it('remove deletes the task', () => {
    const store = new TaskStore();
    const t = store.add(base);
    store.remove(t.id);
    expect(store.has(t.id)).toBe(false);
    expect(store.size).toBe(0);
  });
});

describe('TaskStore — restore (history-replay support)', () => {
  it('inserts the exact object verbatim (same reference reachable via get), does not touch createdAt/updatedAt, bumps revision', () => {
    const store = new TaskStore();
    const original = store.add(base);
    store.remove(original.id);
    let runs = 0;
    const stop = effect(() => {
      void store.revision.value;
      runs++;
    });
    const before = runs;

    const restored = store.restore(original);

    expect(restored).toBe(original);
    expect(store.get(original.id)).toBe(original);
    expect(store.get(original.id)!.createdAt).toEqual(original.createdAt);
    expect(store.get(original.id)!.updatedAt).toEqual(original.updatedAt);
    expect(runs).toBeGreaterThan(before);
    stop();
  });

  it('can overwrite an id that currently does not exist (re-adding after a remove)', () => {
    const store = new TaskStore();
    const t = store.add(base);
    store.remove(t.id);
    expect(store.has(t.id)).toBe(false);
    expect(() => store.restore(t)).not.toThrow();
    expect(store.get(t.id)).toBe(t);
  });

  it('can overwrite an id that currently exists (idempotent overwrite)', () => {
    const store = new TaskStore();
    const t = store.add(base);
    expect(() => store.restore(t)).not.toThrow();
    expect(store.get(t.id)).toBe(t);
    expect(store.size).toBe(1);
  });
});

describe('TaskStore — hierarchy', () => {
  it('children + roots classify by parent', () => {
    const store = new TaskStore();
    const parent = store.add({ ...base, type: 'summary', name: 'Parent' });
    const child = store.add({ ...base, name: 'Child', parent: parent.id });
    expect(store.children(parent.id).map((t) => t.id)).toEqual([child.id]);
    expect(store.roots().map((t) => t.id)).toEqual([parent.id]);
  });

  it('remove cascade-deletes descendants', () => {
    const store = new TaskStore();
    const parent = store.add({ ...base, type: 'summary' });
    const child = store.add({ ...base, parent: parent.id });
    store.add({ ...base, parent: child.id }); // grandchild
    expect(store.size).toBe(3);
    store.remove(parent.id);
    expect(store.size).toBe(0);
  });
});

describe('TaskStore — reactivity', () => {
  it('effect re-runs when the store changes via the revision signal', () => {
    const store = new TaskStore();
    let runs = 0;
    const stop = effect(() => {
      const _ = store.size;
      runs++;
    });
    expect(runs).toBe(1);
    const t = store.add(base);
    expect(runs).toBe(2);
    store.update(t.id, { progress: 1 });
    expect(runs).toBe(3);
    store.remove(t.id);
    expect(runs).toBe(4);
    stop();
    store.add(base);
    expect(runs).toBe(4);
  });
});
