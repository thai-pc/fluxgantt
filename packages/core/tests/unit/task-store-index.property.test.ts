// Index-versus-brute-force model for TaskStore's parent -> children index (spec-mutation-batching
// §5/§8 item 4): after every operation `children(id)` equals the filter over `all()`, ORDER included.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TaskStore } from '../../src/store/task-store.js';
import { toTaskId, type Task, type TaskId } from '../../src/types.js';

const base = {
  name: 'n',
  start: '2026-01-05T09:00',
  end: '2026-01-05T17:00',
  progress: 0,
  type: 'task' as const,
};
const ids = Array.from({ length: 8 }, (_, i) => toTaskId(`t${i}`));
const pick = fc.integer({ min: 0, max: ids.length - 1 });

type Op =
  | { k: 'add'; id: number; parent: number | null }
  | { k: 'reparent'; id: number; parent: number | null }
  | { k: 'restore'; id: number; parent: number | null }
  | { k: 'remove'; id: number }
  | { k: 'clear' };

const parentArb = fc.option(pick, { nil: null });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ k: fc.constant('add' as const), id: pick, parent: parentArb }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('reparent' as const), id: pick, parent: parentArb }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('restore' as const), id: pick, parent: parentArb }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('remove' as const), id: pick }) },
  { weight: 1, arbitrary: fc.constant({ k: 'clear' as const }) },
);

const mk = (id: TaskId, parent: number | null): Task => ({
  ...base,
  id,
  ...(parent === null ? {} : { parent: ids[parent]! }),
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe('TaskStore children index vs brute force', () => {
  it('children() equals the filter over all(), order included, after every op', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const store = new TaskStore();
        for (const op of ops) {
          const id = 'id' in op ? ids[op.id]! : ids[0]!;
          if (op.k === 'add') {
            // The store allows re-adding an id (Map.set semantics): keep that path covered.
            store.add({ ...base, id, ...(op.parent === null ? {} : { parent: ids[op.parent]! }) });
          } else if (op.k === 'reparent') {
            if (store.has(id)) store.update(id, { parent: op.parent === null ? (undefined as never) : ids[op.parent]! });
          } else if (op.k === 'restore') {
            store.restore(mk(id, op.parent));
          } else if (op.k === 'remove') {
            store.remove(id);
          } else store.clear();
          const all = store.all();
          for (const t of ids) {
            expect(store.children(t).map((c) => c.id)).toEqual(all.filter((x) => x.parent === t).map((x) => x.id));
          }
          expect(store.roots().map((r) => r.id)).toEqual(all.filter((x) => x.parent === undefined).map((x) => x.id));
        }
      }),
      { numRuns: 300 },
    );
  });

  it('remove() cascades exactly the brute-force descendant set with a single revision bump', () => {
    fc.assert(
      fc.property(fc.array(fc.option(pick, { nil: null }), { minLength: 1, maxLength: 8 }), pick, (parents, target) => {
        // Acyclic by construction: task i may only hang under a lower index.
        const store = new TaskStore();
        parents.forEach((p, i) => store.add({ ...base, id: ids[i]!, ...(p !== null && p < i ? { parent: ids[p]! } : {}) }));
        const before = store.all();
        const id = ids[Math.min(target, parents.length - 1)]!;
        const expected = new Set<TaskId>([id]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const t of before) {
            if (t.parent && expected.has(t.parent) && !expected.has(t.id)) {
              expected.add(t.id);
              grew = true;
            }
          }
        }
        const rev = store.revision.value;
        store.remove(id);
        expect(store.revision.value).toBe(rev + 1);
        expect(store.all().map((t) => t.id)).toEqual(before.filter((t) => !expected.has(t.id)).map((t) => t.id));
      }),
    );
  });

  it('survives a parent cycle without hanging', () => {
    const store = new TaskStore();
    store.add({ ...base, id: ids[0]! });
    store.add({ ...base, id: ids[1]!, parent: ids[0]! });
    store.update(ids[0]!, { parent: ids[1]! });
    store.remove(ids[0]!);
    expect(store.size).toBe(0);
  });
});
