// `withConflicts()` tests (spec-detect-conflicts.md §7). Node environment on purpose: the mixin is
// headless, so there is no `document` anywhere in this file. `flush()` waits one microtask turn.
import { describe, it, expect, expectTypeOf, vi, afterEach } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withIo } from '../../src/io/mixin.js';
import { withConflicts } from '../../src/conflicts/mixin.js';
import { computeRollup } from '../../src/compute/rollup.js';
import { getInternal } from '../../src/gantt-internal.js';
import type * as ConflictsModule from '../../src/compute/conflicts.js';
import { toTaskId, type Conflict } from '../../src/types.js';
import type { GanttConfig } from '../../src/gantt.js';
import type { TaskInput } from '../../src/store/index.js';

const detectSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../src/compute/conflicts.js', async (importActual) => {
  const actual = await importActual<typeof ConflictsModule>();
  return {
    ...actual,
    detectConflicts: (...args: Parameters<typeof actual.detectConflicts>) => {
      detectSpy.calls++;
      return actual.detectConflicts(...args);
    },
  };
});

const A = toTaskId('a');
const B = toTaskId('b');
const flush = () => new Promise<void>((r) => queueMicrotask(r));
const task = (id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: toTaskId(id),
  name: id,
  start,
  end,
  progress: 0,
  type: 'task',
  ...extra,
});

/** A -> B (FS). A is Mon 09:00-17:00; B starts Tue, i.e. satisfied. */
function make(extra: Partial<GanttConfig> = {}) {
  const g = withConflicts(
    createGantt({
      tasks: [task('a', '2026-01-05T09:00', '2026-01-05T17:00'), task('b', '2026-01-06T09:00', '2026-01-06T10:00')],
      dependencies: [{ from: A, to: B, type: 'FS' }],
      ...extra,
    }),
  );
  const seen: (readonly Conflict[])[] = [];
  return { g, seen, off: g.on('conflict:detected', (c) => seen.push(c)) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withConflicts — detectConflicts()', () => {
  it('is a pure query: reports the current set, never emits', async () => {
    const g = withConflicts(
      createGantt({
        tasks: [task('a', '2026-01-05T09:00', '2026-01-05T17:00'), task('b', '2026-01-05T10:00', '2026-01-05T11:00')],
        dependencies: [{ from: A, to: B, type: 'FS' }],
      }),
    );
    const seen: unknown[] = [];
    g.on('conflict:detected', (c) => seen.push(c));
    expect(g.detectConflicts()).toHaveLength(1);
    expect(g.detectConflicts()).not.toBe(g.detectConflicts());
    await flush();
    expect(seen).toEqual([]);
  });

  it('returns [] after destroy()', () => {
    const { g } = make();
    g.destroy();
    expect(g.detectConflicts()).toEqual([]);
  });

  it('applies `kinds` and drops outside-parent under a rollup provider', () => {
    const tasks = [
      task('p', '2026-01-06T09:00', '2026-01-06T17:00', { type: 'summary' }),
      task('c', '2026-01-05T09:00', '2026-01-06T17:00', { parent: toTaskId('p') }),
    ];
    expect(withConflicts(createGantt({ tasks })).detectConflicts().map((c) => c.kind)).toEqual(['outside-parent']);
    expect(withConflicts(createGantt({ tasks }), { kinds: ['invalid-span'] }).detectConflicts()).toEqual([]);
    expect(withConflicts(createGantt({ tasks, rollup: computeRollup })).detectConflicts()).toEqual([]);
  });

  it('throws on a poisoned lag (the explicit call surfaces the real error)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // the watcher also notices
    const { g } = make();
    g.addTask(task('c', '2026-01-06T09:00', '2026-01-06T10:00'));
    getInternal(g).dependencyStore.link(B, toTaskId('c'), 'FS', { lag: Number.NaN });
    expect(() => g.detectConflicts()).toThrow(/invalid lag/);
  });

  it('works headless in Node (no document)', () => {
    expect(typeof document).toBe('undefined');
    expect(make().g.detectConflicts()).toEqual([]);
  });
});

describe('withConflicts — conflict:detected', () => {
  it('manual mode: one emission when a move breaks the dependency, one [] when it is repaired', async () => {
    const { g, seen } = make();
    g.moveTask(B, '2026-01-05T16:00');
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject([{ kind: 'dependency-violation', from: 'a', to: 'b' }]);
    g.moveTask(B, '2026-01-06T09:00');
    await flush();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual([]);
  });

  it('is silent on subscribe to an already-conflicted chart, then reports a change', async () => {
    const g = withConflicts(
      createGantt({
        tasks: [task('a', '2026-01-05T09:00', '2026-01-05T17:00'), task('b', '2026-01-05T16:00', '2026-01-05T17:00')],
        dependencies: [{ from: A, to: B, type: 'FS' }],
      }),
    );
    const seen: (readonly Conflict[])[] = [];
    g.on('conflict:detected', (c) => seen.push(c));
    await flush();
    expect(seen).toEqual([]);
    g.moveTask(B, '2026-01-05T15:00');
    await flush();
    expect(seen).toHaveLength(1); // shortfall changed 1 -> 2
    expect(seen[0]).toMatchObject([{ shortfallHours: 2 }]);
  });

  it('does not emit for changes that leave the set unchanged', async () => {
    const { g, seen } = make();
    g.setProgress(A, 0.5);
    g.select(A);
    g.zoomTo('month');
    g.moveTask(B, '2026-01-07T09:00'); // still satisfied
    await flush();
    expect(seen).toEqual([]);
  });

  it('coalesces several mutations in one tick into one emission', async () => {
    const { g, seen } = make();
    g.moveTask(B, '2026-01-05T16:00');
    g.moveTask(B, '2026-01-05T15:00');
    g.moveTask(B, '2026-01-05T14:00');
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject([{ shortfallHours: 3 }]);
  });

  it('auto mode: a predecessor move that cascades announces nothing (no transient violation)', async () => {
    const { g, seen } = make({ schedulingMode: 'auto' });
    g.moveTask(A, '2026-01-07T09:00');
    await flush();
    expect(g.detectConflicts()).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('undo() and redo() drive emissions', async () => {
    const { g, seen } = make();
    g.moveTask(B, '2026-01-05T16:00');
    await flush();
    g.undo();
    await flush();
    g.redo();
    await flush();
    expect(seen.map((s) => s.length)).toEqual([1, 0, 1]);
  });

  it('importJson() drives an emission and round-trips the conflicts', async () => {
    const src = createGantt({
      tasks: [
        task('a', '2026-01-05T09:00', '2026-01-05T17:00'),
        task('b', '2026-01-05T10:00', '2026-01-05T11:00'),
        task('p', '2026-01-06T09:00', '2026-01-06T17:00', { type: 'summary' }),
        task('c', '2026-01-05T09:00', '2026-01-06T17:00', { parent: toTaskId('p') }),
      ],
      dependencies: [{ from: A, to: B, type: 'FS' }],
    });
    const bundle = withIo(src).exportJson();
    const dst = withConflicts(withIo(createGantt({ tasks: [] })));
    const seen: (readonly Conflict[])[] = [];
    dst.on('conflict:detected', (c) => seen.push(c));
    dst.importJson(bundle);
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.map((c) => c.kind)).toEqual(['dependency-violation', 'outside-parent']);
    // Dependency ids are regenerated on import, so compare everything else.
    const strip = (cs: readonly Conflict[]) => cs.map(({ ...c }) => ({ ...c, dependencyId: undefined }));
    expect(strip(dst.detectConflicts())).toEqual(strip(withConflicts(src).detectConflicts()));
    const again = withConflicts(withIo(createGantt({ tasks: [] })));
    again.importJson(dst.exportJson());
    expect(again.detectConflicts().map((c) => c.kind)).toEqual(['dependency-violation', 'outside-parent']);
  });
});

describe('withConflicts — lifecycle', () => {
  it('runs no detection with zero listeners, stops after the last unsubscribe, double unsubscribe is a no-op', async () => {
    const g = withConflicts(
      createGantt({
        tasks: [task('a', '2026-01-05T09:00', '2026-01-05T17:00'), task('b', '2026-01-06T09:00', '2026-01-06T10:00')],
        dependencies: [{ from: A, to: B, type: 'FS' }],
      }),
    );
    detectSpy.calls = 0;
    g.moveTask(B, '2026-01-05T16:00');
    await flush();
    expect(detectSpy.calls).toBe(0);

    const offA = g.on('conflict:detected', () => {});
    const offB = g.on('conflict:detected', () => {});
    const afterStart = detectSpy.calls; // the silent baseline
    expect(afterStart).toBe(1);
    g.moveTask(B, '2026-01-05T15:00');
    await flush();
    expect(detectSpy.calls).toBe(afterStart + 1); // one shared watcher
    offA();
    offA();
    g.moveTask(B, '2026-01-05T14:00');
    await flush();
    expect(detectSpy.calls).toBe(afterStart + 2); // still one listener left
    offB();
    g.moveTask(B, '2026-01-05T13:00');
    await flush();
    expect(detectSpy.calls).toBe(afterStart + 2);
  });

  it('multiple listeners each get the payload; a throwing listener does not break the others', async () => {
    const { g, seen } = make();
    const second: unknown[] = [];
    g.on('conflict:detected', () => {
      throw new Error('listener boom');
    });
    g.on('conflict:detected', (c) => second.push(c));
    g.moveTask(B, '2026-01-05T16:00');
    await flush();
    expect(seen).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it('is idempotent: applying it twice yields one emission per change', async () => {
    const { g, seen } = make();
    expect(withConflicts(g)).toBe(g);
    g.moveTask(B, '2026-01-05T16:00');
    await flush();
    expect(seen).toHaveLength(1);
  });

  it('destroy() before the microtask runs emits nothing and does not throw', async () => {
    const { g, seen } = make();
    g.moveTask(B, '2026-01-05T16:00');
    g.destroy();
    await flush();
    expect(seen).toEqual([]);
    g.destroy();
  });

  it('subscribing after destroy() is a no-op', () => {
    const { g } = make();
    g.destroy();
    expect(() => g.on('conflict:detected', () => {})()).not.toThrow();
  });

  it('a poisoned lag makes the watcher console.warn instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { g, seen } = make();
    g.addTask(task('c', '2026-01-06T09:00', '2026-01-06T10:00'));
    getInternal(g).dependencyStore.link(B, toTaskId('c'), 'FS', { lag: Number.NaN });
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('@fluxgantt/core:'), expect.anything());
    expect(seen).toEqual([]);
  });
});

describe('withConflicts — types', () => {
  it('types the payload and allows an exhaustive switch with a default branch', () => {
    const { g } = make();
    g.on('conflict:detected', (conflicts) => {
      expectTypeOf(conflicts).toEqualTypeOf<readonly Conflict[]>();
      for (const c of conflicts) {
        switch (c.kind) {
          case 'dependency-violation':
            expectTypeOf(c.requiredStart.epochMilliseconds).toBeNumber();
            break;
          case 'outside-parent':
            expectTypeOf(c.edge).toEqualTypeOf<'start' | 'end' | 'both'>();
            break;
          case 'invalid-span':
            expectTypeOf(c.taskId).toEqualTypeOf<ReturnType<typeof toTaskId>>();
            break;
        }
      }
    });
    expectTypeOf(g.detectConflicts).returns.toEqualTypeOf<Conflict[]>();
  });
});

describe('withConflicts — review regressions', () => {
  it('a stopped watcher\'s pending flush does not emit through a re-subscribed one (StrictMode shape)', async () => {
    const { g, off } = make();
    g.moveTask(B, '2026-01-05T16:00'); // watcher #1 schedules a flush
    off(); // stops watcher #1
    const seen: (readonly Conflict[])[] = [];
    g.on('conflict:detected', (c) => seen.push(c)); // watcher #2: baseline already has the conflict
    await flush();
    expect(seen).toEqual([]);
    g.moveTask(B, '2026-01-05T15:00');
    await flush();
    expect(seen).toHaveLength(1); // exactly one, not two
  });

  it('re-emits when only requiredStart changes (shortfall unchanged)', async () => {
    const g = withConflicts(
      createGantt({
        tasks: [task('a', '2026-01-05T09:00', '2026-01-05T17:00'), task('b', '2026-01-05T15:00', '2026-01-05T16:00')],
        dependencies: [{ from: A, to: B, type: 'FS' }],
      }),
    );
    const seen: (readonly Conflict[])[] = [];
    g.on('conflict:detected', (c) => seen.push(c));
    // Shift the whole block one working day later in the same tick: shortfall stays 2 h.
    g.moveTask(A, '2026-01-06T09:00');
    g.moveTask(B, '2026-01-06T15:00');
    await flush();
    expect(seen).toHaveLength(1);
    const c = seen[0]?.[0];
    expect(c).toMatchObject({ kind: 'dependency-violation', shortfallHours: 2 });
    if (c?.kind !== 'dependency-violation') throw new Error('expected violation');
    expect(c.requiredStart.toPlainDate().toString()).toBe('2026-01-06');
  });

  it('warns once when applied again with different kinds, silent when equal', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const g = withConflicts(createGantt({ tasks: [], dependencies: [] }), { kinds: ['invalid-span'] });
    withConflicts(g, { kinds: ['invalid-span'] });
    expect(warn).not.toHaveBeenCalled();
    withConflicts(g, { kinds: ['dependency-violation'] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('@fluxgantt/core:');
  });

  it("auto mode: after moveTask(x) every remaining violation has to === x", () => {
    const g = withConflicts(
      createGantt({
        schedulingMode: 'auto',
        tasks: [
          task('a', '2026-01-05T09:00', '2026-01-05T17:00'),
          task('b', '2026-01-06T09:00', '2026-01-06T17:00'),
          task('c', '2026-01-07T09:00', '2026-01-07T17:00'),
        ],
        dependencies: [
          { from: A, to: B, type: 'FS' },
          { from: B, to: toTaskId('c'), type: 'FS' },
          { from: A, to: toTaskId('c'), type: 'SS' },
        ],
      }),
    );
    g.moveTask(B, '2026-01-05T10:00'); // the mover is authoritative: A -> B stays violated
    const remaining = g.detectConflicts().filter((c) => c.kind === 'dependency-violation');
    expect(remaining.length).toBeGreaterThan(0);
    for (const c of remaining) expect(c.kind === 'dependency-violation' && c.to).toBe(B);
  });
});
