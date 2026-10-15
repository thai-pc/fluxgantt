import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { toTaskId } from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import { FluxGantt } from '../src/FluxGantt.js';
import type { FluxGanttRef } from '../src/types.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

describe('<FluxGantt>', () => {
  it('mounts and renders the SVG timeline into its container', () => {
    const { container } = render(
      <FluxGantt tasks={[taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')]} />,
    );
    expect(container.querySelector('.fg-timeline')).not.toBeNull();
    expect(container.querySelectorAll('.fg-task')).toHaveLength(1);
  });

  it('applies the fg-gantt root class, plus any className passed through', () => {
    const { container } = render(<FluxGantt tasks={[]} className="my-chart" />);
    const root = container.firstElementChild;
    expect(root?.className).toBe('fg-gantt my-chart');
  });

  describe('discrete event-callback props', () => {
    function setup() {
      const ref = createRef<FluxGanttRef>();
      const onTaskAdded = vi.fn();
      const onTaskMoved = vi.fn();
      const onTaskResized = vi.fn();
      const onTaskProgressed = vi.fn();
      const onTaskRemoved = vi.fn();
      const onDependencyAdded = vi.fn();
      const onDependencyRemoved = vi.fn();
      const onCriticalPathComputed = vi.fn();
      render(
        <FluxGantt
          ref={ref}
          tasks={[taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')]}
          onTaskAdded={onTaskAdded}
          onTaskMoved={onTaskMoved}
          onTaskResized={onTaskResized}
          onTaskProgressed={onTaskProgressed}
          onTaskRemoved={onTaskRemoved}
          onDependencyAdded={onDependencyAdded}
          onDependencyRemoved={onDependencyRemoved}
          onCriticalPathComputed={onCriticalPathComputed}
        />,
      );
      return {
        ref,
        onTaskAdded,
        onTaskMoved,
        onTaskResized,
        onTaskProgressed,
        onTaskRemoved,
        onDependencyAdded,
        onDependencyRemoved,
        onCriticalPathComputed,
      };
    }

    it('onCriticalPathComputed receives the INITIAL mount-time emit (review #1: subscribe before mount)', () => {
      // setup() mounts with one initial task, so mount()'s synchronous render effect emits
      // the initial critical-path:computed. Subscribing before mount() delivers it.
      const { onCriticalPathComputed } = setup();
      expect(onCriticalPathComputed).toHaveBeenCalledTimes(1);
      expect(onCriticalPathComputed).toHaveBeenCalledWith([toTaskId('a')]);
    });

    it('onTaskAdded fires on addTask', () => {
      const { ref, onTaskAdded } = setup();
      const task = ref.current!.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));
      expect(onTaskAdded).toHaveBeenCalledTimes(1);
      expect(onTaskAdded).toHaveBeenCalledWith(task);
    });

    it('onTaskMoved fires on moveTask, with prevStart', () => {
      const { ref, onTaskMoved } = setup();
      const before = ref.current!.getTask(toTaskId('a'))!;
      const task = ref.current!.moveTask(toTaskId('a'), '2026-01-06T09:00');
      expect(onTaskMoved).toHaveBeenCalledTimes(1);
      expect(onTaskMoved).toHaveBeenCalledWith(task, before.start);
    });

    it('onTaskResized fires on resizeTask', () => {
      const { ref, onTaskResized } = setup();
      const task = ref.current!.resizeTask(toTaskId('a'), 16);
      expect(onTaskResized).toHaveBeenCalledTimes(1);
      expect(onTaskResized.mock.calls[0]?.[0]).toEqual(task);
    });

    it('onTaskProgressed fires on setProgress', () => {
      const { ref, onTaskProgressed } = setup();
      const task = ref.current!.setProgress(toTaskId('a'), 0.5);
      expect(onTaskProgressed).toHaveBeenCalledTimes(1);
      expect(onTaskProgressed).toHaveBeenCalledWith(task, 0);
    });

    it('onTaskRemoved fires on removeTask', () => {
      const { ref, onTaskRemoved } = setup();
      ref.current!.removeTask(toTaskId('a'));
      expect(onTaskRemoved).toHaveBeenCalledTimes(1);
      expect(onTaskRemoved).toHaveBeenCalledWith(toTaskId('a'));
    });

    it('onDependencyAdded fires on linkTasks', () => {
      const { ref, onDependencyAdded } = setup();
      ref.current!.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));
      const dep = ref.current!.linkTasks(toTaskId('a'), toTaskId('b'));
      expect(onDependencyAdded).toHaveBeenCalledTimes(1);
      expect(onDependencyAdded).toHaveBeenCalledWith(dep);
    });

    it('onDependencyRemoved fires on unlinkTasks', () => {
      const { ref, onDependencyRemoved } = setup();
      ref.current!.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));
      const dep = ref.current!.linkTasks(toTaskId('a'), toTaskId('b'));
      ref.current!.unlinkTasks(toTaskId('a'), toTaskId('b'));
      expect(onDependencyRemoved).toHaveBeenCalledTimes(1);
      expect(onDependencyRemoved).toHaveBeenCalledWith(dep.id);
    });

    it('onCriticalPathComputed fires on computeCriticalPath', () => {
      const { ref, onCriticalPathComputed } = setup();
      onCriticalPathComputed.mockClear(); // clear the initial-mount emit from the render effect
      const result = ref.current!.computeCriticalPath();
      expect(onCriticalPathComputed).toHaveBeenCalledWith(result.criticalTaskIds);
    });
  });

  it('unsubscribes listeners on unmount — the retained instance keeps working, but no longer fires the bridged callback', () => {
    const ref = createRef<FluxGanttRef>();
    const onTaskAdded = vi.fn();
    const { unmount } = render(
      <FluxGantt ref={ref} tasks={[]} onTaskAdded={onTaskAdded} />,
    );
    const instance = ref.current!;

    unmount();

    expect(() => instance.addTask(taskInput('z', '2026-01-05T09:00', '2026-01-06T09:00'))).not.toThrow();
    expect(onTaskAdded).not.toHaveBeenCalled();
  });

  it('does NOT call destroy() on unmount — mount() would still work on the retained instance', () => {
    const ref = createRef<FluxGanttRef>();
    const { unmount } = render(<FluxGantt ref={ref} tasks={[]} />);
    const instance = ref.current!;
    unmount();

    const freshContainer = document.createElement('div');
    document.body.appendChild(freshContainer);
    expect(() => instance.mount(freshContainer)).not.toThrow();
    expect(freshContainer.querySelector('.fg-timeline')).not.toBeNull();
    freshContainer.remove();
  });

  it('ref exposes the full GanttInstance surface (no curated subset)', () => {
    const ref = createRef<FluxGanttRef>();
    render(<FluxGantt ref={ref} tasks={[]} />);
    const expectedMethods = [
      'addTask',
      'updateTask',
      'removeTask',
      'moveTask',
      'resizeTask',
      'setProgress',
      'getTask',
      'getTasks',
      'findTasks',
      'linkTasks',
      'unlinkTasks',
      'getDependencies',
      'getDependenciesOf',
      'computeCriticalPath',
      'on',
      'mount',
      'unmount',
      'destroy',
      'refresh',
    ] as const;
    for (const method of expectedMethods) {
      expect(typeof ref.current![method]).toBe('function');
    }
  });

  describe('uncontrolled-first: dev-only identity-change warnings', () => {
    it('warns once when `tasks` prop identity changes after mount', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const initialTasks = [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')];
      const { rerender } = render(<FluxGantt tasks={initialTasks} />);
      expect(warn).not.toHaveBeenCalled();

      rerender(<FluxGantt tasks={[taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')]} />);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('`tasks` changed identity');
      warn.mockRestore();
    });

    it('does not warn when `tasks` prop identity is unchanged', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const tasks = [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')];
      const { rerender } = render(<FluxGantt tasks={tasks} />);
      rerender(<FluxGantt tasks={tasks} />);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  it('viewMode prop change after mount is a no-op (construction-only field)', () => {
    const { container, rerender } = render(<FluxGantt tasks={[]} viewMode="week" />);
    const before = container.querySelector('.fg-timeline')?.outerHTML;

    rerender(<FluxGantt tasks={[]} viewMode="month" />);

    const after = container.querySelector('.fg-timeline')?.outerHTML;
    expect(after).toBe(before);
  });

  it('exposes the viewport capability on the ref (scrollToTask / scrollToDate / setDensity)', () => {
    const ref = createRef<FluxGanttRef>();
    render(<FluxGantt ref={ref} tasks={[taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')]} />);
    const seen: unknown[] = [];
    ref.current!.on('viewport:changed', (p) => seen.push(p));
    expect(ref.current!.scrollToTask(toTaskId('a'))).toBe(true);
    expect(ref.current!.scrollToDate('2026-01-05')).toBe(true);
    ref.current!.setDensity('compact');
    expect(seen).toEqual([{ viewMode: 'week', density: 'compact' }]);
  });

  describe('edit hooks (onTaskActivated / onTaskContextRequested)', () => {
    const tasks = [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')];

    it('onTaskActivated receives the payload on double-click', () => {
      const onTaskActivated = vi.fn();
      const { container } = render(<FluxGantt tasks={tasks} onTaskActivated={onTaskActivated} />);
      fireEvent.doubleClick(container.querySelector('.fg-task__bar')!, { clientX: 5, clientY: 6 });
      expect(onTaskActivated).toHaveBeenCalledTimes(1);
      expect(onTaskActivated.mock.calls[0]![0]).toMatchObject({
        taskId: 'a',
        part: 'bar',
        source: 'pointer',
        clientX: 5,
        clientY: 6,
      });
    });

    it('payload.preventDefault() reaches the native contextmenu event, and only when called', () => {
      let call = false;
      const onTaskContextRequested = vi.fn((p: { preventDefault(): void }) => {
        if (call) p.preventDefault();
      });
      const { container } = render(
        <FluxGantt tasks={tasks} onTaskContextRequested={onTaskContextRequested} />,
      );
      const bar = container.querySelector('.fg-task__bar')!;
      // fireEvent returns false when the event was cancelled.
      expect(fireEvent.contextMenu(bar)).toBe(true);
      call = true;
      expect(fireEvent.contextMenu(bar)).toBe(false);
      expect(onTaskContextRequested).toHaveBeenCalledTimes(2);
    });

    it('without a handler the native menu is left alone, and unmount unsubscribes', () => {
      const onTaskActivated = vi.fn();
      const { container, unmount } = render(<FluxGantt tasks={tasks} onTaskActivated={onTaskActivated} />);
      const bar = container.querySelector('.fg-task__bar')!;
      expect(fireEvent.contextMenu(bar)).toBe(true);
      unmount();
      fireEvent.doubleClick(bar);
      expect(onTaskActivated).not.toHaveBeenCalled();
    });
  });

  it('enableDependencyDrag={false} renders no link handles', () => {
    const { container } = render(
      <FluxGantt tasks={[taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')]} enableDependencyDrag={false} />,
    );
    expect(container.querySelectorAll('.fg-task__link-handle')).toHaveLength(0);
  });

});
