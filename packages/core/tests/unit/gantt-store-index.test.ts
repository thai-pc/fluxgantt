// Gantt-level pins for the indexed stores (spec-mutation-batching PR 2/3 review): the deep-chain
// removal path through `removeTask` + `undo`, and the `task:removed` order after a re-parent.
import { describe, it, expect } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const id = toTaskId;
const t = (name: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: id(name),
  name,
  start: '2026-01-05T09:00',
  end: '2026-01-05T17:00',
  progress: 0,
  type: 'task',
  ...extra,
});

describe('indexed stores through Gantt', () => {
  it('removeTask + undo + redo on a 20k-deep parent chain does not overflow the stack', () => {
    const n = 20_000;
    const tasks = Array.from({ length: n }, (_, i) => t(`t${i}`, i > 0 ? { parent: id(`t${i - 1}`) } : {}));
    const gantt = createGantt({ tasks });
    const removed: string[] = [];
    gantt.on('task:removed', (taskId) => removed.push(taskId));
    gantt.removeTask(id('t0'));
    expect(gantt.getTasks()).toHaveLength(0);
    expect(removed).toHaveLength(n);
    expect(removed[0]).toBe(`t${n - 1}`); // deepest first
    expect(removed[n - 1]).toBe('t0');
    gantt.undo();
    expect(gantt.getTasks()).toHaveLength(n);
    expect(gantt.getTasks().filter((x) => x.parent === id('t5')).map((x) => x.id)).toEqual([id('t6')]);
    gantt.redo();
    expect(gantt.getTasks()).toHaveLength(0);
  });

  it('task:removed follows global insertion order of siblings, also after a re-parent', () => {
    // x is created BEFORE a and b, then moved under P: P's children in insertion order are x, a, b.
    const gantt = createGantt({
      tasks: [t('P'), t('Q'), t('x', { parent: id('Q') }), t('a', { parent: id('P') }), t('b', { parent: id('P') })],
    });
    gantt.updateTask(id('x'), { parent: id('P') });
    expect(gantt.getTasks().filter((k) => k.parent === id('P')).map((k) => k.id)).toEqual(['x', 'a', 'b']);
    const removed: string[] = [];
    gantt.on('task:removed', (taskId) => removed.push(taskId));
    gantt.removeTask(id('P'));
    expect(removed).toEqual(['x', 'a', 'b', 'P']);
    gantt.undo();
    expect(gantt.getTasks().map((k) => k.id)).toEqual(expect.arrayContaining(['P', 'Q', 'x', 'a', 'b']));
  });
});
