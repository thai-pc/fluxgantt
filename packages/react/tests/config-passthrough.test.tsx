// Exhaustive forwarding guard: every `GanttConfig` key reaches `createGantt` (the bug this
// guards: eight fields type-checked but were silently dropped). Compile-time half is the
// `satisfies Record<keyof GanttConfig, ...>` in `src/gantt-config.ts`; this file is the runtime
// half, driven by a `Required<GanttConfig>` literal that stops compiling when core adds a key.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
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

  it('forwards every forwarded key to createGantt by identity', async () => {
    const config: GanttConfig = FULL;
    render(<FluxGantt {...config} />);
    const arg = await lastCreateGanttArg();
    const source = config as unknown as Record<string, unknown>;
    for (const [key, disposition] of Object.entries(CONFIG_DISPOSITION)) {
      if (disposition === 'forwarded') {
        expect(arg, key).toHaveProperty(key);
        expect(arg[key], key).toBe(source[key]);
      }
    }
    // Constructed light on purpose (no matchMedia listener armed at render); the real theme is
    // applied in the layout effect (asserted in config-behavior.test.tsx).
    expect(arg['theme']).toBe('light');
    expect(typeof arg['onTaskChange']).toBe('function');
  });

  it('omits unset keys entirely (not even undefined), except the documented theme default', async () => {
    render(<FluxGantt tasks={[task]} />);
    const arg = await lastCreateGanttArg();
    expect(Object.keys(arg).sort()).toEqual(['onTaskChange', 'tasks', 'theme']);
    expect(arg['theme']).toBe('light');
  });
});
