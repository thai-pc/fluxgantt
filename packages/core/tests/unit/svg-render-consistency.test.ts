// @vitest-environment jsdom
//
// Stale-cache guards for the per-mount render memo (spec-svg-render-perf.md §10/§12 risk 1): the
// live DOM must always equal what a forced from-scratch repaint produces. `refresh()` drops the
// memo and recomputes everything, so `innerHTML` before and after it must be identical.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { batch } from '../../src/signals.js';
import { createGantt } from '../helpers/create-gantt.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const id = toTaskId;
function task(name: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: id(name), name, start, end, progress: 0.25, type: 'task', ...extra };
}
const tasks = (): TaskInput[] => [
  task('p', '2026-01-05T09:00', '2026-01-14T17:00', { type: 'summary' }),
  task('a', '2026-01-05T09:00', '2026-01-07T17:00', { parent: id('p') }),
  task('b', '2026-01-08T09:00', '2026-01-12T17:00', { parent: id('p') }),
  task('c', '2026-01-13T09:00', '2026-01-14T17:00'),
  task('d', '2026-01-15T09:00', '2026-01-19T17:00'),
];

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

type Gantt = ReturnType<typeof createGantt>;

/** The live DOM must equal a forced full recompute. */
function expectLiveEqualsFresh(gantt: Gantt, step: string): void {
  const live = container.innerHTML;
  gantt.refresh();
  expect(container.innerHTML, step).toBe(live);
}

describe('mount DOM equals refresh DOM (guards the first-paint skip, which relies on keyboard-nav starting at the first row unless something is selected: interaction/keyboard-nav.ts initial focus)', () => {
  const cases: Array<[string, (g: Gantt) => void, Parameters<typeof createGantt>[0]?]> = [
    ['plain', () => {}],
    ['select a middle row before mount', (g) => g.select(id('c'))],
    ['select the first row before mount', (g) => g.select(id('p'))],
    ['select a child hidden by initialCollapsed', (g) => g.select(id('a')), { tasks: tasks(), initialCollapsed: [id('p')] }],
    ['zoomTo before mount', (g) => g.zoomTo('day')],
    ['toggleCollapse before mount', (g) => g.toggleCollapse(id('p'))],
    ['everything config', (g) => g.select(id('b')), { tasks: tasks(), locale: 'de-DE', readOnly: true, initialCollapsed: [id('p')] }],
  ];
  it.each(cases)('%s', (_name, setup, config) => {
    const gantt = createGantt(config ?? { tasks: tasks() });
    setup(gantt);
    gantt.mount(container);
    expectLiveEqualsFresh(gantt, 'after mount');
  });
});

describe('live DOM equals a forced full repaint after every operation (stale-memo guard)', () => {
  it('update, link, unlink, undo, redo, batch, duplicate, remove, zoom, select, collapse, importJson', () => {
    const gantt = createGantt({ tasks: tasks() });
    gantt.mount(container);
    const steps: Array<[string, () => void]> = [
      ['update', () => gantt.updateTask(id('c'), { end: '2026-01-20T17:00' })],
      ['link', () => gantt.linkTasks(id('c'), id('d'), 'FS')],
      ['update after link', () => gantt.updateTask(id('d'), { start: '2026-01-25T09:00', end: '2026-01-26T17:00' })],
      ['unlink', () => gantt.unlinkTasks(id('c'), id('d'))],
      ['undo', () => gantt.undo()],
      ['undo', () => gantt.undo()],
      ['redo', () => gantt.redo()],
      ['batch(update + select)', () =>
        batch(() => {
          gantt.updateTask(id('a'), { name: 'renamed' });
          gantt.select(id('a'));
        })],
      ['duplicate', () => gantt.duplicateTask(id('c'))],
      ['zoom', () => gantt.zoomTo('month')],
      ['select all', () => gantt.selectAll()],
      ['collapse', () => gantt.toggleCollapse(id('p'))],
      ['expand', () => gantt.toggleCollapse(id('p'))],
      ['remove', () => gantt.removeTask(id('d'))],
      ['undo remove', () => gantt.undo()],
      ['importJson', () => {
        const json = JSON.stringify({
          schemaVersion: 1,
          tasks: [task('x', '2026-02-02T09:00', '2026-02-06T17:00'), task('y', '2026-02-09T09:00', '2026-02-13T17:00')],
          dependencies: [],
        });
        gantt.importJson(json);
      }],
    ];
    for (const [name, run] of steps) {
      run();
      expectLiveEqualsFresh(gantt, name);
    }
  });
});
