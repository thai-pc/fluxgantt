// Interim DoS cap on imported dependencies (spec-mutation-batching.md §6, PR 0; security.md §2).
// `DependencyStore.link()` is Theta(E^2), so `maxDependencyCount` is lowered from 100_000 to
// 2_500 until `DependencyStore.linkAll` makes the load linear.
// TODO(spec-mutation-batching §6, PR 3): restore the 100_000 default and flip these expectations.
import { describe, it, expect } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withIo } from '../../src/io/mixin.js';
import { DEFAULT_IMPORT_LIMITS, IoValidationError, importCsv, importJson } from '../../src/io/index.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import { countOps } from '../helpers/op-counter.js';

const LIMIT = 2_500;
const rawTask = (n: string) => ({
  id: n,
  name: n,
  start: '2026-01-05T09:00',
  end: '2026-01-05T17:00',
  progress: 0,
  type: 'task',
});
/** `e` hub->leaf dependencies (the cheapest valid shape to load). */
function hub(e: number) {
  const tasks = [rawTask('hub'), ...Array.from({ length: e }, (_, i) => rawTask(`l${i}`))];
  const dependencies = Array.from({ length: e }, (_, i) => ({ from: 'hub', to: `l${i}`, type: 'FS' }));
  return { fluxgantt: { schemaVersion: '1.0' }, tasks, dependencies };
}

describe('maxDependencyCount default', () => {
  it('is 2_500', () => {
    expect(DEFAULT_IMPORT_LIMITS.maxDependencyCount).toBe(LIMIT);
  });

  it('importJson rejects LIMIT + 1 dependencies before validating or linking any of them', () => {
    const doc = hub(LIMIT + 1);
    expect.assertions(3);
    try {
      importJson(doc);
    } catch (err) {
      expect(err).toBeInstanceOf(IoValidationError);
      expect((err as IoValidationError).path).toBe('$.dependencies');
      expect((err as IoValidationError).message).toContain('maxDependencyCount');
    }
  });

  it('gantt.importJson rejects it too and leaves the live instance untouched', () => {
    const gantt = withIo(createGantt({ tasks: [{ ...(rawTask('keep') as unknown as TaskInput), id: toTaskId('keep') }] }));
    expect(() => gantt.importJson(hub(LIMIT + 1))).toThrow(IoValidationError);
    expect(gantt.getTasks().map((t) => t.id)).toEqual(['keep']);
  });

  it('importJson accepts exactly LIMIT dependencies', () => {
    expect(importJson(hub(LIMIT)).dependencies).toHaveLength(LIMIT);
  });

  it('options.limits still overrides (tightening and loosening)', () => {
    expect(() => importJson(hub(11), { limits: { maxDependencyCount: 10 } })).toThrow(IoValidationError);
    expect(importJson(hub(10), { limits: { maxDependencyCount: 10 } }).dependencies).toHaveLength(10);
    expect(importJson(hub(LIMIT + 1), { limits: { maxDependencyCount: LIMIT + 1 } }).dependencies).toHaveLength(
      LIMIT + 1,
    );
  });

  it('CSV carries no dependencies, so the cap cannot be reached through importCsv', () => {
    const csv = 'id,name,start,end,progress,type\nt1,One,2026-01-05T09:00,2026-01-05T17:00,0,task\n';
    expect(importCsv(csv)).not.toHaveProperty('dependencies'); // no dependencies channel exists
    const gantt = withIo(createGantt({}));
    expect(gantt.importCsv(csv)).toMatchObject({ taskCount: 1, dependencyCount: 0 });
    expect(importCsv(csv, { limits: { maxDependencyCount: 0 } }).tasks).toHaveLength(1);
  });
});

describe('calibration: the worst shape at the cap stays bounded', () => {
  // A reversed chain is the most expensive shape to load (every edge's cycle DFS walks the whole
  // tail). 22M counted ops at 2_500 edges is ~0.8-0.9 s single-threaded; 100_000 edges would be
  // ~3.5e10. The bound is loose (30M) so harmless changes do not trip it, but it pins the order
  // of magnitude the limit was chosen for.
  it('createGantt({ dependencies }) with a reversed chain of LIMIT edges', () => {
    const names = Array.from({ length: LIMIT + 1 }, (_, i) => `n${i}`);
    const tasks = names.map((n) => ({ ...(rawTask(n) as unknown as TaskInput), id: toTaskId(n) }));
    const dependencies = names
      .slice(1)
      .map((n, i) => ({ from: toTaskId(names[i]!), to: toTaskId(n) }))
      .reverse();
    const { ops } = countOps(() => createGantt({ tasks, dependencies }));
    expect(ops).toBeGreaterThan(10_000_000);
    expect(ops).toBeLessThan(30_000_000);
  });
});
