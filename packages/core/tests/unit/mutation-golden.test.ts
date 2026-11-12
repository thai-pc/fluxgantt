// Golden event logs for every public mutation on master 0109f02 (spec-mutation-batching.md §8
// item 1, PR 0). Each test records the EXACT sequence of events + `onTaskChange` calls the
// mutation produces TODAY and asserts it. They are characterization tests: the later PRs of the
// mutation-batching task must keep them green, except where spec §4 lists an intentional change.
// Those spots carry a `TODO(spec-mutation-batching §4 ...)` marker.
//
// Headless (node environment). Mounted variants + Delete-selected live in
// mutation-golden-mounted.test.ts.
import { describe, it, expect } from 'vitest';
import { createGantt as createGanttBase, type GanttConfig } from '../../src/gantt.js';
import { withIo } from '../../src/io/mixin.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import { createRecorder } from '../helpers/event-log.js';

const id = toTaskId;
function t(name: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: id(name), name, start, end, progress: 0, type: 'task', ...extra };
}

/** p(summary) > a(summary) > a2, p > b; c root; d root. Deps a>b, b>c, a2>c (SS+4), c>d. */
function worldTasks(): TaskInput[] {
  return [
    t('p', '2026-01-05T09:00', '2026-01-09T17:00', { type: 'summary' }),
    t('a', '2026-01-05T09:00', '2026-01-06T17:00', { parent: id('p'), type: 'summary' }),
    t('a2', '2026-01-05T09:00', '2026-01-06T17:00', { parent: id('a') }),
    t('b', '2026-01-07T09:00', '2026-01-08T17:00', { parent: id('p') }),
    t('c', '2026-01-09T09:00', '2026-01-12T17:00'),
    t('d', '2026-01-13T09:00', '2026-01-14T17:00'),
  ];
}
const worldDeps = [
  { from: id('a'), to: id('b'), type: 'FS' as const },
  { from: id('b'), to: id('c'), type: 'FS' as const },
  { from: id('a2'), to: id('c'), type: 'SS' as const, lag: 4 },
  { from: id('c'), to: id('d'), type: 'FS' as const },
];

function chain(n: number) {
  const tasks: TaskInput[] = [];
  const dependencies: { from: ReturnType<typeof id>; to: ReturnType<typeof id>; type: 'FS' }[] = [];
  for (let i = 0; i < n; i++) {
    tasks.push(t(`k${i}`, '2026-01-05T09:00', '2026-01-05T17:00'));
    if (i > 0) dependencies.push({ from: id(`k${i - 1}`), to: id(`k${i}`), type: 'FS' });
  }
  return { tasks, dependencies };
}

function setup(config: Partial<GanttConfig> = {}) {
  const rec = createRecorder();
  const gantt = withIo(
    createGanttBase({
      tasks: worldTasks(),
      dependencies: worldDeps,
      onTaskChange: rec.onTaskChange,
      ...config,
    } as GanttConfig),
  );
  rec.attach(gantt);
  rec.clear();
  return { gantt, rec };
}
const auto = { schedulingMode: 'auto' } as const;

describe('golden event log: single-write mutations (history:changed fires BEFORE the domain event)', () => {
  it('addTask', () => {
    const { gantt, rec } = setup();
    gantt.addTask(t('n', '2026-01-15T09:00', '2026-01-16T17:00'));
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "history:changed {"canUndo":true,"canRedo":false}",
        "task:added n[2026-01-15T09:00..2026-01-16T17:00 p=0]",
      ]
    `);
  });

  it('linkTasks / unlinkTasks', () => {
    const { gantt, rec } = setup();
    gantt.linkTasks(id('p'), id('d'), 'FF', 2);
    rec.note('unlink');
    gantt.unlinkTasks(id('p'), id('d'));
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "history:changed {"canUndo":true,"canRedo":false}",
        "dependency:added p>d FF lag=2",
        "-- unlink",
        "history:changed {"canUndo":true,"canRedo":false}",
        "dependency:removed p>d FF lag=2",
      ]
    `);
  });

  it('unlinkTasks of a missing pair emits nothing', () => {
    const { gantt, rec } = setup();
    gantt.unlinkTasks(id('p'), id('d'));
    expect(rec.log).toEqual([]);
  });

  it('setProgress (onTaskChange fires after the domain event)', () => {
    const { gantt, rec } = setup();
    gantt.setProgress(id('c'), 0.5);
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "history:changed {"canUndo":true,"canRedo":false}",
        "task:progressed c[2026-01-09T09:00..2026-01-12T17:00 p=0.5] prev=0",
        "onTaskChange c[2026-01-09T09:00..2026-01-12T17:00 p=0.5] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0]",
      ]
    `);
  });
});

describe('golden event log: grouped mutations, manual scheduling (history:changed fires LAST)', () => {
  it('updateTask without schedule fields (name only)', () => {
    const { gantt, rec } = setup();
    gantt.updateTask(id('c'), { name: 'renamed' });
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "onTaskChange c[2026-01-09T09:00..2026-01-12T17:00 p=0] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('updateTask with schedule fields', () => {
    const { gantt, rec } = setup();
    gantt.updateTask(id('c'), { end: '2026-01-13T17:00' });
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:resized c[2026-01-09T09:00..2026-01-13T17:00 p=0] prevDuration=16",
        "onTaskChange c[2026-01-09T09:00..2026-01-13T17:00 p=0] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('moveTask (no cascade in manual mode)', () => {
    const { gantt, rec } = setup();
    gantt.moveTask(id('b'), '2026-01-20T09:00');
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:moved b[2026-01-20T09:00..2026-01-21T17:00 p=0 parent=p] prevStart=2026-01-07T09:00",
        "onTaskChange b[2026-01-20T09:00..2026-01-21T17:00 p=0 parent=p] prev=[2026-01-07T09:00..2026-01-08T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('resizeTask (no cascade in manual mode)', () => {
    const { gantt, rec } = setup();
    gantt.resizeTask(id('b'), 24);
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:resized b[2026-01-07T09:00..2026-01-09T17:00 p=0 parent=p] prevDuration=16",
        "onTaskChange b[2026-01-07T09:00..2026-01-09T17:00 p=0 parent=p] prev=[2026-01-07T09:00..2026-01-08T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });
});

describe("golden event log: cascade in schedulingMode 'auto'", () => {
  it('moveTask cascades through the graph: task:moved + onTaskChange per shift, history:changed once at the end', () => {
    const { gantt, rec } = setup(auto);
    gantt.moveTask(id('a2'), '2026-01-19T09:00');
    // TODO(spec-mutation-batching §4 item 1, PR 1): onTaskChange (and listeners) will observe
    // the final committed state, but the ORDER of entries below must not change.
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:moved a2[2026-01-19T09:00..2026-01-20T17:00 p=0 parent=a] prevStart=2026-01-05T09:00",
        "onTaskChange a2[2026-01-19T09:00..2026-01-20T17:00 p=0 parent=a] prev=[2026-01-05T09:00..2026-01-06T17:00 p=0]",
        "task:moved c[2026-01-19T13:00..2026-01-21T13:00 p=0] prevStart=2026-01-09T09:00",
        "onTaskChange c[2026-01-19T13:00..2026-01-21T13:00 p=0] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0]",
        "task:moved d[2026-01-21T13:00..2026-01-23T13:00 p=0] prevStart=2026-01-13T09:00",
        "onTaskChange d[2026-01-21T13:00..2026-01-23T13:00 p=0] prev=[2026-01-13T09:00..2026-01-14T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('resizeTask cascades to successors', () => {
    const { gantt, rec } = setup(auto);
    gantt.resizeTask(id('c'), 40);
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:resized c[2026-01-09T09:00..2026-01-15T17:00 p=0] prevDuration=16",
        "onTaskChange c[2026-01-09T09:00..2026-01-15T17:00 p=0] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0]",
        "task:moved d[2026-01-15T17:00..2026-01-19T17:00 p=0] prevStart=2026-01-13T09:00",
        "onTaskChange d[2026-01-15T17:00..2026-01-19T17:00 p=0] prev=[2026-01-13T09:00..2026-01-14T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('updateTask with a schedule patch cascades', () => {
    const { gantt, rec } = setup(auto);
    gantt.updateTask(id('b'), { end: '2026-01-15T17:00' });
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:resized b[2026-01-07T09:00..2026-01-15T17:00 p=0 parent=p] prevDuration=16",
        "onTaskChange b[2026-01-07T09:00..2026-01-15T17:00 p=0 parent=p] prev=[2026-01-07T09:00..2026-01-08T17:00 p=0]",
        "task:moved c[2026-01-15T17:00..2026-01-19T17:00 p=0] prevStart=2026-01-09T09:00",
        "onTaskChange c[2026-01-15T17:00..2026-01-19T17:00 p=0] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0]",
        "task:moved d[2026-01-19T17:00..2026-01-21T17:00 p=0] prevStart=2026-01-13T09:00",
        "onTaskChange d[2026-01-19T17:00..2026-01-21T17:00 p=0] prev=[2026-01-13T09:00..2026-01-14T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('moveTask earlier in auto mode', () => {
    const { gantt, rec } = setup(auto);
    gantt.moveTask(id('c'), '2026-01-06T09:00');
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:moved c[2026-01-06T09:00..2026-01-09T17:00 p=0] prevStart=2026-01-09T09:00",
        "onTaskChange c[2026-01-06T09:00..2026-01-09T17:00 p=0] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('moving the head of a 5-chain emits task:moved + onTaskChange pairs in chain order, history last', () => {
    const { tasks, dependencies } = chain(5);
    const { gantt, rec } = setup({ ...auto, tasks, dependencies });
    gantt.moveTask(id('k0'), '2026-01-12T09:00');
    expect(rec.log.map((l) => l.split(' ')[0])).toEqual([
      ...Array.from({ length: 5 }, () => ['task:moved', 'onTaskChange']).flat(),
      'history:changed',
    ]);
    expect(rec.log.filter((l) => l.startsWith('task:moved')).map((l) => l.split('[')[0]!.split(' ')[1])).toEqual([
      'k0',
      'k1',
      'k2',
      'k3',
      'k4',
    ]);
  });
});

describe('golden event log: removeTask', () => {
  it('leaf with dependencies: dependency:removed first, then task:removed', () => {
    const { gantt, rec } = setup();
    gantt.removeTask(id('d'));
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "history:changed {"canUndo":true,"canRedo":false}",
        "dependency:removed c>d FS lag=0",
        "task:removed d",
      ]
    `);
  });

  it('subtree (p > a > a2, b) with deps, selection and collapse pruning', () => {
    const { gantt, rec } = setup({ initialCollapsed: [id('p'), id('a')] });
    gantt.select([id('a2'), id('c')]);
    rec.clear();
    gantt.removeTask(id('p'));
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "history:changed {"canUndo":true,"canRedo":false}",
        "dependency:removed a2>c SS lag=4",
        "dependency:removed a>b FS lag=0",
        "dependency:removed b>c FS lag=0",
        "task:removed a2",
        "task:removed a",
        "task:removed b",
        "task:removed p",
        "selection:changed ["c"]",
        "collapse:changed []",
      ]
    `);
  });

  it('unknown id is a silent no-op', () => {
    const { gantt, rec } = setup();
    gantt.removeTask(id('nope'));
    expect(rec.log).toEqual([]);
  });
});

describe('golden event log: duplicateTask', () => {
  it('one task', () => {
    const { gantt, rec } = setup();
    gantt.duplicateTask(id('c'));
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:added task-#1[2026-01-12T17:00..2026-01-14T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('the selection (3 tasks): ONE history:changed after all task:added', () => {
    const { gantt, rec } = setup();
    gantt.select([id('b'), id('c'), id('d')]);
    rec.clear();
    gantt.duplicateTask();
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:added task-#1[2026-01-08T17:00..2026-01-12T17:00 p=0 parent=p]",
        "task:added task-#2[2026-01-12T17:00..2026-01-14T17:00 p=0]",
        "task:added task-#3[2026-01-14T17:00..2026-01-16T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });
});

describe('golden event log: undo / redo', () => {
  it('addTask', () => {
    const { gantt, rec } = setup();
    gantt.addTask(t('n', '2026-01-15T09:00', '2026-01-16T17:00'));
    rec.clear();
    gantt.undo();
    rec.note('redo');
    gantt.redo();
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:removed n {"source":"undo"}",
        "history:changed {"canUndo":false,"canRedo":true}",
        "-- redo",
        "task:added n[2026-01-15T09:00..2026-01-16T17:00 p=0] {"source":"redo"}",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('setProgress', () => {
    const { gantt, rec } = setup();
    gantt.setProgress(id('c'), 0.5);
    rec.clear();
    gantt.undo();
    rec.note('redo');
    gantt.redo();
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:progressed c[2026-01-09T09:00..2026-01-12T17:00 p=0] prev=0.5 {"source":"undo"}",
        "onTaskChange c[2026-01-09T09:00..2026-01-12T17:00 p=0] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0.5]",
        "history:changed {"canUndo":false,"canRedo":true}",
        "-- redo",
        "task:progressed c[2026-01-09T09:00..2026-01-12T17:00 p=0.5] prev=0 {"source":"redo"}",
        "onTaskChange c[2026-01-09T09:00..2026-01-12T17:00 p=0.5] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('linkTasks and unlinkTasks', () => {
    const { gantt, rec } = setup();
    gantt.linkTasks(id('p'), id('d'));
    gantt.unlinkTasks(id('c'), id('d'));
    rec.clear();
    gantt.undo();
    gantt.undo();
    rec.note('redo');
    gantt.redo();
    gantt.redo();
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "dependency:added c>d FS lag=0 {"source":"undo"}",
        "history:changed {"canUndo":true,"canRedo":true}",
        "dependency:removed p>d FS lag=0 {"source":"undo"}",
        "history:changed {"canUndo":false,"canRedo":true}",
        "-- redo",
        "dependency:added p>d FS lag=0 {"source":"redo"}",
        "history:changed {"canUndo":true,"canRedo":true}",
        "dependency:removed c>d FS lag=0 {"source":"redo"}",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('grouped op: a cascading moveTask is ONE entry (one history:changed per undo/redo)', () => {
    const { gantt, rec } = setup(auto);
    gantt.moveTask(id('a2'), '2026-01-19T09:00');
    rec.clear();
    gantt.undo();
    rec.note('redo');
    gantt.redo();
    // TODO(spec-mutation-batching §4 item 1, PR 1): listeners will see the final state; order stays.
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:moved d[2026-01-13T09:00..2026-01-14T17:00 p=0] prevStart=2026-01-21T13:00 {"source":"undo"}",
        "task:resized d[2026-01-13T09:00..2026-01-14T17:00 p=0] prevDuration=16 {"source":"undo"}",
        "onTaskChange d[2026-01-13T09:00..2026-01-14T17:00 p=0] prev=[2026-01-21T13:00..2026-01-23T13:00 p=0]",
        "task:moved c[2026-01-09T09:00..2026-01-12T17:00 p=0] prevStart=2026-01-19T13:00 {"source":"undo"}",
        "task:resized c[2026-01-09T09:00..2026-01-12T17:00 p=0] prevDuration=16 {"source":"undo"}",
        "onTaskChange c[2026-01-09T09:00..2026-01-12T17:00 p=0] prev=[2026-01-19T13:00..2026-01-21T13:00 p=0]",
        "task:moved a2[2026-01-05T09:00..2026-01-06T17:00 p=0 parent=a] prevStart=2026-01-19T09:00 {"source":"undo"}",
        "onTaskChange a2[2026-01-05T09:00..2026-01-06T17:00 p=0 parent=a] prev=[2026-01-19T09:00..2026-01-20T17:00 p=0]",
        "history:changed {"canUndo":false,"canRedo":true}",
        "-- redo",
        "task:moved a2[2026-01-19T09:00..2026-01-20T17:00 p=0 parent=a] prevStart=2026-01-05T09:00 {"source":"redo"}",
        "onTaskChange a2[2026-01-19T09:00..2026-01-20T17:00 p=0 parent=a] prev=[2026-01-05T09:00..2026-01-06T17:00 p=0]",
        "task:moved c[2026-01-19T13:00..2026-01-21T13:00 p=0] prevStart=2026-01-09T09:00 {"source":"redo"}",
        "task:resized c[2026-01-19T13:00..2026-01-21T13:00 p=0] prevDuration=16 {"source":"redo"}",
        "onTaskChange c[2026-01-19T13:00..2026-01-21T13:00 p=0] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0]",
        "task:moved d[2026-01-21T13:00..2026-01-23T13:00 p=0] prevStart=2026-01-13T09:00 {"source":"redo"}",
        "task:resized d[2026-01-21T13:00..2026-01-23T13:00 p=0] prevDuration=16 {"source":"redo"}",
        "onTaskChange d[2026-01-21T13:00..2026-01-23T13:00 p=0] prev=[2026-01-13T09:00..2026-01-14T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('grouped op: removeTask of a subtree with deps', () => {
    const { gantt, rec } = setup();
    gantt.removeTask(id('p'));
    rec.clear();
    gantt.undo();
    rec.note('redo');
    gantt.redo();
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:added p[2026-01-05T09:00..2026-01-09T17:00 p=0] {"source":"undo"}",
        "task:added b[2026-01-07T09:00..2026-01-08T17:00 p=0 parent=p] {"source":"undo"}",
        "task:added a[2026-01-05T09:00..2026-01-06T17:00 p=0 parent=p] {"source":"undo"}",
        "task:added a2[2026-01-05T09:00..2026-01-06T17:00 p=0 parent=a] {"source":"undo"}",
        "dependency:added b>c FS lag=0 {"source":"undo"}",
        "dependency:added a>b FS lag=0 {"source":"undo"}",
        "dependency:added a2>c SS lag=4 {"source":"undo"}",
        "history:changed {"canUndo":false,"canRedo":true}",
        "-- redo",
        "dependency:removed a2>c SS lag=4 {"source":"redo"}",
        "dependency:removed a>b FS lag=0 {"source":"redo"}",
        "dependency:removed b>c FS lag=0 {"source":"redo"}",
        "task:removed a2 {"source":"redo"}",
        "task:removed a {"source":"redo"}",
        "task:removed b {"source":"redo"}",
        "task:removed p {"source":"redo"}",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('grouped op: duplicateTask of the selection', () => {
    const { gantt, rec } = setup();
    gantt.select([id('b'), id('c')]);
    gantt.duplicateTask();
    rec.clear();
    gantt.undo();
    rec.note('redo');
    gantt.redo();
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:removed task-#2 {"source":"undo"}",
        "task:removed task-#1 {"source":"undo"}",
        "history:changed {"canUndo":false,"canRedo":true}",
        "-- redo",
        "task:added task-#1[2026-01-08T17:00..2026-01-12T17:00 p=0 parent=p] {"source":"redo"}",
        "task:added task-#2[2026-01-12T17:00..2026-01-14T17:00 p=0] {"source":"redo"}",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });
});

describe('golden event log: collapse', () => {
  it('toggleCollapse / collapseAll / expandAll emit collapse:changed only when the set changes', () => {
    const { gantt, rec } = setup();
    gantt.toggleCollapse(id('a'));
    rec.note('collapseAll');
    gantt.collapseAll();
    rec.note('collapseAll again (no-op)');
    gantt.collapseAll();
    rec.note('expandAll');
    gantt.expandAll();
    rec.note('expandAll again (no-op)');
    gantt.expandAll();
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "collapse:changed ["a"]",
        "-- collapseAll",
        "collapse:changed ["p","a"]",
        "-- collapseAll again (no-op)",
        "-- expandAll",
        "collapse:changed []",
        "-- expandAll again (no-op)",
      ]
    `);
  });
});

describe('golden event log: import', () => {
  const envelope = (n: string) => ({
    fluxgantt: { schemaVersion: '1.0' },
    tasks: [
      { id: `${n}1`, name: 'one', start: '2026-02-02T09:00', end: '2026-02-03T17:00', progress: 0, type: 'task' },
      { id: `${n}2`, name: 'two', start: '2026-02-04T09:00', end: '2026-02-05T17:00', progress: 0, type: 'task' },
    ],
    dependencies: [{ from: `${n}1`, to: `${n}2`, type: 'FS' }],
  });

  it('importJson over a populated instance with history and selection', () => {
    const { gantt, rec } = setup();
    gantt.moveTask(id('c'), '2026-01-20T09:00');
    gantt.select([id('a'), id('c')]);
    rec.clear();
    gantt.importJson(envelope('x'));
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "selection:changed []",
        "history:changed {"canUndo":false,"canRedo":false}",
        "data:imported {"format":"json","taskCount":2,"dependencyCount":1}",
      ]
    `);
  });

  it('importJson on a pristine instance (no history, no selection): only data:imported', () => {
    const rec = createRecorder();
    const gantt = withIo(createGanttBase({ onTaskChange: rec.onTaskChange }));
    rec.attach(gantt);
    gantt.importJson(envelope('y'));
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "data:imported {"format":"json","taskCount":2,"dependencyCount":1}",
      ]
    `);
  });

  it('importCsv over a populated instance', () => {
    const { gantt, rec } = setup();
    const csv = gantt.exportCsv();
    gantt.addTask(t('n', '2026-01-15T09:00', '2026-01-16T17:00'));
    gantt.select(id('n'));
    rec.clear();
    gantt.importCsv(csv);
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "selection:changed []",
        "history:changed {"canUndo":false,"canRedo":false}",
        "data:imported {"format":"csv","taskCount":6,"dependencyCount":0}",
      ]
    `);
  });

  it('a rejected import (cycle) emits nothing and leaves the stores untouched', () => {
    const { gantt, rec } = setup();
    const bad = envelope('z');
    bad.dependencies.push({ from: 'z2', to: 'z1', type: 'FS' });
    expect(() => gantt.importJson(bad)).toThrow();
    expect(rec.log).toEqual([]);
    expect(gantt.getTasks()).toHaveLength(6);
  });
});

describe('golden: listener-visible state (documents today; changes in PR 1)', () => {
  it("a 'task:moved' listener for the mover runs BEFORE the cascade shifts are written", () => {
    const { gantt } = setup(auto);
    const seenAtMover: string[] = [];
    gantt.on('task:moved', (task) => {
      if (task.id === id('a2')) seenAtMover.push(String(gantt.getTask(id('c'))!.start));
    });
    const before = String(gantt.getTask(id('c'))!.start);
    gantt.moveTask(id('a2'), '2026-01-19T09:00');
    // TODO(spec-mutation-batching §4 item 1): after PR 1 the mover's listener sees c ALREADY
    // shifted (final state), so this equality flips to `not.toBe(before)`.
    expect(seenAtMover).toEqual([before]);
    expect(String(gantt.getTask(id('c'))!.start)).not.toBe(before);
  });

  it('a throwing onTaskChange aborts the rest of the mutation today (cascade stops part-way)', () => {
    const calls: string[] = [];
    const { gantt } = setup({
      ...auto,
      onTaskChange: (next) => {
        calls.push(next.id);
        if (next.id === id('c')) throw new Error('boom');
      },
    });
    const dBefore = String(gantt.getTask(id('d'))!.start);
    expect(() => gantt.moveTask(id('b'), '2026-01-19T09:00')).toThrow('boom');
    // TODO(spec-mutation-batching §4 item 3): after PR 1 onTaskChange is queued, the remaining
    // events still fire and the first error is rethrown at the end.
    expect(calls).toEqual(['b', 'c']);
    expect(String(gantt.getTask(id('d'))!.start)).toBe(dBefore);
  });
});
