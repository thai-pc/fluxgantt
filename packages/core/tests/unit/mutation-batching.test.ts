// Command runner (`#run`) behavior — spec-mutation-batching.md §3/§4/§8 items 4 and 6.
// Headless. Covers the outbox contract (final state at event time, FIFO, nesting, error paths),
// signals.flush hardening, and a fast-check property: wrapping a whole command sequence in an
// outer signals.batch() changes neither the end state nor the event order.
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { createGantt, type GanttConfig } from '../../src/gantt.js';
import { getInternal } from '../../src/gantt-internal.js';
import { batch, effect, signal } from '../../src/signals.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import { createRecorder } from '../helpers/event-log.js';

const id = toTaskId;
const t = (name: string, start: string, end: string): TaskInput => ({
  id: id(name),
  name,
  start,
  end,
  progress: 0,
  type: 'task',
});
const chain = (n: number): GanttConfig => ({
  schedulingMode: 'auto',
  tasks: Array.from({ length: n }, (_, i) => t(`k${i}`, '2026-01-05T09:00', '2026-01-05T17:00')),
  dependencies: Array.from({ length: n - 1 }, (_, i) => ({ from: id(`k${i}`), to: id(`k${i + 1}`), type: 'FS' as const })),
});

describe('signals.flush hardening', () => {
  it('a throwing effect does not drop the other pending effects; the first error is rethrown', () => {
    const s = signal(0);
    const seen: string[] = [];
    effect(() => {
      if (s.value > 0) {
        seen.push('a');
        throw new Error('first');
      }
    });
    effect(() => {
      if (s.value > 0) seen.push('b');
    });
    effect(() => {
      if (s.value > 0) {
        seen.push('c');
        throw new Error('second');
      }
    });
    expect(() => batch(() => (s.value = 1))).toThrow('first');
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});

describe('#run outbox', () => {
  it('a nested mutation from a listener drains as its own command, in order', () => {
    const gantt = createGantt(chain(3));
    const log: string[] = [];
    gantt.on('task:moved', (task) => {
      log.push(`moved ${task.id}`);
      if (task.id === id('k0')) gantt.setProgress(id('k2'), 0.5);
    });
    gantt.on('task:progressed', (task) => log.push(`progressed ${task.id}`));
    gantt.moveTask(id('k0'), '2026-02-02T09:00');
    expect(log).toEqual(['moved k0', 'progressed k2', 'moved k1', 'moved k2']);
  });

  it('destroy() from a listener mid-drain is safe and silences the remaining events', () => {
    const gantt = createGantt(chain(4));
    const log: string[] = [];
    gantt.on('task:moved', (task) => {
      log.push(task.id);
      gantt.destroy();
    });
    expect(() => gantt.moveTask(id('k0'), '2026-02-02T09:00')).not.toThrow();
    expect(log).toEqual(['k0']);
  });

  it('a throwing fn still announces its committed writes, then rethrows the original error', () => {
    const rec = createRecorder();
    const gantt = createGantt({ ...chain(3), onTaskChange: rec.onTaskChange });
    rec.attach(gantt);
    // Bypass the facade's cycle check (the only way to reach a cascade cycle).
    getInternal(gantt).deps.link(id('k2'), id('k0'), 'FS', { allowCycle: true });
    rec.clear();
    expect(() => gantt.moveTask(id('k0'), '2026-02-02T09:00')).toThrow();
    expect(rec.log.some((l) => l.startsWith('task:moved k0'))).toBe(true);
    expect(rec.log.some((l) => l.startsWith('onTaskChange k0'))).toBe(true);
    expect(rec.log.some((l) => l.startsWith('history:changed'))).toBe(true);
    expect(gantt.getTask(id('k0'))!.start.toString()).toContain('2026-02-02');
    // The runner is reusable after the failure (no stuck "inside a command" state).
    const seen: string[] = [];
    gantt.on('task:progressed', (task) => seen.push(task.id));
    gantt.setProgress(id('k1'), 0.3);
    expect(seen).toEqual(['k1']);
  });

  it('a throwing listener is isolated and does not stop later events', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const gantt = createGantt(chain(3));
    const seen: string[] = [];
    gantt.on('task:moved', () => {
      throw new Error('listener');
    });
    gantt.on('task:moved', (task) => seen.push(task.id));
    gantt.moveTask(id('k0'), '2026-02-02T09:00');
    expect(seen).toEqual(['k0', 'k1', 'k2']);
    spy.mockRestore();
  });
});

// ---- Property: outer batch() is invisible to state and event order -------------------------
type Cmd =
  | { op: 'add'; n: number }
  | { op: 'move'; n: number; day: number }
  | { op: 'resize'; n: number; hours: number }
  | { op: 'progress'; n: number; p: number }
  | { op: 'remove'; n: number }
  | { op: 'link'; a: number; b: number }
  | { op: 'unlink'; a: number; b: number }
  | { op: 'dup'; n: number }
  | { op: 'undo' }
  | { op: 'redo' }
  | { op: 'collapse'; n: number }
  | { op: 'select'; n: number };

const n = fc.integer({ min: 0, max: 5 });
const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({ op: fc.constant('add' as const), n }),
  fc.record({ op: fc.constant('move' as const), n, day: fc.integer({ min: 1, max: 27 }) }),
  fc.record({ op: fc.constant('resize' as const), n, hours: fc.integer({ min: 1, max: 40 }) }),
  fc.record({ op: fc.constant('progress' as const), n, p: fc.integer({ min: 0, max: 10 }).map((x) => x / 10) }),
  fc.record({ op: fc.constant('remove' as const), n }),
  fc.record({ op: fc.constant('link' as const), a: n, b: n }),
  fc.record({ op: fc.constant('unlink' as const), a: n, b: n }),
  fc.record({ op: fc.constant('dup' as const), n }),
  fc.constant({ op: 'undo' as const }),
  fc.constant({ op: 'redo' as const }),
  fc.record({ op: fc.constant('collapse' as const), n }),
  fc.record({ op: fc.constant('select' as const), n }),
);

function play(cmds: readonly Cmd[], wrapped: boolean): { log: string[]; state: string } {
  const rec = createRecorder();
  const gantt = createGantt({
    schedulingMode: 'auto',
    onTaskChange: rec.onTaskChange,
    tasks: [
      { ...t('t0', '2026-02-02T09:00', '2026-02-02T17:00'), type: 'summary' },
      { ...t('t1', '2026-02-03T09:00', '2026-02-04T17:00'), parent: id('t0') },
      t('t2', '2026-02-05T09:00', '2026-02-06T17:00'),
      t('t3', '2026-02-09T09:00', '2026-02-10T17:00'),
    ],
    dependencies: [{ from: id('t2'), to: id('t3'), type: 'FS' }],
  });
  rec.attach(gantt);
  rec.clear();
  const tid = (x: number) => id(`t${x}`);
  const apply = (c: Cmd): void => {
    try {
      switch (c.op) {
        case 'add':
          gantt.addTask({ ...t(`t${c.n}`, '2026-02-11T09:00', '2026-02-12T17:00') });
          break;
        case 'move':
          gantt.moveTask(tid(c.n), `2026-02-${String(c.day).padStart(2, '0')}T09:00`);
          break;
        case 'resize':
          gantt.resizeTask(tid(c.n), c.hours);
          break;
        case 'progress':
          gantt.setProgress(tid(c.n), c.p);
          break;
        case 'remove':
          gantt.removeTask(tid(c.n));
          break;
        case 'link':
          gantt.linkTasks(tid(c.a), tid(c.b));
          break;
        case 'unlink':
          gantt.unlinkTasks(tid(c.a), tid(c.b));
          break;
        case 'dup':
          gantt.duplicateTask(tid(c.n));
          break;
        case 'undo':
          gantt.undo();
          break;
        case 'redo':
          gantt.redo();
          break;
        case 'collapse':
          gantt.toggleCollapse(tid(c.n));
          break;
        case 'select':
          gantt.select(tid(c.n));
          break;
      }
    } catch {
      // Invalid commands (unknown id, cycle, duplicate) throw identically in both runs.
    }
  };
  if (wrapped) batch(() => cmds.forEach(apply));
  else cmds.forEach(apply);
  const labels = new Map<string, string>();
  const norm = (s: string): string =>
    s.replace(/(task|dep)-[0-9a-f]{8}-[0-9a-f-]{27}/g, (m) => {
      if (!labels.has(m)) labels.set(m, `#${labels.size}`);
      return labels.get(m)!;
    });
  const state = norm(
    JSON.stringify({
      tasks: gantt.getTasks().map((x) => [x.id, String(x.start), String(x.end), x.progress, x.parent]),
      deps: gantt.getDependencies().map((d) => [d.from, d.to, d.type, d.lag]),
      sel: gantt.getSelection(),
      undo: gantt.canUndo(),
      redo: gantt.canRedo(),
    }),
  );
  return { log: rec.log, state };
}

describe('property: an outer batch() is invisible', () => {
  it('same end state and same event order with and without wrapping the whole sequence', () => {
    fc.assert(
      fc.property(fc.array(cmdArb, { minLength: 1, maxLength: 25 }), (cmds) => {
        const plain = play(cmds, false);
        const wrapped = play(cmds, true);
        expect(wrapped.state).toBe(plain.state);
        expect(wrapped.log).toEqual(plain.log);
      }),
      { numRuns: 150 },
    );
  });
});
