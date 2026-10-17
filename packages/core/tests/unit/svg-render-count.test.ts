// @vitest-environment jsdom
//
// Redundant-work tripwires for the mounted SVG chart (spec-svg-render-perf.md, PR 1): how many
// full `render()` passes one operation causes, and how many times the critical path is
// recomputed. Counting calls instead of timing them keeps these deterministic on any machine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../helpers/create-gantt.js';
import { getInternal } from '../../src/gantt-internal.js';
import { computeRollup } from '../../src/compute/rollup.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import * as criticalPath from '../../src/compute/critical-path.js';

vi.mock('../../src/compute/critical-path.js', async (importOriginal) => {
  const actual = await importOriginal<typeof criticalPath>();
  return { ...actual, computeCriticalPath: vi.fn(actual.computeCriticalPath) };
});

const id = toTaskId;
function task(name: string, extra: Partial<TaskInput> = {}): TaskInput {
  return {
    id: id(name),
    name,
    start: '2026-01-05T09:00',
    end: '2026-01-07T17:00',
    progress: 0,
    type: 'task',
    ...extra,
  };
}

const tasks: TaskInput[] = [
  task('p', { type: 'summary' }),
  task('a', { parent: id('p') }),
  task('b', { parent: id('p'), start: '2026-01-08T09:00', end: '2026-01-12T17:00' }),
  task('c', { start: '2026-01-13T09:00', end: '2026-01-14T17:00' }),
];

let container: HTMLElement;
/** Full `render()` passes: every one appends exactly one `<defs>` arrowhead marker first. */
let renders = 0;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  renders = 0;
  const realAppend = Element.prototype.append;
  vi.spyOn(Element.prototype, 'append').mockImplementation(function (
    this: Element,
    ...nodes: Array<Node | string>
  ) {
    if (this.classList.contains('fg-timeline') && (nodes[0] as Element | undefined)?.nodeName === 'defs') {
      renders++;
    }
    realAppend.apply(this, nodes);
  });
  vi.mocked(criticalPath.computeCriticalPath).mockClear();
});

afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

const cpmCalls = (): number => vi.mocked(criticalPath.computeCriticalPath).mock.calls.length;

function mounted(config: Partial<Parameters<typeof createGantt>[0]> = {}) {
  const gantt = createGantt({ tasks, ...config });
  gantt.mount(container);
  return gantt;
}

describe('render count: one render per operation', () => {
  it('mount paints once and computes the critical path once', () => {
    mounted();
    expect(renders).toBe(1);
    expect(cpmCalls()).toBe(1);
  });

  it('the first paint already shows the critical path (no second paint adds it)', () => {
    mounted({ tasks: [task('a'), task('b', { start: '2026-01-08T09:00', end: '2026-01-09T17:00' })] });
    expect(container.querySelectorAll('.fg-task--critical').length).toBeGreaterThan(0);
  });

  it('an initially selected row (focus differs from the painted first row) still gets its repaint', () => {
    const gantt = createGantt({ tasks });
    gantt.select(id('c'));
    gantt.mount(container);
    expect(renders).toBe(2);
    expect(container.querySelector('[data-task-id="c"].fg-timeline__row')?.getAttribute('tabindex')).toBe('0');
  });

  it('zoomTo, collapse, expand and select each repaint once and never recompute the critical path', () => {
    const gantt = mounted();
    renders = 0;
    gantt.zoomTo('month');
    expect(renders).toBe(1);
    gantt.toggleCollapse(id('p'));
    expect(renders).toBe(2);
    gantt.toggleCollapse(id('p'));
    expect(renders).toBe(3);
    gantt.select(id('c'));
    expect(renders).toBe(4);
    gantt.selectAll();
    expect(renders).toBe(5);
    expect(cpmCalls()).toBe(1); // the mount's, nothing since
  });

  it('every data mutation repaints once and recomputes the critical path once', () => {
    // removeTask() below transiently leaves a dependency pointing at a removed task (pre-existing,
    // swallowed with a warning by the reactive render).
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gantt = mounted();
    renders = 0;
    vi.mocked(criticalPath.computeCriticalPath).mockClear();
    gantt.updateTask(id('c'), { name: 'renamed' });
    expect([renders, cpmCalls()]).toEqual([1, 1]);
    gantt.addTask(task('d', { start: '2026-01-15T09:00', end: '2026-01-16T17:00' }));
    expect([renders, cpmCalls()]).toEqual([2, 2]);
    gantt.linkTasks(id('c'), id('d'), 'FS');
    expect([renders, cpmCalls()]).toEqual([3, 3]);
    // removeTask drops the link and then the task: two store mutations, two repaints (pre-existing,
    // unbatched). The invariant is that no repaint recomputes twice or skips the recompute.
    gantt.removeTask(id('d'));
    expect(renders).toBe(cpmCalls());
    gantt.undo();
    expect(renders).toBe(cpmCalls());
    expect(renders).toBeGreaterThanOrEqual(5);
  });

  it('refresh() repaints once and DOES recompute (the recompute-everything escape hatch)', () => {
    const gantt = mounted();
    renders = 0;
    vi.mocked(criticalPath.computeCriticalPath).mockClear();
    gantt.refresh();
    expect([renders, cpmCalls()]).toEqual([1, 1]);
  });

  it('an empty chart mounts, gains its first task and loses it again without throwing', () => {
    const gantt = mounted({ tasks: [] });
    expect(renders).toBe(1);
    gantt.addTask(task('a'));
    expect(container.querySelectorAll('.fg-task').length).toBe(1);
    gantt.removeTask(id('a'));
    expect(container.querySelectorAll('.fg-task').length).toBe(0);
  });
});

describe('memoized derived data stays correct', () => {
  it('a selection or collapse change keeps the critical path painted and does not rerun the rollup', () => {
    const rollup = vi.fn(computeRollup);
    const gantt = mounted({ rollup });
    const rollupCalls = rollup.mock.calls.length;
    const critical = container.querySelectorAll('.fg-task--critical').length;
    expect(critical).toBeGreaterThan(0);
    gantt.select(id('c'));
    gantt.toggleCollapse(id('p'));
    expect(rollup.mock.calls.length).toBe(rollupCalls); // rollup follows tasks, not selection
    expect(container.querySelector('[data-task-id="a"]')).toBeNull(); // collapsed child gone
    expect(container.querySelectorAll('.fg-task--critical').length).toBeGreaterThan(0);
    gantt.updateTask(id('c'), { name: 'x' });
    expect(rollup.mock.calls.length).toBe(rollupCalls + 1);
  });
});

describe('critical-path:computed', () => {
  it('fires once on mount, BEFORE renderer:selected, and only again when the critical set changes', () => {
    const gantt = createGantt({ tasks });
    const order: string[] = [];
    gantt.on('critical-path:computed', () => order.push('critical'));
    gantt.on('renderer:selected', () => order.push('selected'));
    gantt.mount(container);
    expect(order).toEqual(['critical', 'selected']);
    gantt.zoomTo('month');
    gantt.select(id('c'));
    gantt.toggleCollapse(id('p'));
    expect(order).toEqual(['critical', 'selected']);
    gantt.addTask(task('z', { start: '2026-02-02T09:00', end: '2026-02-20T17:00' }));
    expect(order).toEqual(['critical', 'selected', 'critical']);
    gantt.updateTask(id('z'), { name: 'zz' }); // a rename cannot change which tasks are critical
    expect(order).toEqual(['critical', 'selected', 'critical']);
  });

  it('a throwing listener does not wedge later repaints', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gantt = createGantt({ tasks });
    gantt.on('critical-path:computed', () => {
      throw new Error('boom');
    });
    expect(() => gantt.mount(container)).not.toThrow();
    expect(() => gantt.zoomTo('month')).not.toThrow();
  });
});

describe('cyclic dependency graph', () => {
  it('warns once per data revision, not once per repaint', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gantt = createGantt({ tasks });
    const { deps: dependencyStore } = getInternal(gantt);
    dependencyStore.link(id('a'), id('b'), 'FS');
    dependencyStore.link(id('b'), id('a'), 'FS', { allowCycle: true });
    gantt.mount(container);
    const cycleWarnings = (): number =>
      warn.mock.calls.filter((c) => String(c[0]).includes('computeCriticalPath failed')).length;
    expect(cycleWarnings()).toBe(1);
    gantt.zoomTo('month');
    gantt.select(id('c'));
    gantt.toggleCollapse(id('p'));
    expect(cycleWarnings()).toBe(1);
    gantt.updateTask(id('c'), { name: 'again' });
    expect(cycleWarnings()).toBe(2);
    expect(container.querySelector('.fg-task')).not.toBeNull(); // still painted, without a path
  });
});
