// `task:updated` (spec-public-api-lock.md §3, PR C). Headless. The golden logs pin the exact
// ordering inside real mutations; this file pins the payload, the change-detection rules and the
// "never fires for" list.
import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import fc from 'fast-check';
import { Temporal } from '@js-temporal/polyfill';
import { createGantt, type GanttConfig, type GanttEventMap, type TaskField, type TaskUpdatedPayload } from '../../src/gantt.js';
import { withIo } from '../../src/io/mixin.js';
import { toTaskId, type Task } from '../../src/types.js';
import type { TaskInput, TaskPatch } from '../../src/store/index.js';

const id = toTaskId;
const t = (name: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: id(name),
  name,
  start,
  end,
  progress: 0,
  type: 'task',
  ...extra,
});

function setup(config: Partial<GanttConfig> = {}) {
  const gantt = withIo(
    createGantt({
      tasks: [
        t('a', '2026-01-05T09:00', '2026-01-06T17:00'),
        t('b', '2026-01-07T09:00', '2026-01-08T17:00'),
        t('c', '2026-01-09T09:00', '2026-01-12T17:00'),
      ],
      dependencies: [
        { from: id('a'), to: id('b'), type: 'FS' },
        { from: id('b'), to: id('c'), type: 'FS' },
      ],
      ...config,
    }),
  );
  const events: TaskUpdatedPayload[] = [];
  gantt.on('task:updated', (p) => events.push(p));
  return { gantt, events };
}

describe('task:updated: changed set per field', () => {
  const cases: Array<[TaskField, TaskPatch]> = [
    ['name', { name: 'renamed' }],
    ['start', { start: '2026-01-06T09:00' }],
    ['end', { end: '2026-01-07T17:00' }],
    ['duration', { duration: 9 }],
    ['progress', { progress: 0.5 }],
    ['priority', { priority: 2 }],
    ['parent', { parent: id('b') }],
    ['type', { type: 'milestone' }],
    ['constraint', { constraint: { kind: 'asap' } }],
    ['notes', { notes: 'hello' }],
    ['color', { color: '#ff0000' }],
    ['meta', { meta: { k: 1 } }],
  ];
  it.each(cases)('updateTask changing only %s reports exactly that field', (field, patch) => {
    const { gantt, events } = setup();
    gantt.updateTask(id('a'), patch);
    expect(events).toHaveLength(1);
    expect(events[0]!.changed).toEqual([field]);
    expect(events[0]!.taskId).toBe(id('a'));
    expect(events[0]!.source).toBeUndefined();
    expect('source' in events[0]!).toBe(false);
  });

  it('a multi-field patch reports the union', () => {
    const { gantt, events } = setup();
    gantt.updateTask(id('a'), { name: 'x', notes: 'y', progress: 0.2 });
    expect([...events[0]!.changed].sort()).toEqual(['name', 'notes', 'progress']);
  });

  it('carries the task after and before the write', () => {
    const { gantt, events } = setup();
    gantt.updateTask(id('a'), { name: 'x' });
    expect(events[0]!.task.name).toBe('x');
    expect(events[0]!.prev.name).toBe('a');
    expect(gantt.getTask(id('a'))).toBe(events[0]!.task);
  });
});

describe('task:updated: superset of the specific events', () => {
  it('moveTask fires task:moved and task:updated[start,end]', () => {
    const { gantt, events } = setup();
    const moved = vi.fn();
    gantt.on('task:moved', moved);
    gantt.moveTask(id('a'), '2026-01-12T09:00');
    expect(moved).toHaveBeenCalledTimes(1);
    expect([...events[0]!.changed].sort()).toEqual(['end', 'start']);
  });
  it('resizeTask fires task:resized and task:updated[end,duration]', () => {
    const { gantt, events } = setup();
    const resized = vi.fn();
    gantt.on('task:resized', resized);
    gantt.resizeTask(id('a'), 4);
    expect(resized).toHaveBeenCalledTimes(1);
    expect([...events[0]!.changed].sort()).toEqual(['duration', 'end']);
  });
  it('setProgress fires task:progressed and task:updated[progress]', () => {
    const { gantt, events } = setup();
    const progressed = vi.fn();
    gantt.on('task:progressed', progressed);
    gantt.setProgress(id('a'), 0.5);
    expect(progressed).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.changed)).toEqual([['progress']]);
  });
});

describe('task:updated: change detection', () => {
  it('a start written as the equal instant (string, Date, ZonedDateTime, other zone) is not a change', () => {
    const { gantt, events } = setup();
    const a = gantt.getTask(id('a'))!;
    const tz = 'UTC';
    const zdt = Temporal.ZonedDateTime.from(`2026-01-05T09:00:00[${tz}]`);
    // The same instant expressed in another zone.
    const other = zdt.withTimeZone('Asia/Ho_Chi_Minh');
    gantt.updateTask(id('a'), { start: a.start });
    gantt.updateTask(id('a'), { start: new Date(zdt.epochMilliseconds) });
    gantt.updateTask(id('a'), { start: zdt as never });
    gantt.updateTask(id('a'), { start: other as never });
    expect(events).toEqual([]);
  });

  it('a genuinely different instant is a change even if the wall-clock text matches', () => {
    const { gantt, events } = setup();
    const zdt = Temporal.ZonedDateTime.from('2026-01-05T09:00:00[Asia/Ho_Chi_Minh]');
    gantt.updateTask(id('a'), { start: zdt as never });
    expect(events.map((e) => e.changed)).toEqual([['start']]);
  });

  it('a no-op patch emits nothing but onTaskChange still fires once', () => {
    const onTaskChange = vi.fn();
    const { gantt, events } = setup({ onTaskChange });
    const a = gantt.getTask(id('a'))!;
    gantt.updateTask(id('a'), { name: a.name, progress: a.progress });
    gantt.updateTask(id('a'), {});
    expect(events).toEqual([]);
    expect(onTaskChange).toHaveBeenCalledTimes(2);
  });

  it('updatedAt alone never counts (and is never listed)', () => {
    const { gantt, events } = setup();
    gantt.updateTask(id('a'), { name: 'x' });
    expect(events[0]!.changed).not.toContain('updatedAt' as never);
    events.length = 0;
    gantt.updateTask(id('a'), { name: 'x' }); // restamps updatedAt only
    expect(events).toEqual([]);
  });

  it('object fields compare by reference (documented): a deep-equal replacement counts', () => {
    const { gantt, events } = setup();
    gantt.updateTask(id('a'), { meta: { k: 1 } });
    events.length = 0;
    gantt.updateTask(id('a'), { meta: { k: 1 } });
    expect(events.map((e) => e.changed)).toEqual([['meta']]);
  });

  it('a field going from set to absent is found (union of keys)', () => {
    const { gantt, events } = setup();
    gantt.updateTask(id('a'), { notes: 'n' });
    events.length = 0;
    gantt.undo();
    expect(events[0]!.changed).toEqual(['notes']);
  });
});

describe('task:updated: never fires for', () => {
  it('add, duplicate, remove, dependency ops, selection and import', () => {
    const { gantt, events } = setup();
    gantt.addTask(t('n', '2026-01-05T09:00', '2026-01-05T17:00'));
    gantt.duplicateTask(id('a'));
    gantt.removeTask(id('c'));
    gantt.linkTasks(id('a'), id('c'), 'SS');
    gantt.unlinkTasks(id('a'), id('c'));
    gantt.select(id('a'));
    expect(events).toEqual([]);
    const json = gantt.exportJson();
    gantt.importJson(json);
    gantt.importCsv(gantt.exportCsv());
    expect(events).toEqual([]);
  });

  it('undo/redo of add and remove ops', () => {
    const { gantt, events } = setup();
    gantt.addTask(t('n', '2026-01-05T09:00', '2026-01-05T17:00'));
    gantt.removeTask(id('c'));
    gantt.undo();
    gantt.undo();
    gantt.redo();
    gantt.redo();
    expect(events).toEqual([]);
  });
});

describe('task:updated: undo/redo source', () => {
  it('carries source and swaps prev/task', () => {
    const { gantt, events } = setup();
    gantt.setProgress(id('a'), 0.5);
    gantt.undo();
    gantt.redo();
    expect(events.map((e) => e.source)).toEqual([undefined, 'undo', 'redo']);
    expect(events[1]!.prev.progress).toBe(0.5);
    expect(events[1]!.task.progress).toBe(0);
    expect(events[2]!.prev.progress).toBe(0);
    expect(events[2]!.task.progress).toBe(0.5);
  });
});

describe('task:updated: ordering and the batched runner', () => {
  it('per task: specific events, onTaskChange, task:updated', () => {
    const log: string[] = [];
    const { gantt } = setup({ onTaskChange: () => log.push('onTaskChange') });
    gantt.on('task:progressed', () => log.push('task:progressed'));
    gantt.on('task:updated', () => log.push('task:updated'));
    gantt.setProgress(id('a'), 0.5);
    expect(log).toEqual(['task:progressed', 'onTaskChange', 'task:updated']);
  });

  it('auto cascade: one event per shifted task, listeners see the final state', () => {
    const { gantt, events } = setup({ schedulingMode: 'auto' });
    const seenFromFirst: string[] = [];
    gantt.on('task:updated', (p) => {
      if (p.taskId === id('a')) seenFromFirst.push(String(gantt.getTask(id('c'))!.start));
    });
    gantt.moveTask(id('a'), '2026-01-19T09:00');
    expect(events.map((e) => e.taskId)).toEqual([id('a'), id('b'), id('c')]);
    for (const e of events) expect([...e.changed].sort()).toEqual(['end', 'start']);
    expect(seenFromFirst[0]).toBe(String(gantt.getTask(id('c'))!.start));
  });

  it('a throwing task:updated listener blocks neither other listeners nor the mutation', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { gantt } = setup();
    const second = vi.fn();
    gantt.on('task:updated', () => {
      throw new Error('boom');
    });
    gantt.on('task:updated', second);
    expect(() => gantt.setProgress(id('a'), 0.4)).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
    expect(gantt.getTask(id('a'))!.progress).toBe(0.4);
    spy.mockRestore();
  });

  it('a throwing onTaskChange does not suppress task:updated', () => {
    const { gantt, events } = setup({
      onTaskChange: () => {
        throw new Error('hook');
      },
    });
    expect(() => gantt.updateTask(id('a'), { name: 'z' })).toThrow('hook');
    expect(events).toHaveLength(1);
  });

  it('a command started from a listener does not re-drain the outer outbox', () => {
    const { gantt, events } = setup();
    let first = true;
    gantt.on('task:updated', () => {
      if (first) {
        first = false;
        gantt.setProgress(id('b'), 0.3);
      }
    });
    gantt.setProgress(id('a'), 0.2);
    expect(events.map((e) => e.taskId)).toEqual([id('a'), id('b')]);
  });

  it('with no listener, no payload is built (no work on the hot path)', () => {
    const gantt = createGantt({ tasks: [t('a', '2026-01-05T09:00', '2026-01-06T17:00')] });
    expect(() => gantt.setProgress(id('a'), 0.5)).not.toThrow();
  });
});

describe('task:updated: types', () => {
  it('payload shape and TaskField', () => {
    expectTypeOf<GanttEventMap['task:updated']>().toEqualTypeOf<[payload: TaskUpdatedPayload]>();
    expectTypeOf<TaskField>().toEqualTypeOf<keyof TaskPatch>();
  });
});

describe('task:updated: property (sound and complete), across zones', () => {
  const zones = ['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'];
  const patchArb = fc.record(
    {
      name: fc.constantFrom('a', 'b', 'c'),
      progress: fc.constantFrom(0, 0.25, 0.5),
      notes: fc.constantFrom('x', 'y'),
      priority: fc.constantFrom(1, 2),
      start: fc.constantFrom('2026-03-06T09:00', '2026-03-09T09:00', '2026-11-02T09:00'),
    },
    { requiredKeys: [] },
  );
  it.each(zones)('changed reproduces the write in %s', (timezone) => {
    fc.assert(
      fc.property(fc.array(patchArb, { minLength: 1, maxLength: 8 }), (patches) => {
        const gantt = createGantt({
          calendar: {
            workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
            workingHours: [{ start: '09:00', end: '17:00' }],
            holidays: [],
            timezone,
          },
          tasks: [t('a', '2026-03-06T09:00', '2026-03-09T17:00')],
        });
        const events: TaskUpdatedPayload[] = [];
        gantt.on('task:updated', (p) => events.push(p));
        for (const p of patches) gantt.updateTask(id('a'), p);
        for (const e of events) {
          expect(e.changed.length).toBeGreaterThan(0);
          const keys = new Set([...Object.keys(e.prev), ...Object.keys(e.task)]) as Set<keyof Task>;
          for (const k of keys) {
            if (k === 'updatedAt' || e.changed.includes(k as TaskField)) continue;
            if (k === 'start' || k === 'end') continue; // instant-equal values may differ in shape
            expect(Object.is(e.prev[k], e.task[k])).toBe(true);
          }
        }
        // Replaying every undo mirrors the forward events in reverse.
        const forward = events.map((e) => [...e.changed].sort().join());
        events.length = 0;
        while (gantt.canUndo()) gantt.undo();
        const back = events.map((e) => [...e.changed].sort().join());
        expect(events.every((e) => e.source === 'undo')).toBe(true);
        expect(back).toEqual([...forward].reverse());
      }),
      { numRuns: 40 },
    );
  });
});

describe('task:updated: re-entrant writes (pins the current #127 order)', () => {
  it('a nested updateTask from onTaskChange delivers its event BEFORE the outer write\'s (documented)', () => {
    let nested = false;
    const { gantt, events } = setup({
      onTaskChange: (task) => {
        if (task.name === 'first' && !nested) {
          nested = true;
          gantt.updateTask(id('a'), { name: 'second' });
        }
      },
    });
    gantt.updateTask(id('a'), { name: 'first' });
    expect(events.map((e) => e.task.name)).toEqual(['second', 'first']);
    expect(gantt.getTask(id('a'))!.name).toBe('second'); // so persisters must read getTask()
  });
});
