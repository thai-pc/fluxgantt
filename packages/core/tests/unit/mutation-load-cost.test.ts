// Load-cost harness (spec-mutation-batching.md §8 item 3, PR 0). Counts Map/Set/array work —
// not wall-clock — for loading tasks + dependencies at N and 4N edges, for the four graph shapes
// the spec calls out. On master 0109f02 `DependencyStore.link()` rescans every dependency (pair
// check), rebuilds the whole successor map and runs a DFS per call, so the cost is Theta(E^2):
// 4x the edges costs ~16x the operations. These tests document that loosely (a band around 16x),
// NOT as a goal. TODO(spec-mutation-batching §6, PR 3): after `DependencyStore.linkAll` lands the
// ratio flips to < 4.5 (linear) and `QUADRATIC_BAND` becomes `LINEAR_MAX`.
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
  dependencies: Array<{ from: ReturnType<typeof id>; to: ReturnType<typeof id> }>;
}
const link = (a: string, b: string) => ({ from: id(a), to: id(b) });

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
/** 4x data costs 16x ops for a Theta(E^2) loader; allow for the linear terms around it. */
const QUADRATIC_BAND = { min: 10, max: 20 };

const viaConstructor = (d: Dataset) => () => createGantt({ tasks: d.tasks, dependencies: d.dependencies });
const viaImportJson = (d: Dataset) => () =>
  withIo(createGantt({})).importJson({
    fluxgantt: { schemaVersion: '1.0' },
    tasks: d.tasks,
    dependencies: d.dependencies.map((x) => ({ ...x, type: 'FS' })),
  });

describe('load-cost harness: operation counts at N and 4N dependencies (documents the quadratic load)', () => {
  for (const [shapeName, build] of Object.entries(SHAPES)) {
    for (const [entry, run] of [
      ['createGantt({ dependencies })', viaConstructor],
      ['importJson', viaImportJson],
    ] as const) {
      it(`${shapeName} via ${entry}: ops(4N)/ops(N) is ~16x`, () => {
        const small = countOps(run(build(N))).ops;
        const large = countOps(run(build(FOUR_N))).ops;
        const ratio = large / small;
        expect(small).toBeGreaterThan(N); // the counter really sees the load
        expect(ratio).toBeGreaterThan(QUADRATIC_BAND.min);
        expect(ratio).toBeLessThan(QUADRATIC_BAND.max);
      });
    }
  }

  it('the counter itself is deterministic (same input, same count)', () => {
    const d = SHAPES['reverse chain']!(100);
    expect(countOps(viaConstructor(d)).ops).toBe(countOps(viaConstructor(d)).ops);
  });
});
