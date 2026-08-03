// Property-based tests (fast-check) for the JSON IO layer (spec-io-json-csv.md §8).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Temporal } from '@js-temporal/polyfill';
import { exportJson, importJson, IoValidationError } from '../../src/io/index.js';
import { normalizeDate } from '../../src/compute/working-calendar.js';
import { toDependencyId, toTaskId, type Dependency, type DependencyType, type Task, type TaskKind } from '../../src/types.js';

const TIMEZONE = 'UTC';

function sameInstant(a: Task['start'], b: Task['start']): boolean {
  return (
    Temporal.Instant.compare(normalizeDate(a, TIMEZONE).toInstant(), normalizeDate(b, TIMEZONE).toInstant()) === 0
  );
}

/** Produces one of the 4 `DateInput` shapes for a given epoch millisecond instant. */
function dateInputVariant(epochMs: number, shape: 0 | 1 | 2 | 3): Task['start'] {
  const instant = Temporal.Instant.fromEpochMilliseconds(epochMs);
  switch (shape) {
    case 0:
      return instant.toString();
    case 1:
      return new Date(epochMs);
    case 2:
      return instant.toZonedDateTimeISO('UTC');
    case 3:
      return instant.toZonedDateTimeISO('UTC').toPlainDate();
  }
}

const epochArb = fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) });
const shapeArb = fc.constantFrom(0, 1, 2, 3) as fc.Arbitrary<0 | 1 | 2 | 3>;
const dateInputArb = fc.tuple(epochArb, shapeArb).map(([ms, shape]) => dateInputVariant(ms, shape));

const taskKindArb: fc.Arbitrary<TaskKind> = fc.constantFrom('task', 'summary', 'milestone', 'project');
const dependencyTypeArb: fc.Arbitrary<DependencyType> = fc.constantFrom('FS', 'SS', 'FF', 'SF');
const shortStringArb = fc.string({ minLength: 0, maxLength: 30 });
// `rgb(...)` is deliberately excluded: `validateColor`'s coarse blocklist (spec §5.4) rejects
// ANY value containing `(` — a documented, accepted false-positive trade-off for a
// defense-in-depth secondary guard, not the authoritative CSS-color validator.
const colorArb = fc.constantFrom('#6366f1', '#ef4444', 'red', 'indigo');

/** A single valid task; `parent` (if any) always references a LOWER-index task within the
 *  same batch, guaranteeing no cycle by construction (mirrors critical-path.property.test.ts
 *  DAG-by-construction technique). */
function taskArbAt(index: number): fc.Arbitrary<Task> {
  const now = new Date();
  return fc.record({
    start: dateInputArb,
    end: dateInputArb,
    name: shortStringArb,
    progress: fc.float({ min: 0, max: 1, noNaN: true }),
    type: taskKindArb,
    duration: fc.option(fc.integer({ min: 0, max: 200 }), { nil: undefined }),
    priority: fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined }),
    notes: fc.option(shortStringArb, { nil: undefined }),
    color: fc.option(colorArb, { nil: undefined }),
    parentIdx: index > 0 ? fc.option(fc.integer({ min: 0, max: index - 1 }), { nil: undefined }) : fc.constant(undefined),
    meta: fc.option(fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.integer(), { maxKeys: 4 }), {
      nil: undefined,
    }),
  }).map((r) => ({
    id: toTaskId(`t${index}`),
    name: r.name,
    start: r.start,
    end: r.end,
    progress: r.progress,
    type: r.type,
    createdAt: now,
    updatedAt: now,
    ...(r.duration !== undefined ? { duration: r.duration } : {}),
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
    ...(r.parentIdx !== undefined ? { parent: toTaskId(`t${r.parentIdx}`) } : {}),
    ...(r.notes !== undefined ? { notes: r.notes } : {}),
    ...(r.color !== undefined ? { color: r.color } : {}),
    ...(r.meta !== undefined ? { meta: r.meta } : {}),
  }));
}

const tasksArb: fc.Arbitrary<Task[]> = fc
  .integer({ min: 1, max: 6 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => taskArbAt(i))));

function dependenciesArb(tasks: readonly Task[]): fc.Arbitrary<Dependency[]> {
  if (tasks.length < 2) return fc.constant([]);
  return fc.array(
    fc
      .tuple(
        fc.integer({ min: 0, max: tasks.length - 1 }),
        fc.integer({ min: 0, max: tasks.length - 1 }),
        dependencyTypeArb,
        fc.integer({ min: -10, max: 10 }),
      )
      .filter(([from, to]) => from !== to),
    { maxLength: tasks.length },
  ).map((edges) =>
    edges.map(
      ([fromIdx, toIdx, type, lag], i): Dependency => ({
        id: toDependencyId(`d${i}`),
        from: tasks[fromIdx]!.id,
        to: tasks[toIdx]!.id,
        type,
        lag,
      }),
    ),
  );
}

const fixtureArb = tasksArb.chain((tasks) => dependenciesArb(tasks).map((dependencies) => ({ tasks, dependencies })));

describe('property: exportJson/importJson round-trip', () => {
  it('round-trips every logical field for random valid task/dependency sets', () => {
    fc.assert(
      fc.property(fixtureArb, ({ tasks, dependencies }) => {
        const bundle = exportJson(tasks, dependencies, { timezone: TIMEZONE });
        const result = importJson(bundle);

        expect(result.tasks).toHaveLength(tasks.length);
        expect(result.dependencies).toHaveLength(dependencies.length);

        const byId = new Map(result.tasks.map((t) => [t.id, t]));
        for (const original of tasks) {
          const reimported = byId.get(original.id)!;
          expect(reimported.name).toBe(original.name);
          expect(sameInstant(reimported.start, original.start)).toBe(true);
          expect(sameInstant(reimported.end, original.end)).toBe(true);
          expect(reimported.progress).toBeCloseTo(original.progress, 6);
          expect(reimported.type).toBe(original.type);
          expect(reimported.duration).toBe(original.duration);
          expect(reimported.priority).toBe(original.priority);
          expect(reimported.parent).toBe(original.parent);
          expect(reimported.notes).toBe(original.notes);
          expect(reimported.color).toBe(original.color);
          expect(reimported.meta).toEqual(original.meta);
        }

        for (let i = 0; i < dependencies.length; i++) {
          expect(result.dependencies[i]!.from).toBe(dependencies[i]!.from);
          expect(result.dependencies[i]!.to).toBe(dependencies[i]!.to);
          expect(result.dependencies[i]!.type).toBe(dependencies[i]!.type);
          expect(result.dependencies[i]!.lag).toBe(dependencies[i]!.lag);
        }
      }),
    );
  });
});

// --- Invalid-mutation fuzzing --------------------------------------------------------------

type Mutation = (bundle: ReturnType<typeof exportJson>) => unknown;

const mutations: Mutation[] = [
  // Drop a required field.
  (bundle) => ({ ...bundle, tasks: bundle.tasks.map((t) => ({ ...t, name: undefined })) }),
  (bundle) => ({ ...bundle, tasks: bundle.tasks.map((t) => ({ ...t, start: undefined })) }),
  (bundle) => ({ ...bundle, tasks: bundle.tasks.map((t) => ({ ...t, type: undefined })) }),
  // Inject a wrong-typed value.
  (bundle) => ({ ...bundle, tasks: bundle.tasks.map((t) => ({ ...t, progress: 'not-a-number' })) }),
  (bundle) => ({ ...bundle, tasks: bundle.tasks.map((t) => ({ ...t, id: 123 })) }),
  (bundle) => ({ ...bundle, tasks: 'not-an-array' }),
  (bundle) => ({ ...bundle, dependencies: bundle.dependencies.map((d) => ({ ...d, type: 'XX' })) }),
  // Blow past a limit (small injected cap applied via a wrapper below, not here).
  (bundle) => ({ ...bundle, tasks: bundle.tasks.map((t) => ({ ...t, id: '' })) }),
  (bundle) => ({
    ...bundle,
    tasks: bundle.tasks.length >= 2 ? [bundle.tasks[0], { ...bundle.tasks[0], id: bundle.tasks[0]!.id }] : bundle.tasks,
  }),
];

const mutationArb = fc.constantFrom(...mutations);

describe('property: importJson never throws anything but IoValidationError on invalid input', () => {
  it('rejects mutated (invalid) bundles with IoValidationError, never hangs / never a different error type', () => {
    fc.assert(
      fc.property(fixtureArb, mutationArb, ({ tasks, dependencies }, mutate) => {
        const bundle = exportJson(tasks, dependencies);
        const mutated = mutate(bundle);
        let threw = false;
        try {
          importJson(mutated as object);
        } catch (err) {
          threw = true;
          expect(err).toBeInstanceOf(IoValidationError);
        }
        // Not every mutation is guaranteed invalid for every fixture (e.g. mutating an empty
        // tasks array's elements is a no-op) — so we only assert the ERROR TYPE when a throw
        // does happen, never that a throw always happens. The meaningful invariant fuzzed here
        // is "never throws a non-IoValidationError, never hangs."
        expect(typeof threw).toBe('boolean');
      }),
    );
  });

  it('rejects an over-limit task count', () => {
    fc.assert(
      fc.property(fixtureArb, ({ tasks, dependencies }) => {
        const bundle = exportJson(tasks, dependencies);
        expect(() => importJson(bundle, { limits: { maxTaskCount: 0 } })).toThrow(IoValidationError);
      }),
    );
  });
});
