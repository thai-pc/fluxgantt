import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render } from '@testing-library/react';
import { toTaskId } from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import { FluxGantt } from '../src/FluxGantt.js';
import type { FluxGanttRef } from '../src/types.js';

function taskInput(id: string, start: string, end: string): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task' };
}
const A = [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')];

describe('onTaskUpdated (@beta)', () => {
  it('fires with the core payload for updateTask and moveTask', () => {
    const ref = createRef<FluxGanttRef>();
    const onTaskUpdated = vi.fn();
    render(<FluxGantt ref={ref} tasks={A} onTaskUpdated={onTaskUpdated} />);
    const before = ref.current!.getTask(toTaskId('a'))!;

    const renamed = ref.current!.updateTask(toTaskId('a'), { name: 'renamed' });
    expect(onTaskUpdated).toHaveBeenCalledTimes(1);
    expect(onTaskUpdated).toHaveBeenLastCalledWith({
      taskId: toTaskId('a'),
      task: renamed,
      prev: before,
      changed: ['name'],
    });

    const moved = ref.current!.moveTask(toTaskId('a'), '2026-01-07T09:00');
    expect(onTaskUpdated).toHaveBeenCalledTimes(2);
    const payload = onTaskUpdated.mock.calls[1]![0];
    expect(payload.taskId).toBe(toTaskId('a'));
    expect(payload.task).toEqual(moved);
    expect(payload.changed).toContain('start');
  });

  it('does not fire for addTask', () => {
    const ref = createRef<FluxGanttRef>();
    const onTaskUpdated = vi.fn();
    render(<FluxGantt ref={ref} tasks={A} onTaskUpdated={onTaskUpdated} />);
    ref.current!.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));
    expect(onTaskUpdated).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const ref = createRef<FluxGanttRef>();
    const onTaskUpdated = vi.fn();
    const { unmount } = render(<FluxGantt ref={ref} tasks={A} onTaskUpdated={onTaskUpdated} />);
    const instance = ref.current!;
    unmount();
    instance.updateTask(toTaskId('a'), { name: 'late' });
    expect(onTaskUpdated).not.toHaveBeenCalled();
  });

  it('uses the latest callback across renders without re-subscribing', () => {
    const ref = createRef<FluxGanttRef>();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<FluxGantt ref={ref} tasks={A} onTaskUpdated={first} />);
    const onSpy = vi.spyOn(ref.current!, 'on');

    rerender(<FluxGantt ref={ref} tasks={A} onTaskUpdated={second} />);
    ref.current!.updateTask(toTaskId('a'), { name: 'x' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(onSpy).not.toHaveBeenCalled();
  });
});
