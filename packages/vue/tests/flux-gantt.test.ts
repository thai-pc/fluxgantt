import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { toTaskId } from '@fluxgantt/core';
import type { GanttInstance, TaskInput } from '@fluxgantt/core';
import type { RenderCapability } from '@fluxgantt/core/render';
import type { ViewportCapability } from '@fluxgantt/core/viewport';
import { FluxGantt } from '../src/FluxGantt.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

// `RenderCapability` (`mount`/`unmount`/`refresh`) comes from the opt-in
// `@fluxgantt/core/render` mixin the wrapper composes for the consumer — see
// `use-flux-gantt.ts` and `FluxGanttRef` in `src/types.ts`.
function vm(wrapper: { vm: unknown }): GanttInstance & RenderCapability {
  return wrapper.vm as unknown as GanttInstance & RenderCapability;
}

describe('<FluxGantt>', () => {
  it('mounts and renders the SVG timeline into its container', () => {
    const wrapper = mount(FluxGantt, {
      props: { tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] },
      attachTo: document.body,
    });
    expect(wrapper.element.querySelector('.fg-timeline')).not.toBeNull();
    expect(wrapper.element.querySelectorAll('.fg-task')).toHaveLength(1);
    wrapper.unmount();
  });

  it('applies the fg-gantt root class, plus any class passed through via attribute fallthrough', () => {
    const wrapper = mount(FluxGantt, {
      props: { tasks: [] },
      attrs: { class: 'my-chart' },
      attachTo: document.body,
    });
    expect(wrapper.element.className).toBe('fg-gantt my-chart');
    wrapper.unmount();
  });

  describe('discrete emits', () => {
    function setup() {
      const wrapper = mount(FluxGantt, {
        props: { tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] },
        attachTo: document.body,
      });
      return { wrapper, instance: vm(wrapper) };
    }

    it('task-added fires on addTask', () => {
      const { wrapper, instance } = setup();
      const task = instance.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));
      expect(wrapper.emitted('task-added')).toEqual([[task]]);
      wrapper.unmount();
    });

    it('task-moved fires on moveTask, with prevStart', () => {
      const { wrapper, instance } = setup();
      const before = instance.getTask(toTaskId('a'))!;
      const task = instance.moveTask(toTaskId('a'), '2026-01-06T09:00');
      expect(wrapper.emitted('task-moved')).toEqual([[task, before.start]]);
      wrapper.unmount();
    });

    it('task-resized fires on resizeTask', () => {
      const { wrapper, instance } = setup();
      const task = instance.resizeTask(toTaskId('a'), 16);
      const emitted = wrapper.emitted('task-resized');
      expect(emitted).toHaveLength(1);
      expect(emitted![0]![0]).toEqual(task);
      wrapper.unmount();
    });

    it('task-progressed fires on setProgress', () => {
      const { wrapper, instance } = setup();
      const task = instance.setProgress(toTaskId('a'), 0.5);
      expect(wrapper.emitted('task-progressed')).toEqual([[task, 0]]);
      wrapper.unmount();
    });

    it('task-removed fires on removeTask', () => {
      const { wrapper, instance } = setup();
      instance.removeTask(toTaskId('a'));
      expect(wrapper.emitted('task-removed')).toEqual([[toTaskId('a')]]);
      wrapper.unmount();
    });

    it('dependency-added fires on linkTasks', () => {
      const { wrapper, instance } = setup();
      instance.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));
      const dep = instance.linkTasks(toTaskId('a'), toTaskId('b'));
      expect(wrapper.emitted('dependency-added')).toEqual([[dep]]);
      wrapper.unmount();
    });

    it('dependency-removed fires on unlinkTasks', () => {
      const { wrapper, instance } = setup();
      instance.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));
      const dep = instance.linkTasks(toTaskId('a'), toTaskId('b'));
      instance.unlinkTasks(toTaskId('a'), toTaskId('b'));
      expect(wrapper.emitted('dependency-removed')).toEqual([[dep.id]]);
      wrapper.unmount();
    });

    it('critical-path-computed receives the INITIAL mount-time emit (review #1: subscribe before mount)', () => {
      // setup() mounts with one initial task, so mount()'s synchronous render effect emits
      // the initial critical-path:computed. Subscribing in setup() (before the composable's
      // mount onMounted) delivers it — previously it was missed (subscribed in a later onMounted).
      const { wrapper } = setup();
      const emitted = wrapper.emitted('critical-path-computed');
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual([[toTaskId('a')]]);
      wrapper.unmount();
    });

    it('critical-path-computed fires on computeCriticalPath', () => {
      const { wrapper, instance } = setup();
      const before = wrapper.emitted('critical-path-computed')?.length ?? 0; // initial-mount emit
      const result = instance.computeCriticalPath();
      const emitted = wrapper.emitted('critical-path-computed')!;
      expect(emitted.length).toBeGreaterThan(before);
      expect(emitted.at(-1)).toEqual([result.criticalTaskIds]);
      wrapper.unmount();
    });
  });

  it('unsubscribes listeners on unmount — the retained instance keeps working, but no longer fires the bridged emit', () => {
    const wrapper = mount(FluxGantt, { props: { tasks: [] }, attachTo: document.body });
    const instance = vm(wrapper);

    wrapper.unmount();
    const before = wrapper.emitted('task-added')?.length ?? 0;

    expect(() => instance.addTask(taskInput('z', '2026-01-05T09:00', '2026-01-06T09:00'))).not.toThrow();
    expect(wrapper.emitted('task-added')?.length ?? 0).toBe(before);
  });

  it('does NOT call destroy() on unmount — mount() would still work on the retained instance', () => {
    const wrapper = mount(FluxGantt, { props: { tasks: [] }, attachTo: document.body });
    const instance = vm(wrapper);
    wrapper.unmount();

    const freshContainer = document.createElement('div');
    document.body.appendChild(freshContainer);
    expect(() => instance.mount(freshContainer)).not.toThrow();
    expect(freshContainer.querySelector('.fg-timeline')).not.toBeNull();
    freshContainer.remove();
  });

  it('exposes the full GanttInstance surface (no curated subset)', () => {
    const wrapper = mount(FluxGantt, { props: { tasks: [] }, attachTo: document.body });
    const instance = vm(wrapper);
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
      expect(typeof (instance as unknown as Record<string, unknown>)[method]).toBe('function');
    }
    wrapper.unmount();
  });

  describe('uncontrolled-first: dev-only identity-change warnings', () => {
    it('warns once when `tasks` prop identity changes after mount', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const initialTasks = [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')];
      const wrapper = mount(FluxGantt, { props: { tasks: initialTasks }, attachTo: document.body });
      expect(warn).not.toHaveBeenCalled();

      await wrapper.setProps({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
      await wrapper.vm.$nextTick();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('`tasks` changed identity');
      warn.mockRestore();
      wrapper.unmount();
    });

    it('does not warn when `tasks` prop identity is unchanged', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const tasks = [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')];
      const wrapper = mount(FluxGantt, { props: { tasks }, attachTo: document.body });
      await wrapper.setProps({ tasks });
      await wrapper.vm.$nextTick();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
      wrapper.unmount();
    });
  });

  it('viewMode prop change after mount is a no-op (construction-only field)', async () => {
    const wrapper = mount(FluxGantt, {
      props: { tasks: [], viewMode: 'week' },
      attachTo: document.body,
    });
    const before = wrapper.element.querySelector('.fg-timeline')?.outerHTML;

    await wrapper.setProps({ viewMode: 'month' });
    await wrapper.vm.$nextTick();

    const after = wrapper.element.querySelector('.fg-timeline')?.outerHTML;
    expect(after).toBe(before);
    wrapper.unmount();
  });

  it('0->1 task transition through the Vue path does not throw (empty-state regression)', () => {
    const wrapper = mount(FluxGantt, { props: { tasks: [] }, attachTo: document.body });
    const instance = vm(wrapper);
    expect(() => instance.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'))).not.toThrow();
    expect(wrapper.element.querySelectorAll('.fg-task')).toHaveLength(1);
    wrapper.unmount();
  });

  // §11 (spec-vue-wrapper.md) — MANDATORY drift guard: the runtime `props`/`emits` option
  // objects (FluxGantt.ts) and the hand-written FluxGanttProps/FluxGanttEmits types (types.ts)
  // have no compiler-enforced link (§9's "genuinely new open question", resolved as a required
  // guard, not optional). This is a cheap runtime tripwire against the two lists silently
  // drifting apart as @fluxgantt/core's GanttConfig/GanttEventMap evolve.
  it('runtime props/emits declarations match GanttConfig / the 10 bridged GanttEventMap events (drift guard)', () => {
    const componentOptions = FluxGantt as unknown as {
      props: Record<string, unknown>;
      emits: Record<string, unknown>;
    };

    const expectedPropKeys = [
      'tasks',
      'dependencies',
      'calendar',
      'viewMode',
      'density',
      'locale',
      'readOnly',
      'enableDependencyDrag',
      'onTaskChange',
    ].sort();
    const expectedEmitKeys = [
      'task-added',
      'task-moved',
      'task-resized',
      'task-progressed',
      'task-removed',
      'dependency-added',
      'dependency-removed',
      'critical-path-computed',
      'task-activated',
      'task-context-requested',
    ].sort();

    expect(Object.keys(componentOptions.props).sort()).toEqual(expectedPropKeys);
    expect(Object.keys(componentOptions.emits).sort()).toEqual(expectedEmitKeys);
  });

  it('exposes the viewport capability through the component proxy', () => {
    const wrapper = mount(FluxGantt, {
      props: { tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] },
      attachTo: document.body,
    });
    const instance = wrapper.vm as unknown as GanttInstance & RenderCapability & ViewportCapability;
    const seen: unknown[] = [];
    instance.on('viewport:changed', (p) => seen.push(p));
    expect(instance.scrollToTask(toTaskId('a'))).toBe(true);
    expect(instance.scrollToDate('2026-01-05')).toBe(true);
    instance.setDensity('compact');
    expect(seen).toEqual([{ viewMode: 'week', density: 'compact' }]);
    wrapper.unmount();
  });

  describe('edit hooks (task-activated / task-context-requested)', () => {
    const tasks = [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')];

    it('emits task-activated with the payload on double-click', async () => {
      const wrapper = mount(FluxGantt, { props: { tasks }, attachTo: document.body });
      const bar = wrapper.element.querySelector('.fg-task__bar')!;
      bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 5, clientY: 6 }));
      const emitted = wrapper.emitted('task-activated');
      expect(emitted).toHaveLength(1);
      expect(emitted![0]![0]).toMatchObject({ taskId: 'a', part: 'bar', source: 'pointer', clientX: 5, clientY: 6 });
      wrapper.unmount();
    });

    it('payload.preventDefault() in a Vue listener reaches the native contextmenu (sync emit)', () => {
      let call = false;
      const wrapper = mount(FluxGantt, {
        props: {
          tasks,
          onTaskContextRequested: (p: { preventDefault(): void }) => {
            if (call) p.preventDefault();
          },
        },
        attachTo: document.body,
      });
      const bar = wrapper.element.querySelector('.fg-task__bar')!;
      const fire = (): boolean =>
        bar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(fire()).toBe(true);
      call = true;
      expect(fire()).toBe(false);
      expect(wrapper.emitted('task-context-requested')).toHaveLength(2);
      wrapper.unmount();
    });

    it('unsubscribes on unmount', () => {
      const wrapper = mount(FluxGantt, { props: { tasks }, attachTo: document.body });
      const bar = wrapper.element.querySelector('.fg-task__bar')!;
      wrapper.unmount();
      bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 1, clientY: 1 }));
      expect(wrapper.emitted('task-activated')).toBeUndefined();
    });
  });

  it('enableDependencyDrag=false renders no link handles', () => {
    const wrapper = mount(FluxGantt, {
      props: { tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')], enableDependencyDrag: false },
      attachTo: document.body,
    });
    expect(wrapper.element.querySelectorAll('.fg-task__link-handle')).toHaveLength(0);
    wrapper.unmount();
  });

});
