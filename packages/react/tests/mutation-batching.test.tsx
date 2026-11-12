// Event timing of batched mutations (spec-mutation-batching.md §8 item 7): callbacks fire once per
// shifted task, in chain order, AFTER the whole cascade committed.
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render } from '@testing-library/react';
import { toTaskId } from '@fluxgantt/core';
import type { TaskInput, Task } from '@fluxgantt/core';
import { FluxGantt } from '../src/FluxGantt.js';
import type { FluxGanttRef } from '../src/types.js';

const N = 5;
function chain(): { tasks: TaskInput[]; dependencies: { from: ReturnType<typeof toTaskId>; to: ReturnType<typeof toTaskId>; type: 'FS' }[] } {
  const tasks: TaskInput[] = [];
  const dependencies: { from: ReturnType<typeof toTaskId>; to: ReturnType<typeof toTaskId>; type: 'FS' }[] = [];
  for (let i = 0; i < N; i++) {
    tasks.push({
      id: toTaskId(`k${i}`),
      name: `k${i}`,
      start: '2026-01-05T09:00',
      end: '2026-01-05T17:00',
      progress: 0,
      type: 'task',
    });
    if (i > 0) dependencies.push({ from: toTaskId(`k${i - 1}`), to: toTaskId(`k${i}`), type: 'FS' });
  }
  return { tasks, dependencies };
}

describe('<FluxGantt> batched mutations', () => {
  it('auto-mode cascade: one onTaskMoved per task in chain order, final state visible, one critical-path emit', () => {
    const ref = createRef<FluxGanttRef>();
    const order: string[] = [];
    const seenLast: string[] = [];
    const initialStarts = new Map<string, string>();
    const onTaskChange = vi.fn();
    const onCriticalPathComputed = vi.fn();
    const { tasks, dependencies } = chain();
    let renders = 0;
    const onTaskMoved = (task: Task): void => {
      order.push(task.id);
      seenLast.push(String(ref.current!.getTask(toTaskId(`k${N - 1}`))!.start));
    };
    function Harness() {
      renders++;
      return (
        <FluxGantt
          ref={ref}
          tasks={tasks}
          dependencies={dependencies}
          schedulingMode="auto"
          onTaskMoved={onTaskMoved}
          onTaskChange={onTaskChange}
          onCriticalPathComputed={onCriticalPathComputed}
        />
      );
    }
    render(<Harness />);
    for (const t of ref.current!.getTasks()) initialStarts.set(t.id, String(t.start));
    onCriticalPathComputed.mockClear();
    onTaskChange.mockClear();
    const rendersBefore = renders;

    ref.current!.moveTask(toTaskId('k0'), '2026-02-02T09:00');

    expect(order).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
    // Every listener sees the LAST task already shifted (final state).
    const finalLast = String(ref.current!.getTask(toTaskId('k4'))!.start);
    expect(finalLast).not.toBe(initialStarts.get('k4'));
    expect(seenLast).toEqual(Array(N).fill(finalLast));
    expect(onTaskChange).toHaveBeenCalledTimes(N);
    expect(onCriticalPathComputed.mock.calls.length).toBeLessThanOrEqual(1);
    expect(renders).toBe(rendersBefore); // the host component does not re-render
  });

  it('unmounting the component from inside a callback is safe', () => {
    const ref = createRef<FluxGanttRef>();
    const { tasks, dependencies } = chain();
    const seen: string[] = [];
    const { unmount } = render(
      <FluxGantt
        ref={ref}
        tasks={tasks}
        dependencies={dependencies}
        schedulingMode="auto"
        onTaskMoved={(task) => {
          seen.push(task.id);
          if (task.id === 'k1') unmount();
        }}
      />,
    );
    expect(() => ref.current!.moveTask(toTaskId('k0'), '2026-02-02T09:00')).not.toThrow();
    expect(seen).toEqual(['k0', 'k1']);
  });
});
