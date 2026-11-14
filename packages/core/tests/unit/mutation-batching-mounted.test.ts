// @vitest-environment jsdom
//
// Mounted command-runner behavior: re-entrant mutations started from the effect flush (a
// `critical-path:computed` listener, a host `effect()`), error precedence, and a fast-check
// property that every event is delivered exactly once with bounded repaints.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../helpers/create-gantt.js';
import type { GanttConfig } from '../../src/gantt.js';
import { getInternal } from '../../src/gantt-internal.js';
import { effect } from '../../src/signals.js';
import { CyclicDependencyError } from '../../src/compute/dependency-math.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import { createRecorder } from '../helpers/event-log.js';

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
const world = (): GanttConfig => ({
  tasks: [
    t('p', '2026-01-05T09:00', '2026-01-09T17:00', { type: 'summary' }),
    t('a', '2026-01-05T09:00', '2026-01-06T17:00', { parent: id('p') }),
    t('b', '2026-01-07T09:00', '2026-01-08T17:00', { parent: id('p') }),
    t('c', '2026-01-09T09:00', '2026-01-12T17:00'),
    t('d', '2026-01-13T09:00', '2026-01-14T17:00'),
  ],
  dependencies: [
    { from: id('a'), to: id('b'), type: 'FS' },
    { from: id('b'), to: id('c'), type: 'FS' },
    { from: id('c'), to: id('d'), type: 'FS' },
  ],
});

let container: HTMLElement;
let paints = 0;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  paints = 0;
  const realAppend = Element.prototype.append;
  vi.spyOn(Element.prototype, 'append').mockImplementation(function (this: Element, ...nodes: Array<Node | string>) {
    if (this.classList.contains('fg-timeline') && (nodes[0] as Element | undefined)?.nodeName === 'defs') paints++;
    realAppend.apply(this, nodes);
  });
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

const count = (log: readonly string[], prefix: string): number => log.filter((l) => l.startsWith(prefix)).length;

describe('re-entrant mutations started during the effect flush', () => {
  it('a critical-path:computed listener that mutates: every event and onTaskChange fires exactly once', () => {
    const rec = createRecorder();
    const gantt = createGantt({ ...world(), onTaskChange: rec.onTaskChange });
    gantt.mount(container);
    rec.attach(gantt);
    rec.clear();
    let nested = 0;
    gantt.on('critical-path:computed', () => {
      if (nested++ === 0) gantt.updateTask(id('d'), { progress: 0.5 });
    });
    gantt.removeTask(id('p'));
    expect(nested).toBe(1); // precondition: the listener ran (the critical set changed)
    expect(count(rec.log, 'task:removed')).toBe(3);
    expect(count(rec.log, 'dependency:removed')).toBe(2);
    // removeTask's own history entry + the nested setProgress' (d is still alive: only a,b,p go)
    expect(count(rec.log, 'history:changed')).toBe(2);
    expect(count(rec.log, 'task:progressed')).toBe(1);
    expect(count(rec.log, 'onTaskChange')).toBe(1);
  });

  it('a host effect() that mutates in response to the store change: exactly-once delivery', () => {
    const rec = createRecorder();
    const gantt = createGantt({ ...world(), schedulingMode: 'auto', onTaskChange: rec.onTaskChange });
    gantt.mount(container);
    rec.attach(gantt);
    const internal = getInternal(gantt);
    let armed = false;
    let fired = 0;
    effect(() => {
      void internal.tasks.revision.value;
      if (armed && fired++ === 0) gantt.updateTask(id('d'), { progress: 0.25 });
    });
    rec.clear();
    armed = true;
    gantt.moveTask(id('b'), '2026-01-19T09:00');
    expect(fired).toBeGreaterThanOrEqual(1);
    expect(count(rec.log, 'task:moved b')).toBe(1);
    expect(count(rec.log, 'task:moved c')).toBe(1);
    expect(count(rec.log, 'task:moved d')).toBe(1);
    expect(count(rec.log, 'task:progressed d')).toBe(1);
    expect(count(rec.log, 'onTaskChange')).toBe(4); // b, c, d shifts + the nested progress
    expect(count(rec.log, 'history:changed')).toBe(2);
  });
});

describe('error precedence', () => {
  it("the command's own error wins over a throwing onTaskChange, which is reported, not lost", () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const gantt = createGantt({
      ...world(),
      schedulingMode: 'auto',
      onTaskChange: () => {
        throw new Error('hook');
      },
    });
    expect(() =>
      getInternal(gantt).run(() => {
        gantt.setProgress(id('b'), 0.5); // a committed write, so the hook fires
        throw new CyclicDependencyError([id('b')]);
      }, true),
    ).toThrow(CyclicDependencyError);
    expect(logged.mock.calls.some((c) => String(c[0]).includes('onTaskChange threw'))).toBe(true);
  });

  it('a hook error alone is still rethrown after every event fired', () => {
    const gantt = createGantt({
      ...world(),
      schedulingMode: 'auto',
      onTaskChange: () => {
        throw new Error('hook');
      },
    });
    const moved: string[] = [];
    gantt.on('task:moved', (task) => moved.push(task.id));
    expect(() => gantt.moveTask(id('b'), '2026-01-19T09:00')).toThrow('hook');
    expect(moved).toEqual(['b', 'c', 'd']);
  });
});

// ---- Property: exactly-once delivery, bounded repaints, with a re-entrant listener ----------
type Cmd =
  | { op: 'move'; n: number; day: number }
  | { op: 'resize'; n: number; hours: number }
  | { op: 'progress'; n: number; p: number }
  | { op: 'remove'; n: number }
  | { op: 'dup'; n: number }
  | { op: 'link'; a: number; b: number }
  | { op: 'undo' }
  | { op: 'redo' };
const nArb = fc.integer({ min: 0, max: 4 });
const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({ op: fc.constant('move' as const), n: nArb, day: fc.integer({ min: 1, max: 27 }) }),
  fc.record({ op: fc.constant('resize' as const), n: nArb, hours: fc.integer({ min: 1, max: 40 }) }),
  fc.record({ op: fc.constant('progress' as const), n: nArb, p: fc.integer({ min: 0, max: 10 }).map((x) => x / 10) }),
  fc.record({ op: fc.constant('remove' as const), n: nArb }),
  fc.record({ op: fc.constant('dup' as const), n: nArb }),
  fc.record({ op: fc.constant('link' as const), a: nArb, b: nArb }),
  fc.constant({ op: 'undo' as const }),
  fc.constant({ op: 'redo' as const }),
);
const names = ['p', 'a', 'b', 'c', 'd'];

describe('property: exactly-once delivery with a re-entrant listener', () => {
  it('no event/onTaskChange payload is delivered twice in a command; repaints, critical-path emits and history emits are bounded by 1 + nested commands', () => {
    fc.assert(
      fc.property(
        fc.array(cmdArb, { minLength: 1, maxLength: 10 }),
        fc.constantFrom('critical-path:computed', 'task:moved', 'task:removed', 'task:added', 'none'),
        fc.constantFrom('manual', 'auto'),
        (cmds, trigger, mode) => {
          const sink: Array<[string, unknown]> = [];
          const gantt = createGantt({
            ...world(),
            schedulingMode: mode,
            onTaskChange: (next) => void sink.push(['onTaskChange', next]),
          });
          gantt.mount(container);
          let nested = 0;
          let armed = false;
          const events = ['task:added', 'task:moved', 'task:resized', 'task:progressed', 'task:removed', 'dependency:added', 'dependency:removed', 'critical-path:computed', 'history:changed'] as const;
          const perEvent = new Map<string, number>();
          for (const e of events) {
            gantt.on(e, ((...args: unknown[]) => {
              sink.push([e, args[0]]);
              perEvent.set(e, (perEvent.get(e) ?? 0) + 1);
              if (armed && e === trigger) {
                armed = false;
                nested++;
                try {
                  gantt.updateTask(id(names[nested % names.length]!), { progress: 0.5 });
                } catch {
                  nested--;
                }
              }
            }) as never);
          }
          for (const c of cmds) {
            sink.length = 0;
            perEvent.clear();
            paints = 0;
            nested = 0;
            armed = trigger !== 'none';
            const tid = (x: number) => id(names[x]!);
            try {
              switch (c.op) {
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
                case 'dup':
                  gantt.duplicateTask(tid(c.n));
                  break;
                case 'link':
                  gantt.linkTasks(tid(c.a), tid(c.b));
                  break;
                case 'undo':
                  gantt.undo();
                  break;
                case 'redo':
                  gantt.redo();
                  break;
              }
            } catch {
              // invalid commands throw
            }
            // Exactly once: the same (event, payload object) is never delivered twice.
            const seen = new Map<unknown, Set<string>>();
            for (const [e, payload] of sink) {
              if (payload === null || typeof payload !== 'object') continue;
              const evs = seen.get(payload) ?? new Set<string>();
              expect(evs.has(e)).toBe(false);
              evs.add(e);
              seen.set(payload, evs);
            }
            const bound = 1 + nested;
            expect(paints).toBeLessThanOrEqual(bound);
            expect(perEvent.get('critical-path:computed') ?? 0).toBeLessThanOrEqual(bound);
            expect(perEvent.get('history:changed') ?? 0).toBeLessThanOrEqual(bound);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});
