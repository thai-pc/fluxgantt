// Compile-level + behavioural proof that the documented `withConflicts(instance)` recipe works on
// the wrapper's instance (spec-detect-conflicts.md §9). The wrappers deliberately do not compose it.
import { describe, it, expect, expectTypeOf } from 'vitest';
import { defineComponent, h, onMounted, onUnmounted, shallowRef } from 'vue';
import { mount } from '@vue/test-utils';
import { toTaskId } from '@fluxgantt/core';
import type { Conflict, TaskInput } from '@fluxgantt/core';
import { withConflicts } from '@fluxgantt/core/conflicts';
import { useFluxGantt } from '../src/use-flux-gantt.js';
import type { UseFluxGanttResult } from '../src/types.js';

const task = (id: string, start: string, end: string): TaskInput => ({
  id: toTaskId(id),
  name: id,
  start,
  end,
  progress: 0,
  type: 'task',
});

describe('withConflicts(instance) on the Vue wrapper instance', () => {
  it('type-checks, types the event payload, and reports a violation', async () => {
    let result: UseFluxGanttResult | undefined;
    const Host = defineComponent({
      setup() {
        const r = useFluxGantt({
          tasks: [task('a', '2026-01-05T09:00', '2026-01-05T17:00'), task('b', '2026-01-06T09:00', '2026-01-06T10:00')],
          dependencies: [{ from: toTaskId('a'), to: toTaskId('b'), type: 'FS' }],
        });
        result = r;
        return () => h('div', { ref: r.containerRef });
      },
    });
    mount(Host);
    const instance = result!.instance;
    const withC = withConflicts(instance);
    expect(withC).toBe(instance);
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

  it('the documented recipe seeds a shallowRef<readonly Conflict[]> and tracks changes', async () => {
    const conflicts = shallowRef<readonly Conflict[]>([]);
    let result: UseFluxGanttResult | undefined;
    const Host = defineComponent({
      setup() {
        const r = useFluxGantt({
          // Loads already violated: b starts before a ends.
          tasks: [task('a', '2026-01-05T09:00', '2026-01-05T17:00'), task('b', '2026-01-05T10:00', '2026-01-05T11:00')],
          dependencies: [{ from: toTaskId('a'), to: toTaskId('b'), type: 'FS' }],
        });
        result = r;
        let off: (() => void) | undefined;
        onMounted(() => {
          const g = withConflicts(r.instance);
          conflicts.value = g.detectConflicts();
          off = g.on('conflict:detected', (c) => {
            conflicts.value = c;
          });
        });
        onUnmounted(() => off?.());
        return () => h('div', { ref: r.containerRef });
      },
    });
    mount(Host);
    expect(conflicts.value).toHaveLength(1); // initial state, no event needed
    result!.instance.moveTask(toTaskId('b'), '2026-01-06T09:00');
    await Promise.resolve();
    expect(conflicts.value).toEqual([]);
  });
});
