// @vitest-environment jsdom
//
// Facade wiring — `mount()`'s `enableDragResize` → `#commitResize` → `resizeTask()` pipeline
// (spec-drag-resize.md §3, §7 "Facade" test plan). Runs under jsdom (per-file override; the
// rest of core stays `environment: 'node'`), mirroring `gantt-dom.test.ts`'s drag-move facade
// tests + `drag-move.test.ts`'s `PointerEventCtor` polyfill.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import {
  DEFAULT_CALENDAR,
  addWorkingHours,
  differenceInWorkingHours,
  normalizeDate,
} from '../../src/compute/working-calendar.js';
import { toTaskId, type Task } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

// --- Minimal PointerEvent polyfill — jsdom@25.0.1 doesn't ship one (see drag-move.test.ts §8.1). ----
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId: number }) {
    super(type, init);
    this.pointerId = init.pointerId;
  }
}
const PointerEventCtor: typeof PointerEvent =
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
  (PointerEventPolyfill as unknown as typeof PointerEvent);

function dispatchPointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { pointerId: number; clientX: number; clientY: number; bubbles?: boolean },
): void {
  target.dispatchEvent(
    new PointerEventCtor(type, {
      pointerId: init.pointerId,
      clientX: init.clientX,
      clientY: init.clientY,
      bubbles: init.bubbles ?? false,
      cancelable: true,
    }),
  );
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

/** Reads the rendered `.fg-task__bar` x/width DOM attributes for a task id — same ground
 *  truth `enableDragResize`'s hit-test reads (svgLeft is 0 under jsdom). */
function barGeometry(root: HTMLElement, taskId: string): { x: number; width: number } {
  const groupEl = root.querySelector(`.fg-task[data-task-id="${taskId}"]`)!;
  const barEl = groupEl.querySelector('.fg-task__bar')!;
  return { x: Number(barEl.getAttribute('x')), width: Number(barEl.getAttribute('width')) };
}

describe('resize commit -> facade event wiring', () => {
  function mountWithTask(options: Parameters<typeof createGantt>[0] = {}) {
    const gantt = createGantt({
      tasks: [taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00')],
      ...options,
    });
    gantt.mount(container);
    const groupEl = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    return { gantt, groupEl };
  }

  it('a right-edge pointerdown → move → up commits via resizeTask (end/duration change) and emits task:resized', () => {
    const { gantt, groupEl } = mountWithTask();
    const resized = vi.fn();
    gantt.on('task:resized', resized);
    const before = gantt.getTask(toTaskId('t1'))!;
    const { x, width } = barGeometry(container, 't1');
    const rightEdgeX = x + width;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    // pixelsPerDay(week) = 24 → dx=48 ⇒ end +2 days
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });

    expect(resized).toHaveBeenCalledTimes(1);
    const [task] = resized.mock.calls[0] as [Task, number];
    expect(task.id).toBe('t1');

    const after = gantt.getTask(toTaskId('t1'))!;
    expect(after.start).toBe(before.start); // start never touched
    expect(after.end).not.toBe(before.end);

    // `#commitResize` converts the interaction layer's calendar-day-snapped `newEnd`
    // (2026-01-07T09:00 + 2 days = 2026-01-09T09:00) into a working-hours duration, then
    // `resizeTask` re-derives `end` from that duration via `addWorkingHours` — the SAME
    // round-trip the pre-existing `resizeTask()` pipeline always performs, independently
    // reproduced here rather than hand-guessed, since re-deriving via working hours does
    // not always land back on the calendar-day-snapped instant (see the flagged-edge-case
    // regression test below).
    const cal = DEFAULT_CALENDAR;
    const calendarSnappedEnd = '2026-01-09T09:00';
    const expectedDuration = differenceInWorkingHours('2026-01-05T09:00', calendarSnappedEnd, cal);
    const expectedEnd = addWorkingHours('2026-01-05T09:00', expectedDuration, cal);
    expect(after.duration).toBe(expectedDuration);
    expect(after.end.toString()).toBe(expectedEnd.toString());
  });

  it("schedulingMode: 'auto' — a drag-resize commit cascades: the dependent successor's task:moved fires, its stored start actually shifted", () => {
    const { gantt, groupEl } = mountWithTask({
      schedulingMode: 'auto',
      tasks: [
        taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00'),
        // t2 starts right after t1's original end — the resize below (end +2 days) pushes
        // t1's end past t2's current start, violating the FS link and forcing t2 to cascade.
        taskInput('t2', '2026-01-07T10:00', '2026-01-08T10:00'),
      ],
      dependencies: [{ from: toTaskId('t1'), to: toTaskId('t2'), type: 'FS' }],
    });
    const moved = vi.fn();
    gantt.on('task:moved', moved);
    const beforeT2 = gantt.getTask(toTaskId('t2'))!;
    const { x, width } = barGeometry(container, 't1');
    const rightEdgeX = x + width;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 }); // +2 days
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });

    const movedIds = moved.mock.calls.map((c) => (c[0] as Task).id);
    expect(movedIds).toContain(toTaskId('t2')); // cascaded successor

    const afterT2 = gantt.getTask(toTaskId('t2'))!;
    expect(afterT2.start).not.toBe(beforeT2.start);
  });

  it('readOnly: true — a synthetic edge-drag never resizes (and never moves)', () => {
    const { gantt, groupEl } = mountWithTask({ readOnly: true });
    const resized = vi.fn();
    const moved = vi.fn();
    gantt.on('task:resized', resized);
    gantt.on('task:moved', moved);
    const before = gantt.getTask(toTaskId('t1'))!;
    const { x, width } = barGeometry(container, 't1');
    const rightEdgeX = x + width;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });

    expect(resized).not.toHaveBeenCalled();
    expect(moved).not.toHaveBeenCalled();
    const after = gantt.getTask(toTaskId('t1'))!;
    expect(after.start).toBe(before.start);
    expect(after.end).toBe(before.end);
  });

  // --- Flagged regression (spec-drag-resize.md §6/§8, resolutions "Flag 2 → ACCEPT as-is") --
  it('regression: a task starting Friday 17:00 resized past the 1-day floor lands on Saturday 17:00 → resizeTask receives duration ~0 without throwing (documented v1 behavior)', () => {
    // 2026-01-02 is a Friday (2026-01-01 is a Thursday, DEFAULT_CALENDAR, UTC).
    const { gantt, groupEl } = mountWithTask({
      tasks: [taskInput('t1', '2026-01-02T17:00', '2026-01-08T17:00')],
    });
    const resized = vi.fn();
    gantt.on('task:resized', resized);
    const before = gantt.getTask(toTaskId('t1'))!;
    const { x, width } = barGeometry(container, 't1');
    const rightEdgeX = x + width;

    // Drag far past the left of `start` — floor-clamps to exactly start + 1 calendar day
    // (2026-01-03T17:00, a Saturday).
    expect(() => {
      dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX - 10_000, clientY: 50 });
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX - 10_000, clientY: 50 });
    }).not.toThrow();

    expect(resized).toHaveBeenCalledTimes(1);
    const [task, prevDuration] = resized.mock.calls[0] as [Task, number];
    expect(prevDuration).toBeGreaterThan(0); // the ORIGINAL task's effective duration (baseline, not the new one)
    // The committed working-hours duration is ~0 — Friday 17:00 (day close) to Saturday
    // 17:00 (non-working day) contains zero working hours. `resizeTask` already accepts a
    // 0 duration from a direct programmatic call — this locks in that the drag-resize path
    // reaches the same, intentionally-not-special-cased, outcome. With duration 0,
    // `resizeTask`'s own `addWorkingHours(start, 0, cal)` returns `start` unchanged, so
    // `end` collapses onto `start` — also documented here, not hand-waved.
    expect(task.duration).toBe(0);
    expect(normalizeDate(task.end, DEFAULT_CALENDAR.timezone).toString()).toBe(
      normalizeDate(task.start, DEFAULT_CALENDAR.timezone).toString(),
    );
    expect(normalizeDate(task.start, DEFAULT_CALENDAR.timezone).toString()).toBe('2026-01-02T17:00:00+00:00[UTC]');

    const after = gantt.getTask(toTaskId('t1'))!;
    expect(after.start).toBe(before.start);
  });
});
