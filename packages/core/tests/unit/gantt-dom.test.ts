// @vitest-environment jsdom
//
// DOM facade tests (spec-gantt-facade.md §8.2) — mount()/unmount()/destroy(), the reactive
// store->render effect, and the drag-move -> task:moved wiring. Runs under jsdom (per-file
// override; the rest of core stays `environment: 'node'`), matching svg-renderer.test.ts /
// drag-move.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { toTaskId, type Task } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

// --- Minimal PointerEvent polyfill — jsdom@25.0.1 doesn't ship one (see drag-move.test.ts §8.1). ----
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId: number }) {
    super(type, init);
    this.pointerId = init.pointerId;
  }
}
const PointerEventCtor: typeof PointerEvent =
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
  (PointerEventPolyfill as unknown as typeof PointerEvent);

function dispatchPointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { pointerId: number; clientX: number; clientY: number; bubbles?: boolean },
): void {
  target.dispatchEvent(
    new PointerEventCtor(type, {
      pointerId: init.pointerId,
      clientX: init.clientX,
      clientY: init.clientY,
      bubbles: init.bubbles ?? false,
      cancelable: true,
    }),
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

describe('mount() — initial render', () => {
  it('renders into container (svg present, row/bar count matches config.tasks.length)', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
      ],
    });
    gantt.mount(container);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('.fg-task')).toHaveLength(2);
  });

  it('empty-config mount does not throw, renders an empty grid (item B)', () => {
    const gantt = createGantt({});
    expect(() => gantt.mount(container)).not.toThrow();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('.fg-task')).toHaveLength(0);
  });

  it('mounting with 0 tasks then adding the FIRST task does not throw (empty -> populated transition, regression)', () => {
    // Regression: `#renderNow` used to call `setTimeRange()` (whose `setOptions` triggers an
    // immediate `render()` against the renderer's STALE, still-empty internal task list)
    // BEFORE `handle.update()` had pushed the new task — `deriveTimeRange` throws when both
    // `timeRange` is unset AND `tasks` is empty. `#renderNow` must order the two calls so
    // the renderer's internal state is never observed with an unset `timeRange` and an
    // empty task list at the same time, in either transition direction.
    const gantt = createGantt({ tasks: [] });
    gantt.mount(container);
    expect(container.querySelectorAll('.fg-task')).toHaveLength(0);

    expect(() =>
      gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')),
    ).not.toThrow();
    expect(container.querySelectorAll('.fg-task')).toHaveLength(1);
  });

  it('removing the LAST task then adding a new one does not throw (populated -> empty -> populated, regression)', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);

    gantt.removeTask(toTaskId('a'));
    expect(container.querySelectorAll('.fg-task')).toHaveLength(0);

    expect(() =>
      gantt.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00')),
    ).not.toThrow();
    expect(container.querySelectorAll('.fg-task')).toHaveLength(1);
  });
});

describe('reactive re-render (the store -> render effect)', () => {
  it('a store mutation while mounted triggers a further render pass, without calling handle.update() directly', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    expect(container.querySelectorAll('.fg-task')).toHaveLength(1);

    gantt.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));

    expect(container.querySelectorAll('.fg-task')).toHaveLength(2);
  });

  it('removing every task down to zero does not throw and omits the critical path from that point on (0-task branch of §5.6)', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'), taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00')],
    });
    gantt.mount(container);
    expect(() => {
      gantt.removeTask(toTaskId('a'));
      gantt.removeTask(toTaskId('b'));
    }).not.toThrow();
    expect(container.querySelectorAll('.fg-task')).toHaveLength(0);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('drag commit -> facade event wiring', () => {
  function mountWithTask(options: Parameters<typeof createGantt>[0] = {}) {
    const gantt = createGantt({
      tasks: [taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00')],
      ...options,
    });
    gantt.mount(container);
    const groupEl = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    return { gantt, groupEl };
  }

  it('a drag gesture fires task:moved with the correct prevStart, and the store reflects the new start/end', () => {
    const { gantt, groupEl } = mountWithTask();
    const moved = vi.fn();
    gantt.on('task:moved', moved);
    const before = gantt.getTask(toTaskId('t1'))!;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    // pixelsPerDay(week) = 24 -> dx=48 => 2 days
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 148, clientY: 50 });

    expect(moved).toHaveBeenCalledTimes(1);
    const [task, prevStart] = moved.mock.calls[0] as [Task, unknown];
    expect(task.id).toBe('t1');
    expect(prevStart).toBe(before.start);

    const after = gantt.getTask(toTaskId('t1'))!;
    expect(after.start).not.toBe(before.start);
    expect(after.start.toString()).toContain('2026-01-07');
    expect(after.end.toString()).toContain('2026-01-09');
  });

  it("schedulingMode: 'auto' — a drag-move commit cascades: the dependent successor's task:moved fires (after the mover's own), and its stored start actually shifted (spec-cascade.md §9)", () => {
    const { gantt, groupEl } = mountWithTask({
      schedulingMode: 'auto',
      tasks: [
        taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00'),
        // t2 starts right after t1's original end — comfortably satisfied pre-drag, but the
        // drag below (t1 +2 days) pushes t1's end past t2's current start, violating the FS
        // link and forcing t2 to cascade.
        taskInput('t2', '2026-01-07T10:00', '2026-01-08T10:00'),
      ],
      dependencies: [{ from: toTaskId('t1'), to: toTaskId('t2'), type: 'FS' }],
    });
    const moved = vi.fn();
    gantt.on('task:moved', moved);
    const beforeT2 = gantt.getTask(toTaskId('t2'))!;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 }); // +2 days
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 148, clientY: 50 });

    const movedIds = moved.mock.calls.map((c) => (c[0] as Task).id);
    expect(movedIds[0]).toBe(toTaskId('t1')); // mover's own event fires first
    expect(movedIds).toContain(toTaskId('t2')); // then the cascaded successor

    const afterT2 = gantt.getTask(toTaskId('t2'))!;
    expect(afterT2.start).not.toBe(beforeT2.start);
  });

  it('readOnly: true — a synthetic drag never fires task:moved and never mutates the task', () => {
    const { gantt, groupEl } = mountWithTask({ readOnly: true });
    const moved = vi.fn();
    gantt.on('task:moved', moved);
    const before = gantt.getTask(toTaskId('t1'))!;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 148, clientY: 50 });

    expect(moved).not.toHaveBeenCalled();
    const after = gantt.getTask(toTaskId('t1'))!;
    expect(after.start).toBe(before.start);
    expect(after.end).toBe(before.end);
  });
});

describe('unmount() / remount()', () => {
  it('unmount() removes the <svg>; a subsequent mutation does not throw and does not touch the (absent) DOM', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    expect(container.querySelector('svg')).not.toBeNull();

    gantt.unmount();
    expect(container.querySelector('svg')).toBeNull();

    expect(() => gantt.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'))).not.toThrow();
    expect(container.children).toHaveLength(0);
  });

  it('mount() again after unmount() (remount) re-renders current state, including post-unmount mutations', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    gantt.unmount();
    gantt.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));

    gantt.mount(container);
    expect(container.querySelectorAll('.fg-task')).toHaveLength(2);
  });

  it('mount() called twice without an intervening unmount() (implicit remount, item A) leaves exactly one <svg>', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    const container2 = document.createElement('div');
    document.body.appendChild(container2);

    gantt.mount(container);
    gantt.mount(container2); // implicit remount into a different container

    expect(container.querySelectorAll('svg')).toHaveLength(0); // old mount torn down
    expect(container2.querySelectorAll('svg')).toHaveLength(1);

    container2.remove();
  });

  it('mount() called twice into the SAME container tears down the old <svg> first — no duplicate', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    gantt.mount(container);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});

describe('destroy() while mounted', () => {
  it('removes the <svg>; a drag mid-flight at the moment of destroy() leaves no leaked window pointer listeners', () => {
    const gantt = createGantt({ tasks: [taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00')] });
    gantt.mount(container);
    const groupEl = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    const moved = vi.fn();
    gantt.on('task:moved', moved);

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 });

    gantt.destroy();
    expect(container.children).toHaveLength(0);

    expect(() => {
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 300, clientY: 50 });
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 300, clientY: 50 });
    }).not.toThrow();
    expect(moved).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
  });
});

describe('refresh() — manual repaint escape hatch', () => {
  it('repaints without throwing while mounted; a no-op headless/post-destroy', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    expect(() => gantt.refresh()).not.toThrow(); // headless, never mounted
    gantt.mount(container);
    expect(() => gantt.refresh()).not.toThrow();
    gantt.destroy();
    expect(() => gantt.refresh()).not.toThrow();
  });
});

describe('click-select — mount() wiring (spec-selection.md §12.4)', () => {
  it('clicking a rendered .fg-task adds fg-task--selected after the reactive re-render, and getSelection() reflects it', () => {
    const gantt = createGantt({
      tasks: [taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00')],
    });
    gantt.mount(container);
    const groupEl = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    expect(groupEl.classList.contains('fg-task--selected')).toBe(false);

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50 });

    const groupElAfter = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    expect(groupElAfter.classList.contains('fg-task--selected')).toBe(true);
    expect(gantt.getSelection()).toEqual([toTaskId('t1')]);
  });

  it("selection:changed fires on a real click via gantt.on(...)", () => {
    const gantt = createGantt({
      tasks: [taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00')],
    });
    gantt.mount(container);
    const changed = vi.fn();
    gantt.on('selection:changed', changed);
    const groupEl = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50 });

    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith([toTaskId('t1')]);
  });

  it('readOnly: true — drag-move does NOT fire, but click-select STILL works (Q2 regression)', () => {
    const gantt = createGantt({
      tasks: [taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00')],
      readOnly: true,
    });
    gantt.mount(container);
    const moved = vi.fn();
    const changed = vi.fn();
    gantt.on('task:moved', moved);
    gantt.on('selection:changed', changed);
    const groupEl = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;

    // A drag (exceeds threshold) must not move the task under readOnly.
    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 200, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 200, clientY: 50 });
    expect(moved).not.toHaveBeenCalled();

    // A plain click still selects.
    const groupEl2 = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    dispatchPointer(groupEl2, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 2, clientX: 100, clientY: 50 });

    const groupElAfter = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    expect(groupElAfter.classList.contains('fg-task--selected')).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(gantt.getSelection()).toEqual([toTaskId('t1')]);
  });

  it('a task both critical AND selected renders BOTH classes, and the inline critical stroke/stroke-dasharray are unaffected by selection', () => {
    // Two independent, equal-length tasks → both are critical (each is its own zero-slack path).
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-05T17:00'),
        taskInput('b', '2026-01-05T09:00', '2026-01-05T17:00'),
      ],
    });
    gantt.mount(container);
    gantt.select(toTaskId('a'));

    const groupEl = container.querySelector('.fg-task[data-task-id="a"]') as SVGGElement;
    expect(groupEl.classList.contains('fg-task--critical')).toBe(true);
    expect(groupEl.classList.contains('fg-task--selected')).toBe(true);

    const bar = groupEl.querySelector('.fg-task__bar') as SVGRectElement;
    expect(bar.style.getPropertyValue('stroke-dasharray')).not.toBe('');
    expect(bar.style.getPropertyValue('stroke')).not.toBe('');
  });

  it('aria-label includes ", selected" when selected, ", critical path" when critical, both suffixes (critical then selected) when both', () => {
    // Independent (no dependencies) tasks: a task's own late-finish is bounded by the
    // GLOBAL projectEnd (see computeCriticalPath's backward pass), so the LONGER task ('a',
    // whose own end IS projectEnd) is critical (zero slack), while the SHORTER task ('b',
    // ending before projectEnd) has positive slack — not critical. A third, unselected task
    // ('c') stays neither critical nor selected, as a negative control.
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-05T17:00'), // 8h — drives projectEnd, critical
        taskInput('b', '2026-01-05T09:00', '2026-01-05T13:00'), // 4h — ends early, positive slack
        taskInput('c', '2026-01-05T09:00', '2026-01-05T11:00'), // 2h — unselected control
      ],
    });
    gantt.mount(container);
    gantt.select([toTaskId('a'), toTaskId('b')]);

    const critAndSelected = container.querySelector('.fg-task[data-task-id="a"]') as SVGGElement;
    expect(critAndSelected.classList.contains('fg-task--critical')).toBe(true);
    expect(critAndSelected.classList.contains('fg-task--selected')).toBe(true);
    expect(critAndSelected.getAttribute('aria-label')).toMatch(/critical path, selected$/);

    const selectedOnly = container.querySelector('.fg-task[data-task-id="b"]') as SVGGElement;
    expect(selectedOnly.classList.contains('fg-task--critical')).toBe(false);
    expect(selectedOnly.classList.contains('fg-task--selected')).toBe(true);
    expect(selectedOnly.getAttribute('aria-label')).toMatch(/, selected$/);
    expect(selectedOnly.getAttribute('aria-label')).not.toMatch(/critical path/);

    const neither = container.querySelector('.fg-task[data-task-id="c"]') as SVGGElement;
    expect(neither.classList.contains('fg-task--critical')).toBe(false);
    expect(neither.classList.contains('fg-task--selected')).toBe(false);
    expect(neither.getAttribute('aria-label')).not.toMatch(/selected/);
  });

  it('no aria-selected attribute is present anywhere (locks in the §8 decision)', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    gantt.mount(container);
    gantt.select(toTaskId('a'));

    const anyAriaSelected = container.querySelectorAll('[aria-selected]');
    expect(anyAriaSelected).toHaveLength(0);
  });
});

describe('critical-path:computed — emit-on-change from the render effect (fix #3)', () => {
  it('does not re-emit when a mutation leaves the critical set unchanged; re-emits when it changes', () => {
    // Two independent, equal-length tasks → both are critical (each is its own zero-slack path).
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-05T17:00'),
        taskInput('b', '2026-01-05T09:00', '2026-01-05T17:00'),
      ],
    });
    const computed = vi.fn();
    gantt.on('critical-path:computed', computed);
    gantt.mount(container); // effect runs once → 1 initial emit
    const afterMount = computed.mock.calls.length;
    expect(afterMount).toBe(1);

    // setProgress doesn't affect scheduling → critical set unchanged → NO re-emit
    // (the render effect still runs, but critical-path:computed is gated on change).
    gantt.setProgress(toTaskId('a'), 0.5);
    expect(computed.mock.calls.length).toBe(afterMount);

    // Adding a longer task makes it the sole critical task → critical set changes → re-emit.
    gantt.addTask(taskInput('c', '2026-01-05T09:00', '2026-01-08T17:00'));
    expect(computed.mock.calls.length).toBe(afterMount + 1);
    expect(computed.mock.lastCall?.[0]).toEqual([toTaskId('c')]);
  });
});
