import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { toTaskId } from '@fluxgantt/core';
import type * as CoreModule from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import { useFluxGantt } from '../src/use-flux-gantt.js';
import type { UseFluxGanttConfig, UseFluxGanttResult } from '../src/types.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

vi.mock('@fluxgantt/core', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreModule>();
  return { ...actual, createGantt: vi.fn(actual.createGantt) };
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Minimal host component exercising the composable in isolation — mirrors react's
 *  `renderHook`-based tests, adapted to Vue's "composable body runs once per instance"
 *  model (§3's module doc-comment). `props` (Vue's own reactive props proxy) is passed
 *  STRAIGHT THROUGH to `useFluxGantt`, never spread/copied first — the same contract
 *  `<FluxGantt>` itself follows (see `use-flux-gantt.ts`'s module doc-comment on why a
 *  spread copy would defeat the "always-latest `onTaskChange`" read). `expose(result)`
 *  surfaces the composable's return value for assertions; the raw `GanttInstance` here is
 *  never called through the exposed proxy in this file (see `FluxGantt.ts`'s
 *  `exposableInstance` doc-comment for why that would matter), only read/compared by
 *  reference. */
const Host = defineComponent({
  name: 'Host',
  props: {
    tasks: { type: Array as () => TaskInput[], required: false },
    dependencies: { type: Array as () => unknown[], required: false },
    locale: { type: String, required: false },
  },
  setup(props, { expose }) {
    const result: UseFluxGanttResult = useFluxGantt(props as UseFluxGanttConfig);
    expose({ instance: result.instance, containerRef: result.containerRef });
    return () => h('div', { ref: result.containerRef });
  },
});

describe('useFluxGantt', () => {
  it('creates exactly one GanttInstance, stable across reactive prop updates', async () => {
    const { createGantt } = await import('@fluxgantt/core');

    const wrapper = mount(Host, {
      props: { tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')], locale: 'en' },
    });
    expect(createGantt).toHaveBeenCalledTimes(1);
    const first = (wrapper.vm as unknown as { instance: unknown }).instance;

    await wrapper.setProps({ locale: 'vi' });
    await wrapper.vm.$nextTick();

    expect(createGantt).toHaveBeenCalledTimes(1);
    expect((wrapper.vm as unknown as { instance: unknown }).instance).toBe(first);
  });

  it('mounts the container node via onMounted', () => {
    const wrapper = mount(Host, {
      props: { tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] },
      attachTo: document.body,
    });
    expect(wrapper.element.querySelector('.fg-timeline')).not.toBeNull();
    wrapper.unmount();
  });

  it('re-throws an invalid initial config with the @fluxgantt/vue context tag', () => {
    // A cyclic initial dependency makes createGantt throw during setup(); Vue also logs its
    // own "missing render function" dev warning as a side effect of setup() throwing before a
    // render function was ever returned — silence it, it's expected noise, not a regression.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      mount(Host, {
        props: {
          tasks: [
            taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
            taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
          ],
          dependencies: [
            { from: toTaskId('a'), to: toTaskId('b'), type: 'FS' },
            { from: toTaskId('b'), to: toTaskId('a'), type: 'FS' }, // cycle
          ],
        },
      }),
    ).toThrow(/^\[@fluxgantt\/vue\] invalid initial config/);
    warn.mockRestore();
  });
});
