// Stack-safety characterization (spec-mutation-batching.md §0 last row, PR 0). Two recursive
// traversals overflow the call stack on a long chain on master 0109f02. Both are marked
// `it.fails`: the assertion states the DESIRED behaviour, vitest reports the test as passing only
// while it still fails today, and PR 2 / PR 3 (iterative remove / Kahn `hasCycle`) must flip each
// to a plain `it`.
import { describe, it, expect } from 'vitest';
import { DependencyStore } from '../../src/store/dependency-store.js';
import { TaskStore } from '../../src/store/task-store.js';
import { toDependencyId, toTaskId, type Dependency, type Task } from '../../src/types.js';

describe('recursion hazards (documented, fixed by the indexed-store PRs)', () => {
  // TODO(spec-mutation-batching §5/§6, PR 3): turn into a plain `it` once hasCycle() is iterative.
  it.fails('hasCycle() on a 100k-edge chain does not throw RangeError (recursive 3-colour DFS today)', () => {
    const edges: Dependency[] = Array.from({ length: 100_000 }, (_, i) => ({
      id: toDependencyId(`d${i}`),
      from: toTaskId(`n${i}`),
      to: toTaskId(`n${i + 1}`),
      type: 'FS',
      lag: 0,
    }));
    const store = new DependencyStore(edges); // the constructor takes edges verbatim: no per-edge validation
    expect(store.hasCycle()).toBe(false);
  });

  it('the failure mode is specifically a RangeError (stack overflow), not a wrong answer', () => {
    const edges: Dependency[] = Array.from({ length: 100_000 }, (_, i) => ({
      id: toDependencyId(`d${i}`),
      from: toTaskId(`n${i}`),
      to: toTaskId(`n${i + 1}`),
      type: 'FS',
      lag: 0,
    }));
    expect(() => new DependencyStore(edges).hasCycle()).toThrow(RangeError);
  });

  // TaskStore.remove() recurses once per hierarchy level (the constructor path has no depth
  // limit; import caps depth at 100).
  it('TaskStore.remove() of a 15k-deep parent chain does not throw RangeError', () => {
    const tasks: Task[] = Array.from({ length: 15_000 }, (_, i) => ({
      id: toTaskId(`t${i}`),
      name: `t${i}`,
      start: '2026-01-05T09:00',
      end: '2026-01-05T17:00',
      progress: 0,
      type: 'task',
      ...(i > 0 ? { parent: toTaskId(`t${i - 1}`) } : {}),
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));
    const store = new TaskStore(tasks);
    store.remove(toTaskId('t0'));
    expect(store.size).toBe(0);
  });
});
