// Property tests (fast-check) for `detectConflicts` — spec-detect-conflicts.md §7.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Temporal } from '@js-temporal/polyfill';
import { detectConflicts } from '../../src/compute/conflicts.js';
import { computeCascade } from '../../src/compute/cascade.js';
import { DEFAULT_CALENDAR, addWorkingHours } from '../../src/compute/working-calendar.js';
import {
  toDependencyId,
  toTaskId,
  type Dependency,
  type DependencyType,
  type Task,
  type WorkingCalendar,
} from '../../src/types.js';

const cal = DEFAULT_CALENDAR;
const now = new Date('2026-01-01T00:00:00Z');
const ROOT = '2026-01-05T09:00';

interface Spec {
  n: number;
  offsets: number[];
  durations: number[];
  edges: Array<{ from: number; to: number; type: DependencyType; lag: number }>;
}

const specArb: fc.Arbitrary<Spec> = fc.integer({ min: 2, max: 7 }).chain((n) =>
  fc.record({
    n: fc.constant(n),
    offsets: fc.array(fc.integer({ min: 0, max: 60 }), { minLength: n, maxLength: n }),
    durations: fc.array(fc.integer({ min: 1, max: 40 }), { minLength: n, maxLength: n }),
    edges: fc.array(
      fc.integer({ min: 0, max: n - 2 }).chain((from) =>
        fc.record({
          from: fc.constant(from),
          to: fc.integer({ min: from + 1, max: n - 1 }),
          type: fc.constantFrom<DependencyType>('FS', 'SS', 'FF', 'SF'),
          lag: fc.integer({ min: -20, max: 20 }),
        }),
      ),
      { maxLength: n * 2 },
    ),
  }),
);

function build(spec: Spec): { tasks: Task[]; deps: Dependency[] } {
  const tasks: Task[] = spec.durations.map((duration, i) => {
    const start = addWorkingHours(ROOT, spec.offsets[i]!, cal);
    return {
      id: toTaskId(`t${i}`),
      name: `t${i}`,
      start,
      end: addWorkingHours(start, duration, cal),
      duration,
      progress: 0,
      type: 'task',
      createdAt: now,
      updatedAt: now,
    };
  });
  const deps: Dependency[] = spec.edges.map((e, i) => ({
    id: toDependencyId(`d${i}`),
    from: tasks[e.from]!.id,
    to: tasks[e.to]!.id,
    type: e.type,
    lag: e.lag,
  }));
  return { tasks, deps };
}

const roots = (tasks: Task[], deps: Dependency[]) =>
  tasks.filter((t) => !deps.some((d) => d.to === t.id)).map((t) => t.id);

/** Deterministic permutation driven by a seed array. */
function permute<T>(xs: readonly T[], seed: readonly number[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = (seed[i % seed.length] ?? 0) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('detectConflicts — properties', () => {
  it('is order-invariant', () => {
    fc.assert(
      fc.property(specArb, fc.array(fc.nat(), { minLength: 1, maxLength: 8 }), (spec, seed) => {
        const { tasks, deps } = build(spec);
        expect(detectConflicts(permute(tasks, seed), permute(deps, seed), cal)).toEqual(
          detectConflicts(tasks, deps, cal),
        );
      }),
    );
  });

  it('has no dependency-violation iff computeCascade from the roots shifts nothing', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        const { tasks, deps } = build(spec);
        const violations = detectConflicts(tasks, deps, cal, { kinds: ['dependency-violation'] });
        const { shifts } = computeCascade(tasks, deps, cal, roots(tasks, deps));
        expect(violations.length === 0).toBe(shifts.length === 0);
      }),
    );
  });

  it('applying the cascade from the roots removes every dependency-violation', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        const { tasks, deps } = build(spec);
        const { shifts } = computeCascade(tasks, deps, cal, roots(tasks, deps));
        const patched = tasks.map((t) => {
          const s = shifts.find((x) => x.taskId === t.id);
          return s ? { ...t, start: s.start, end: s.end } : t;
        });
        expect(detectConflicts(patched, deps, cal, { kinds: ['dependency-violation'] })).toEqual([]);
      }),
    );
  });

  it('moving a violated successor to its requiredStart removes that dependency conflict', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        const { tasks, deps } = build(spec);
        const [first] = detectConflicts(tasks, deps, cal, { kinds: ['dependency-violation'] });
        if (!first || first.kind !== 'dependency-violation') return;
        const patched = tasks.map((t) =>
          t.id === first.to ? { ...t, start: first.requiredStart, end: addWorkingHours(first.requiredStart, t.duration!, cal) } : t,
        );
        const after = detectConflicts(patched, deps, cal, { kinds: ['dependency-violation'] });
        expect(after.some((c) => c.kind === 'dependency-violation' && c.dependencyId === first.dependencyId)).toBe(false);
      }),
    );
  });

  it('is pure and reports non-negative shortfalls', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        const { tasks, deps } = build(spec);
        const a = detectConflicts(tasks, deps, cal);
        expect(detectConflicts(tasks, deps, cal)).toEqual(a);
        for (const c of a) if (c.kind === 'dependency-violation') expect(c.shortfallHours).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('never throws on cyclic graphs, self loops, or end-before-start spans', () => {
    const arb = fc.record({
      spans: fc.array(fc.tuple(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 200 })), { minLength: 1, maxLength: 6 }),
      edges: fc.array(
        fc.record({
          from: fc.nat(5),
          to: fc.nat(5),
          type: fc.constantFrom<DependencyType>('FS', 'SS', 'FF', 'SF'),
          lag: fc.integer({ min: -30, max: 30 }),
        }),
        { maxLength: 10 },
      ),
    });
    fc.assert(
      fc.property(arb, ({ spans, edges }) => {
        const tasks: Task[] = spans.map(([s, e], i) => ({
          id: toTaskId(`t${i}`),
          name: `t${i}`,
          start: addWorkingHours(ROOT, s, cal),
          end: addWorkingHours(ROOT, e, cal),
          progress: 0,
          type: 'task',
          createdAt: now,
          updatedAt: now,
        }));
        const deps: Dependency[] = edges.map((e, i) => ({
          id: toDependencyId(`d${i}`),
          from: toTaskId(`t${e.from % tasks.length}`),
          to: toTaskId(`t${e.to % tasks.length}`),
          type: e.type,
          lag: e.lag,
        }));
        expect(() => detectConflicts(tasks, deps, cal)).not.toThrow();
      }),
    );
  });
});

// Harsher inputs than the aligned/integer/UTC suite above: DST + split windows + holidays, spans
// starting at arbitrary minutes (nights, weekends), fractional lags and explicit durations.
const harshCalendars: Record<string, WorkingCalendar> = {
  newYork: {
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    workingHours: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
    holidays: ['2026-03-09', '2026-03-23'],
    timezone: 'America/New_York',
  },
  hoChiMinh: {
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    workingHours: [{ start: '08:00', end: '12:00' }, { start: '13:30', end: '17:30' }],
    holidays: ['2026-03-10'],
    timezone: 'Asia/Ho_Chi_Minh',
  },
};

interface HarshSpec {
  starts: number[]; // minutes after 2026-03-02T00:00 local
  lengths: number[]; // working hours (quarter-hour steps)
  explicit: boolean[];
  edges: Array<{ from: number; to: number; type: DependencyType; lag: number }>;
}

const harshArb: fc.Arbitrary<HarshSpec> = fc.integer({ min: 2, max: 6 }).chain((n) =>
  fc.record({
    starts: fc.array(fc.integer({ min: 0, max: 40 * 24 * 60 }), { minLength: n, maxLength: n }),
    lengths: fc.array(fc.integer({ min: 1, max: 60 }).map((q) => q / 4), { minLength: n, maxLength: n }),
    explicit: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
    edges: fc.array(
      fc.integer({ min: 0, max: n - 2 }).chain((from) =>
        fc.record({
          from: fc.constant(from),
          to: fc.integer({ min: from + 1, max: n - 1 }),
          type: fc.constantFrom<DependencyType>('FS', 'SS', 'FF', 'SF'),
          lag: fc.integer({ min: -60, max: 60 }).map((q) => q / 4),
        }),
      ),
      { maxLength: n * 2 },
    ),
  }),
);

function buildHarsh(spec: HarshSpec, c: WorkingCalendar): { tasks: Task[]; deps: Dependency[] } {
  const base = Temporal.PlainDateTime.from('2026-03-02T00:00').toZonedDateTime(c.timezone);
  const tasks: Task[] = spec.starts.map((m, i) => {
    const start = base.add({ minutes: m });
    const length = spec.lengths[i]!;
    return {
      id: toTaskId(`t${i}`),
      name: `t${i}`,
      start,
      end: addWorkingHours(start, length, c),
      ...(spec.explicit[i] ? { duration: length } : {}),
      progress: 0,
      type: 'task',
      createdAt: now,
      updatedAt: now,
    };
  });
  const deps: Dependency[] = spec.edges.map((e, i) => ({
    id: toDependencyId(`d${i}`),
    from: tasks[e.from]!.id,
    to: tasks[e.to]!.id,
    type: e.type,
    lag: e.lag,
  }));
  return { tasks, deps };
}

describe.each(Object.entries(harshCalendars))('detectConflicts — properties on %s', (_name, hc) => {
  it('agrees with computeCascade from the roots and the cascade repairs every violation', () => {
    fc.assert(
      fc.property(harshArb, (spec) => {
        const { tasks, deps } = buildHarsh(spec, hc);
        const violations = detectConflicts(tasks, deps, hc, { kinds: ['dependency-violation'] });
        const { shifts } = computeCascade(tasks, deps, hc, roots(tasks, deps));
        expect(violations.length === 0).toBe(shifts.length === 0);
        const patched = tasks.map((t) => {
          const s = shifts.find((x) => x.taskId === t.id);
          return s ? { ...t, start: s.start, end: s.end } : t;
        });
        expect(detectConflicts(patched, deps, hc, { kinds: ['dependency-violation'] })).toEqual([]);
        for (const v of violations) {
          if (v.kind === 'dependency-violation') expect(v.shortfallHours).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 150 },
    );
  });
});
