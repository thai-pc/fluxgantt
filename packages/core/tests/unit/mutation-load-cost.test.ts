// Load-cost harness (spec-mutation-batching.md §8 item 3). Counts Map/Set/array work, not
// wall-clock, for loading tasks + dependencies at N and 4N edges, for the four graph shapes the
// spec calls out. Before `DependencyStore.linkAll` the sequential `link()` loader rescanned every
// dependency per edge (Theta(E^2): 4x the edges cost ~16x the operations); now it is linear.
import { describe, it, expect } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withIo } from '../../src/io/mixin.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import { countOps } from '../helpers/op-counter.js';

const id = toTaskId;
const mk = (n: string): TaskInput => ({
  id: id(n),
  name: n,
  start: '2026-01-05T09:00',
  end: '2026-01-05T17:00',
  progress: 0,
  type: 'task',
});

interface Dataset {
  tasks: TaskInput[];
  dependencies: Array<{ from: ReturnType<typeof id>; to: ReturnType<typeof id>; type: 'FS' }>;
}
const link = (a: string, b: string) => ({ from: id(a), to: id(b), type: 'FS' as const });

/** Four shapes, each with exactly `e` dependencies. */
const SHAPES: Record<string, (e: number) => Dataset> = {
  // k0 -> k1 -> ... in input order: each new edge's cycle DFS is trivial, the pair scan and
  // adjacency rebuild are not.
  'in-order chain': (e) => {
    const names = Array.from({ length: e + 1 }, (_, i) => `n${i}`);
    return { tasks: names.map(mk), dependencies: names.slice(1).map((n, i) => link(names[i]!, n)) };
  },
  // The same chain listed back to front: every new edge's DFS walks the whole tail built so far.
  'reverse chain': (e) => {
    const s = SHAPES['in-order chain']!(e);
    return { tasks: s.tasks, dependencies: [...s.dependencies].reverse() };
  },
  // One node fans out to e leaves.
  'hub star': (e) => {
    const names = ['hub', ...Array.from({ length: e }, (_, i) => `l${i}`)];
    return { tasks: names.map(mk), dependencies: names.slice(1).map((n) => link('hub', n)) };
  },
  // A chain of e/2 edges, then e/2 distinct sources pointing at its head: every source edge's
  // cycle DFS walks the whole chain, which also defeats an incremental per-edge DFS.
  'chain with many sources': (e) => {
    const m = Math.floor(e / 2);
    const chain = Array.from({ length: m + 1 }, (_, i) => `c${i}`);
    const sources = Array.from({ length: e - m }, (_, i) => `s${i}`);
    return {
      tasks: [...chain, ...sources].map(mk),
      dependencies: [...chain.slice(1).map((n, i) => link(chain[i]!, n)), ...sources.map((s) => link(s, 'c0'))],
    };
  },
};

const N = 250;
const FOUR_N = 4 * N;
/** A linear loader costs ~4x ops for 4x data (the old sequential loader cost ~16x). */
const LINEAR_MAX = 4.5;

const viaConstructor = (d: Dataset): (() => unknown) => () => createGantt({ tasks: d.tasks, dependencies: d.dependencies });
const viaImportJson = (d: Dataset): (() => unknown) => () =>
  withIo(createGantt({})).importJson({
    fluxgantt: { schemaVersion: '1.0' },
    tasks: d.tasks,
    dependencies: d.dependencies,
  });

describe('load-cost harness: operation counts at N and 4N dependencies (linear load)', () => {
  for (const [shapeName, build] of Object.entries(SHAPES)) {
    for (const [entry, run] of [
      ['createGantt({ dependencies })', viaConstructor],
      ['importJson', viaImportJson],
    ] as const) {
      it(`${shapeName} via ${entry}: ops(4N)/ops(N) is linear (< 4.5)`, () => {
        const small = countOps(run(build(N))).ops;
        const large = countOps(run(build(FOUR_N))).ops;
        const ratio = large / small;
        expect(small).toBeGreaterThan(N); // the counter really sees the load
        expect(ratio).toBeLessThan(LINEAR_MAX);
      });
    }
  }

  it('the counter itself is deterministic (same input, same count)', () => {
    const d = SHAPES['reverse chain']!(100);
    expect(countOps(viaConstructor(d)).ops).toBe(countOps(viaConstructor(d)).ops);
  });
});
