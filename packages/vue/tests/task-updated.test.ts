import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { toTaskId } from '@fluxgantt/core';
import type { GanttInstance, TaskInput } from '@fluxgantt/core';
import { FluxGantt } from '../src/FluxGantt.js';

function taskInput(id: string, start: string, end: string): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task' };
}
const A = [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')];

function setup() {
  const wrapper = mount(FluxGantt, { props: { tasks: A }, attachTo: document.body });
  return { wrapper, instance: wrapper.vm as unknown as GanttInstance };
}

describe('task-updated emit (@beta)', () => {
  it('emits the core payload for updateTask and moveTask', () => {
    const { wrapper, instance } = setup();
    const before = instance.getTask(toTaskId('a'))!;

    const renamed = instance.updateTask(toTaskId('a'), { name: 'renamed' });
    expect(wrapper.emitted('task-updated')).toEqual([
      [{ taskId: toTaskId('a'), task: renamed, prev: before, changed: ['name'] }],
    ]);

    const moved = instance.moveTask(toTaskId('a'), '2026-01-07T09:00');
    const emitted = wrapper.emitted('task-updated')!;
    expect(emitted).toHaveLength(2);
    const payload = emitted[1]![0] as { taskId: string; task: unknown; changed: string[] };
    expect(payload.taskId).toBe(toTaskId('a'));
    expect(payload.task).toEqual(moved);
    expect(payload.changed).toContain('start');
    wrapper.unmount();
  });

  it('does not emit for addTask', () => {
    const { wrapper, instance } = setup();
    instance.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));
    expect(wrapper.emitted('task-updated')).toBeUndefined();
    wrapper.unmount();
  });

  it('unsubscribes on unmount', () => {
    const { wrapper, instance } = setup();
    wrapper.unmount();
    instance.updateTask(toTaskId('a'), { name: 'late' });
    expect(wrapper.emitted('task-updated')).toBeUndefined();
  });

  it('follows a changed @task-updated handler between renders', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const wrapper = mount(FluxGantt, {
      props: { tasks: A, 'onTask-updated': first },
      attachTo: document.body,
    });
    const instance = wrapper.vm as unknown as GanttInstance;
    await wrapper.setProps({ 'onTask-updated': second });
    instance.updateTask(toTaskId('a'), { name: 'x' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
