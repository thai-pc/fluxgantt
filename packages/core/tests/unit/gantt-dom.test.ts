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
