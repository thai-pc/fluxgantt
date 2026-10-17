// Exhaustive forwarding guard for `<FluxGantt>`: every `GanttConfig` key is declared as a prop
// (Vue has no reflection on TS types, so an undeclared key would fall through to the root
// element as a DOM attribute) and reaches `createGantt`. Compile-time half is the
// `satisfies Record<keyof GanttConfig, ...>` in `src/gantt-config.ts`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { toRaw } from 'vue';
import { mount } from '@vue/test-utils';
import { DEFAULT_CALENDAR, computeRollup, toTaskId } from '@fluxgantt/core';
import type * as CoreModule from '@fluxgantt/core';
import type { GanttConfig, TaskInput } from '@fluxgantt/core';
import { FluxGantt } from '../src/FluxGantt.js';
import { CONFIG_DISPOSITION } from '../src/gantt-config.js';

vi.mock('@fluxgantt/core', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreModule>();
  return { ...actual, createGantt: vi.fn(actual.createGantt) };
});

afterEach(() => {
  vi.clearAllMocks();
});

const task: TaskInput = {
  id: toTaskId('a'),
  name: 'a',
  start: '2026-01-05T09:00',
  end: '2026-01-06T09:00',
  progress: 0,
  type: 'task',
};

const FULL: Required<GanttConfig> = {
  tasks: [task],
  dependencies: [],
  calendar: DEFAULT_CALENDAR,
  viewMode: 'month',
  density: 'compact',
  locale: 'fr',
  ariaLabel: 'My plan',
  messages: { taskLabel: () => 'x' },
  rtl: true,
  theme: 'dark',
  canvasViewportHeight: 321,
  readOnly: true,
  enableDependencyDrag: false,
  schedulingMode: 'auto',
  historyLimit: 7,
  initialCollapsed: [],
  rollup: computeRollup,
  onTaskChange: () => {},
};

async function lastCreateGanttArg(): Promise<Record<string, unknown>> {
  const { createGantt } = await import('@fluxgantt/core');
  const calls = vi.mocked(createGantt).mock.calls;
  return calls[calls.length - 1]![0] as unknown as Record<string, unknown>;
}

describe('<FluxGantt> config passthrough', () => {
  it('lists exactly the keys of a full GanttConfig in CONFIG_DISPOSITION', () => {
    expect(Object.keys(CONFIG_DISPOSITION).sort()).toEqual(Object.keys(FULL).sort());
  });

  it('declares every config key as a prop', () => {
    expect(Object.keys(FluxGantt.props).sort()).toEqual(Object.keys(CONFIG_DISPOSITION).sort());
  });

  it('forwards every forwarded key to createGantt by identity', async () => {
    mount(FluxGantt, { props: { ...FULL } });
    const arg = await lastCreateGanttArg();
    const source = FULL as unknown as Record<string, unknown>;
    for (const [key, disposition] of Object.entries(CONFIG_DISPOSITION)) {
      if (disposition === 'forwarded') {
        expect(arg, key).toHaveProperty(key);
        // test-utils wraps `props` in a reactive proxy; compare the raw targets.
        expect(toRaw(arg[key]), key).toBe(toRaw(source[key]));
      }
    }
    // Constructed light on purpose (no matchMedia listener armed in setup); the real theme is
    // applied in onMounted (asserted in config-behavior.test.ts).
    expect(arg['theme']).toBe('light');
    expect(typeof arg['onTaskChange']).toBe('function');
  });

  it('omits unset keys entirely (not even undefined), except the documented theme default', async () => {
    mount(FluxGantt, { props: { tasks: [task] } });
    const arg = await lastCreateGanttArg();
    expect(Object.keys(arg).sort()).toEqual(['onTaskChange', 'tasks', 'theme']);
    expect(arg['theme']).toBe('light');
  });

  it('does not leak config props onto the root element as DOM attributes', () => {
    const wrapper = mount(FluxGantt, { props: { ...FULL }, attachTo: document.body });
    const root = wrapper.element as HTMLElement;
    for (const attr of ['arialabel', 'ariaLabel', 'rollup', 'messages', 'theme', 'historylimit']) {
      expect(root.hasAttribute(attr), attr).toBe(false);
    }
    wrapper.unmount();
  });

  it('kebab-case aria-label binds to the ariaLabel prop: names the svg, not the root', () => {
    const wrapper = mount(FluxGantt, {
      props: { tasks: [] },
      attrs: { 'aria-label': 'Plan' },
      attachTo: document.body,
    });
    const root = wrapper.element as HTMLElement;
    expect(root.hasAttribute('aria-label')).toBe(false);
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toBe('Plan');
    wrapper.unmount();
  });
});
