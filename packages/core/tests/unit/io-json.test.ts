// JSON IO layer tests (spec-io-json-csv.md §8, testing.md §3 IO layer priority).
import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { exportJson, importJson, IoValidationError } from '../../src/io/index.js';
import { createGantt } from '../../src/gantt.js';
import { normalizeDate } from '../../src/compute/working-calendar.js';
import {
  toDependencyId,
  toResourceId,
  toTaskId,
  type Dependency,
  type Task,
  type TaskConstraint,
} from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import type { DependencyInput } from '../../src/gantt.js';

const now = new Date('2026-01-01T00:00:00Z');

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: toTaskId('t-1'),
    name: 'Task 1',
    start: '2026-01-05T09:00:00Z',
    end: '2026-01-05T17:00:00Z',
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeDependency(overrides: Partial<Dependency> = {}): Dependency {
  return {
    id: toDependencyId('d-1'),
    from: toTaskId('t-1'),
    to: toTaskId('t-2'),
    type: 'FS',
    ...overrides,
  };
}

/** Compares the LOGICAL fields only (excludes createdAt/updatedAt + dependency id, per
 *  spec §10's resolved round-trip invariant). `start`/`end`/constraint `date` are compared
 *  as Temporal instants (not string-equal), since a live `Task` may carry any of the 4
 *  `DateInput` shapes. */
function assertTaskLogicallyEqual(original: Task, reimported: TaskInput, timezone = 'UTC'): void {
  expect(reimported.id).toBe(original.id);
  expect(reimported.name).toBe(original.name);
  expect(sameInstant(reimported.start, original.start, timezone)).toBe(true);
  expect(sameInstant(reimported.end, original.end, timezone)).toBe(true);
  expect(reimported.progress).toBe(original.progress);
  expect(reimported.type).toBe(original.type);
  expect(reimported.duration).toBe(original.duration);
  expect(reimported.priority).toBe(original.priority);
  expect(reimported.parent).toBe(original.parent);
  expect(reimported.notes).toBe(original.notes);
  expect(reimported.color).toBe(original.color);
  expect(reimported.meta).toEqual(original.meta);
  expect(reimported.resources).toEqual(original.resources);
  assertConstraintLogicallyEqual(original.constraint, reimported.constraint, timezone);
}

function assertConstraintLogicallyEqual(
  original: TaskConstraint | undefined,
  reimported: TaskConstraint | undefined,
  timezone: string,
): void {
  if (original === undefined) {
    expect(reimported).toBeUndefined();
    return;
  }
  expect(reimported).toBeDefined();
  expect(reimported!.kind).toBe(original.kind);
  if (original.kind === 'asap' || original.kind === 'alap') return;
  expect(sameInstant((reimported as { date: string }).date, (original as { date: string }).date, timezone)).toBe(
    true,
  );
}

function sameInstant(a: Task['start'], b: Task['start'], timezone: string): boolean {
  return Temporal.Instant.compare(normalizeDate(a, timezone).toInstant(), normalizeDate(b, timezone).toInstant()) === 0;
}

function assertDependencyLogicallyEqual(original: Dependency, reimported: DependencyInput): void {
  expect(reimported.from).toBe(original.from);
  expect(reimported.to).toBe(original.to);
  expect(reimported.type).toBe(original.type);
  expect(reimported.lag).toBe(original.lag);
}

// A fixture set covering: every TaskKind, every TaskConstraint kind, presence/absence of
// each optional field, and all 4 DateInput shapes across different tasks.
function buildFixture(): { tasks: Task[]; dependencies: Dependency[] } {
  const constraints: TaskConstraint[] = [
    { kind: 'asap' },
    { kind: 'alap' },
    { kind: 'must-start-on', date: '2026-01-06T09:00:00Z' },
    { kind: 'must-finish-on', date: '2026-01-06T17:00:00Z' },
    { kind: 'start-no-earlier-than', date: '2026-01-07T09:00:00Z' },
    { kind: 'start-no-later-than', date: '2026-01-07T17:00:00Z' },
    { kind: 'finish-no-earlier-than', date: '2026-01-08T09:00:00Z' },
    { kind: 'finish-no-later-than', date: '2026-01-08T17:00:00Z' },
  ];

  const tasks: Task[] = [
    // Bare-minimum required fields only.
    makeTask({ id: toTaskId('minimal') }),
    // Every TaskKind.
    makeTask({ id: toTaskId('kind-task'), type: 'task' }),
    makeTask({ id: toTaskId('kind-summary'), type: 'summary' }),
    makeTask({ id: toTaskId('kind-milestone'), type: 'milestone' }),
    makeTask({ id: toTaskId('kind-project'), type: 'project' }),
    // Every optional scalar field populated.
    makeTask({
      id: toTaskId('full'),
      duration: 40,
      priority: 3,
      notes: 'Some notes',
      color: '#6366f1',
      meta: { tag: 'x', nested: { a: 1 }, list: [1, 2, 3] },
      resources: [{ resourceId: toResourceId('r-1'), units: 0.5 }],
    }),
    // Hierarchy: parent present.
    makeTask({ id: toTaskId('parent'), type: 'summary' }),
    makeTask({ id: toTaskId('child'), parent: toTaskId('parent') }),
    // All 4 DateInput shapes.
    makeTask({ id: toTaskId('date-string'), start: '2026-01-05T09:00:00Z', end: '2026-01-05T17:00:00Z' }),
    makeTask({
      id: toTaskId('date-native'),
      start: new Date('2026-01-05T09:00:00Z'),
      end: new Date('2026-01-05T17:00:00Z'),
    }),
    makeTask({
      id: toTaskId('date-zoned'),
      start: Temporal.ZonedDateTime.from('2026-01-05T09:00:00[UTC]'),
      end: Temporal.ZonedDateTime.from('2026-01-05T17:00:00[UTC]'),
    }),
    makeTask({
      id: toTaskId('date-plain'),
      start: Temporal.PlainDate.from('2026-01-05'),
      end: Temporal.PlainDate.from('2026-01-06'),
    }),
    ...constraints.map((constraint, i) => makeTask({ id: toTaskId(`constraint-${i}`), constraint })),
  ];

  const dependencies: Dependency[] = [
    makeDependency({ id: toDependencyId('dep-fs'), type: 'FS', lag: 2 }),
    makeDependency({ id: toDependencyId('dep-ss'), type: 'SS', from: toTaskId('t-1'), to: toTaskId('kind-task') }),
    makeDependency({ id: toDependencyId('dep-ff'), type: 'FF', from: toTaskId('t-1'), to: toTaskId('kind-summary') }),
    makeDependency({
      id: toDependencyId('dep-sf'),
      type: 'SF',
      from: toTaskId('t-1'),
      to: toTaskId('kind-milestone'),
      lag: -3,
    }),
    makeDependency({
      id: toDependencyId('dep-no-lag'),
      type: 'FS',
      from: toTaskId('t-1'),
      to: toTaskId('kind-project'),
    }),
  ];

  return { tasks, dependencies };
}

describe('exportJson / importJson — round-trip', () => {
  it('round-trips every logical field, in UTC', () => {
    const { tasks, dependencies } = buildFixture();
    const bundle = exportJson(tasks, dependencies);
    const result = importJson(bundle);

    expect(result.tasks).toHaveLength(tasks.length);
    expect(result.dependencies).toHaveLength(dependencies.length);

    const byId = new Map(result.tasks.map((t) => [t.id, t]));
    for (const original of tasks) {
      assertTaskLogicallyEqual(original, byId.get(original.id)!);
    }
    for (let i = 0; i < dependencies.length; i++) {
      assertDependencyLogicallyEqual(dependencies[i]!, result.dependencies[i]!);
    }
  });

  it.each(['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'] as const)(
    'round-trips instant-for-instant across timezone %s (incl. a DST-boundary instant)',
    (timezone) => {
      const dstTask = makeTask({
        id: toTaskId('dst-boundary'),
        // 2026-03-08 is a real US DST "spring forward" date (America/New_York).
        start: Temporal.ZonedDateTime.from('2026-03-08T01:30:00[America/New_York]'),
        end: Temporal.ZonedDateTime.from('2026-03-08T04:30:00[America/New_York]'),
      });
      const { tasks, dependencies } = buildFixture();
      const all = [...tasks, dstTask];
      const bundle = exportJson(all, dependencies, { timezone });
      const result = importJson(bundle);
      const byId = new Map(result.tasks.map((t) => [t.id, t]));
      for (const original of all) {
        assertTaskLogicallyEqual(original, byId.get(original.id)!, timezone);
      }
    },
  );

  it('accepts a bare {tasks, dependencies} envelope (no fluxgantt key)', () => {
    const { tasks, dependencies } = buildFixture();
    const bundle = exportJson(tasks, dependencies);
    const bare = { tasks: bundle.tasks, dependencies: bundle.dependencies };
    expect(() => importJson(bare)).not.toThrow();
  });

  it('rejects a mismatched schemaVersion', () => {
    const bundle = exportJson([], []);
    const bad = { ...bundle, fluxgantt: { ...bundle.fluxgantt, schemaVersion: '9.9' } };
    expect(() => importJson(bad)).toThrow(IoValidationError);
  });

  it('ignores unknown top-level keys (resources/baselines forward-compat)', () => {
    const bundle = exportJson([], []);
    const withExtras = { ...bundle, resources: [{ bogus: true }], baselines: [] };
    expect(() => importJson(withExtras)).not.toThrow();
  });

  it('parses a JSON string input identically to an already-parsed object', () => {
    const { tasks, dependencies } = buildFixture();
    const bundle = exportJson(tasks, dependencies);
    const fromString = importJson(JSON.stringify(bundle));
    const fromObject = importJson(bundle);
    expect(fromString.tasks.map((t) => t.id)).toEqual(fromObject.tasks.map((t) => t.id));
  });
});

describe('importJson — malformed-input rejection', () => {
  const isIoErr = (fn: () => unknown): void => expect(fn).toThrow(IoValidationError);

  it('rejects truncated/invalid JSON', () => {
    isIoErr(() => importJson('{ "tasks": ['));
  });

  it('rejects a non-object root (array)', () => {
    isIoErr(() => importJson('[]'));
  });

  it('rejects a non-object root (null)', () => {
    isIoErr(() => importJson('null'));
  });

  it('rejects a non-object root (primitive)', () => {
    isIoErr(() => importJson('42'));
  });

  it('rejects tasks that is not an array', () => {
    isIoErr(() => importJson({ tasks: 'nope', dependencies: [] }));
  });

  it('rejects a task missing name/start/end/progress/type', () => {
    const base: Record<string, unknown> = {
      id: 'x',
      name: 'n',
      start: '2026-01-01',
      end: '2026-01-02',
      progress: 0,
      type: 'task',
    };
    for (const key of ['name', 'start', 'end', 'progress', 'type']) {
      const rest = { ...base };
      delete rest[key];
      isIoErr(() => importJson({ tasks: [rest], dependencies: [] }));
    }
  });

  it('rejects progress out of [0,1]', () => {
    const task = { id: 'x', name: 'n', start: '2026-01-01', end: '2026-01-02', progress: 1.5, type: 'task' };
    isIoErr(() => importJson({ tasks: [task], dependencies: [] }));
    isIoErr(() =>
      importJson({ tasks: [{ ...task, progress: -0.1 }], dependencies: [] }),
    );
  });

  it('rejects an unknown task type', () => {
    const task = { id: 'x', name: 'n', start: '2026-01-01', end: '2026-01-02', progress: 0, type: 'bogus' };
    isIoErr(() => importJson({ tasks: [task], dependencies: [] }));
  });

  it('rejects a non-parseable start string', () => {
    const task = { id: 'x', name: 'n', start: 'not-a-date', end: '2026-01-02', progress: 0, type: 'task' };
    isIoErr(() => importJson({ tasks: [task], dependencies: [] }));
  });

  it('rejects an unknown constraint.kind', () => {
    const task = {
      id: 'x',
      name: 'n',
      start: '2026-01-01',
      end: '2026-01-02',
      progress: 0,
      type: 'task',
      constraint: { kind: 'whenever' },
    };
    isIoErr(() => importJson({ tasks: [task], dependencies: [] }));
  });

  it('rejects a must-start-on constraint missing date', () => {
    const task = {
      id: 'x',
      name: 'n',
      start: '2026-01-01',
      end: '2026-01-02',
      progress: 0,
      type: 'task',
      constraint: { kind: 'must-start-on' },
    };
    isIoErr(() => importJson({ tasks: [task], dependencies: [] }));
  });

  it('rejects an oversized tasks array (injected small limit)', () => {
    const task = { id: 'x', name: 'n', start: '2026-01-01', end: '2026-01-02', progress: 0, type: 'task' };
    isIoErr(() =>
      importJson(
        { tasks: [task, { ...task, id: 'y' }], dependencies: [] },
        { limits: { maxTaskCount: 1 } },
      ),
    );
  });

  it('rejects an over-length name (injected small limit)', () => {
    const task = { id: 'x', name: 'toolong', start: '2026-01-01', end: '2026-01-02', progress: 0, type: 'task' };
    isIoErr(() => importJson({ tasks: [task], dependencies: [] }, { limits: { maxNameLength: 3 } }));
  });

  it('rejects an over-length notes string (injected small limit)', () => {
    const task = {
      id: 'x',
      name: 'n',
      start: '2026-01-01',
      end: '2026-01-02',
      progress: 0,
      type: 'task',
      notes: 'toolong',
    };
    isIoErr(() => importJson({ tasks: [task], dependencies: [] }, { limits: { maxStringLength: 3 } }));
  });

  it('rejects an over-length color string (injected small limit)', () => {
    const task = {
      id: 'x',
      name: 'n',
      start: '2026-01-01',
      end: '2026-01-02',
      progress: 0,
      type: 'task',
      color: '#6366f1',
    };
    isIoErr(() => importJson({ tasks: [task], dependencies: [] }, { limits: { maxStringLength: 3 } }));
  });

  it('rejects a duplicate task id within one import', () => {
    const task = { id: 'x', name: 'n', start: '2026-01-01', end: '2026-01-02', progress: 0, type: 'task' };
    isIoErr(() => importJson({ tasks: [task, { ...task }], dependencies: [] }));
  });

  it('rejects an empty-string task id', () => {
    const task = { id: '', name: 'n', start: '2026-01-01', end: '2026-01-02', progress: 0, type: 'task' };
    isIoErr(() => importJson({ tasks: [task], dependencies: [] }));
  });

  it('rejects a meta object exceeding maxMetaKeys', () => {
    const task = {
      id: 'x',
      name: 'n',
      start: '2026-01-01',
      end: '2026-01-02',
      progress: 0,
      type: 'task',
      meta: { a: 1, b: 2, c: 3 },
    };
    isIoErr(() => importJson({ tasks: [task], dependencies: [] }, { limits: { maxMetaKeys: 2 } }));
  });

  it('rejects a meta object nested deeper than maxMetaDepth', () => {
    const task = {
      id: 'x',
      name: 'n',
      start: '2026-01-01',
      end: '2026-01-02',
      progress: 0,
      type: 'task',
      meta: { a: { b: { c: 1 } } },
    };
    isIoErr(() => importJson({ tasks: [task], dependencies: [] }, { limits: { maxMetaDepth: 2 } }));
  });

  it('rejects a parent chain that cycles within the batch', () => {
    const a = { id: 'a', name: 'a', start: '2026-01-01', end: '2026-01-02', progress: 0, type: 'task', parent: 'b' };
    const b = { id: 'b', name: 'b', start: '2026-01-01', end: '2026-01-02', progress: 0, type: 'task', parent: 'a' };
    isIoErr(() => importJson({ tasks: [a, b], dependencies: [] }));
  });

  it('rejects a parent chain deeper than maxHierarchyDepth', () => {
    const chain = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      name: `t${i}`,
      start: '2026-01-01',
      end: '2026-01-02',
      progress: 0,
      type: 'task',
      ...(i > 0 ? { parent: `t${i - 1}` } : {}),
    }));
    isIoErr(() => importJson({ tasks: chain, dependencies: [] }, { limits: { maxHierarchyDepth: 3 } }));
  });

  it('rejects a color containing javascript:/url(', () => {
    const base = { id: 'x', name: 'n', start: '2026-01-01', end: '2026-01-02', progress: 0, type: 'task' };
    isIoErr(() => importJson({ tasks: [{ ...base, color: 'javascript:alert(1)' }], dependencies: [] }));
    isIoErr(() => importJson({ tasks: [{ ...base, color: 'url(x.png)' }], dependencies: [] }));
  });
});

describe('importJson — .path assertions', () => {
  it('points at the offending task field', () => {
    const task = { id: 'x', name: 'n', start: '2026-01-01', end: '2026-01-02', progress: 1.5, type: 'task' };
    try {
      importJson({ tasks: [task], dependencies: [] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IoValidationError);
      expect((err as InstanceType<typeof IoValidationError>).path).toBe('$.tasks[0].progress');
    }
  });

  it('points at the offending dependency field', () => {
    try {
      importJson({ tasks: [], dependencies: [{ from: 'a', to: 'b', type: 'bogus' }] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IoValidationError);
      expect((err as InstanceType<typeof IoValidationError>).path).toBe('$.dependencies[0].type');
    }
  });

  it('points at the schemaVersion field', () => {
    try {
      importJson({ fluxgantt: { schemaVersion: '2.0' }, tasks: [], dependencies: [] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IoValidationError);
      expect((err as InstanceType<typeof IoValidationError>).path).toBe('$.fluxgantt.schemaVersion');
    }
  });

  it('points at the root for a malformed root', () => {
    try {
      importJson('[]');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IoValidationError);
      expect((err as InstanceType<typeof IoValidationError>).path).toBe('$');
    }
  });
});

describe('IoValidationError vs plain Error — dependency cycle delegation', () => {
  it('importJson does NOT throw for a cyclic dependency set; createGantt DOES', () => {
    const tasks = [
      { id: 'a', name: 'a', start: '2026-01-01', end: '2026-01-02', progress: 0, type: 'task' },
      { id: 'b', name: 'b', start: '2026-01-01', end: '2026-01-02', progress: 0, type: 'task' },
    ];
    const dependencies = [
      { from: 'a', to: 'b', type: 'FS' },
      { from: 'b', to: 'a', type: 'FS' },
    ];

    const result = importJson({ tasks, dependencies });
    expect(result.dependencies).toHaveLength(2);

    expect(() => createGantt({ tasks: result.tasks, dependencies: result.dependencies })).toThrow(/cycle/);
    try {
      createGantt({ tasks: result.tasks, dependencies: result.dependencies });
      expect.unreachable();
    } catch (err) {
      expect(err).not.toBeInstanceOf(IoValidationError);
    }
  });
});
