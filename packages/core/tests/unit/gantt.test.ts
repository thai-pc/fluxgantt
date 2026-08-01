// Headless facade tests (spec-gantt-facade.md §8.1). Runs under vitest's default `node`
// environment — createGantt(config) must be fully usable (mutate/compute/subscribe) with
// no DOM. DOM tests (mount/unmount/drag) live in gantt-dom.test.ts (jsdom).
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../../src/gantt.js';
import type { GanttEventName, GanttEventMap } from '../../src/gantt.js';
import { normalizeDate } from '../../src/compute/working-calendar.js';
import { toTaskId, type Task, type TaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return {
    id: toTaskId(id),
    name: id,
    start,
    end,
    progress: 0,
    type: 'task',
    ...extra,
  };
}

describe('createGantt — construction', () => {
  it('createGantt({}) succeeds; getTasks()/getDependencies() are empty', () => {
    const gantt = createGantt({});
    expect(gantt.getTasks()).toEqual([]);
    expect(gantt.getDependencies()).toEqual([]);
  });

  it('hydrates tasks/dependencies from config; no task:added/dependency:added fired for a post-construction subscriber', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'), taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00')],
      dependencies: [{ from: toTaskId('a'), to: toTaskId('b'), type: 'FS' }],
    });
    expect(gantt.getTasks()).toHaveLength(2);
    expect(gantt.getDependencies()).toHaveLength(1);

    const onTaskAdded = vi.fn();
    const onDepAdded = vi.fn();
    gantt.on('task:added', onTaskAdded);
    gantt.on('dependency:added', onDepAdded);
    expect(onTaskAdded).not.toHaveBeenCalled();
    expect(onDepAdded).not.toHaveBeenCalled();
  });

  it('duplicate explicit task id in config.tasks throws, names the id', () => {
    expect(() =>
      createGantt({
        tasks: [taskInput('dup', '2026-01-05T09:00', '2026-01-06T09:00'), taskInput('dup', '2026-01-07T09:00', '2026-01-08T09:00')],
      }),
    ).toThrow(/dup/);
  });

  it('cyclic config.dependencies throws', () => {
    expect(() =>
      createGantt({
        tasks: [
          taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
          taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
        ],
        dependencies: [
          { from: toTaskId('a'), to: toTaskId('b'), type: 'FS' },
          { from: toTaskId('b'), to: toTaskId('a'), type: 'FS' },
        ],
      }),
    ).toThrow(/cycle/);
  });
});

describe('addTask', () => {
  it('adds a task and emits task:added', () => {
    const gantt = createGantt({});
    const onAdded = vi.fn();
    gantt.on('task:added', onAdded);
    const task = gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    expect(gantt.getTask(task.id)).toEqual(task);
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenCalledWith(task);
  });
});

describe('updateTask / moveTask / resizeTask / setProgress — split events (Q3)', () => {
  function setup() {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00', { progress: 0.2 })], // no explicit duration -> derived
    });
    return gantt;
  }

  it('updateTask changing only start (end fixed) emits BOTH task:moved and task:resized — moving the left edge changes both position and the span (resize detection is span-based, not duration-based)', () => {
    // Even with an explicit `duration`, moving `start` alone (end unchanged) changes the
    // instant span end−start, which is exactly what the rendered bar width tracks — so a
    // resize genuinely happened. (This is the span-based #2 fix: detection no longer keys off
    // the working-hours effectiveDuration, so it's consistent whether duration is explicit or
    // derived.) A pure "moved only" is what `moveTask` produces (span preserved) — see below.
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00', { progress: 0.2, duration: 8 })],
    });
    const prev = gantt.getTask(toTaskId('a'))!;
    const moved = vi.fn();
    const resized = vi.fn();
    const progressed = vi.fn();
    gantt.on('task:moved', moved);
    gantt.on('task:resized', resized);
    gantt.on('task:progressed', progressed);

    const next = gantt.updateTask(toTaskId('a'), { start: '2026-01-06T09:00' });

    expect(moved).toHaveBeenCalledTimes(1);
    expect(moved).toHaveBeenCalledWith(next, prev.start);
    expect(resized).toHaveBeenCalledTimes(1); // span (end − start) changed
    expect(progressed).not.toHaveBeenCalled();
  });

  it('resizeTask updates end (not just duration) so the bar — width from start/end — actually resizes (fix #1)', () => {
    const gantt = setup(); // task a: Mon 2026-01-05 09:00 → Tue 01-06 09:00 (derived 8 working hours)
    const before = gantt.getTask(toTaskId('a'))!;
    const next = gantt.resizeTask(toTaskId('a'), 16);
    expect(next.duration).toBe(16);
    expect(next.start).toBe(before.start); // start untouched
    // end moved: Mon 09:00 + 8h(Mon 09–17) + 8h(Tue 09–17) = Tue 01-06 17:00 (was 09:00)
    expect(String(next.end)).not.toBe(String(before.end));
    expect(String(next.end)).toContain('2026-01-06T17:00');
  });

  it('moveTask across a partial week with a DERIVED duration does NOT fire task:resized — span-based detection is move-invariant (fix #2)', () => {
    // Fri 09:00 → Mon 09:00 (no explicit duration, spans a weekend). Shift +1 day → Sat → Tue:
    // the working-hours *content* of the span differs, but the instant span (end−start) is
    // identical, so it's a move, not a resize. The old working-hours-based detector would
    // have fired a spurious task:resized here.
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-09T09:00', '2026-01-12T09:00')] });
    const resized = vi.fn();
    gantt.on('task:resized', resized);
    gantt.moveTask(toTaskId('a'), '2026-01-10T09:00'); // +1 day
    expect(resized).not.toHaveBeenCalled();
  });

  it('updateTask changing only start with a DERIVED duration (no explicit task.duration) also emits task:resized, since end is unchanged and the effective span shrinks — a real cascading side effect, not a bug', () => {
    const gantt = setup(); // duration: undefined -> derived from start/end via the working calendar
    const resized = vi.fn();
    gantt.on('task:resized', resized);
    gantt.updateTask(toTaskId('a'), { start: '2026-01-06T09:00' }); // end stays 2026-01-06T09:00 -> 0 span
    expect(resized).toHaveBeenCalledTimes(1);
  });

  it('moveTask shifts start AND end by the same delta (preserves span), emits task:moved only', () => {
    const gantt = setup();
    const moved = vi.fn();
    gantt.on('task:moved', moved);
    const next = gantt.moveTask(toTaskId('a'), '2026-01-10T09:00');
    expect(next.start.toString()).toContain('2026-01-10');
    expect(next.end.toString()).toContain('2026-01-11'); // shifted by same +5 days
    expect(moved).toHaveBeenCalledTimes(1);
  });

  it('resizeTask sets duration explicitly, emits task:resized only, with correct prevDuration', () => {
    const gantt = setup();
    const resized = vi.fn();
    gantt.on('task:resized', resized);
    const next = gantt.resizeTask(toTaskId('a'), 16);
    expect(next.duration).toBe(16);
    expect(resized).toHaveBeenCalledTimes(1);
    const [emittedTask, prevDuration] = resized.mock.calls[0] as [Task, number];
    expect(emittedTask.duration).toBe(16);
    // 2026-01-05 (Mon) 09:00 -> 2026-01-06 (Tue) 09:00, DEFAULT_CALENDAR (Mon-Fri 09:00-17:00):
    // only the Mon 09:00-17:00 window falls inside the range (Tue 00:00-09:00 is before
    // working hours) -> 8 working hours, not 24 calendar hours.
    expect(prevDuration).toBe(8);
  });

  it('resizeTask rejects NaN/Infinity/negative durations', () => {
    const gantt = setup();
    expect(() => gantt.resizeTask(toTaskId('a'), NaN)).toThrow();
    expect(() => gantt.resizeTask(toTaskId('a'), Infinity)).toThrow();
    expect(() => gantt.resizeTask(toTaskId('a'), -1)).toThrow();
  });

  it('setProgress emits task:progressed only, with correct prevProgress', () => {
    const gantt = setup();
    const progressed = vi.fn();
    gantt.on('task:progressed', progressed);
    const next = gantt.setProgress(toTaskId('a'), 0.75);
    expect(next.progress).toBe(0.75);
    expect(progressed).toHaveBeenCalledTimes(1);
    const [, prevProgress] = progressed.mock.calls[0] as [Task, number];
    expect(prevProgress).toBe(0.2);
  });

  it('setProgress rejects values outside [0, 1]', () => {
    const gantt = setup();
    expect(() => gantt.setProgress(toTaskId('a'), -0.1)).toThrow();
    expect(() => gantt.setProgress(toTaskId('a'), 1.1)).toThrow();
  });

  it('a single updateTask patch changing start+duration+progress emits all three, in fixed order moved -> resized -> progressed', () => {
    const gantt = setup();
    const order: string[] = [];
    gantt.on('task:moved', () => order.push('moved'));
    gantt.on('task:resized', () => order.push('resized'));
    gantt.on('task:progressed', () => order.push('progressed'));

    gantt.updateTask(toTaskId('a'), { start: '2026-01-06T09:00', duration: 10, progress: 0.9 });

    expect(order).toEqual(['moved', 'resized', 'progressed']);
  });

  it('a patch that only changes a non-eventable field (name) emits no task:* event but calls onTaskChange once', () => {
    const onTaskChange = vi.fn();
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
      onTaskChange,
    });
    const moved = vi.fn();
    const resized = vi.fn();
    const progressed = vi.fn();
    gantt.on('task:moved', moved);
    gantt.on('task:resized', resized);
    gantt.on('task:progressed', progressed);

    gantt.updateTask(toTaskId('a'), { name: 'renamed' });

    expect(moved).not.toHaveBeenCalled();
    expect(resized).not.toHaveBeenCalled();
    expect(progressed).not.toHaveBeenCalled();
    expect(onTaskChange).toHaveBeenCalledTimes(1);
  });

  it('updateTask/moveTask/resizeTask/setProgress on a non-existent id throw', () => {
    const gantt = setup();
    const missing = toTaskId('missing');
    expect(() => gantt.updateTask(missing, { name: 'x' })).toThrow();
    expect(() => gantt.moveTask(missing, '2026-01-01T00:00')).toThrow();
    expect(() => gantt.resizeTask(missing, 1)).toThrow();
    expect(() => gantt.setProgress(missing, 0.5)).toThrow();
  });

});

describe('moveTask — span preservation (fast-check)', () => {
  const timezones = ['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'];

  it('next.end - next.start (epoch-ns) equals prev.end - prev.start, for random start/span/newStart across timezones incl. DST', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...timezones),
        fc.integer({ min: 1, max: 27 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 96 }), // span hours between start and end
        fc.integer({ min: 1, max: 27 }),
        fc.integer({ min: 0, max: 20 }),
        (tz, startDay, startHour, spanHours, targetDay, targetHour) => {
          const startIso = `2026-03-${String(startDay).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:00`;
          const startZ = normalizeDate(startIso, tz);
          const endZ = startZ.add({ hours: spanHours });
          const gantt = createGantt({
            calendar: {
              workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
              workingHours: [{ start: '00:00', end: '23:59' }],
              holidays: [],
              timezone: tz,
            },
            tasks: [{ id: toTaskId('a'), name: 'a', start: startZ, end: endZ, progress: 0, type: 'task' }],
          });

          const newStartIso = `2026-05-${String(targetDay).padStart(2, '0')}T${String(targetHour).padStart(2, '0')}:00`;
          const prev = gantt.getTask(toTaskId('a'))!;
          const next = gantt.moveTask(toTaskId('a'), newStartIso);

          const prevStartZ = normalizeDate(prev.start, tz);
          const prevEndZ = normalizeDate(prev.end, tz);
          const nextStartZ = normalizeDate(next.start, tz);
          const nextEndZ = normalizeDate(next.end, tz);

          const prevDeltaNs = prevEndZ.epochNanoseconds - prevStartZ.epochNanoseconds;
          const nextDeltaNs = nextEndZ.epochNanoseconds - nextStartZ.epochNanoseconds;
          expect(nextDeltaNs).toBe(prevDeltaNs);
          // The new start really did move to the requested instant.
          expect(nextStartZ.epochNanoseconds).toBe(normalizeDate(newStartIso, tz).epochNanoseconds);
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe('removeTask — cascade + dependency cleanup', () => {
  function buildHierarchy() {
    return createGantt({
      tasks: [
        taskInput('parent', '2026-01-05T09:00', '2026-01-10T09:00', { type: 'summary' }),
        taskInput('child1', '2026-01-05T09:00', '2026-01-06T09:00', { parent: toTaskId('parent') }),
        taskInput('child2', '2026-01-06T09:00', '2026-01-07T09:00', { parent: toTaskId('parent') }),
        taskInput('other', '2026-01-08T09:00', '2026-01-09T09:00'),
      ],
      dependencies: [
        { from: toTaskId('child1'), to: toTaskId('child2'), type: 'FS' },
        { from: toTaskId('child2'), to: toTaskId('other'), type: 'FS' },
      ],
    });
  }

  it('removing a summary with N descendants emits N+1 task:removed (deepest-first, target last) and dependency:removed before task:removed', () => {
    const gantt = buildHierarchy();
    const events: Array<{ type: string; payload: unknown }> = [];
    gantt.on('task:removed', (id) => events.push({ type: 'task:removed', payload: id }));
    gantt.on('dependency:removed', (id) => events.push({ type: 'dependency:removed', payload: id }));

    gantt.removeTask(toTaskId('parent'));

    const taskRemovedEvents = events.filter((e) => e.type === 'task:removed');
    const depRemovedEvents = events.filter((e) => e.type === 'dependency:removed');
    expect(taskRemovedEvents).toHaveLength(3); // parent + child1 + child2
    expect(taskRemovedEvents[taskRemovedEvents.length - 1]!.payload).toBe(toTaskId('parent')); // target last
    // dep child1->child2 touches both descendants, so it must be cleaned up; dep child2->other
    // touches child2, must be cleaned up too. 'other' itself is untouched (not removed).
    expect(depRemovedEvents.length).toBeGreaterThanOrEqual(1);
    expect(gantt.getTasks().map((t) => t.id)).toEqual([toTaskId('other')]);

    // Every dependency:removed must appear before ANY task:removed in emission order.
    const firstTaskRemovedIndex = events.findIndex((e) => e.type === 'task:removed');
    const lastDepRemovedIndex = events
      .map((e, i) => (e.type === 'dependency:removed' ? i : -1))
      .filter((i) => i >= 0)
      .pop();
    if (lastDepRemovedIndex !== undefined) {
      expect(lastDepRemovedIndex).toBeLessThan(firstTaskRemovedIndex);
    }
  });

  it('removing a leaf task with no dependency links emits exactly one task:removed, zero dependency:removed', () => {
    const gantt = createGantt({ tasks: [taskInput('solo', '2026-01-05T09:00', '2026-01-06T09:00')] });
    const taskRemoved = vi.fn();
    const depRemoved = vi.fn();
    gantt.on('task:removed', taskRemoved);
    gantt.on('dependency:removed', depRemoved);

    gantt.removeTask(toTaskId('solo'));

    expect(taskRemoved).toHaveBeenCalledTimes(1);
    expect(taskRemoved).toHaveBeenCalledWith(toTaskId('solo'));
    expect(depRemoved).not.toHaveBeenCalled();
  });

  it('removeTask on a non-existent id is a silent no-op (no throw, no events)', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    const taskRemoved = vi.fn();
    gantt.on('task:removed', taskRemoved);
    expect(() => gantt.removeTask(toTaskId('missing'))).not.toThrow();
    expect(taskRemoved).not.toHaveBeenCalled();
  });
});

describe('dependency operations', () => {
  it('linkTasks self-link/duplicate-pair/cycle: throws, no dependency:added emitted', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'), taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00')],
    });
    const added = vi.fn();
    gantt.on('dependency:added', added);

    expect(() => gantt.linkTasks(toTaskId('a'), toTaskId('a'))).toThrow(); // self-link
    gantt.linkTasks(toTaskId('a'), toTaskId('b'));
    expect(added).toHaveBeenCalledTimes(1);
    expect(() => gantt.linkTasks(toTaskId('a'), toTaskId('b'))).toThrow(); // duplicate pair
    expect(() => gantt.linkTasks(toTaskId('b'), toTaskId('a'))).toThrow(); // would create a cycle
    expect(added).toHaveBeenCalledTimes(1);
  });

  it('unlinkTasks on a non-existent pair is a no-op, zero events; on an existing pair emits dependency:removed with the correct id', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'), taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00')],
    });
    const removed = vi.fn();
    gantt.on('dependency:removed', removed);

    gantt.unlinkTasks(toTaskId('a'), toTaskId('b'));
    expect(removed).not.toHaveBeenCalled();

    const dep = gantt.linkTasks(toTaskId('a'), toTaskId('b'));
    gantt.unlinkTasks(toTaskId('a'), toTaskId('b'));
    expect(removed).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith(dep.id);
  });

  it('getDependenciesOf returns links touching a task (incoming or outgoing)', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
        taskInput('c', '2026-01-07T09:00', '2026-01-08T09:00'),
      ],
      dependencies: [
        { from: toTaskId('a'), to: toTaskId('b'), type: 'FS' },
        { from: toTaskId('b'), to: toTaskId('c'), type: 'FS' },
      ],
    });
    expect(gantt.getDependenciesOf(toTaskId('b'))).toHaveLength(2);
    expect(gantt.getDependenciesOf(toTaskId('a'))).toHaveLength(1);
  });
});

describe('event bus (Q4)', () => {
  it('on() returns a working UnsubscribeFn; calling it twice is a no-op', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    const cb = vi.fn();
    const unsubscribe = gantt.on('task:progressed', cb);

    gantt.setProgress(toTaskId('a'), 0.1);
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribe(); // idempotent
    gantt.setProgress(toTaskId('a'), 0.2);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not prevent a second listener on the same event, and does not throw out of the mutation', () => {
    const gantt = createGantt({});
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    gantt.on('task:added', throwing);
    gantt.on('task:added', ok);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'))).not.toThrow();

    expect(throwing).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('a listener registered by another listener during an emit is not invoked until the NEXT emit', () => {
    const gantt = createGantt({});
    const late = vi.fn();
    gantt.on('task:added', () => {
      gantt.on('task:added', late);
    });

    gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    expect(late).not.toHaveBeenCalled();

    gantt.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('fast-check: random addTask/updateTask/removeTask/linkTasks/unlinkTasks sequence — getTasks()/getDependencies() length always matches a reference model', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({ op: fc.constant('add' as const), id: fc.integer({ min: 0, max: 9 }) }),
            fc.record({ op: fc.constant('remove' as const), id: fc.integer({ min: 0, max: 9 }) }),
            fc.record({
              op: fc.constant('link' as const),
              from: fc.integer({ min: 0, max: 9 }),
              to: fc.integer({ min: 0, max: 9 }),
            }),
            fc.record({
              op: fc.constant('unlink' as const),
              from: fc.integer({ min: 0, max: 9 }),
              to: fc.integer({ min: 0, max: 9 }),
            }),
          ),
          { maxLength: 40 },
        ),
        (ops) => {
          const gantt = createGantt({});
          const referenceTaskIds = new Set<TaskId>();
          const referenceDepPairs = new Set<string>();
          const removedTasksObserved = new Set<TaskId>();
          gantt.on('task:removed', (id) => removedTasksObserved.add(id));

          for (const opRaw of ops) {
            if (opRaw.op === 'add') {
              const id = toTaskId(`t${opRaw.id}`);
              if (referenceTaskIds.has(id)) continue; // addTask with explicit id twice would collide; skip
              gantt.addTask({
                id,
                name: id,
                start: '2026-01-05T09:00',
                end: '2026-01-06T09:00',
                progress: 0,
                type: 'task',
              });
              referenceTaskIds.add(id);
            } else if (opRaw.op === 'remove') {
              const id = toTaskId(`t${opRaw.id}`);
              const existed = referenceTaskIds.has(id);
              gantt.removeTask(id);
              if (existed) {
                referenceTaskIds.delete(id);
                // remove any dependency pairs touching this id from the reference model too
                for (const pair of [...referenceDepPairs]) {
                  const [from, to] = pair.split('->');
                  if (from === id || to === id) referenceDepPairs.delete(pair);
                }
                expect(removedTasksObserved.has(id)).toBe(true);
              }
            } else if (opRaw.op === 'link') {
              const from = toTaskId(`t${opRaw.from}`);
              const to = toTaskId(`t${opRaw.to}`);
              if (!referenceTaskIds.has(from) || !referenceTaskIds.has(to)) continue;
              const pairKey = `${from}->${to}`;
              try {
                gantt.linkTasks(from, to);
                referenceDepPairs.add(pairKey);
              } catch {
                // self-link/duplicate/cycle — reference model doesn't add it either
              }
            } else {
              const from = toTaskId(`t${opRaw.from}`);
              const to = toTaskId(`t${opRaw.to}`);
              const pairKey = `${from}->${to}`;
              gantt.unlinkTasks(from, to);
              referenceDepPairs.delete(pairKey);
            }
          }

          expect(gantt.getTasks()).toHaveLength(referenceTaskIds.size);
          expect(gantt.getDependencies()).toHaveLength(referenceDepPairs.size);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('computeCriticalPath()', () => {
  it('wraps computeCriticalPath correctly against a small known fixture', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-05T17:00'),
        taskInput('b', '2026-01-05T09:00', '2026-01-05T17:00'),
      ],
      dependencies: [{ from: toTaskId('a'), to: toTaskId('b'), type: 'FS' }],
    });
    const result = gantt.computeCriticalPath();
    expect(result.criticalTaskIds).toEqual([toTaskId('a'), toTaskId('b')]);
    expect(result.schedule.size).toBe(2);
  });

  it('empty task set throws a clear message', () => {
    const gantt = createGantt({});
    expect(() => gantt.computeCriticalPath()).toThrow(/no tasks/);
  });

  it('propagates errors thrown by the underlying pure function (not swallowed) — e.g. an invalid task with end before start and no explicit duration', () => {
    // NOTE: a genuine `CyclicDependencyError` is NOT reachable through the public facade
    // API — `linkTasks` (and `config.dependencies` at construction) always cycle-checks
    // via `DependencyStore.link`, so the store can never hold a cyclic graph the facade's
    // own `computeCriticalPath()` could observe. That specific throw path is exercised at
    // the pure-function level in `compute/critical-path.test.ts`; the reactive render
    // effect's swallow-and-warn behavior for a cyclic graph reached by bypassing the
    // facade (`DependencyStore.link(..., { allowCycle: true })` directly) is covered in
    // the DOM test file instead (§8.2). Here we assert the facade method itself does NOT
    // wrap/catch — any error the pure function throws surfaces unchanged.
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-06T09:00', '2026-01-05T09:00')], // end before start, no explicit duration
    });
    expect(() => gantt.computeCriticalPath()).toThrow(/end before its start/);
  });

  it('emits critical-path:computed with exactly result.criticalTaskIds', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-05T17:00'), taskInput('b', '2026-01-05T09:00', '2026-01-05T17:00')],
      dependencies: [{ from: toTaskId('a'), to: toTaskId('b'), type: 'FS' }],
    });
    const computed = vi.fn();
    gantt.on('critical-path:computed', computed);
    const result = gantt.computeCriticalPath();
    expect(computed).toHaveBeenCalledTimes(1);
    expect(computed).toHaveBeenCalledWith(result.criticalTaskIds);
  });
});

describe('lifecycle without a DOM', () => {
  it('unmount()/destroy()/refresh() on a never-mounted headless instance are safe no-ops (pure node, no DOM APIs referenced)', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    expect(() => gantt.unmount()).not.toThrow();
    expect(() => gantt.refresh()).not.toThrow();
    expect(() => gantt.destroy()).not.toThrow();
  });

  it('mutations work while unmounted — mutation + diff/emit pipeline is fully independent of #mount', () => {
    const gantt = createGantt({});
    const moved = vi.fn();
    gantt.on('task:moved', moved);
    const t = gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    gantt.moveTask(t.id, '2026-01-10T09:00');
    expect(moved).toHaveBeenCalledTimes(1);
  });

  describe('after destroy()', () => {
    it('every mutating/computing method throws the destroyed-instance error', () => {
      const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
      gantt.destroy();
      const id = toTaskId('a');
      expect(() => gantt.addTask(taskInput('b', '2026-01-05T09:00', '2026-01-06T09:00'))).toThrow(/destroyed/);
      expect(() => gantt.updateTask(id, { name: 'x' })).toThrow(/destroyed/);
      expect(() => gantt.moveTask(id, '2026-01-01T00:00')).toThrow(/destroyed/);
      expect(() => gantt.resizeTask(id, 1)).toThrow(/destroyed/);
      expect(() => gantt.setProgress(id, 0.5)).toThrow(/destroyed/);
      expect(() => gantt.linkTasks(id, toTaskId('nope'))).toThrow(/destroyed/);
      expect(() => gantt.computeCriticalPath()).toThrow(/destroyed/);
    });

    it('every read method returns its documented empty value', () => {
      const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
      const id = toTaskId('a');
      gantt.destroy();
      expect(gantt.getTask(id)).toBeUndefined();
      expect(gantt.getTasks()).toEqual([]);
      expect(gantt.findTasks(() => true)).toEqual([]);
      expect(gantt.getDependencies()).toEqual([]);
      expect(gantt.getDependenciesOf(id)).toEqual([]);
    });

    it('on() returns an inert unsubscribe that never registers/fires; removeTask/unlinkTasks (void-returning mutators) also throw, per §6\'s "any mutating method" rule', () => {
      const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
      gantt.destroy();
      const unsub = gantt.on('task:added', () => {});
      expect(() => unsub()).not.toThrow();
      expect(() => gantt.removeTask(toTaskId('a'))).toThrow(/destroyed/);
      expect(() => gantt.unlinkTasks(toTaskId('a'), toTaskId('b'))).toThrow(/destroyed/);
    });

    it('double destroy() is idempotent; mount()/unmount()/refresh() stay safe no-ops', () => {
      const gantt = createGantt({});
      gantt.destroy();
      expect(() => gantt.destroy()).not.toThrow();
      expect(() => gantt.unmount()).not.toThrow();
      expect(() => gantt.refresh()).not.toThrow();
    });
  });
});

// Type-level smoke: GanttEventName/GanttEventMap are usable as documented.
describe('type surface smoke', () => {
  it('GanttEventName covers exactly the documented event names', () => {
    const names: GanttEventName[] = [
      'task:added',
      'task:moved',
      'task:resized',
      'task:progressed',
      'task:removed',
      'dependency:added',
      'dependency:removed',
      'critical-path:computed',
    ];
    expect(names).toHaveLength(8);
  });

  it('GanttEventMap payload shape compiles for a representative subscriber', () => {
    const gantt = createGantt({});
    const handler: (...args: GanttEventMap['task:moved']) => void = (task, prevStart) => {
      void task;
      void prevStart;
    };
    gantt.on('task:moved', handler);
    expect(true).toBe(true);
  });
});
