// Event timing of batched mutations (spec-mutation-batching.md §8 item 7).
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { toTaskId } from '@fluxgantt/core';
import type { GanttInstance, TaskInput } from '@fluxgantt/core';
import { FluxGantt } from '../src/FluxGantt.js';

const N = 5;
const tasks: TaskInput[] = Array.from({ length: N }, (_, i) => ({
  id: toTaskId(`k${i}`),
  name: `k${i}`,
  start: '2026-01-05T09:00',
  end: '2026-01-05T17:00',
  progress: 0,
  type: 'task',
}));
const dependencies = Array.from({ length: N - 1 }, (_, i) => ({
  from: toTaskId(`k${i}`),
  to: toTaskId(`k${i + 1}`),
  type: 'FS' as const,
}));

describe('<FluxGantt> batched mutations', () => {
  it('auto-mode cascade: one task-moved per task in chain order, one critical-path-computed, final state readable', () => {
    const wrapper = mount(FluxGantt, {
      props: { tasks, dependencies, schedulingMode: 'auto' },
      attachTo: document.body,
    });
    const instance = wrapper.vm as unknown as GanttInstance;
    const before = String(instance.getTask(toTaskId('k4'))!.start);
    const critBefore = wrapper.emitted('critical-path-computed')?.length ?? 0;
    // Read the final state at event time through the same instance.
    const seen: string[] = [];
    instance.on('task:moved', () => seen.push(String(instance.getTask(toTaskId('k4'))!.start)));

    instance.moveTask(toTaskId('k0'), '2026-02-02T09:00');

    const moved = wrapper.emitted('task-moved')!;
    expect(moved.map((args) => (args[0] as { id: string }).id)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
    const after = String(instance.getTask(toTaskId('k4'))!.start);
    expect(after).not.toBe(before);
    expect(seen).toEqual(Array(N).fill(after));
    expect((wrapper.emitted('critical-path-computed')?.length ?? 0) - critBefore).toBeLessThanOrEqual(1);
    wrapper.unmount();
  });

  it('unmounting from inside a handler is safe', () => {
    const wrapper = mount(FluxGantt, {
      props: { tasks, dependencies, schedulingMode: 'auto' },
      attachTo: document.body,
    });
    const instance = wrapper.vm as unknown as GanttInstance;
    const seen: string[] = [];
    instance.on('task:moved', (task) => {
      seen.push(task.id);
      if (task.id === 'k1') wrapper.unmount();
    });
    expect(() => instance.moveTask(toTaskId('k0'), '2026-02-02T09:00')).not.toThrow();
    // The instance-level listener outlives the component; the component's own emit bridge does not.
    expect(seen.slice(0, 2)).toEqual(['k0', 'k1']);
    expect(wrapper.emitted('task-moved')?.length ?? 0).toBeLessThanOrEqual(2);
  });
});
