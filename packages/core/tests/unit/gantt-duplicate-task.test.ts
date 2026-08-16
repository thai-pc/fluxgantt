// Headless facade tests — duplicateTask() (spec-duplicate-task.md §8). Runs under vitest's
// default `node` environment — duplicateTask is pure state/facade logic, no DOM dependency
// (same posture as gantt-history.test.ts, not the jsdom-requiring gantt-dom.test.ts).
import { describe, it, expect, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { toTaskId, toResourceId, type Task, type WorkingCalendar } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import {
  addWorkingHours,
  differenceInWorkingHours,
  normalizeDate,
  DEFAULT_CALENDAR,
} from '../../src/compute/working-calendar.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

describe('duplicateTask — single explicit duplicate, full round-trip', () => {
  it('copies every generic field verbatim, resets progress, mints a fresh id/timestamps, offsets start/end', () => {
    // Fake timers + an explicit tick between task creation and duplication: `createdAt`/
    // `updatedAt` are stamped via `new Date()` (TaskStore.add()'s documented I/O-boundary
    // exception, ms-resolution) — without advancing the clock, source-creation and
    // duplication could land in the SAME millisecond and produce a flaky "not.toEqual"
    // failure unrelated to duplicateTask's own logic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00', {
          priority: 3,
          notes: 'important note',
          color: '#6366f1',
          meta: { foo: 'bar' },
          resources: [{ resourceId: toResourceId('res-1'), units: 0.5 }],
          constraint: { kind: 'asap' },
          progress: 0.75,
        }),
      ],
    });
    const source = gantt.getTask(toTaskId('a'))!;

    vi.advanceTimersByTime(1000);
    const result = gantt.duplicateTask(toTaskId('a'));
    vi.useRealTimers();

    expect(result).toHaveLength(1);
    const copy = result[0]!;

    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe(source.name);
    expect(copy.priority).toBe(source.priority);
    expect(copy.parent).toBe(source.parent);
    expect(copy.type).toBe(source.type);
    expect(copy.constraint).toEqual(source.constraint);
    expect(copy.resources).toEqual(source.resources);
    expect(copy.notes).toBe(source.notes);
    expect(copy.color).toBe(source.color);
    expect(copy.meta).toEqual(source.meta);
    expect(copy.duration).toBe(source.duration);

    expect(copy.progress).toBe(0); // reset, even though source.progress was 0.75

    expect(copy.createdAt).not.toEqual(source.createdAt);
    expect(copy.updatedAt).not.toEqual(source.updatedAt);

    const tz = 'UTC'; // DEFAULT_CALENDAR timezone
    expect(normalizeDate(copy.start, tz).epochNanoseconds).toBe(
      normalizeDate(source.end, tz).epochNanoseconds,
    );
    // Span preserved: the copy's own working-hours duration equals the source's.
    expect(differenceInWorkingHours(copy.start, copy.end, DEFAULT_CALENDAR)).toBe(
      differenceInWorkingHours(source.start, source.end, DEFAULT_CALENDAR),
    );
  });
});

describe('duplicateTask — milestone (zero-length task)', () => {
  it('copy is also zero-length, positioned exactly at the source end', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('m', '2026-01-05T09:00', '2026-01-05T09:00', { type: 'milestone' }),
      ],
    });
    const source = gantt.getTask(toTaskId('m'))!;
    const [copy] = gantt.duplicateTask(toTaskId('m'));

    expect(copy!.type).toBe('milestone');
    const tz = 'UTC';
    const expectedStart = normalizeDate(source.end, tz).epochNanoseconds;
    expect(normalizeDate(copy!.start, tz).epochNanoseconds).toBe(expectedStart);
    expect(normalizeDate(copy!.end, tz).epochNanoseconds).toBe(expectedStart);
  });
});

describe('duplicateTask — explicit nonexistent id throws', () => {
  it('throws with the standard #requireTask message; nothing mutated', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    const countBefore = gantt.getTasks().length;
    const canUndoBefore = gantt.canUndo();

    expect(() => gantt.duplicateTask(toTaskId('nope'))).toThrow(
      'gantt.duplicateTask: task "nope" not found',
    );

    expect(gantt.getTasks()).toHaveLength(countBefore);
    expect(gantt.canUndo()).toBe(canUndoBefore);
  });
});

describe('duplicateTask — no-arg + empty selection is a safe no-op', () => {
  it('returns [], no mutation, no history entry, no task:added', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    const onAdded = vi.fn();
    gantt.on('task:added', onAdded);

    const result = gantt.duplicateTask();

    expect(result).toEqual([]);
    expect(gantt.getTasks()).toHaveLength(1);
    expect(gantt.canUndo()).toBe(false);
    expect(onAdded).not.toHaveBeenCalled();
  });
});

describe('duplicateTask — multi-select duplicate: count + single undo entry', () => {
  it('duplicates the current selection, fires task:added N times, history:changed once, undo/redo atomic', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
        taskInput('c', '2026-01-07T09:00', '2026-01-08T09:00'),
      ],
    });
    gantt.select([toTaskId('a'), toTaskId('b'), toTaskId('c')]);

    const onAdded = vi.fn();
    const onHistory = vi.fn();
    gantt.on('task:added', onAdded);
    gantt.on('history:changed', onHistory);

    const countBefore = gantt.getTasks().length;
    const result = gantt.duplicateTask();

    expect(result).toHaveLength(3);
    const newIds = new Set(result.map((t) => t.id));
    expect(newIds.size).toBe(3);
    expect(onAdded).toHaveBeenCalledTimes(3);
    expect(onHistory).toHaveBeenCalledTimes(1); // ONE entry for the whole multi-select duplicate

    expect(gantt.undo()).toBe(true);
    expect(gantt.getTasks()).toHaveLength(countBefore); // all 3 copies removed atomically

    expect(gantt.redo()).toBe(true);
    expect(gantt.getTasks()).toHaveLength(countBefore + 3);
    const restoredIds = new Set(
      gantt
        .getTasks()
        .map((t) => t.id)
        .filter((id) => newIds.has(id)),
    );
    expect(restoredIds).toEqual(newIds); // identity-fidelity round-trip
  });
});

describe('duplicateTask — per-copy offset independence', () => {
  it('each copy is offset from ITS OWN source end, not a shared/first-processed anchor', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-05T17:00'),
        taskInput('b', '2026-01-06T09:00', '2026-01-07T17:00'),
        taskInput('c', '2026-01-08T09:00', '2026-01-12T17:00'),
      ],
    });
    gantt.select([toTaskId('a'), toTaskId('b'), toTaskId('c')]);
    const sources = {
      a: gantt.getTask(toTaskId('a'))!,
      b: gantt.getTask(toTaskId('b'))!,
      c: gantt.getTask(toTaskId('c'))!,
    };

    const [copyA, copyB, copyC] = gantt.duplicateTask();
    const tz = 'UTC';

    expect(normalizeDate(copyA!.start, tz).epochNanoseconds).toBe(
      normalizeDate(sources.a.end, tz).epochNanoseconds,
    );
    expect(normalizeDate(copyB!.start, tz).epochNanoseconds).toBe(
      normalizeDate(sources.b.end, tz).epochNanoseconds,
    );
    expect(normalizeDate(copyC!.start, tz).epochNanoseconds).toBe(
      normalizeDate(sources.c.end, tz).epochNanoseconds,
    );

    // Sanity — the three offsets are genuinely distinct (not a bug that happens to alias).
    const starts = new Set(
      [copyA, copyB, copyC].map((c) => normalizeDate(c!.start, tz).epochNanoseconds.toString()),
    );
    expect(starts.size).toBe(3);
  });
});

describe('duplicateTask — zero dependency edges on the copy', () => {
  it('(a) duplicating a task with no dependencies leaves the copy with none', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    const [copy] = gantt.duplicateTask(toTaskId('a'));
    expect(gantt.getDependenciesOf(copy!.id)).toEqual([]);
  });

  it('(b) duplicating a task with both incoming FS and outgoing SS edges (+lag) yields zero edges on the copy; source unaffected', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('pred', '2026-01-01T09:00', '2026-01-02T09:00'),
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('succ', '2026-01-06T09:00', '2026-01-07T09:00'),
      ],
      dependencies: [
        { from: toTaskId('pred'), to: toTaskId('a'), type: 'FS', lag: 2 },
        { from: toTaskId('a'), to: toTaskId('succ'), type: 'SS' },
      ],
    });
    const sourceDepsBefore = gantt.getDependenciesOf(toTaskId('a'));
    expect(sourceDepsBefore).toHaveLength(2);

    const [copy] = gantt.duplicateTask(toTaskId('a'));

    expect(gantt.getDependenciesOf(copy!.id)).toEqual([]);
    expect(gantt.getDependenciesOf(toTaskId('a'))).toEqual(sourceDepsBefore); // original untouched
  });
});

describe('duplicateTask — destroy() lifecycle', () => {
  it('throws the standard #assertAlive message after destroy()', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.destroy();

    expect(() => gantt.duplicateTask(toTaskId('a'))).toThrow(
      '@fluxgantt/core: cannot call duplicateTask — this gantt instance destroyed',
    );
  });
});

describe('duplicateTask — readOnly-independence', () => {
  it('succeeds normally under readOnly: true (not gated at the facade-method level)', () => {
    const gantt = createGantt({
      readOnly: true,
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    const result = gantt.duplicateTask(toTaskId('a'));
    expect(result).toHaveLength(1);
    expect(gantt.getTasks()).toHaveLength(2);
  });
});

describe('duplicateTask — event emission discipline', () => {
  it('only task:added fires per copy (N times), history:changed once per call — no new event type', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
      ],
    });
    gantt.select([toTaskId('a'), toTaskId('b')]);

    const onAdded = vi.fn();
    const onHistory = vi.fn();
    gantt.on('task:added', onAdded);
    gantt.on('history:changed', onHistory);

    gantt.duplicateTask();

    expect(onAdded).toHaveBeenCalledTimes(2);
    expect(onHistory).toHaveBeenCalledTimes(1);
    // No 'task:duplicated' event exists on the GanttEventMap at all — a TS compile-time
    // guarantee (attempting gantt.on('task:duplicated', ...) would fail to typecheck), so
    // there is nothing further to assert here at runtime beyond the counts above.
  });
});

describe('duplicateTask — field-copy completeness (table-driven)', () => {
  it('every Task field is either copied verbatim or explicitly reset, none accidentally dropped', () => {
    // See the "single explicit duplicate" test above for why fake timers + an explicit tick
    // are needed here — createdAt/updatedAt are ms-resolution `new Date()` stamps.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00', {
          duration: 8,
          priority: 5,
          type: 'task',
          constraint: { kind: 'must-start-on', date: '2026-01-05T09:00' },
          resources: [],
          notes: 'notes here',
          color: '#ef4444',
          meta: { a: 1, b: 'two' },
          progress: 0.75,
        }),
      ],
    });
    const source = gantt.getTask(toTaskId('a'))!;

    vi.advanceTimersByTime(1000);
    const [copy] = gantt.duplicateTask(toTaskId('a'));
    vi.useRealTimers();

    // Verbatim fields
    const verbatimFields: (keyof Task)[] = [
      'name',
      'priority',
      'parent',
      'type',
      'constraint',
      'resources',
      'notes',
      'color',
      'meta',
      'duration',
    ];
    for (const field of verbatimFields) {
      expect(copy![field]).toEqual(source[field]);
    }

    // Explicitly-reset / fresh fields
    expect(copy!.progress).toBe(0);
    expect(source.progress).toBe(0.75);
    expect(copy!.id).not.toBe(source.id);
    expect(copy!.createdAt).not.toEqual(source.createdAt);
    expect(copy!.updatedAt).not.toEqual(source.updatedAt);
    // start/end explicitly recomputed (not verbatim) — covered by the offset tests above.
  });
});

describe('duplicateTask — meta/resources reference-sharing safety (shallow copy)', () => {
  it('mutating the copy via updateTask (replace, not in-place) never affects the source', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00', { meta: { shared: true } }),
      ],
    });
    const [copy] = gantt.duplicateTask(toTaskId('a'));

    gantt.updateTask(copy!.id, { meta: { ...copy!.meta, extra: 1 } });

    const source = gantt.getTask(toTaskId('a'))!;
    expect(source.meta).toEqual({ shared: true });
    expect(source.meta).not.toHaveProperty('extra');
  });
});

describe('duplicateTask — DST-boundary date-offset correctness', () => {
  it('offset composition across a spring-forward transition matches addWorkingHours/differenceInWorkingHours independently', () => {
    const nyCalendar: WorkingCalendar = {
      workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      workingHours: [{ start: '09:00', end: '17:00' }],
      holidays: [],
      timezone: 'America/New_York',
    };
    const gantt = createGantt({
      calendar: nyCalendar,
      // 2026-03-06 = Fri, 2026-03-08 = Sun (DST spring-forward), 2026-03-09 = Mon.
      tasks: [taskInput('a', '2026-03-06T09:00', '2026-03-06T16:00')],
    });
    const source = gantt.getTask(toTaskId('a'))!;
    const [copy] = gantt.duplicateTask(toTaskId('a'));

    const tz = 'America/New_York';
    const expectedStart = normalizeDate(source.end, tz);
    const durationHours = differenceInWorkingHours(source.start, source.end, nyCalendar);
    const expectedEnd = addWorkingHours(expectedStart, durationHours, nyCalendar);

    expect(normalizeDate(copy!.start, tz).epochNanoseconds).toBe(expectedStart.epochNanoseconds);
    expect(normalizeDate(copy!.end, tz).epochNanoseconds).toBe(expectedEnd.epochNanoseconds);
    // Span preserved (working hours), independently re-derived, no drift/off-by-one-hour bug.
    expect(differenceInWorkingHours(copy!.start, copy!.end, nyCalendar)).toBe(durationHours);
  });
});
