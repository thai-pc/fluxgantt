// Pure, DOM-free drag arithmetic shared by the SVG recognizers (`interaction/drag-*.ts`) and the
// Canvas recognizers (`render/canvas-drag.ts`, a lazy chunk that must not import `interaction/*`
// at runtime). Calendar-day snapping only: working-calendar handling is the commit path's job.
import type { Temporal } from '@js-temporal/polyfill';
import { normalizeDate } from '../compute/working-calendar.js';
import type { TimeScale } from '../render/renderer-base.js';
import type { DateInput } from '../types.js';
import { getTemporal } from './temporal.js';

export const DEFAULT_DRAG_THRESHOLD_PX = 4;
/** Right-edge resize zone (px) under a fine pointer. */
export const EDGE_HIT_ZONE_PX = 8;
/** Coarse-pointer edge zone: WCAG 2.2 SC 2.5.8 (24 px). Kept in lockstep with the coarse link
 *  handle radius (12 px): the handle sits ON the bar's end anchor at a higher gesture priority, so
 *  it shadows the innermost 12 px of this zone. 24 > 12 leaves a reachable band of edge-resize
 *  beside the handle; change one and re-check the other. */
export const COARSE_EDGE_HIT_ZONE_PX = 24;
export const LINK_HANDLE_RADIUS_PX = 4;
export const COARSE_LINK_HANDLE_RADIUS_PX = 12;

/**
 * Clamp for the snapped day-delta: `ZonedDateTime.add({ days: 1e8 })` throws a `RangeError`, which
 * would escape a pointer handler and wedge the drag UI. +-366,000 days is ~1,000 years: far beyond
 * any real drag and always inside Temporal's range.
 */
export const MAX_DRAG_DAYS = 366_000;

/** Snap a pixel delta to the nearest whole day. Returns the NUMBER OF DAYS, not pixels. */
export function snapDeltaToDay(dxPixels: number, timeScale: TimeScale): number {
  if (!Number.isFinite(dxPixels) || !Number.isFinite(timeScale.pixelsPerDay) || timeScale.pixelsPerDay === 0) {
    return 0;
  }
  const n = Math.round(dxPixels / timeScale.pixelsPerDay);
  return Math.max(-MAX_DRAG_DAYS, Math.min(MAX_DRAG_DAYS, n));
}

/**
 * New start/end via calendar arithmetic (`.add({ days })` on dates normalized to the time scale's
 * timezone): preserves wall-clock time-of-day and duration, DST-safe.
 */
export function computeDraggedDates(
  timeScale: TimeScale,
  originalStart: DateInput,
  originalEnd: DateInput,
  deltaDays: number,
): { newStart: Temporal.ZonedDateTime; newEnd: Temporal.ZonedDateTime } {
  const timezone = timeScale.range.start.timeZoneId;
  const newStart = normalizeDate(originalStart, timezone).add({ days: deltaDays });
  const newEnd = normalizeDate(originalEnd, timezone).add({ days: deltaDays });
  return { newStart, newEnd };
}

/**
 * Resize variant: only `end` moves, floored at the EARLIER of `start + 1 calendar day` and the
 * task's own original end (never expands a naturally sub-day task). Pure, Temporal-only.
 */
export function computeClampedResizedEnd(
  timeScale: TimeScale,
  originalStart: DateInput,
  originalEnd: DateInput,
  deltaDays: number,
): Temporal.ZonedDateTime {
  const timezone = timeScale.range.start.timeZoneId;
  const start = normalizeDate(originalStart, timezone);
  const end = normalizeDate(originalEnd, timezone);
  const tentativeEnd = end.add({ days: deltaDays });
  const compare = getTemporal().ZonedDateTime.compare;
  const dayFloor = start.add({ days: 1 });
  const minEnd = compare(end, dayFloor) < 0 ? end : dayFloor;
  return compare(tentativeEnd, minEnd) < 0 ? minEnd : tentativeEnd;
}
