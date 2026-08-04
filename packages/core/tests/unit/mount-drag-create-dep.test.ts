// @vitest-environment jsdom
//
// Facade wiring — `mount()`'s `enableDragCreateDep` → `#commitCreateDep` → `linkTasks()`
// pipeline (spec-drag-create-dependency.md §2, §9 "mount-drag-create-dep.test.ts"). Runs
// under jsdom (per-file override; the rest of core stays `environment: 'node'`), mirroring
// `mount-drag-resize.test.ts`'s `PointerEventCtor` polyfill + `mountWithTask()` helper.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { toTaskId, type Dependency, type Task } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

// --- Minimal PointerEvent polyfill — jsdom doesn't ship one (see drag-move.test.ts §8.1). ----
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

function handleEl(groupEl: Element, end: 'start' | 'end'): SVGCircleElement {
  return groupEl.querySelector(`.fg-task__link-handle[data-handle-end="${end}"]`) as SVGCircleElement;
}

function handleCoords(el: SVGCircleElement): { cx: number; cy: number } {
  return { cx: Number(el.getAttribute('cx')), cy: Number(el.getAttribute('cy')) };
}

describe('drag-create-dep — facade event wiring', () => {
  function mountWithTasks(options: Parameters<typeof createGantt>[0] = {}) {
    const gantt = createGantt({
      tasks: [
        taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00'),
        taskInput('t2', '2026-01-10T09:00', '2026-01-12T09:00'),
      ],
      ...options,
    });
    gantt.mount(container);
    const groupEl1 = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    const groupEl2 = container.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;
    return { gantt, groupEl1, groupEl2 };
  }

  function dragLink(groupFrom: Element, groupTo: Element, endpoint: 'start' | 'end' = 'end'): void {
    const h = handleEl(groupFrom, endpoint);
    const { cx, cy } = handleCoords(h);
    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    dispatchPointer(groupTo, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy, bubbles: true });
  }

  it('a valid drag from A to B fires dependency:added with an FS, lag 0 dependency; getDependencies reflects it', () => {
    const { gantt, groupEl1, groupEl2 } = mountWithTasks();
    const added = vi.fn();
    gantt.on('dependency:added', added);

    dragLink(groupEl1, groupEl2);

    expect(added).toHaveBeenCalledTimes(1);
    const [dep] = added.mock.calls[0] as [Dependency];
    expect(dep.from).toBe(toTaskId('t1'));
    expect(dep.to).toBe(toTaskId('t2'));
    expect(dep.type).toBe('FS');
    expect(dep.lag).toBe(0);

    const deps = gantt.getDependencies();
    expect(deps).toHaveLength(1);
    expect(deps[0]!.from).toBe(toTaskId('t1'));
    expect(deps[0]!.to).toBe(toTaskId('t2'));
  });

  it('cycle rejection: pre-linking B→A then dragging A onto B does not throw, emits no dependency:added, store unchanged', () => {
    const { gantt, groupEl1, groupEl2 } = mountWithTasks({
      dependencies: [{ from: toTaskId('t2'), to: toTaskId('t1'), type: 'FS' }],
    });
    const added = vi.fn();
    gantt.on('dependency:added', added);
    const before = gantt.getDependencies();

    expect(() => dragLink(groupEl1, groupEl2)).not.toThrow();

    expect(added).not.toHaveBeenCalled();
    expect(gantt.getDependencies()).toHaveLength(before.length);
  });

  it('duplicate-pair rejection: pre-linking A→B FS then dragging A onto B again does not throw, emits no dependency:added, store unchanged', () => {
    const { gantt, groupEl1, groupEl2 } = mountWithTasks({
      dependencies: [{ from: toTaskId('t1'), to: toTaskId('t2'), type: 'FS' }],
    });
    const added = vi.fn();
    gantt.on('dependency:added', added);
    const before = gantt.getDependencies();

    expect(() => dragLink(groupEl1, groupEl2)).not.toThrow();

    expect(added).not.toHaveBeenCalled();
    expect(gantt.getDependencies()).toHaveLength(before.length);
  });

  it('self-drop: dragging a handle back onto its own task never fires dependency:added, never throws', () => {
    const { gantt, groupEl1 } = mountWithTasks();
    const added = vi.fn();
    gantt.on('dependency:added', added);

    expect(() => dragLink(groupEl1, groupEl1)).not.toThrow();

    expect(added).not.toHaveBeenCalled();
    expect(gantt.getDependencies()).toHaveLength(0);
  });

  it('empty-space drop: dragging a handle onto window never fires dependency:added, never throws', () => {
    const { gantt, groupEl1 } = mountWithTasks();
    const added = vi.fn();
    gantt.on('dependency:added', added);
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    expect(() => {
      dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy });
    }).not.toThrow();

    expect(added).not.toHaveBeenCalled();
    expect(gantt.getDependencies()).toHaveLength(0);
  });

  it('readOnly: true — connector handles are NOT rendered and no drag can create a dependency', () => {
    const { gantt, groupEl1, groupEl2 } = mountWithTasks({ readOnly: true });
    const added = vi.fn();
    gantt.on('dependency:added', added);

    // A readOnly chart must not render the (interactive) handles at all — they'd be a
    // misleading dead affordance since the recognizer is never wired (review B2). With no
    // handle there is nothing to grab, so a link is impossible by construction.
    expect(groupEl1.querySelectorAll('.fg-task__link-handle')).toHaveLength(0);

    // Even a full pointer drag from t1's bar body onto t2 creates nothing (the recognizer is
    // gated off when readOnly).
    const barEl = groupEl1.querySelector('.fg-task__bar')!;
    const bx = Number(barEl.getAttribute('x'));
    dispatchPointer(groupEl1, 'pointerdown', { pointerId: 1, clientX: bx, clientY: 40, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: bx, clientY: 80 });
    dispatchPointer(groupEl2, 'pointerup', { pointerId: 1, clientX: bx, clientY: 80, bubbles: true });

    expect(added).not.toHaveBeenCalled();
    expect(gantt.getDependencies()).toHaveLength(0);
  });

  it('hierarchy edge case: linking a parent to its own child is allowed, no special-case', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('parent', '2026-01-05T09:00', '2026-01-12T09:00'),
        taskInput('child', '2026-01-05T09:00', '2026-01-07T09:00', { parent: toTaskId('parent') }),
      ],
    });
    gantt.mount(container);
    const groupParent = container.querySelector('.fg-task[data-task-id="parent"]') as SVGGElement;
    const groupChild = container.querySelector('.fg-task[data-task-id="child"]') as SVGGElement;
    const added = vi.fn();
    gantt.on('dependency:added', added);

    dragLink(groupParent, groupChild);

    expect(added).toHaveBeenCalledTimes(1);
    const [dep] = added.mock.calls[0] as [Dependency];
    expect(dep.from).toBe(toTaskId('parent'));
    expect(dep.to).toBe(toTaskId('child'));
  });

  it('coexistence: one drag-move on the bar body and one link-create on a handle in the same mount both fire their own events, no cross-talk', () => {
    const { gantt, groupEl2 } = mountWithTasks();
    const moved = vi.fn();
    const added = vi.fn();
    gantt.on('task:moved', moved);
    gantt.on('dependency:added', added);

    // Drag-move on t2's bar body.
    const barEl2 = groupEl2.querySelector('.fg-task__bar')!;
    const x2 = Number(barEl2.getAttribute('x'));
    const width2 = Number(barEl2.getAttribute('width'));
    const midX2 = x2 + width2 / 2;
    dispatchPointer(barEl2, 'pointerdown', { pointerId: 1, clientX: midX2, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: midX2 + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: midX2 + 48, clientY: 50 });

    // The move commit triggers a full reactive repaint (renderer full-repaints, no diff) —
    // the previously-queried group elements are now detached; re-query the freshly-rendered
    // ones before the second gesture.
    const freshGroupEl1 = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    const freshGroupEl2 = container.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;

    // Link-create from t1's handle onto t2.
    dragLink(freshGroupEl1, freshGroupEl2);

    expect(moved).toHaveBeenCalledTimes(1);
    expect((moved.mock.calls[0] as [Task, unknown])[0].id).toBe(toTaskId('t2'));
    expect(added).toHaveBeenCalledTimes(1);
    const [dep] = added.mock.calls[0] as [Dependency];
    expect(dep.from).toBe(toTaskId('t1'));
    expect(dep.to).toBe(toTaskId('t2'));
  });

  it('mount() then unmount(): the disposer tears down without throwing (no leaked listeners)', () => {
    const { gantt } = mountWithTasks();
    expect(() => gantt.unmount()).not.toThrow();
  });
});
