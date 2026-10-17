// `internal/drag-math.ts`: the DOM-free arithmetic the SVG recognizers and the Canvas recognizers
// share. The existing drag-move / drag-resize / pointer-drag suites keep importing these names from
// their old homes, so the re-export identity is pinned here too.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  MAX_DRAG_DAYS,
  computeClampedResizedEnd,
  computeDraggedDates,
  snapDeltaToDay,
} from '../../src/internal/drag-math.js';
import * as dragMove from '../../src/interaction/drag-move.js';
import * as dragResize from '../../src/interaction/drag-resize.js';
import * as pointerDrag from '../../src/interaction/pointer-drag.js';
import { createTimeScale } from '../../src/render/renderer-base.js';
import { DEFAULT_CALENDAR, normalizeDate } from '../../src/compute/working-calendar.js';

const scaleIn = (tz: string) => {
  const start = normalizeDate('2026-03-01T00:00', tz);
  return createTimeScale({ start, end: start.add({ days: 60 }) }, 'week', { ...DEFAULT_CALENDAR, timezone: tz });
};

describe('drag-math', () => {
  it('is the single implementation behind the old import paths (SVG and Canvas share it)', () => {
    expect(dragMove.snapDeltaToDay).toBe(snapDeltaToDay);
    expect(dragMove.computeDraggedDates).toBe(computeDraggedDates);
    expect(dragResize.computeClampedResizedEnd).toBe(computeClampedResizedEnd);
    expect(pointerDrag.snapDeltaToDay).toBe(snapDeltaToDay);
    expect(pointerDrag.MAX_DRAG_DAYS).toBe(MAX_DRAG_DAYS);
  });

  it('snapDeltaToDay lands within half a day of the exact delta and is clamped', () => {
    const ts = scaleIn('UTC');
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (dx) => {
        const n = snapDeltaToDay(dx, ts);
        expect(Math.abs(n)).toBeLessThanOrEqual(MAX_DRAG_DAYS);
        expect(Math.abs(n - dx / ts.pixelsPerDay)).toBeLessThanOrEqual(0.5 + 1e-6);
      }),
    );
    expect(snapDeltaToDay(Number.NaN, ts)).toBe(0);
    expect(snapDeltaToDay(Number.POSITIVE_INFINITY, ts)).toBe(0);
    expect(snapDeltaToDay(1e15, ts)).toBe(MAX_DRAG_DAYS);
    expect(snapDeltaToDay(-1e15, ts)).toBe(-MAX_DRAG_DAYS);
  });

  it.each(['America/New_York', 'Asia/Ho_Chi_Minh', 'UTC'])(
    'computeDraggedDates keeps the wall-clock time across a DST boundary in %s',
    (tz) => {
      const ts = scaleIn(tz);
      // US DST starts 2026-03-08: dragging across it must not shift 09:00 to 08:00 / 10:00.
      const { newStart, newEnd } = computeDraggedDates(ts, '2026-03-06T09:00', '2026-03-06T17:00', 5);
      expect(newStart.hour).toBe(9);
      expect(newEnd.hour).toBe(17);
      expect(newStart.toPlainDate().toString()).toBe('2026-03-11');
    },
  );

  it('computeDraggedDates is invertible: +n then -n restores the instants', () => {
    const ts = scaleIn('America/New_York');
    fc.assert(
      fc.property(fc.integer({ min: -400, max: 400 }), (n) => {
        const a = computeDraggedDates(ts, '2026-03-06T09:00', '2026-03-09T17:00', n);
        const b = computeDraggedDates(ts, a.newStart.toString(), a.newEnd.toString(), -n);
        expect(b.newStart.toPlainDateTime().toString()).toBe('2026-03-06T09:00:00');
        expect(b.newEnd.toPlainDateTime().toString()).toBe('2026-03-09T17:00:00');
      }),
    );
  });

  it('computeClampedResizedEnd floors at start + 1 day but never expands a sub-day task', () => {
    const ts = scaleIn('UTC');
    expect(computeClampedResizedEnd(ts, '2026-03-02T00:00', '2026-03-06T00:00', -100).toPlainDate().toString()).toBe('2026-03-03');
    expect(computeClampedResizedEnd(ts, '2026-03-02T00:00', '2026-03-06T00:00', 2).toPlainDate().toString()).toBe('2026-03-08');
    const sub = computeClampedResizedEnd(ts, '2026-03-02T09:00', '2026-03-02T13:00', 0);
    expect(sub.hour).toBe(13);
    expect(computeClampedResizedEnd(ts, '2026-03-02T09:00', '2026-03-02T13:00', -3).hour).toBe(13);
  });
});
