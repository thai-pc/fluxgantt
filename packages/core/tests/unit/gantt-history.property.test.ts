// Property-based test (fast-check) for undo/redo — spec-undo-redo.md §8.2.
//
// "Any sequence of mutations + undo/redo returns to a state equal to a prior committed state,
// and the stack size never exceeds historyLimit." Uses a small, fixed `historyLimit` (10) so
// eviction is exercised within a reasonably short generated sequence.
//
// Reference model: a facade-side mirror of gantt.ts's own `#undoStack`/`#redoStack` — an array
// of `{ before, after }` snapshot PAIRS (object references into TaskStore/DependencyStore's own
// copy-on-write objects, never deep-cloned; TaskStore/DependencyStore never mutate a previously
// returned object in place, so a captured snapshot stays valid forever). A new entry is pushed
// ONLY when the corresponding facade call is known (by construction, not by generic diffing) to
// actually commit a history entry, mirroring gantt.ts's own recording rules exactly:
//   - addTask/moveTask/resizeTask/setProgress: always commit when the target task exists.
//   - removeTask: always commits when the target task exists.
//   - linkTasks: commits iff it does not throw (self-link/duplicate-pair/cycle rejections do
//     not record — mirrors DependencyLinkError being thrown before #recordOp is ever reached).
//   - unlinkTasks: commits iff at least one from/to pair existed beforehand (mirrors the early
//     `if (matches.length === 0) return;` in gantt.ts, which never calls #recordOps).
// No DST/calendar-specific cases are needed here (undo/redo never recomputes a date, it replays
// committed Temporal.ZonedDateTime snapshots verbatim) — already covered by
// cascade.property.test.ts / critical-path.property.test.ts.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../../src/gantt.js';
import { toTaskId, type Task, type Dependency } from '../../src/types.js';

const HISTORY_LIMIT = 10;
const ID_POOL = 5; // task ids t0..t4 — small pool to force hits/collisions

interface Snapshot {
  readonly tasks: readonly Task[];
  readonly deps: readonly Dependency[];
}

interface HistoryEntry {
  readonly before: Snapshot;
  readonly after: Snapshot;
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function snapshot(gantt: ReturnType<typeof createGantt>): Snapshot {
  return {
    tasks: [...gantt.getTasks()].sort(byId),
    deps: [...gantt.getDependencies()].sort(byId),
  };
}

function dayString(n: number): string {
  const day = 1 + (Math.abs(n) % 27); // 1..27, always a valid Feb day
  return `2026-02-${String(day).padStart(2, '0')}T09:00`;
}

type Command =
  | { op: 'add'; id: number }
  | { op: 'move'; id: number; offset: number }
  | { op: 'resize'; id: number; duration: number }
  | { op: 'progress'; id: number; progress: number }
  | { op: 'remove'; id: number }
  | { op: 'link'; from: number; to: number }
  | { op: 'unlink'; from: number; to: number }
  | { op: 'undo' }
  | { op: 'redo' };

const idArb = fc.integer({ min: 0, max: ID_POOL - 1 });

const commandArb: fc.Arbitrary<Command> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ op: fc.constant('add' as const), id: idArb }) },
  { weight: 3, arbitrary: fc.record({ op: fc.constant('move' as const), id: idArb, offset: fc.integer({ min: -20, max: 20 }) }) },
  { weight: 3, arbitrary: fc.record({ op: fc.constant('resize' as const), id: idArb, duration: fc.integer({ min: 1, max: 40 }) }) },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant('progress' as const),
      id: idArb,
      progress: fc.integer({ min: 0, max: 10 }).map((n) => n / 10),
    }),
  },
  { weight: 2, arbitrary: fc.record({ op: fc.constant('remove' as const), id: idArb }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant('link' as const), from: idArb, to: idArb }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant('unlink' as const), from: idArb, to: idArb }) },
  { weight: 3, arbitrary: fc.constant({ op: 'undo' as const }) },
  { weight: 3, arbitrary: fc.constant({ op: 'redo' as const }) },
);

describe('undo/redo — property: any sequence of mutations + undo/redo round-trips to a prior committed state', () => {
  it('holds for arbitrary command sequences, with historyLimit ring-buffer eviction respected', () => {
    fc.assert(
      fc.property(fc.array(commandArb, { maxLength: 60 }), (commands) => {
        const gantt = createGantt({ historyLimit: HISTORY_LIMIT });
        const localUndo: HistoryEntry[] = [];
        const localRedo: HistoryEntry[] = [];

        const pushEntry = (before: Snapshot, after: Snapshot): void => {
          localUndo.push({ before, after });
          if (localUndo.length > HISTORY_LIMIT) localUndo.shift(); // ring-buffer eviction, oldest first
          localRedo.length = 0; // a new committed mutation always clears the redo stack
        };

        for (const cmd of commands) {
          switch (cmd.op) {
            case 'add': {
              const id = toTaskId(`t${cmd.id}`);
              if (gantt.getTask(id)) break; // explicit-id collision — out of this test's scope
              const before = snapshot(gantt);
              gantt.addTask({ id, name: id, start: '2026-01-05T09:00', end: '2026-01-06T09:00', progress: 0, type: 'task' });
              pushEntry(before, snapshot(gantt));
              break;
            }
            case 'move': {
              const id = toTaskId(`t${cmd.id}`);
              if (!gantt.getTask(id)) break;
              const before = snapshot(gantt);
              gantt.moveTask(id, dayString(cmd.offset));
              pushEntry(before, snapshot(gantt));
              break;
            }
            case 'resize': {
              const id = toTaskId(`t${cmd.id}`);
              if (!gantt.getTask(id)) break;
              const before = snapshot(gantt);
              gantt.resizeTask(id, cmd.duration);
              pushEntry(before, snapshot(gantt));
              break;
            }
            case 'progress': {
              const id = toTaskId(`t${cmd.id}`);
              if (!gantt.getTask(id)) break;
              const before = snapshot(gantt);
              gantt.setProgress(id, cmd.progress);
              pushEntry(before, snapshot(gantt));
              break;
            }
            case 'remove': {
              const id = toTaskId(`t${cmd.id}`);
              if (!gantt.getTask(id)) break;
              const before = snapshot(gantt);
              gantt.removeTask(id);
              pushEntry(before, snapshot(gantt));
              break;
            }
            case 'link': {
              const from = toTaskId(`t${cmd.from}`);
              const to = toTaskId(`t${cmd.to}`);
              if (!gantt.getTask(from) || !gantt.getTask(to)) break;
              const before = snapshot(gantt);
              try {
                gantt.linkTasks(from, to);
              } catch {
                break; // self-link/duplicate-pair/cycle — no commit, mirrors gantt.ts
              }
              pushEntry(before, snapshot(gantt));
              break;
            }
            case 'unlink': {
              const from = toTaskId(`t${cmd.from}`);
              const to = toTaskId(`t${cmd.to}`);
              const hadMatch = gantt.getDependencies().some((d) => d.from === from && d.to === to);
              if (!hadMatch) {
                gantt.unlinkTasks(from, to); // real call, guaranteed no-op — exercises the early-return path too
                break;
              }
              const before = snapshot(gantt);
              gantt.unlinkTasks(from, to);
              pushEntry(before, snapshot(gantt));
              break;
            }
            case 'undo': {
              const expected = localUndo.length > 0;
              const result = gantt.undo();
              expect(result).toBe(expected);
              if (result) {
                const entry = localUndo.pop()!;
                localRedo.push(entry);
                if (localRedo.length > HISTORY_LIMIT) localRedo.shift(); // defensive; provably a no-op (see spec §5.4)
                expect(snapshot(gantt)).toEqual(entry.before);
              }
              break;
            }
            case 'redo': {
              const expected = localRedo.length > 0;
              const result = gantt.redo();
              expect(result).toBe(expected);
              if (result) {
                const entry = localRedo.pop()!;
                localUndo.push(entry);
                if (localUndo.length > HISTORY_LIMIT) localUndo.shift(); // defensive; provably a no-op
                expect(snapshot(gantt)).toEqual(entry.after);
              }
              break;
            }
          }

          // Invariants asserted after EVERY step, not just undo/redo ones.
          expect(gantt.canUndo()).toBe(localUndo.length > 0);
          expect(gantt.canRedo()).toBe(localRedo.length > 0);
          expect(localUndo.length).toBeLessThanOrEqual(HISTORY_LIMIT);
          expect(localRedo.length).toBeLessThanOrEqual(HISTORY_LIMIT);
        }
      }),
      { numRuns: 200 },
    );
  });
});
