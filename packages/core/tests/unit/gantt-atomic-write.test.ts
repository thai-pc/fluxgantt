// @vitest-environment jsdom
//
// A write command either fully applies (store + history + events) or changes NOTHING and throws.
// Covers `updateTask` / `moveTask` / `resizeTask` / `setProgress`, the cascade they trigger and
// `duplicateTask`. A throwing `onTaskChange` hook is deliberately NOT rolled back (it is a
// post-commit notification, see mutation-batching-mounted.test.ts); exact success-path event order
// is pinned by mutation-golden.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../helpers/create-gantt.js';
import type { GanttConfig } from '../../src/gantt.js';
import { getInternal } from '../../src/gantt-internal.js';
import { CyclicDependencyError } from '../../src/compute/dependency-math.js';
import { computeCascade } from '../../src/compute/cascade.js';
import { TaskStore } from '../../src/store/index.js';
import { toTaskId, type DependencyType, type WorkingCalendar } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import { createRecorder, type EventRecorder } from '../helpers/event-log.js';

const id = toTaskId;
const t = (name: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: id(name),
  name,
  start,
  end,
  progress: 0,
  type: 'task',
  ...extra,
});
const baseConfig = (): GanttConfig => ({
  tasks: [
    t('a', '2026-01-05T09:00', '2026-01-06T17:00'),
    t('b', '2026-01-07T09:00', '2026-01-08T17:00'),
    t('c', '2026-01-09T09:00', '2026-01-12T17:00'),
  ],
  dependencies: [
    { from: id('a'), to: id('b'), type: 'FS' },
    { from: id('b'), to: id('c'), type: 'FS' },
  ],
});

type G = ReturnType<typeof createGantt>;
function make(extra: Partial<GanttConfig> = {}, config: GanttConfig = baseConfig()): { g: G; rec: EventRecorder } {
  const rec = createRecorder();
  const g = createGantt({ ...config, ...extra, onTaskChange: rec.onTaskChange });
  rec.attach(g);
  rec.clear();
  return { g, rec };
}

/** Everything a failed command must leave alone. Tasks are compared BY IDENTITY: the store
 *  replaces the object on every write, so an unchanged store returns the very same objects. */
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
function expectSame(g: G, before: ReturnType<typeof state>): void {
  const now = state(g);
  expect(now.tasks.length).toBe(before.tasks.length);
  now.tasks.forEach((task, i) => expect(task).toBe(before.tasks[i]));
  expect(now.deps).toEqual(before.deps);
  expect(now.rev).toEqual(before.rev);
  expect(now.canUndo).toBe(before.canUndo);
  expect(now.canRedo).toBe(before.canRedo);
}
/** Run `fn`, which must throw, and assert nothing changed, no event fired, no hook ran. */
function expectUntouched(g: G, rec: EventRecorder, fn: () => unknown, error?: unknown): void {
  const before = state(g);
  rec.clear();
  expect(fn).toThrow(error as never);
  expectSame(g, before);
  expect(rec.log).toEqual([]); // events AND onTaskChange are in the recorder
}

describe('a failing write changes nothing', () => {
  it.each([
    ['start', { start: 'not-a-date' }],
    ['end', { end: 'also-not' }],
  ])('updateTask with a bad %s', (_n, patch) => {
    const { g, rec } = make();
    g.setProgress(id('a'), 0.5); // one prior history entry
    expectUntouched(g, rec, () => g.updateTask(id('a'), patch as never));
    expect(g.undo()).toBe(true); // exactly ONE entry was recorded: the earlier one
    expect(g.canUndo()).toBe(false);
  });

  it('moveTask with a bad date, resizeTask / setProgress with bad numbers, a missing id', () => {
    const { g, rec } = make();
    expectUntouched(g, rec, () => g.moveTask(id('a'), 'nope'));
    expectUntouched(g, rec, () => g.resizeTask(id('a'), -3));
    expectUntouched(g, rec, () => g.resizeTask(id('a'), NaN));
    expectUntouched(g, rec, () => g.setProgress(id('a'), 2));
    expectUntouched(g, rec, () => g.setProgress(id('a'), NaN));
    expectUntouched(g, rec, () => g.updateTask(id('zzz'), { progress: 1 }));
  });

  it('a cascade that throws changes nothing (nothing was written first)', () => {
    const { g, rec } = make({ schedulingMode: 'auto' });
    getInternal(g).deps.link(id('c'), id('b'), 'FS', { allowCycle: true });
    expectUntouched(g, rec, () => g.moveTask(id('b'), '2026-01-19T09:00'), CyclicDependencyError);
    expectUntouched(g, rec, () => g.updateTask(id('b'), { duration: 8 }), CyclicDependencyError);
    expectUntouched(g, rec, () => g.resizeTask(id('b'), 16), CyclicDependencyError);
  });

  describe('a STORED task whose date does not parse (addTask validates nothing)', () => {
    const bad = (extra: Partial<TaskInput> = {}) => {
      const m = make();
      m.g.addTask(t('x', 'garbage', '2026-01-06T17:00', extra));
      m.rec.clear();
      return m;
    };
    it('updateTask, even one that would repair the bad field, throws before the write', () => {
      const { g, rec } = bad();
      expectUntouched(g, rec, () => g.updateTask(id('x'), { start: '2026-01-05T09:00' }));
      expectUntouched(g, rec, () => g.updateTask(id('x'), { name: 'renamed' }));
    });
    it('moveTask', () => {
      const { g, rec } = bad();
      expectUntouched(g, rec, () => g.moveTask(id('x'), '2026-01-05T09:00'));
    });
    it('resizeTask, with the end bad too', () => {
      const m = make();
      m.g.addTask(t('y', '2026-01-05T09:00', 'garbage'));
      m.rec.clear();
      expectUntouched(m.g, m.rec, () => m.g.resizeTask(id('y'), 8));
    });
    it('setProgress', () => {
      const { g, rec } = bad();
      expectUntouched(g, rec, () => g.setProgress(id('x'), 0.5));
    });
  });

  it('a runtime `id` key in an untyped patch is ignored, as before', () => {
    const { g } = make({ schedulingMode: 'auto' });
    g.updateTask(id('a'), { id: id('b'), end: '2026-01-07T17:00' } as never);
    expect(g.getTask(id('a'))!.id).toBe(id('a'));
  });

  describe('duplicateTask', () => {
    const withBadLast = () => {
      const m = make();
      m.g.addTask({ ...t('bad', '2026-01-05T09:00', '2026-01-06T17:00'), duration: Infinity });
      m.rec.clear();
      return m;
    };
    it('whose LAST selected source throws leaves no copy of the earlier ones', () => {
      const { g, rec } = withBadLast();
      g.select([id('a'), id('bad')]);
      expectUntouched(g, rec, () => g.duplicateTask());
    });
    it('with an explicit bad source id', () => {
      const { g, rec } = withBadLast();
      expectUntouched(g, rec, () => g.duplicateTask(id('bad')));
    });
    it('with an unknown explicit id', () => {
      const { g, rec } = make();
      expectUntouched(g, rec, () => g.duplicateTask(id('nope')), /not found/);
    });
    it('a stale selected id now throws before any copy is made (it used to be skipped)', () => {
      const { g, rec } = make();
      g.select([id('a')]);
      getInternal(g).sel.replace([id('a'), id('ghost')]);
      expectUntouched(g, rec, () => g.duplicateTask(), /not found/);
    });
  });
});

describe('a failing command on a mounted chart does not repaint', () => {
  let container: HTMLElement;
  let paints = 0;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const realAppend = Element.prototype.append;
    vi.spyOn(Element.prototype, 'append').mockImplementation(function (this: Element, ...nodes: Array<Node | string>) {
      if (this.classList.contains('fg-timeline') && (nodes[0] as Element | undefined)?.nodeName === 'defs') paints++;
      realAppend.apply(this, nodes);
    });
  });
  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });
  it('bad date, cascade cycle, bad progress', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the mount-time critical path logs the planted cycle
    const { g, rec } = make({ schedulingMode: 'auto' });
    getInternal(g).deps.link(id('c'), id('b'), 'FS', { allowCycle: true });
    g.mount(container);
    paints = 0;
    expectUntouched(g, rec, () => g.updateTask(id('a'), { start: 'nope' }));
    expectUntouched(g, rec, () => g.moveTask(id('b'), '2026-01-19T09:00'), CyclicDependencyError);
    expectUntouched(g, rec, () => g.setProgress(id('a'), 5));
    expect(paints).toBe(0);
    g.destroy();
  });
});

describe('a successful write is unchanged', () => {
  it('moveTask with a cascade: exact event order, one history entry', () => {
    const { g, rec } = make({ schedulingMode: 'auto' });
    g.moveTask(id('a'), '2026-01-06T09:00');
    expect(rec.log.map((l) => l.split(' ')[0])).toEqual([
      'task:moved',
      'onTaskChange',
      'task:updated',
      'task:moved',
      'onTaskChange',
      'task:updated',
      'task:moved',
      'onTaskChange',
      'task:updated',
      'history:changed', // the group commits once, after the last write
    ]);
    expect(rec.log.filter((l) => l.startsWith('history:changed'))).toHaveLength(1);
    g.undo();
    expect(g.canUndo()).toBe(false);
  });
});

// ---- Reference model: the OLD write-then-cascade path --------------------------------------
const TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];
const day = (n: number) => `2026-02-${String(n + 1).padStart(2, '0')}T09:00`;
const CALENDARS: Array<WorkingCalendar | undefined> = [
  undefined,
  {
    workingDays: ['mon', 'tue', 'wed', 'thu'],
    workingHours: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '16:00' }],
    holidays: ['2026-02-10'],
    timezone: 'America/New_York',
  } as WorkingCalendar,
];
const dagArb = fc.record({
  n: fc.integer({ min: 2, max: 5 }),
  edges: fc.array(
    fc.record({
      a: fc.integer({ min: 0, max: 3 }),
      d: fc.integer({ min: 1, max: 3 }),
      type: fc.constantFrom(...TYPES),
      lag: fc.integer({ min: -8, max: 16 }),
    }),
    { maxLength: 6 },
  ),
  cal: fc.integer({ min: 0, max: CALENDARS.length - 1 }),
});
const buildConfig = (m: { n: number; edges: Array<{ a: number; d: number; type: DependencyType; lag: number }>; cal: number }): GanttConfig => {
  const names = Array.from({ length: m.n }, (_, i) => `t${i}`);
  const seen = new Set<string>();
  const dependencies = [];
  for (const e of m.edges) {
    const from = e.a % m.n;
    const to = (from + e.d) % m.n;
    if (to <= from) continue; // forward edges only: a DAG
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dependencies.push({ from: id(names[from]!), to: id(names[to]!), type: e.type, lag: e.lag });
  }
  const cal = CALENDARS[m.cal];
  return {
    tasks: names.map((n, i) => t(n, day(i * 2), day(i * 2 + 1))),
    dependencies,
    schedulingMode: 'auto',
    ...(cal ? { calendar: cal } : {}),
  };
};
const snap = (tasks: ReadonlyArray<{ id: string; start: unknown; end: unknown; duration?: number; type: string }>) =>
  tasks.map((x) => `${x.id} ${String(x.start)} ${String(x.end)} ${x.duration ?? ''} ${x.type}`);

describe('property: plan-then-write equals the old write-then-cascade path', () => {
  it('same final tasks (or both throw) over random DAGs, link types, lags, calendars and patches', () => {
    fc.assert(
      fc.property(
        dagArb,
        fc.integer({ min: 0, max: 4 }),
        fc.record(
          {
            start: fc.integer({ min: 0, max: 20 }).map(day),
            end: fc.integer({ min: 0, max: 20 }).map(day),
            duration: fc.integer({ min: 0, max: 40 }),
            type: fc.constantFrom('task' as const, 'milestone' as const),
          },
          { requiredKeys: [] },
        ),
        (model, pick, patch) => {
          const { g } = make({}, buildConfig(model));
          const target = id(`t${pick % model.n}`);
          // Reference: TaskStore.update first, THEN cascade over the written store (the old path).
          const refStore = new TaskStore(g.getTasks());
          const cal = CALENDARS[model.cal] ?? getInternal(g).calendar;
          let refThrew = false;
          try {
            refStore.update(target, patch);
            // `updateTask` only cascades for a patch that touches the schedule (a `{}` or `type`-only
            // patch writes and stops, even when the stored data already violates a link).
            if (patch.start !== undefined || patch.end !== undefined || patch.duration !== undefined) {
              const { shifts } = computeCascade(refStore.all(), g.getDependencies(), cal, [target]);
              for (const s of shifts) refStore.update(s.taskId, { start: s.start, end: s.end });
            }
          } catch {
            refThrew = true;
          }
          let threw = false;
          try {
            g.updateTask(target, patch);
          } catch {
            threw = true;
          }
          expect(threw).toBe(refThrew);
          if (!threw) expect(snap(g.getTasks())).toEqual(snap(refStore.all()));
        },
      ),
      { numRuns: Number(process.env.FG_RUNS ?? 200), ...(process.env.FG_SEED ? { seed: Number(process.env.FG_SEED), path: process.env.FG_PATH } : {}) },
    );
  });
});

describe('property: a throwing command leaves the state exactly as it was', () => {
  const dateArb = fc.oneof(
    fc.constantFrom('not-a-date', '', '2026-13-45', 'x'),
    fc.integer({ min: 0, max: 20 }).map(day),
  );
  const numArb = fc.oneof(fc.constantFrom(NaN, Infinity, -1, 7), fc.double({ min: 0, max: 1, noNaN: true }));
  const patchArb = fc.record(
    { start: dateArb, end: dateArb, progress: numArb, duration: numArb, name: fc.string(), parent: fc.constantFrom(id('t0'), id('t1')) },
    { requiredKeys: [] },
  );
  const cmdArb = fc.oneof(
    fc.record({ k: fc.constant('update' as const), n: fc.integer({ min: 0, max: 5 }), patch: patchArb }),
    fc.record({ k: fc.constant('move' as const), n: fc.integer({ min: 0, max: 5 }), d: dateArb }),
    fc.record({ k: fc.constant('resize' as const), n: fc.integer({ min: 0, max: 5 }), h: numArb }),
    fc.record({ k: fc.constant('progress' as const), n: fc.integer({ min: 0, max: 5 }), p: numArb }),
    fc.record({ k: fc.constant('dup' as const), n: fc.integer({ min: 0, max: 5 }), all: fc.boolean() }),
  );

  it('tasks (by identity), deps, revisions, history and events survive any failing command', () => {
    fc.assert(
      fc.property(
        dagArb,
        fc.boolean(),
        fc.boolean(),
        fc.array(cmdArb, { minLength: 1, maxLength: 12 }),
        (model, auto, storedBad, cmds) => {
          const cfg = buildConfig(model);
          const { g, rec } = make(auto ? {} : { schedulingMode: 'manual' }, cfg);
          const names = cfg.tasks!.map((x) => x.id!);
          if (auto && names.length > 1) {
            // a back edge: any cascade through it throws
            getInternal(g).deps.link(names[names.length - 1]!, names[0]!, 'FS', { allowCycle: true });
          }
          if (storedBad) g.addTask(t('bad', 'garbage', day(3)));
          for (const c of cmds) {
            const tid = names[c.n % names.length]!;
            const before = state(g);
            rec.clear();
            try {
              if (c.k === 'update') g.updateTask(tid, c.patch as never);
              else if (c.k === 'move') g.moveTask(tid, c.d);
              else if (c.k === 'resize') g.resizeTask(tid, c.h);
              else if (c.k === 'progress') g.setProgress(tid, c.p);
              else if (c.all) {
                g.select(names);
                g.duplicateTask();
              } else g.duplicateTask(tid);
            } catch {
              expectSame(g, before);
              // a select() before a failed duplicate may have changed selection events only
              expect(rec.log.filter((l) => !l.startsWith('selection:changed'))).toEqual([]);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
