// @vitest-environment jsdom
//
// Mounted golden event logs (spec-mutation-batching.md §8 item 1, PR 0): the same recorder as
// mutation-golden.test.ts, but on a chart with `mount()` + interaction, so the render effect's
// `critical-path:computed` shows up in the sequence and Delete-selected (keyboard) can be driven.
// Records TODAY's order on master 0109f02.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../helpers/create-gantt.js';
import type { GanttConfig } from '../../src/gantt.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import { createRecorder } from '../helpers/event-log.js';

const id = toTaskId;
function t(name: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: id(name), name, start, end, progress: 0, type: 'task', ...extra };
}
const tasks = (): TaskInput[] => [
  t('p', '2026-01-05T09:00', '2026-01-09T17:00', { type: 'summary' }),
  t('a', '2026-01-05T09:00', '2026-01-06T17:00', { parent: id('p') }),
  t('b', '2026-01-07T09:00', '2026-01-08T17:00', { parent: id('p') }),
  t('c', '2026-01-09T09:00', '2026-01-12T17:00'),
  t('d', '2026-01-13T09:00', '2026-01-14T17:00'),
];
const deps = [
  { from: id('a'), to: id('b'), type: 'FS' as const },
  { from: id('b'), to: id('c'), type: 'FS' as const },
  { from: id('c'), to: id('d'), type: 'FS' as const },
];

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

function setup(config: Partial<GanttConfig> = {}) {
  const rec = createRecorder();
  const gantt = createGantt({ tasks: tasks(), dependencies: deps, onTaskChange: rec.onTaskChange, ...config });
  gantt.mount(container);
  rec.attach(gantt);
  rec.clear();
  return { gantt, rec };
}
const auto = { schedulingMode: 'auto' } as const;

function pressDelete(taskId: string): void {
  container
    .querySelector(`.fg-timeline__row[data-task-id="${taskId}"]`)!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
}

describe('mounted golden event log (adds critical-path:computed from the render effect)', () => {
  it('moveTask in auto mode (the critical set does not change here, so no critical-path:computed)', () => {
    const { gantt, rec } = setup(auto);
    gantt.moveTask(id('b'), '2026-01-19T09:00');
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:moved b[2026-01-19T09:00..2026-01-20T17:00 p=0 parent=p] prevStart=2026-01-07T09:00",
        "onTaskChange b[2026-01-19T09:00..2026-01-20T17:00 p=0 parent=p] prev=[2026-01-07T09:00..2026-01-08T17:00 p=0]",
        "task:updated b[2026-01-19T09:00..2026-01-20T17:00 p=0 parent=p] changed=[end,start]",
        "task:moved c[2026-01-20T17:00..2026-01-22T17:00 p=0] prevStart=2026-01-09T09:00",
        "onTaskChange c[2026-01-20T17:00..2026-01-22T17:00 p=0] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0]",
        "task:updated c[2026-01-20T17:00..2026-01-22T17:00 p=0] changed=[end,start]",
        "task:moved d[2026-01-22T17:00..2026-01-26T17:00 p=0] prevStart=2026-01-13T09:00",
        "onTaskChange d[2026-01-22T17:00..2026-01-26T17:00 p=0] prev=[2026-01-13T09:00..2026-01-14T17:00 p=0]",
        "task:updated d[2026-01-22T17:00..2026-01-26T17:00 p=0] changed=[end,start]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('addTask / linkTasks / setProgress: critical-path:computed position relative to domain events', () => {
    const { gantt, rec } = setup();
    gantt.addTask(t('n', '2026-01-15T09:00', '2026-01-16T17:00'));
    rec.note('link');
    gantt.linkTasks(id('d'), id('n'));
    rec.note('setProgress');
    gantt.setProgress(id('n'), 0.25);
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "critical-path:computed ["n"]",
        "history:changed {"canUndo":true,"canRedo":false}",
        "task:added n[2026-01-15T09:00..2026-01-16T17:00 p=0]",
        "-- link",
        "critical-path:computed ["a","b","c","d","n"]",
        "history:changed {"canUndo":true,"canRedo":false}",
        "dependency:added d>n FS lag=0",
        "-- setProgress",
        "history:changed {"canUndo":true,"canRedo":false}",
        "task:progressed n[2026-01-15T09:00..2026-01-16T17:00 p=0.25] prev=0",
        "onTaskChange n[2026-01-15T09:00..2026-01-16T17:00 p=0.25] prev=[2026-01-15T09:00..2026-01-16T17:00 p=0]",
        "task:updated n[2026-01-15T09:00..2026-01-16T17:00 p=0.25] changed=[progress]",
      ]
    `);
  });

  it('removeTask of a subtree', () => {
    const { gantt, rec } = setup();
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gantt.removeTask(id('p'));
    // Before PR 1 each intermediate write repainted a store where a task was gone but its
    // dependencies were not yet (CPM threw "references a task that does not exist" and the render
    // effect logged it). The batched command paints only the final state.
    expect(warns).toHaveBeenCalledTimes(0);
    // At most one critical-path:computed, before the queued events.
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "critical-path:computed ["c","d"]",
        "history:changed {"canUndo":true,"canRedo":false}",
        "dependency:removed a>b FS lag=0",
        "dependency:removed b>c FS lag=0",
        "task:removed a",
        "task:removed b",
        "task:removed p",
      ]
    `);
  });

  it('undo / redo of a cascading move', () => {
    const { gantt, rec } = setup(auto);
    gantt.moveTask(id('b'), '2026-01-19T09:00');
    rec.clear();
    gantt.undo();
    rec.note('redo');
    gantt.redo();
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "task:moved d[2026-01-13T09:00..2026-01-14T17:00 p=0] prevStart=2026-01-22T17:00 {"source":"undo"}",
        "task:resized d[2026-01-13T09:00..2026-01-14T17:00 p=0] prevDuration=16 {"source":"undo"}",
        "onTaskChange d[2026-01-13T09:00..2026-01-14T17:00 p=0] prev=[2026-01-22T17:00..2026-01-26T17:00 p=0]",
        "task:updated d[2026-01-13T09:00..2026-01-14T17:00 p=0] changed=[end,start] {"source":"undo"}",
        "task:moved c[2026-01-09T09:00..2026-01-12T17:00 p=0] prevStart=2026-01-20T17:00 {"source":"undo"}",
        "task:resized c[2026-01-09T09:00..2026-01-12T17:00 p=0] prevDuration=16 {"source":"undo"}",
        "onTaskChange c[2026-01-09T09:00..2026-01-12T17:00 p=0] prev=[2026-01-20T17:00..2026-01-22T17:00 p=0]",
        "task:updated c[2026-01-09T09:00..2026-01-12T17:00 p=0] changed=[end,start] {"source":"undo"}",
        "task:moved b[2026-01-07T09:00..2026-01-08T17:00 p=0 parent=p] prevStart=2026-01-19T09:00 {"source":"undo"}",
        "onTaskChange b[2026-01-07T09:00..2026-01-08T17:00 p=0 parent=p] prev=[2026-01-19T09:00..2026-01-20T17:00 p=0]",
        "task:updated b[2026-01-07T09:00..2026-01-08T17:00 p=0 parent=p] changed=[end,start] {"source":"undo"}",
        "history:changed {"canUndo":false,"canRedo":true}",
        "-- redo",
        "task:moved b[2026-01-19T09:00..2026-01-20T17:00 p=0 parent=p] prevStart=2026-01-07T09:00 {"source":"redo"}",
        "onTaskChange b[2026-01-19T09:00..2026-01-20T17:00 p=0 parent=p] prev=[2026-01-07T09:00..2026-01-08T17:00 p=0]",
        "task:updated b[2026-01-19T09:00..2026-01-20T17:00 p=0 parent=p] changed=[end,start] {"source":"redo"}",
        "task:moved c[2026-01-20T17:00..2026-01-22T17:00 p=0] prevStart=2026-01-09T09:00 {"source":"redo"}",
        "task:resized c[2026-01-20T17:00..2026-01-22T17:00 p=0] prevDuration=16 {"source":"redo"}",
        "onTaskChange c[2026-01-20T17:00..2026-01-22T17:00 p=0] prev=[2026-01-09T09:00..2026-01-12T17:00 p=0]",
        "task:updated c[2026-01-20T17:00..2026-01-22T17:00 p=0] changed=[end,start] {"source":"redo"}",
        "task:moved d[2026-01-22T17:00..2026-01-26T17:00 p=0] prevStart=2026-01-13T09:00 {"source":"redo"}",
        "task:resized d[2026-01-22T17:00..2026-01-26T17:00 p=0] prevDuration=16 {"source":"redo"}",
        "onTaskChange d[2026-01-22T17:00..2026-01-26T17:00 p=0] prev=[2026-01-13T09:00..2026-01-14T17:00 p=0]",
        "task:updated d[2026-01-22T17:00..2026-01-26T17:00 p=0] changed=[end,start] {"source":"redo"}",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('duplicateTask of the selection', () => {
    const { gantt, rec } = setup();
    gantt.select([id('c'), id('d')]);
    rec.clear();
    gantt.duplicateTask();
    // ONE critical-path:computed with the final set, ahead of the queued task:added events.
    // (Placeholder numbering is by first appearance, so the last copy is task-#1.)
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "critical-path:computed ["task-#1"]",
        "task:added task-#2[2026-01-12T17:00..2026-01-14T17:00 p=0]",
        "task:added task-#1[2026-01-14T17:00..2026-01-16T17:00 p=0]",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('Delete-selected (keyboard) removes each selected id inside ONE history entry', () => {
    const { gantt, rec } = setup();
    gantt.select([id('a'), id('c')]);
    rec.clear();
    pressDelete('a');
    // ONE critical-path:computed (the final set) before the events.
    expect(gantt.getTasks().map((x) => x.id)).toEqual([id('p'), id('b'), id('d')]);
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "critical-path:computed ["d"]",
        "dependency:removed a>b FS lag=0",
        "task:removed a",
        "selection:changed ["c"]",
        "dependency:removed b>c FS lag=0",
        "dependency:removed c>d FS lag=0",
        "task:removed c",
        "selection:changed []",
        "history:changed {"canUndo":true,"canRedo":false}",
      ]
    `);
  });

  it('importJson over a mounted chart', () => {
    const { gantt, rec } = setup();
    gantt.select(id('a'));
    gantt.moveTask(id('c'), '2026-01-20T09:00');
    rec.clear();
    gantt.importJson({
      fluxgantt: { schemaVersion: '1.0' },
      tasks: [
        { id: 'x1', name: 'one', start: '2026-02-02T09:00', end: '2026-02-03T17:00', progress: 0, type: 'task' },
        { id: 'x2', name: 'two', start: '2026-02-04T09:00', end: '2026-02-05T17:00', progress: 0, type: 'task' },
      ],
      dependencies: [{ from: 'x1', to: 'x2', type: 'FS' }],
    });
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "critical-path:computed ["x1","x2"]",
        "selection:changed []",
        "history:changed {"canUndo":false,"canRedo":false}",
        "data:imported {"format":"json","taskCount":2,"dependencyCount":1}",
      ]
    `);
  });

  it('importCsv over a mounted chart', () => {
    const { gantt, rec } = setup();
    const csv = gantt.exportCsv();
    gantt.addTask(t('n', '2026-01-15T09:00', '2026-01-16T17:00'));
    rec.clear();
    gantt.importCsv(csv);
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "critical-path:computed ["d"]",
        "history:changed {"canUndo":false,"canRedo":false}",
        "data:imported {"format":"csv","taskCount":5,"dependencyCount":0}",
      ]
    `);
  });

  it('collapseAll', () => {
    const { gantt, rec } = setup();
    gantt.collapseAll();
    expect(rec.log).toMatchInlineSnapshot(`
      [
        "collapse:changed ["p"]",
      ]
    `);
  });
});
