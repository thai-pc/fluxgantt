// Compile-level + behavioural proof that the documented `withConflicts(instance)` recipe works on
// the wrapper's instance (spec-detect-conflicts.md §9). The wrappers deliberately do not compose it.
import { describe, it, expect, expectTypeOf } from 'vitest';
import { useEffect, useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { toTaskId } from '@fluxgantt/core';
import type { Conflict, TaskInput } from '@fluxgantt/core';
import { withConflicts } from '@fluxgantt/core/conflicts';
import { useFluxGantt } from '../src/use-flux-gantt.js';

const task = (id: string, start: string, end: string): TaskInput => ({
  id: toTaskId(id),
  name: id,
  start,
  end,
  progress: 0,
  type: 'task',
});

// Hoisted: the wrapper treats `tasks`/`dependencies` as an uncontrolled initial value.
const violatedConfig = {
  // Loads already violated: b starts before a ends.
  tasks: [task('a', '2026-01-05T09:00', '2026-01-05T17:00'), task('b', '2026-01-05T10:00', '2026-01-05T11:00')],
  dependencies: [{ from: toTaskId('a'), to: toTaskId('b'), type: 'FS' as const }],
};

describe('withConflicts(instance) on the React wrapper instance', () => {
  it('type-checks, types the event payload, and reports a violation', async () => {
    const { result } = renderHook(() =>
      useFluxGantt({
        tasks: [task('a', '2026-01-05T09:00', '2026-01-05T17:00'), task('b', '2026-01-06T09:00', '2026-01-06T10:00')],
        dependencies: [{ from: toTaskId('a'), to: toTaskId('b'), type: 'FS' }],
      }),
    );
    const { instance } = result.current;
    const withC = withConflicts(instance);
    expect(withC).toBe(instance);
    expect(withConflicts(instance)).toBe(instance); // idempotent (StrictMode)
    const seen: (readonly Conflict[])[] = [];
    withC.on('conflict:detected', (c) => {
      expectTypeOf(c).toEqualTypeOf<readonly Conflict[]>();
      seen.push(c);
    });
    withC.moveTask(toTaskId('b'), '2026-01-05T16:00');
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    expect(withC.detectConflicts()).toHaveLength(1);
  });

  it('the documented recipe seeds the initial state and tracks changes (useState<readonly Conflict[]>)', async () => {
    const { result } = renderHook(() => {
      const { instance } = useFluxGantt(violatedConfig);
      const [conflicts, setConflicts] = useState<readonly Conflict[]>([]);
      useEffect(() => {
        const g = withConflicts(instance);
        setConflicts(g.detectConflicts());
        return g.on('conflict:detected', setConflicts);
      }, [instance]);
      return { instance, conflicts };
    });
    expect(result.current.conflicts).toHaveLength(1); // initial state, no event needed
    await act(async () => {
      result.current.instance.moveTask(toTaskId('b'), '2026-01-06T09:00');
      await Promise.resolve();
    });
    expect(result.current.conflicts).toEqual([]);
  });
});
