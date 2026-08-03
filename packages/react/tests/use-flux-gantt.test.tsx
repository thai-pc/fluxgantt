import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, renderHook, act } from '@testing-library/react';
import { toTaskId } from '@fluxgantt/core';
import type * as CoreModule from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import { useFluxGantt } from '../src/use-flux-gantt.js';

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

describe('useFluxGantt', () => {
  it('creates exactly one GanttInstance across re-renders (not per-render)', async () => {
    const { createGantt } = await import('@fluxgantt/core');

    function Host() {
      const [, setTick] = useState(0);
      const { ref, instance } = useFluxGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
      return (
        <div>
          <div ref={ref} data-testid="container" />
          <button onClick={() => setTick((t) => t + 1)}>rerender</button>
          <span data-testid="task-count">{instance.getTasks().length}</span>
        </div>
      );
    }

    const { getByText } = render(<Host />);
    expect(createGantt).toHaveBeenCalledTimes(1);

    act(() => getByText('rerender').click());
    act(() => getByText('rerender').click());
    act(() => getByText('rerender').click());

    expect(createGantt).toHaveBeenCalledTimes(1);
  });

  it('returns a stable `instance` identity across re-renders', () => {
    const { result, rerender } = renderHook(() => useFluxGantt({ tasks: [] }), {
      initialProps: { tick: 0 },
    });
    const first = result.current.instance;
    rerender({ tick: 1 });
    rerender({ tick: 2 });
    expect(result.current.instance).toBe(first);
  });

  it('re-throws an invalid initial config with @fluxgantt/react context (review finding)', () => {
    // A cyclic initial dependency makes createGantt throw during render; the hook wraps it
    // with an actionable, context-tagged message rather than surfacing the raw core error.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {}); // silence RTL's render-error log
    expect(() =>
      renderHook(() =>
        useFluxGantt({
          tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'), taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00')],
          dependencies: [
            { from: toTaskId('a'), to: toTaskId('b'), type: 'FS' },
            { from: toTaskId('b'), to: toTaskId('a'), type: 'FS' }, // cycle
          ],
        }),
      ),
    ).toThrow(/\[@fluxgantt\/react\] invalid initial config/);
    spy.mockRestore();
  });
});
