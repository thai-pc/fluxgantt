// Vue's analogue of react's dedicated <StrictMode> test (spec-vue-wrapper.md §8 case 5).
// Vue has no StrictMode double-invoke; the two scenarios that warrant equivalent scrutiny are
// an ordinary unmount->remount cycle and a <KeepAlive> deactivate/reactivate round-trip.
import { describe, it, expect, vi } from 'vitest';
import { defineComponent, h, KeepAlive, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { toTaskId } from '@fluxgantt/core';
import type { GanttInstance, TaskInput } from '@fluxgantt/core';
import { FluxGantt } from '../src/FluxGantt.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

function vm(wrapper: { vm: unknown }): GanttInstance {
  return wrapper.vm as unknown as GanttInstance;
}

describe('<FluxGantt> remount', () => {
  it('an ordinary unmount -> fresh mount produces a different instance with no cross-instance listener leakage', () => {
    const onTaskAdded = vi.fn();
    const wrapperA = mount(FluxGantt, { props: { tasks: [] }, attachTo: document.body });
    const instanceA = vm(wrapperA);
    wrapperA.unmount();

    const wrapperB = mount(FluxGantt, { props: { tasks: [] }, attachTo: document.body });
    const instanceB = vm(wrapperB);

    expect(instanceB).not.toBe(instanceA);

    // B's own bridge works.
    instanceB.addTask(taskInput('b', '2026-01-05T09:00', '2026-01-06T09:00'));
    expect(wrapperB.emitted('task-added')).toHaveLength(1);

    // Firing an event on A's (unmounted, but still-alive) instance produces no entries in
    // B's emitted() — proves no shared/module-level listener state leaked across instances.
    instanceA.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    expect(wrapperB.emitted('task-added')).toHaveLength(1);

    expect(onTaskAdded).not.toHaveBeenCalled();
    wrapperB.unmount();
  });

  it('<KeepAlive> round-trip: deactivate/reactivate does not tear down or lose the mounted chart', async () => {
    const active = ref(true);
    // A single stable array reference across every render pass — keeps the "tasks changed
    // identity" dev warning (see the uncontrolled-first tests in flux-gantt.test.ts) out of
    // this unrelated test; a fresh array literal per render would otherwise fire it on
    // reactivation, which is correct-but-noisy, not something this test is about.
    const initialTasks = [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')];
    const Host = defineComponent({
      name: 'KeepAliveHost',
      setup() {
        return () =>
          h(KeepAlive, () => (active.value ? h(FluxGantt, { tasks: initialTasks, ref: 'gantt' }) : null));
      },
    });

    const wrapper = mount(Host, { attachTo: document.body });
    const beforeDeactivate = wrapper.element.querySelector('.fg-timeline');
    expect(beforeDeactivate).not.toBeNull();

    active.value = false;
    await wrapper.vm.$nextTick();
    // KeepAlive detaches the subtree into hidden storage rather than destroying it — our own
    // teardown (onBeforeUnmount) does NOT run here (onDeactivated is not one of our lifecycle
    // hooks — see spec-vue-wrapper.md §6 point 4). `wrapper.element` becomes a comment
    // placeholder while the branch is inactive, so nothing more is asserted at this point;
    // the meaningful assertion is reactivation below finding the SAME SVG node intact.

    active.value = true;
    await wrapper.vm.$nextTick();
    const afterReactivate = wrapper.element.querySelector('.fg-timeline');
    expect(afterReactivate).not.toBeNull();
    // Same DOM node survives the KeepAlive round-trip — nothing was torn down and rebuilt.
    expect(afterReactivate).toBe(beforeDeactivate);

    wrapper.unmount();
  });
});
