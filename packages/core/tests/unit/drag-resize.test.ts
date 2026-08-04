// @vitest-environment jsdom
//
// Interaction — drag-resize tests (spec-drag-resize.md §7). Runs under jsdom (per-file
// override; the rest of core stays `environment: 'node'`), reusing `drag-move.test.ts`'s
// `PointerEventCtor` polyfill + `dispatchPointer` helper pattern.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { createTimeScale } from '../../src/render/renderer-base.js';
import { enableDragResize, computeClampedResizedEnd } from '../../src/interaction/drag-resize.js';
import { enableDragMove } from '../../src/interaction/drag-move.js';
import { snapDeltaToDay as snapDeltaToDayFromPointerDrag } from '../../src/interaction/pointer-drag.js';
import { DEFAULT_CALENDAR, normalizeDate } from '../../src/compute/working-calendar.js';
import { getTemporal } from '../../src/internal/temporal.js';
import { toTaskId, type Task, type TaskId, type WorkingCalendar } from '../../src/types.js';

function task(id: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: toTaskId(id),
    name: id,
    start,
    end,
    progress: 0.5,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

// --- Pointer polyfill (mirrors drag-move.test.ts §8.1) ------------------------------------
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

// --- Pure math: computeClampedResizedEnd (no DOM needed) -----------------------------------

describe('computeClampedResizedEnd — day-snap floor at start + 1 calendar day (resolution #3)', () => {
  const cal = DEFAULT_CALENDAR;
  const range = { start: normalizeDate('2026-01-01', cal.timezone), end: normalizeDate('2026-12-31', cal.timezone) };
  const ts = createTimeScale(range, 'week', cal);

  it('N days forward: end moves by N calendar days, unclamped when still after the floor', () => {
    const end = computeClampedResizedEnd(ts, '2026-03-10T09:00', '2026-03-12T17:00', 3);
    expect(end.toString()).toBe(normalizeDate('2026-03-12T17:00', cal.timezone).add({ days: 3 }).toString());
  });

  it('deltaDays = 0 leaves end unchanged (same instant)', () => {
    const end = computeClampedResizedEnd(ts, '2026-03-10T09:00', '2026-03-12T17:00', 0);
    expect(end.equals(normalizeDate('2026-03-12T17:00', cal.timezone))).toBe(true);
  });

  it('a moderate negative delta that still lands after the floor is NOT clamped', () => {
    const end = computeClampedResizedEnd(ts, '2026-03-10T09:00', '2026-03-12T17:00', -1);
    expect(end.toString()).toBe(normalizeDate('2026-03-11T17:00', cal.timezone).toString());
  });

  it('negative deltaDays past the floor clamps to exactly start + 1 calendar day, never earlier', () => {
    const end = computeClampedResizedEnd(ts, '2026-03-10T09:00', '2026-03-12T17:00', -100);
    expect(end.toString()).toBe(normalizeDate('2026-03-10T09:00', cal.timezone).add({ days: 1 }).toString());
  });

  it('a large positive delta is never clamped (only the floor side clamps)', () => {
    expect(() => computeClampedResizedEnd(ts, '2026-03-10T09:00', '2026-03-12T17:00', 100_000)).not.toThrow();
    const end = computeClampedResizedEnd(ts, '2026-03-10T09:00', '2026-03-12T17:00', 100_000);
    expect(end.toPlainDate().year).toBeGreaterThan(2026);
  });

  it('DST boundary — America/New_York spring-forward 2026-03-08: end shifts by calendar days, time-of-day preserved', () => {
    const nyCal: WorkingCalendar = { ...DEFAULT_CALENDAR, timezone: 'America/New_York' };
    const nyRange = {
      start: normalizeDate('2026-03-01', nyCal.timezone),
      end: normalizeDate('2026-03-31', nyCal.timezone),
    };
    const nyTs = createTimeScale(nyRange, 'week', nyCal);

    const end = computeClampedResizedEnd(nyTs, '2026-03-07T09:00', '2026-03-07T17:00', 2);
    expect(end.hour).toBe(17);
    expect(end.minute).toBe(0);
    expect(end.toPlainDate().toString()).toBe('2026-03-09');

    const before = normalizeDate('2026-03-07T17:00', nyCal.timezone);
    expect(before.offset).toBe('-05:00');
    expect(end.offset).toBe('-04:00');
  });

  it('property: for a MULTI-day task the result is never before start + 1 calendar day, for any integer deltaDays', () => {
    fc.assert(
      fc.property(fc.integer({ min: -2000, max: 2000 }), (deltaDays) => {
        const end = computeClampedResizedEnd(ts, '2026-06-10T09:00', '2026-06-12T17:00', deltaDays);
        const minEnd = normalizeDate('2026-06-10T09:00', cal.timezone).add({ days: 1 });
        expect(getTemporal().ZonedDateTime.compare(end, minEnd)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  // --- Review A2: sub-day tasks must NOT balloon to a full day -------------------------------
  describe('sub-day task (original span < 1 calendar day) — floor is the original end, not start + 1 day', () => {
    // start 09:00, end 17:00 same day ⇒ originalEnd (17:00) is earlier than start + 1 day
    // (next-day 09:00), so the floor must be the original end. Weekday-independent (pure
    // calendar `add`/compare, no working-day lookup).
    const start = '2026-03-10T09:00';
    const end = '2026-03-10T17:00';

    it('deltaDays = 0 leaves the sub-day end unchanged (does NOT balloon to start + 1 day)', () => {
      const result = computeClampedResizedEnd(ts, start, end, 0);
      expect(result.equals(normalizeDate(end, cal.timezone))).toBe(true);
    });

    it('shrinking (negative delta) clamps to the original end, never expands past it', () => {
      const result = computeClampedResizedEnd(ts, start, end, -5);
      expect(result.equals(normalizeDate(end, cal.timezone))).toBe(true);
    });

    it('growing still works normally (delta added to the original end)', () => {
      const result = computeClampedResizedEnd(ts, start, end, 2);
      expect(result.toString()).toBe(normalizeDate(end, cal.timezone).add({ days: 2 }).toString());
    });
  });
});

describe('snapDeltaToDay — canonical home is now pointer-drag.ts (locks in the refactor)', () => {
  it('imported directly from pointer-drag.js behaves identically to the drag-move.js re-export', () => {
    const cal = DEFAULT_CALENDAR;
    const range = { start: normalizeDate('2026-01-01', cal.timezone), end: normalizeDate('2026-12-31', cal.timezone) };
    const ts = createTimeScale(range, 'week', cal);
    expect(snapDeltaToDayFromPointerDrag(1.6 * ts.pixelsPerDay, ts)).toBe(2);
  });
});

// --- DOM/interaction — needs jsdom, dispatches PointerEvent --------------------------------

const CAL = DEFAULT_CALENDAR;

describe('enableDragResize — DOM interaction', () => {
  let container: HTMLElement;
  let tasks: Task[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tasks = [
      task('t1', '2026-01-05T09:00', '2026-01-07T09:00'),
      task('t2', '2026-01-10T09:00', '2026-01-12T09:00'),
      task('milestone', '2026-01-15T09:00', '2026-01-15T09:00', { type: 'milestone' }),
      // Very short duration → rendered bar width (< 8px default edgeHitZonePx at
      // pixelsPerDay=24/day) narrower than the hit-zone (spec §6 "narrow-bar fallback").
      task('narrow', '2026-01-20T09:00', '2026-01-20T10:00'),
    ];
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function setup(options: Parameters<typeof enableDragResize>[2]) {
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    const dispose = enableDragResize(handle, () => tasks, options);
    return { handle, groupEl, dispose };
  }

  /** Reads the rendered `.fg-task__bar` x/width DOM attributes for a task — the SAME ground
   *  truth `enableDragResize`'s hit-test reads (svgLeft is 0 under jsdom, so client-space ==
   *  these numbers directly). */
  function barGeometry(handle: ReturnType<typeof createSvgRenderer>, taskId: string): { x: number; width: number } {
    const groupEl = handle.svg.querySelector(`.fg-task[data-task-id="${taskId}"]`)!;
    const barEl = groupEl.querySelector('.fg-task__bar')!;
    return { x: Number(barEl.getAttribute('x')), width: Number(barEl.getAttribute('width')) };
  }

  it('pointerdown on the right-edge zone → pointermove (≥ threshold) → pointerup: onTaskResized called exactly once with the correct snapped newEnd', () => {
    const onTaskResized = vi.fn();
    const { handle, groupEl } = setup({ onTaskResized });
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    // pixelsPerDay(week) = 24 → dx=48 ⇒ +2 days on `end`
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });

    expect(onTaskResized).toHaveBeenCalledTimes(1);
    const [taskId, newEnd] = onTaskResized.mock.calls[0] as [TaskId, { toString(): string }];
    expect(taskId).toBe('t1');
    expect(newEnd.toString()).toBe(normalizeDate('2026-01-07T09:00', CAL.timezone).add({ days: 2 }).toString());
  });

  it('pointerdown in the middle of the bar → onTaskResized never called (falls through — no move recognizer registered here)', () => {
    const onTaskResized = vi.fn();
    const { handle, groupEl } = setup({ onTaskResized });
    const { x, width } = barGeometry(handle, 't1');
    const middleX = x + width / 2;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: middleX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: middleX + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: middleX + 48, clientY: 50 });

    expect(onTaskResized).not.toHaveBeenCalled();
  });

  it('below dragThresholdPx: no commit, width attribute unchanged', () => {
    const onTaskResized = vi.fn();
    const { handle, groupEl } = setup({ onTaskResized });
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;
    const barEl = groupEl.querySelector('.fg-task__bar')!;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 2, clientY: 50 }); // dx=2 < 4
    expect(barEl.getAttribute('width')).toBe(String(width));
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 2, clientY: 50 });

    expect(onTaskResized).not.toHaveBeenCalled();
    expect(barEl.getAttribute('width')).toBe(String(width));
  });

  it('milestone task: pointerdown anywhere on its bar never triggers resize', () => {
    const onTaskResized = vi.fn();
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="milestone"]') as SVGGElement;
    enableDragResize(handle, () => tasks, { onTaskResized });
    const { x, width } = barGeometry(handle, 'milestone');
    const rightEdgeX = x + width;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });

    expect(onTaskResized).not.toHaveBeenCalled();
  });

  it('1-day floor: drag far past the left of start → newEnd clamps to exactly start + 1 day, never before', () => {
    const onTaskResized = vi.fn();
    const { handle, groupEl } = setup({ onTaskResized });
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX - 10_000, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX - 10_000, clientY: 50 });

    expect(onTaskResized).toHaveBeenCalledTimes(1);
    const [, newEnd] = onTaskResized.mock.calls[0] as [TaskId, { toString(): string }];
    expect(newEnd.toString()).toBe(normalizeDate('2026-01-05T09:00', CAL.timezone).add({ days: 1 }).toString());
  });

  it('narrow-bar fallback: a bar rendered narrower than edgeHitZonePx never claims resize — move claims instead', () => {
    const onTaskResized = vi.fn();
    const onTaskMoved = vi.fn();
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="narrow"]') as SVGGElement;
    const { x, width } = barGeometry(handle, 'narrow');
    expect(width).toBeLessThan(8); // precondition: narrower than the default edgeHitZonePx

    enableDragResize(handle, () => tasks, { onTaskResized });
    enableDragMove(handle, () => tasks, { onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: x + width, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: x + width + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: x + width + 48, clientY: 50 });

    expect(onTaskResized).not.toHaveBeenCalled();
    expect(onTaskMoved).toHaveBeenCalledTimes(1);
  });

  it('destroy-mid-resize (B1): handle.destroy() during an open resize gesture → no leaked listeners, no commit, width reverted, cursor reset', () => {
    const onTaskResized = vi.fn();
    const { handle, groupEl } = setup({ onTaskResized });
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;
    const barEl = groupEl.querySelector('.fg-task__bar')!;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    expect(barEl.getAttribute('width')).not.toBe(String(width));

    handle.destroy();
    expect(container.children).toHaveLength(0);

    expect(() => {
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 200, clientY: 50 });
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 200, clientY: 50 });
    }).not.toThrow();
    expect(onTaskResized).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
  });

  it('B2: finite-but-huge delta (clientX ~1e8) → no RangeError, N is clamped, chrome not stuck', () => {
    const onTaskResized = vi.fn();
    const { groupEl, handle } = setup({ onTaskResized });
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    expect(() => {
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 1e8, clientY: 50 });
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 1e8, clientY: 50 });
    }).not.toThrow();

    expect(onTaskResized).toHaveBeenCalledTimes(1);
    expect(document.body.style.cursor).toBe('');
    expect(groupEl.classList.contains('fg-task--resizing')).toBe(false);
  });

  it('live bar width is offset-free — enlarging by N days grows the width by exactly N*pixelsPerDay, NOT under-sized by LABEL_COLUMN_WIDTH (regression)', () => {
    // The rendered `.fg-task__bar` `x` attribute bakes in the renderer's private
    // LABEL_COLUMN_WIDTH offset, but `timeScale.dateToX` does not. The live width MUST be
    // computed in one consistent (offset-free) space: `dateToX(end) - dateToX(start)`.
    // The earlier `dateToX(end) - originalX` mixed the two → every live bar was 160px too
    // narrow (bars under 160px true width collapsed to 0 mid-drag).
    const { groupEl, handle } = setup({ onTaskResized: vi.fn() });
    const { x, width } = barGeometry(handle, 't1');
    const { pixelsPerDay } = handle.getTimeScale();
    const rightEdgeX = x + width;
    const barEl = groupEl.querySelector('.fg-task__bar')!;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 2 * pixelsPerDay, clientY: 50 });

    // +2 days ⇒ width grows by exactly 2*pixelsPerDay, still strictly greater than the
    // original (would be `width - LABEL_COLUMN_WIDTH` = a clamped 0 under the old formula).
    expect(Number(barEl.getAttribute('width'))).toBe(width + 2 * pixelsPerDay);
  });

  it('NaN coordinate mid-valid-resize: the event is skipped, no throw, the next valid pointermove still works', () => {
    const onTaskResized = vi.fn();
    const { groupEl, handle } = setup({ onTaskResized });
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;
    const barEl = groupEl.querySelector('.fg-task__bar')!;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 }); // +2 days
    const widthAfterFirstMove = barEl.getAttribute('width');
    expect(widthAfterFirstMove).not.toBe(String(width));

    const badEvent = new PointerEventCtor('pointermove', { pointerId: 1, clientX: 0, clientY: 50 });
    Object.defineProperty(badEvent, 'clientX', { value: NaN, configurable: true });
    expect(() => window.dispatchEvent(badEvent)).not.toThrow();
    expect(barEl.getAttribute('width')).toBe(widthAfterFirstMove);

    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 72, clientY: 50 }); // +3 days
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 72, clientY: 50 });

    expect(onTaskResized).toHaveBeenCalledTimes(1);
    const [, newEnd] = onTaskResized.mock.calls[0] as [TaskId, { toPlainDate(): { toString(): string } }];
    expect(newEnd.toPlainDate().toString()).toBe('2026-01-10'); // +3 days from 01-07
  });

  it('B3: a second pointerdown (2 fingers, different task) mid-resize is ignored — the first gesture is not orphaned', () => {
    const onTaskResized = vi.fn();
    const { handle, groupEl } = setup({ onTaskResized });
    const group2 = handle.svg.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;
    const bar2 = barGeometry(handle, 't2');

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 }); // 2 days

    dispatchPointer(group2, 'pointerdown', {
      pointerId: 2,
      clientX: bar2.x + bar2.width,
      clientY: 80,
      bubbles: true,
    });

    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    expect(onTaskResized).toHaveBeenCalledTimes(1);
    expect(onTaskResized.mock.calls[0]![0]).toBe('t1');
  });

  it('fg-task--resizing: present after the threshold, gone after release (commit path)', () => {
    const onTaskResized = vi.fn();
    const { handle, groupEl } = setup({ onTaskResized });
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    expect(groupEl.classList.contains('fg-task--resizing')).toBe(false);
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    expect(groupEl.classList.contains('fg-task--resizing')).toBe(true);
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    expect(groupEl.classList.contains('fg-task--resizing')).toBe(false);
  });

  it('fg-task--resizing: gone after Escape (cancel path), width reverted to original', () => {
    const onTaskResized = vi.fn();
    const { groupEl, handle } = setup({ onTaskResized });
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;
    const barEl = groupEl.querySelector('.fg-task__bar')!;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    expect(barEl.getAttribute('width')).not.toBe(String(width));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(groupEl.classList.contains('fg-task--resizing')).toBe(false);
    expect(barEl.getAttribute('width')).toBe(String(width));
    expect(onTaskResized).not.toHaveBeenCalled();
  });

  it('custom edgeHitZonePx/dragThresholdPx are respected', () => {
    const onTaskResized = vi.fn();
    const { handle, groupEl } = setup({ onTaskResized, edgeHitZonePx: 20, dragThresholdPx: 10 });
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;
    // 15px inside the wider 20px zone — a default 8px zone would have missed this.
    const nearEdgeButOutsideDefaultZone = rightEdgeX - 15;

    dispatchPointer(groupEl, 'pointerdown', {
      pointerId: 1,
      clientX: nearEdgeButOutsideDefaultZone,
      clientY: 50,
      bubbles: true,
    });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: nearEdgeButOutsideDefaultZone + 8, clientY: 50 }); // dx=8 < 10
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: nearEdgeButOutsideDefaultZone + 8, clientY: 50 });
    expect(onTaskResized).not.toHaveBeenCalled(); // below the custom threshold

    dispatchPointer(groupEl, 'pointerdown', {
      pointerId: 2,
      clientX: nearEdgeButOutsideDefaultZone,
      clientY: 50,
      bubbles: true,
    });
    dispatchPointer(window, 'pointermove', {
      pointerId: 2,
      clientX: nearEdgeButOutsideDefaultZone + 48,
      clientY: 50,
    });
    dispatchPointer(window, 'pointerup', { pointerId: 2, clientX: nearEdgeButOutsideDefaultZone + 48, clientY: 50 });
    expect(onTaskResized).toHaveBeenCalledTimes(1); // above the custom threshold, inside the custom zone
  });

  it('onResizing: called on each valid pointermove AFTER the threshold, NOT before it, NOT on pointerup', () => {
    const onTaskResized = vi.fn();
    const onResizing = vi.fn();
    const { handle, groupEl } = setup({ onTaskResized, onResizing });
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 2, clientY: 50 }); // < threshold
    expect(onResizing).not.toHaveBeenCalled();

    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 }); // exceeds threshold
    expect(onResizing).toHaveBeenCalledTimes(1);

    const callCountBeforeUp = onResizing.mock.calls.length;
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    expect(onResizing).toHaveBeenCalledTimes(callCountBeforeUp);
    expect(onTaskResized).toHaveBeenCalledTimes(1);
  });

  // --- Review B1: a PRE-threshold cancel must not clobber host-owned body cursor -------------
  it('pointercancel BEFORE the threshold does not reset document.body.style.cursor (regression B1)', () => {
    const { handle, groupEl } = setup({ onTaskResized: vi.fn() });
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;

    document.body.style.cursor = 'wait'; // host-owned chrome (e.g. a background load)
    // pointerdown in the edge zone, then cancel WITHOUT ever moving (a touch that becomes a
    // scroll fires pointercancel here). onDragStart never ran, so onCancel must be skipped.
    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointercancel', { pointerId: 1, clientX: rightEdgeX, clientY: 50 });

    expect(document.body.style.cursor).toBe('wait'); // untouched — the gesture never started
    document.body.style.cursor = ''; // clean up for the next test
  });
});

// --- Coexistence with enableDragMove (registration order both ways) ------------------------

describe('enableDragResize + enableDragMove coexisting on the same handle (priority, not call order, decides the winner)', () => {
  let container: HTMLElement;
  let tasks: Task[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tasks = [task('t1', '2026-01-05T09:00', '2026-01-07T09:00')];
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function barGeometry(handle: ReturnType<typeof createSvgRenderer>, taskId: string): { x: number; width: number } {
    const groupEl = handle.svg.querySelector(`.fg-task[data-task-id="${taskId}"]`)!;
    const barEl = groupEl.querySelector('.fg-task__bar')!;
    return { x: Number(barEl.getAttribute('x')), width: Number(barEl.getAttribute('width')) };
  }

  it.each([
    ['drag-move registered first', 'move-first'],
    ['drag-resize registered first', 'resize-first'],
  ] as const)('%s: edge claims resize, middle claims move — registration order does not matter', (_label, order) => {
    const onTaskResized = vi.fn();
    const onTaskMoved = vi.fn();
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    const { x, width } = barGeometry(handle, 't1');
    const rightEdgeX = x + width;
    const middleX = x + width / 2;

    if (order === 'move-first') {
      enableDragMove(handle, () => tasks, { onTaskMoved });
      enableDragResize(handle, () => tasks, { onTaskResized });
    } else {
      enableDragResize(handle, () => tasks, { onTaskResized });
      enableDragMove(handle, () => tasks, { onTaskMoved });
    }

    // Edge pointerdown → resize claims, move never fires.
    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: rightEdgeX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: rightEdgeX + 48, clientY: 50 });
    expect(onTaskResized).toHaveBeenCalledTimes(1);
    expect(onTaskMoved).not.toHaveBeenCalled();

    // Middle pointerdown → move claims, resize never fires.
    dispatchPointer(groupEl, 'pointerdown', { pointerId: 2, clientX: middleX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 2, clientX: middleX + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 2, clientX: middleX + 48, clientY: 50 });
    expect(onTaskMoved).toHaveBeenCalledTimes(1);
    expect(onTaskResized).toHaveBeenCalledTimes(1); // still just the one from above
  });
});

// --- Coordinator hardening (review C4 destroy-wrap, E1 viewBox scaling) --------------------

describe('coordinator hardening', () => {
  let container: HTMLElement;
  let tasks: Task[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tasks = [task('t1', '2026-01-05T09:00', '2026-01-07T09:00')];
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function barGeometry(handle: ReturnType<typeof createSvgRenderer>, taskId: string): { x: number; width: number } {
    const groupEl = handle.svg.querySelector(`.fg-task[data-task-id="${taskId}"]`)!;
    const barEl = groupEl.querySelector('.fg-task__bar')!;
    return { x: Number(barEl.getAttribute('x')), width: Number(barEl.getAttribute('width')) };
  }

  it('third-party wraps handle.destroy AFTER enable, then both disposers run, then the outer destroy fires → no throw, real teardown still runs (C4)', () => {
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const disposeResize = enableDragResize(handle, () => tasks, { onTaskResized: vi.fn() });
    const disposeMove = enableDragMove(handle, () => tasks, { onTaskMoved: vi.fn() });

    // A plugin wraps destroy on top of the coordinator's wrap and captures OUR wrappedDestroy
    // as its inner original.
    const innerDestroy = handle.destroy;
    let outerRan = false;
    handle.destroy = (): void => {
      outerRan = true;
      innerDestroy();
    };

    // Both recognizers unregister → the coordinator detaches and nulls its `originalDestroy`
    // module var. Because our wrap is no longer `handle.destroy` (the plugin's is), it is not
    // restored — the plugin's wrapper still holds a reference to it.
    disposeResize();
    disposeMove();

    // The plugin's later teardown calls through our (now-detached) wrappedDestroy. It must use
    // the closure-captured original renderer destroy, not the nulled module var.
    expect(() => handle.destroy()).not.toThrow();
    expect(outerRan).toBe(true);
    expect(handle.svg.isConnected).toBe(false); // the real renderer destroy actually ran
  });

  it('right-edge hit-zone honors viewBox scaling: claims at the SCALED edge, declines at the unscaled one (E1)', () => {
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const vbAttr = handle.svg.getAttribute('viewBox')!;
    const vbWidth = Number(vbAttr.split(/\s+/)[2]);
    const scale = 2;
    // jsdom has no layout engine — stub a rendered box twice the viewBox width (host CSS
    // scaled the <svg> to 2×). left = 0 keeps the arithmetic simple.
    handle.svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: vbWidth * scale, height: 100, right: vbWidth * scale, bottom: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;

    const { x, width } = barGeometry(handle, 't1'); // SVG user units
    const onTaskResized = vi.fn();
    enableDragResize(handle, () => tasks, { onTaskResized });
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;

    // The UNSCALED right edge (x + width) is now far left of the true on-screen edge → decline.
    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: x + width, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: x + width + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: x + width + 48, clientY: 50 });
    expect(onTaskResized).not.toHaveBeenCalled();

    // The SCALED right edge is where the bar's right edge actually renders → claim.
    const scaledEdge = (x + width) * scale;
    dispatchPointer(groupEl, 'pointerdown', { pointerId: 2, clientX: scaledEdge, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 2, clientX: scaledEdge + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 2, clientX: scaledEdge + 48, clientY: 50 });
    expect(onTaskResized).toHaveBeenCalledTimes(1);
  });
});
