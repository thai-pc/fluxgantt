// Index-versus-brute-force model for DependencyStore (spec-mutation-batching §5/§8 item 4) plus
// linkAll-versus-sequential-link equivalence. Order is part of the contract (of() and
// predecessors()/successors() follow global insertion order).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DependencyLinkError, DependencyStore } from '../../src/store/dependency-store.js';
import { toTaskId, type Dependency, type TaskId } from '../../src/types.js';

const ids = Array.from({ length: 6 }, (_, i) => toTaskId(`t${i}`));
const pick = fc.integer({ min: 0, max: ids.length - 1 });

type Op =
  | { k: 'link'; a: number; b: number; cycle: boolean }
  | { k: 'unlink'; a: number; b: number }
  | { k: 'remove'; n: number }
  | { k: 'removeForTask'; a: number }
  | { k: 'restore'; n: number }
  | { k: 'clear' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ k: fc.constant('link' as const), a: pick, b: pick, cycle: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('unlink' as const), a: pick, b: pick }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('remove' as const), n: fc.nat(30) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('removeForTask' as const), a: pick }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('restore' as const), n: fc.nat(30) }) },
  { weight: 1, arbitrary: fc.constant({ k: 'clear' as const }) },
);

const reach = (deps: Dependency[], from: TaskId, to: TaskId): boolean => {
  const seen = new Set<TaskId>();
  const stack = [from];
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const d of deps) if (d.from === n) stack.push(d.to);
  }
  return false;
};
/** reach() with at least one edge, so a node reaches itself only through a real cycle. */
const onCycle = (deps: Dependency[], n: TaskId): boolean => deps.some((d) => d.from === n && reach(deps, d.to, n));

describe('DependencyStore indices vs brute force', () => {
  it('of/predecessors/successors/linkExists/wouldCreateCycle/hasCycle match scans, order included', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const store = new DependencyStore();
        const removed: Dependency[] = [];
        for (const op of ops) {
          if (op.k === 'link') {
            try {
              store.link(ids[op.a]!, ids[op.b]!, 'FS', op.cycle ? { allowCycle: true } : {});
            } catch (e) {
              expect(e).toBeInstanceOf(DependencyLinkError);
            }
          } else if (op.k === 'unlink') {
            const before = store.all();
            store.unlink(ids[op.a]!, ids[op.b]!);
            removed.push(...before.filter((d) => d.from === ids[op.a] && d.to === ids[op.b]));
          } else if (op.k === 'remove') {
            const all = store.all();
            const d = all[op.n % Math.max(all.length, 1)];
            if (d) removed.push(d);
            if (d) store.remove(d.id);
          } else if (op.k === 'removeForTask') {
            removed.push(...store.of(ids[op.a]!));
            store.removeForTask(ids[op.a]!);
          } else if (op.k === 'restore') {
            const d = removed[op.n % Math.max(removed.length, 1)];
            // Only replay a dependency whose id is free and whose pair slot is free (undo/redo does).
            if (d && !store.get(d.id) && !store.linkExists(d.from, d.to)) store.restore(d);
          } else store.clear();

          const all = store.all();
          for (const t of ids) {
            expect(store.of(t).map((d) => d.id)).toEqual(all.filter((d) => d.from === t || d.to === t).map((d) => d.id));
            expect(store.predecessors(t).map((d) => d.id)).toEqual(all.filter((d) => d.to === t).map((d) => d.id));
            expect(store.successors(t).map((d) => d.id)).toEqual(all.filter((d) => d.from === t).map((d) => d.id));
            for (const u of ids) {
              expect(store.linkExists(t, u)).toBe(all.some((d) => d.from === t && d.to === u));
              expect(store.wouldCreateCycle(t, u)).toBe(t === u || reach(all, u, t));
            }
          }
          expect(store.hasCycle()).toBe(ids.some((t) => onCycle(all, t)));
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('DependencyStore.linkAll vs sequential link', () => {
  const edgeArb = fc.record({
    from: pick,
    to: pick,
    type: fc.constantFrom('FS' as const, 'SS' as const, 'FF' as const, 'SF' as const),
    lag: fc.integer({ min: -8, max: 8 }),
  });

  it('accepts exactly what sequential link accepts, in the same order; rejects with the same class', () => {
    fc.assert(
      fc.property(fc.array(edgeArb, { maxLength: 14 }), (edges) => {
        const inputs = edges.map((e) => ({ from: ids[e.from]!, to: ids[e.to]!, type: e.type, lag: e.lag }));
        const seq = new DependencyStore();
        let seqErr: unknown;
        try {
          for (const e of inputs) seq.link(e.from, e.to, e.type, { lag: e.lag });
        } catch (e) {
          seqErr = e;
        }
        const bulk = new DependencyStore();
        let bulkErr: unknown;
        try {
          bulk.linkAll(inputs);
        } catch (e) {
          bulkErr = e;
        }
        expect(bulkErr === undefined).toBe(seqErr === undefined);
        if (seqErr) {
          expect(bulkErr).toBeInstanceOf(DependencyLinkError);
          expect(bulk.size).toBe(0); // all-or-nothing
          expect(bulk.hasCycle()).toBe(false);
        } else {
          const strip = (s: DependencyStore) => s.all().map(({ from, to, type, lag }) => ({ from, to, type, lag }));
          expect(strip(bulk)).toEqual(strip(seq));
          expect(bulk.of(ids[0]!).length).toBe(seq.of(ids[0]!).length);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('rolls back on failure even when the store already held links', () => {
    const store = new DependencyStore();
    store.link(ids[0]!, ids[1]!);
    expect(() =>
      store.linkAll([
        { from: ids[1]!, to: ids[2]! },
        { from: ids[2]!, to: ids[0]! }, // closes 0 -> 1 -> 2 -> 0
      ]),
    ).toThrow(/would create a cycle/);
    expect(store.all().map((d) => [d.from, d.to])).toEqual([[ids[0], ids[1]]]);
    expect(store.linkExists(ids[1]!, ids[2]!)).toBe(false);
    expect(() => store.linkAll([{ from: ids[0]!, to: ids[1]! }])).toThrow(/already exists/);
    expect(() => store.linkAll([{ from: ids[3]!, to: ids[3]! }])).toThrow(/cannot self-link/);
  });

  it('doubly invalid input: a duplicate is reported before a cycle (message-only difference, same class)', () => {
    const a = ids[0]!, b = ids[1]!, c = ids[2]!;
    const input = [{ from: a, to: b }, { from: b, to: a }, { from: a, to: c }, { from: a, to: c }];
    expect(() => new DependencyStore().linkAll(input)).toThrow(/already exists/); // bulk
    const seq = new DependencyStore();
    expect(() => input.forEach((e) => seq.link(e.from, e.to))).toThrow(/would create a cycle/); // sequential
  });

  it('an empty list is a no-op without a revision bump', () => {
    const store = new DependencyStore();
    const rev = store.revision.value;
    expect(store.linkAll([])).toEqual([]);
    expect(store.revision.value).toBe(rev);
  });

  it('bumps the revision once for the whole batch', () => {
    const store = new DependencyStore();
    const rev = store.revision.value;
    store.linkAll([{ from: ids[0]!, to: ids[1]! }, { from: ids[1]!, to: ids[2]! }]);
    expect(store.revision.value).toBe(rev + 1);
  });

  it('a cycle hidden at the end of 100k edges is rejected (and a long chain is accepted) without recursion', () => {
    const n = (i: number) => toTaskId(`n${i}`);
    const chain = Array.from({ length: 100_000 }, (_, i) => ({ from: n(i), to: n(i + 1) }));
    const ok = new DependencyStore();
    expect(ok.linkAll(chain)).toHaveLength(100_000);
    expect(ok.hasCycle()).toBe(false);
    expect(() => new DependencyStore().linkAll([...chain, { from: n(100_000), to: n(0) }])).toThrow(DependencyLinkError);
  });
});

describe('DependencyStore.linkAll cycle message names an edge on a cycle', () => {
  const [a, b, c] = ids as [TaskId, TaskId, TaskId];

  it('[b->c, a->b, b->a] names b -> a, like sequential link (c is only downstream of the cycle)', () => {
    const input = [{ from: b, to: c }, { from: a, to: b }, { from: b, to: a }];
    expect(() => new DependencyStore().linkAll(input)).toThrow(/link t1 → t0 would create a cycle/);
    const seq = new DependencyStore();
    expect(() => input.forEach((e) => seq.link(e.from, e.to))).toThrow(/link t1 → t0 would create a cycle/);
  });

  it('property: the edge named in a cycle error lies on a cycle of the input graph', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ from: pick, to: pick }), { maxLength: 14 }), (edges) => {
        const inputs = edges.map((e) => ({ from: ids[e.from]!, to: ids[e.to]! }));
        try {
          new DependencyStore().linkAll(inputs);
        } catch (e) {
          const m = /link (t\d+) → (t\d+) would create a cycle/.exec((e as Error).message);
          if (!m) return; // self-link / duplicate
          const graph = inputs.map((d, i) => ({ id: `d${i}`, ...d, type: 'FS', lag: 0 }) as unknown as Dependency);
          expect(reach(graph, toTaskId(m[2]!), toTaskId(m[1]!))).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('a 100k-edge downstream chain listed before the cycle stays linear in time', () => {
    const n = (i: number) => toTaskId(`n${i}`);
    const down = Array.from({ length: 100_000 }, (_, i) => ({ from: n(i + 2), to: n(i + 3) })) // n2 -> n3 -> ... downstream of the cycle;
    const t0 = performance.now();
    expect(() =>
      new DependencyStore().linkAll([...down, { from: n(1), to: n(2) }, { from: n(2), to: n(1) }]),
    ).toThrow(/link n2 → n1 would create a cycle/);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
