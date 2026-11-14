// @vitest-environment jsdom
// A write command either fully applies (store + history + events) or changes NOTHING and throws.
// Covers `updateTask` / `moveTask` / `resizeTask` / `setProgress` (one `#applyPatch` path), the
// cascade they trigger, and `duplicateTask`. A throwing `onTaskChange` hook is deliberately NOT
// here: it is a post-commit notification (see mutation-batching-mounted.test.ts).
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../helpers/create-gantt.js';
import type { GanttConfig } from '../../src/gantt.js';
import { getInternal } from '../../src/gantt-internal.js';
import { CyclicDependencyError } from '../../src/compute/dependency-math.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import { createRecorder } from '../helpers/event-log.js';

const id = toTaskId;
const t = (name: string, start: string, end: string): TaskInput => ({
  id: id(name),
  name,
  start,
  end,
  progress: 0,
  type: 'task',
});
const world = (extra: Partial<GanttConfig> = {}): GanttConfig => ({
  tasks: [
    t('a', '2026-01-05T09:00', '2026-01-06T17:00'),
    t('b', '2026-01-07T09:00', '2026-01-08T17:00'),
    t('c', '2026-01-09T09:00', '2026-01-12T17:00'),
  ],
  dependencies: [
    { from: id('a'), to: id('b'), type: 'FS' },
    { from: id('b'), to: id('c'), type: 'FS' },
  ],
  ...extra,
});

type G = ReturnType<typeof createGantt>;
/** Everything a failed command must leave alone. */
function state(g: G) {
  const internal = getInternal(g);
  return {
    tasks: g.getTasks(),
    deps: g.getDependencies(),
    rev: [internal.tasks.revision.peek(), internal.deps.revision.peek()],
    canUndo: g.canUndo(),
    canRedo: g.canRedo(),
  };
}
/** Run `fn`, which must throw, and assert nothing changed and nothing was emitted. */
function expectUntouched(g: G, fn: () => unknown, error?: unknown): void {
  const rec = createRecorder();
  const detach = rec.attach(g);
  const before = state(g);
  expect(fn).toThrow(error as never);
  expect(state(g)).toEqual(before);
  expect(rec.log).toEqual([]);
  detach();
}

describe('a failing write changes nothing', () => {
  it.each([
    ['start', { start: 'not-a-date' }],
    ['end', { end: 'also-not' }],
  ])('updateTask with a bad %s', (_n, patch) => {
    const g = createGantt(world());
    g.setProgress(id('a'), 0.5); // one prior history entry
    expectUntouched(g, () => g.updateTask(id('a'), patch as never));
    expect(g.undo()).toBe(true); // exactly ONE entry was recorded: the earlier one
    expect(g.canUndo()).toBe(false);
  });

  it('onTaskChange is not called for a rejected patch', () => {
    const onTaskChange = vi.fn();
    const g = createGantt(world({ onTaskChange }));
    expect(() => g.updateTask(id('a'), { start: 'nope' })).toThrow();
    expect(onTaskChange).not.toHaveBeenCalled();
  });

  it('moveTask with a bad date, resizeTask / setProgress with bad numbers', () => {
    const g = createGantt(world());
    expectUntouched(g, () => g.moveTask(id('a'), 'nope'));
    expectUntouched(g, () => g.resizeTask(id('a'), -3));
    expectUntouched(g, () => g.resizeTask(id('a'), NaN));
    expectUntouched(g, () => g.setProgress(id('a'), 2));
    expectUntouched(g, () => g.setProgress(id('a'), NaN));
    expectUntouched(g, () => g.updateTask(id('zzz'), { progress: 1 }));
  });

  it('a cascade that throws rolls the whole command back (nothing was written first)', () => {
    const g = createGantt(world({ schedulingMode: 'auto' }));
    getInternal(g).deps.link(id('c'), id('b'), 'FS', { allowCycle: true });
    expectUntouched(g, () => g.moveTask(id('b'), '2026-01-19T09:00'), CyclicDependencyError);
    expectUntouched(g, () => g.updateTask(id('b'), { duration: 8 }), CyclicDependencyError);
    expectUntouched(g, () => g.resizeTask(id('b'), 16), CyclicDependencyError);
  });

  it('a throwing cascade on a mounted chart does not repaint or emit', () => {
    const g = createGantt(world({ schedulingMode: 'auto' }));
    const el = document.createElement('div');
    document.body.append(el);
    g.mount(el);
    getInternal(g).deps.link(id('c'), id('b'), 'FS', { allowCycle: true });
    expectUntouched(g, () => g.moveTask(id('b'), '2026-01-19T09:00'), CyclicDependencyError);
    g.destroy();
    el.remove();
  });

  it('duplicateTask whose LAST source throws leaves no copy of the earlier ones', () => {
    const g = createGantt(world());
    g.addTask({ ...t('bad', '2026-01-05T09:00', '2026-01-06T17:00'), duration: Infinity });
    g.select([id('a'), id('bad')]);
    expectUntouched(g, () => g.duplicateTask());
  });
});

describe('a successful write is unchanged', () => {
  it('updateTask: events, order, one history entry, payloads', () => {
    const g = createGantt(world({ schedulingMode: 'auto' }));
    const rec = createRecorder();
    rec.attach(g);
    g.moveTask(id('a'), '2026-01-06T09:00');
    expect(rec.log.join('\n')).toMatch(/task:moved a.*\n.*/);
    expect(rec.log.filter((l) => l.startsWith('task:moved'))).toHaveLength(3); // a, b, c
    g.undo();
    expect(g.canUndo()).toBe(false); // the cascade collapsed into ONE entry
  });

  it('a cascade planned on the draft shifts the same tasks the old path did', () => {
    const g = createGantt(world({ schedulingMode: 'auto' }));
    g.resizeTask(id('a'), 32);
    const [a, b] = [g.getTask(id('a'))!, g.getTask(id('b'))!];
    expect(String(b.start) >= String(a.end)).toBe(true);
  });
});

describe('property: a throwing command leaves the state exactly as it was', () => {
  const dateArb = fc.oneof(
    fc.constantFrom('not-a-date', '', '2026-13-45', 'x'),
    fc.integer({ min: 0, max: 20 }).map((d) => `2026-02-${String(d + 1).padStart(2, '0')}T09:00`),
  );
  const numArb = fc.oneof(fc.constantFrom(NaN, Infinity, -1, 7), fc.double({ min: 0, max: 1, noNaN: true }));
  const patchArb = fc.record(
    { start: dateArb, end: dateArb, progress: numArb, duration: numArb, name: fc.string() },
    { requiredKeys: [] },
  );
  const cmdArb = fc.oneof(
    fc.record({ k: fc.constant('update' as const), n: fc.integer({ min: 0, max: 2 }), patch: patchArb }),
    fc.record({ k: fc.constant('move' as const), n: fc.integer({ min: 0, max: 2 }), d: dateArb }),
    fc.record({ k: fc.constant('resize' as const), n: fc.integer({ min: 0, max: 2 }), h: numArb }),
    fc.record({ k: fc.constant('progress' as const), n: fc.integer({ min: 0, max: 2 }), p: numArb }),
  );

  it('state, history and events survive any failing command', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.array(cmdArb, { minLength: 1, maxLength: 12 }), (auto, cyclic, cmds) => {
        const g = createGantt(world(auto ? { schedulingMode: 'auto' } : {}));
        if (cyclic) getInternal(g).deps.link(id('c'), id('a'), 'FS', { allowCycle: true });
        const rec = createRecorder();
        rec.attach(g);
        for (const c of cmds) {
          const tid = id(['a', 'b', 'c'][c.n]!);
          const before = state(g);
          rec.clear();
          try {
            if (c.k === 'update') g.updateTask(tid, c.patch as never);
            else if (c.k === 'move') g.moveTask(tid, c.d);
            else if (c.k === 'resize') g.resizeTask(tid, c.h);
            else g.setProgress(tid, c.p);
          } catch {
            expect(state(g)).toEqual(before);
            expect(rec.log).toEqual([]);
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});
