// Dedicated <StrictMode> correctness test (spec-react-wrapper.md §8 case 6 — the #2
// regression guard). Verifies the dev-only double render + double mount/cleanup/mount cycle
// never produces two live instances, two live renders, or duplicate event listeners.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StrictMode, createRef } from 'react';
import { render, act } from '@testing-library/react';
import { toTaskId } from '@fluxgantt/core';
import type * as CoreModule from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import { FluxGantt } from '../src/FluxGantt.js';
import type { FluxGanttRef } from '../src/types.js';

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

describe('<FluxGantt> under <React.StrictMode>', () => {
  it('creates exactly one GanttInstance despite the dev-only double render', async () => {
    const { createGantt } = await import('@fluxgantt/core');
    const ref = createRef<FluxGanttRef>();

    render(
      <StrictMode>
        <FluxGantt ref={ref} tasks={[]} />
      </StrictMode>,
    );

    expect(createGantt).toHaveBeenCalledTimes(1);
  });

  it('renders exactly one .fg-timeline, with no leftover from the throwaway mount/unmount cycle', () => {
    const { container } = render(
      <StrictMode>
        <FluxGantt tasks={[taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')]} />
      </StrictMode>,
    );

    expect(container.querySelectorAll('.fg-timeline')).toHaveLength(1);
    expect(container.querySelectorAll('.fg-task')).toHaveLength(1);
  });

  it('exactly one listener fires — no duplicate on() registration survives mount -> cleanup -> mount', () => {
    const ref = createRef<FluxGanttRef>();
    const onTaskAdded = vi.fn();

    render(
      <StrictMode>
        <FluxGantt ref={ref} tasks={[]} onTaskAdded={onTaskAdded} />
      </StrictMode>,
    );

    act(() => {
      ref.current!.addTask(taskInput('x', '2026-01-05T09:00', '2026-01-06T09:00'));
    });

    expect(onTaskAdded).toHaveBeenCalledTimes(1);
  });

  it('the chart survives the double-invoke: the instance is still mounted (not left unmounted by the thrown-away cleanup)', () => {
    const ref = createRef<FluxGanttRef>();
    const { container } = render(
      <StrictMode>
        <FluxGantt ref={ref} tasks={[]} />
      </StrictMode>,
    );

    act(() => {
      ref.current!.addTask(taskInput('y', '2026-01-05T09:00', '2026-01-06T09:00'));
    });

    // If the real mount had been torn down by the throwaway cleanup and never remounted,
    // this mutation would not be reflected in the DOM.
    expect(container.querySelectorAll('.fg-task')).toHaveLength(1);
  });
});
