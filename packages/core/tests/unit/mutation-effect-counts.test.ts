// @vitest-environment jsdom
//
// Effect-run tripwires (spec-mutation-batching.md §8 item 2, PR 0). Exact, deterministic counts
// of how many times a reactive effect re-runs per public mutation on master 0109f02 — no
// wall-clock. Three counters per scenario:
//   data   an `effect()` reading `tasks.revision` + `deps.revision` (what any subscriber sees)
//   paints full SVG `render()` passes of a mounted chart (one `<defs>` marker each)
//   cpm    critical-path computations the mounted render effect performed
// The numbers document CURRENT (unbatched) behaviour. Each carries a `target` for after the
// batching PR (spec §8 item 2 table); that PR lowers them, which is the point of the tripwire.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../helpers/create-gantt.js';
import type { GanttConfig } from '../../src/gantt.js';
import { getInternal } from '../../src/gantt-internal.js';
import { effect } from '../../src/signals.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import * as criticalPath from '../../src/compute/critical-path.js';

vi.mock('../../src/compute/critical-path.js', async (importOriginal) => {
  const actual = await importOriginal<typeof criticalPath>();
  return { ...actual, computeCriticalPath: vi.fn(actual.computeCriticalPath) };
});

const id = toTaskId;
const t = (name: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: id(name),
  name,
  start: '2026-01-05T09:00',
  end: '2026-01-05T17:00',
  progress: 0,
  type: 'task',
  ...extra,
});

let container: HTMLElement;
let paints = 0;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  paints = 0;
  const realAppend = Element.prototype.append;
  vi.spyOn(Element.prototype, 'append').mockImplementation(function (this: Element, ...nodes: Array<Node | string>) {
    if (this.classList.contains('fg-timeline') && (nodes[0] as Element | undefined)?.nodeName === 'defs') paints++;
    realAppend.apply(this, nodes);
  });
  // Mid-mutation states of an unbatched removeTask make CPM throw and the renderer warn.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});
const cpm = (): number => vi.mocked(criticalPath.computeCriticalPath).mock.calls.length;

interface Counts {
  data: number;
  paints?: number;
  cpm?: number;
}

/** Build, (optionally mount), arm the counters, run `act`, read them. */
function measure(
  config: GanttConfig,
  act: (g: ReturnType<typeof createGantt>) => void,
  opts: { mounted: boolean; prepare?: (g: ReturnType<typeof createGantt>) => void },
): Counts {
  const g = createGantt(config);
  if (opts.mounted) g.mount(container);
  opts.prepare?.(g);
  const internal = getInternal(g);
  let data = 0;
  const stop = effect(() => {
    void internal.tasks.revision.value;
    void internal.deps.revision.value;
    data++;
  });
  data = 0;
  paints = 0;
  vi.mocked(criticalPath.computeCriticalPath).mockClear();
  act(g);
  stop();
  return opts.mounted ? { data, paints, cpm: cpm() } : { data };
}

function chain(n: number, extra: Partial<GanttConfig> = {}): GanttConfig {
  const tasks: TaskInput[] = [];
  const dependencies = [];
  for (let i = 0; i < n; i++) {
    tasks.push(t(`k${i}`));
    if (i > 0) dependencies.push({ from: id(`k${i - 1}`), to: id(`k${i}`), type: 'FS' as const });
  }
  return { tasks, dependencies, ...extra };
}
const auto = { schedulingMode: 'auto' } as const;

/** Summary `p` with `n` children chained child_i -> child_{i+1}. */
function subtree(n: number): GanttConfig {
  const tasks: TaskInput[] = [t('p', { type: 'summary' })];
  const dependencies = [];
  for (let i = 0; i < n; i++) {
    tasks.push(t(`s${i}`, { parent: id('p') }));
    if (i > 0) dependencies.push({ from: id(`s${i - 1}`), to: id(`s${i}`), type: 'FS' as const });
  }
  return { tasks, dependencies };
}

describe('effect-run tripwires: cascade (50-task FS chain, schedulingMode auto)', () => {
  const move = (g: ReturnType<typeof createGantt>) => g.moveTask(id('k0'), '2026-02-02T09:00');

  it('moveTask: ONE run for the mover plus every shifted successor (was mover + one per shift)', { timeout: 60_000 }, () => {
    // Before PR 1 a 50-chain ran 50 data effects (mover + 49 shifts), a 51-chain 51. The command
    // runner batches the whole cascade into ONE.
    expect(measure(chain(50, auto), move, { mounted: false })).toEqual({ data: 1 });
    expect(measure(chain(51, auto), move, { mounted: false })).toEqual({ data: 1 });
    expect(measure(chain(50, auto), move, { mounted: true })).toMatchInlineSnapshot(`
      {
        "cpm": 1,
        "data": 1,
        "paints": 1,
      }
    `);
  });

  it('undo and redo of that move', () => {
    const undo = (g: ReturnType<typeof createGantt>) => g.undo();
    const redo = (g: ReturnType<typeof createGantt>) => g.redo();
    expect(measure(chain(50, auto), undo, { mounted: false, prepare: move2 })).toEqual({ data: 1 });
    expect(
      measure(chain(50, auto), redo, {
        mounted: false,
        prepare: (g) => {
          move2(g);
          g.undo();
        },
      }),
    ).toEqual({ data: 1 });
  });
  function move2(g: ReturnType<typeof createGantt>): void {
    g.moveTask(id('k0'), '2026-02-02T09:00');
  }

  it('manual mode moveTask is a single write', () => {
    expect(measure(chain(50), move, { mounted: false })).toEqual({ data: 1 });
  });
});

describe('effect-run tripwires: removeTask of a 100-descendant subtree with 99 deps', { timeout: 60_000 }, () => {
  const remove = (g: ReturnType<typeof createGantt>) => g.removeTask(id('p'));

  it('headless', () => {
    expect(measure(subtree(100), remove, { mounted: false })).toMatchInlineSnapshot(`
      {
        "data": 1,
      }
    `);
  });

  it('mounted', () => {
    expect(measure(subtree(100), remove, { mounted: true })).toMatchInlineSnapshot(`
      {
        "cpm": 0,
        "data": 1,
        "paints": 1,
      }
    `);
  });
});

describe('effect-run tripwires: multi-write grouped mutations', () => {
  const flat = (n: number): GanttConfig => ({ tasks: Array.from({ length: n }, (_, i) => t(`f${i}`)) });
  const ids5 = [0, 1, 2, 3, 4].map((i) => id(`f${i}`));

  it('duplicateTask of 5 selected tasks', () => {
    const act = (g: ReturnType<typeof createGantt>) => g.duplicateTask();
    const prepare = (g: ReturnType<typeof createGantt>) => g.select(ids5);
    expect(measure(flat(10), act, { mounted: false, prepare })).toEqual({ data: 1 });
    expect(measure(flat(10), act, { mounted: true, prepare })).toMatchInlineSnapshot(`
      {
        "cpm": 1,
        "data": 1,
        "paints": 1,
      }
    `);
  });

  it('Delete-selected (keyboard) of 5 tasks', () => {
    const act = () =>
      container
        .querySelector('.fg-timeline__row[data-task-id="f0"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    const prepare = (g: ReturnType<typeof createGantt>) => g.select(ids5);
    expect(measure(flat(10), act, { mounted: true, prepare })).toMatchInlineSnapshot(`
      {
        "cpm": 1,
        "data": 1,
        "paints": 1,
      }
    `);
  });

  it('importJson (already batched) is one run', () => {
    const doc = {
      fluxgantt: { schemaVersion: '1.0' },
      tasks: Array.from({ length: 50 }, (_, i) => ({
        id: `i${i}`,
        name: `i${i}`,
        start: '2026-02-02T09:00',
        end: '2026-02-02T17:00',
        progress: 0,
        type: 'task',
      })),
      dependencies: [{ from: 'i0', to: 'i1', type: 'FS' }],
    };
    const act = (g: ReturnType<typeof createGantt>) => g.importJson(doc);
    expect(measure(flat(10), act, { mounted: false })).toEqual({ data: 1 });
    expect(measure(flat(10), act, { mounted: true })).toMatchInlineSnapshot(`
      {
        "cpm": 1,
        "data": 1,
        "paints": 1,
      }
    `);
  });
});

describe('effect-run tripwires: single-write mutations stay at one run', () => {
  const base: GanttConfig = chain(5);
  it('addTask / linkTasks / setProgress / unlinkTasks', () => {
    const cases: Array<[string, (g: ReturnType<typeof createGantt>) => void]> = [
      ['addTask', (g) => void g.addTask(t('z'))],
      ['linkTasks', (g) => void g.linkTasks(id('k0'), id('k3'))],
      ['setProgress', (g) => void g.setProgress(id('k1'), 0.5)],
      ['unlinkTasks', (g) => g.unlinkTasks(id('k0'), id('k1'))],
    ];
    for (const [, act] of cases) {
      expect(measure(base, act, { mounted: false })).toEqual({ data: 1 });
    }
    expect(cases.map(([name, act]) => [name, measure(base, act, { mounted: true })])).toMatchInlineSnapshot(`
      [
        [
          "addTask",
          {
            "cpm": 1,
            "data": 1,
            "paints": 1,
          },
        ],
        [
          "linkTasks",
          {
            "cpm": 1,
            "data": 1,
            "paints": 1,
          },
        ],
        [
          "setProgress",
          {
            "cpm": 1,
            "data": 1,
            "paints": 1,
          },
        ],
        [
          "unlinkTasks",
          {
            "cpm": 1,
            "data": 1,
            "paints": 1,
          },
        ],
      ]
    `);
  });

  it('select / selectAll / zoomTo / collapseAll do not touch the data stores and never recompute the critical path', () => {
    const cfg: GanttConfig = { ...subtree(5) };
    const acts: Array<(g: ReturnType<typeof createGantt>) => void> = [
      (g) => g.select(id('s1')),
      (g) => g.selectAll(),
      (g) => g.zoomTo('month'),
      (g) => g.collapseAll(),
    ];
    const results = acts.map((act) => measure(cfg, act, { mounted: true }));
    for (const r of results) {
      expect(r.data).toBe(0);
      expect(r.cpm).toBe(0);
    }
    expect(results.map((r) => r.paints)).toMatchInlineSnapshot(`
      [
        0,
        0,
        1,
        1,
      ]
    `);
  });
});
