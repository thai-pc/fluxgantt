// @vitest-environment jsdom
//
// Interaction — drag-move tests (spec-drag-move.md §8, decisions Q1–Q5 §10). Runs under
// jsdom (per-file override; the rest of core stays `environment: 'node'`), like
// `svg-renderer.test.ts`.
//
// Q4 (main session, overrides the original §4.3 — important): the commit uses calendar
// arithmetic (`normalizeDate(...).add({ days: N })`), NOT `timeScale.xToDate`/
// elapsed-nanoseconds. The DST test below locks in this property: the wall-clock
// time-of-day is unchanged when dragging across a DST boundary, only the date shifts by N.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { createTimeScale } from '../../src/render/renderer-base.js';
import { enableDragMove, computeDraggedDates, snapDeltaToDay } from '../../src/interaction/drag-move.js';
import { DEFAULT_CALENDAR, normalizeDate } from '../../src/compute/working-calendar.js';
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

// --- §8.1 smoke test: PointerEvent must be constructible + dispatchable under jsdom@25 ----
//
// SPEC DEVIATION (flagged per the §8.1 requirement, not silently changing course): the spec
// assumed `jsdom@25.0.1` ships a global `PointerEvent` constructor. Verified directly against
// the actually-installed `jsdom` (`node_modules/.pnpm/jsdom@25.0.1`, both standalone and
// inside vitest): `'PointerEvent' in window` is `false` — there is no `PointerEvent` at all,
// not even a no-op. Since this was a single-agent run (no synchronous channel back to
// spec-writer), we use a minimal polyfill ONLY in this test file (not touching `src/`, not
// touching the shared `tests/setup/temporal.ts`) rather than leaving all DOM tests red
// forever — see the full explanation on `PointerEventPolyfill` below. To be confirmed by
// spec-writer/planner at the next review.
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId: number }) {
    super(type, init);
    this.pointerId = init.pointerId;
  }
}
/** The real `globalThis.PointerEvent` if the environment has one (a real browser, a different
 *  jsdom version); otherwise the minimal polyfill above — `enableDragMove` only reads
 *  `clientX`/`clientY`/`pointerId`, using no real `PointerEvent`-only API, so the polyfill is
 *  enough to simulate the behavior under test. */
const PointerEventCtor: typeof PointerEvent =
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
  (PointerEventPolyfill as unknown as typeof PointerEvent);

describe('smoke — PointerEvent under jsdom', () => {
  it('confirmed for real: globalThis.PointerEvent does NOT exist in the jsdom@25.0.1 installed in this repo (deviates from spec §8.1 assumption)', () => {
    expect('PointerEvent' in globalThis).toBe(false);
  });

  it('PointerEventCtor (real or polyfill) is constructible and dispatchEvent does not throw', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(() => {
      const ev = new PointerEventCtor('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true });
      el.dispatchEvent(ev);
    }).not.toThrow();
    el.remove();
  });
});

// --- Pure math: snapDeltaToDay / computeDraggedDates (no real DOM needed) -----------------

describe('snapDeltaToDay — snap to a whole day (decision Q4)', () => {
  const cal = DEFAULT_CALENDAR;
  const range = { start: normalizeDate('2026-01-01', cal.timezone), end: normalizeDate('2026-12-31', cal.timezone) };
  const ts = createTimeScale(range, 'week', cal); // pixelsPerDay = 24

  it('1.4 days → rounds down to 1', () => {
    expect(snapDeltaToDay(1.4 * ts.pixelsPerDay, ts)).toBe(1);
  });
  it('1.6 days → rounds up to 2', () => {
    expect(snapDeltaToDay(1.6 * ts.pixelsPerDay, ts)).toBe(2);
  });
  it('exact half (1.5 days) → Math.round JS convention rounds up to 2', () => {
    expect(snapDeltaToDay(1.5 * ts.pixelsPerDay, ts)).toBe(2);
  });
  it('a negative delta snaps in the right direction too', () => {
    expect(snapDeltaToDay(-1.6 * ts.pixelsPerDay, ts)).toBe(-2);
  });
  it('NaN/Infinity pixels → returns 0, no throw', () => {
    expect(snapDeltaToDay(NaN, ts)).toBe(0);
    expect(snapDeltaToDay(Infinity, ts)).toBe(0);
  });
});

describe('computeDraggedDates — calendar arithmetic .add({days:N}) (decision Q4)', () => {
  const cal = DEFAULT_CALENDAR; // UTC
  const range = { start: normalizeDate('2026-01-01', cal.timezone), end: normalizeDate('2026-12-31', cal.timezone) };
  const ts = createTimeScale(range, 'week', cal);

  it('adds exactly N calendar days, keeps time-of-day, and matches normalizeDate(...).add({days:N}) directly', () => {
    const { newStart, newEnd } = computeDraggedDates(ts, '2026-03-10T09:30', '2026-03-12T17:00', 3);
    expect(newStart.toString()).toBe(normalizeDate('2026-03-10T09:30', 'UTC').add({ days: 3 }).toString());
    expect(newEnd.toString()).toBe(normalizeDate('2026-03-12T17:00', 'UTC').add({ days: 3 }).toString());
  });

  it('negative N shifts backwards', () => {
    const { newStart } = computeDraggedDates(ts, '2026-03-10T09:30', '2026-03-12T17:00', -2);
    expect(newStart.toPlainDate().toString()).toBe('2026-03-08');
  });

  it('N = 0 → unchanged (aside from a possible re-normalize) but the same instant', () => {
    const { newStart } = computeDraggedDates(ts, '2026-03-10T09:30', '2026-03-12T17:00', 0);
    expect(newStart.equals(normalizeDate('2026-03-10T09:30', 'UTC'))).toBe(true);
  });

  it('milestone (originalStart === originalEnd) → newStart === newEnd for any N', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (n) => {
        const { newStart, newEnd } = computeDraggedDates(ts, '2026-06-15T12:00', '2026-06-15T12:00', n);
        expect(newStart.equals(newEnd)).toBe(true);
      }),
    );
  });

  it('property: the time-of-day (wall-clock hour/minute) is unchanged after adding N days', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 27 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: -400, max: 400 }),
        (day, hour, minute, n) => {
          const iso = `2026-05-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          const { newStart } = computeDraggedDates(ts, iso, iso, n);
          expect(newStart.hour).toBe(hour);
          expect(newStart.minute).toBe(minute);
        },
      ),
    );
  });

  it('dragging outside timeScale.range: a very large dx still returns a valid ZonedDateTime, no throw', () => {
    expect(() => computeDraggedDates(ts, '2026-03-10T09:30', '2026-03-12T17:00', 100_000)).not.toThrow();
    const { newStart } = computeDraggedDates(ts, '2026-03-10T09:30', '2026-03-12T17:00', 100_000);
    expect(newStart.toPlainDate().year).toBeGreaterThan(2026);
  });
});

describe('DST boundary — America/New_York, spring-forward 2026-03-08 (required per testing.md)', () => {
  const nyCal: WorkingCalendar = { ...DEFAULT_CALENDAR, timezone: 'America/New_York' };
  const range = {
    start: normalizeDate('2026-03-01', nyCal.timezone),
    end: normalizeDate('2026-03-31', nyCal.timezone),
  };
  const ts = createTimeScale(range, 'week', nyCal);

  it('dragging 2 days across the DST boundary → time-of-day is UNCHANGED, only the date shifts by N (the deliberate Q4 property)', () => {
    // 2026-03-07 09:00 (EST, offset -05:00) → +2 days → 2026-03-09 09:00 (EDT, offset -04:00).
    const { newStart, newEnd } = computeDraggedDates(ts, '2026-03-07T09:00', '2026-03-07T17:00', 2);

    expect(newStart.hour).toBe(9);
    expect(newStart.minute).toBe(0);
    expect(newStart.toPlainDate().toString()).toBe('2026-03-09');
    expect(newEnd.hour).toBe(17);
    expect(newEnd.minute).toBe(0);
    expect(newEnd.toPlainDate().toString()).toBe('2026-03-09');

    // Lock in the proof that the DST boundary was actually crossed: the UTC offset changes
    // from -05:00 → -04:00, even though the local (wall-clock) time 09:00/17:00 does not
    // shift with it — this IS the Q4 property (add calendar days, not elapsed-nanoseconds/xToDate).
    const before = normalizeDate('2026-03-07T09:00', nyCal.timezone);
    expect(before.offset).toBe('-05:00');
    expect(newStart.offset).toBe('-04:00');
  });
});

// --- DOM/interaction — needs jsdom, dispatches PointerEvent (polyfill — see the §8.1 note
// above `PointerEventCtor`) ---------------------------------------------------------------

const CAL = DEFAULT_CALENDAR;

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

describe('enableDragMove — DOM interaction', () => {
  let container: HTMLElement;
  let tasks: Task[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tasks = [
      task('t1', '2026-01-05T09:00', '2026-01-07T09:00'),
      task('t2', '2026-01-10T09:00', '2026-01-12T09:00'),
    ];
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function setup(options: Parameters<typeof enableDragMove>[2]) {
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    const dispose = enableDragMove(handle, () => tasks, options);
    return { handle, groupEl, dispose };
  }

  it('pointerdown → pointermove (≥ threshold) → pointerup: onTaskMoved called exactly once with the right N days', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    // pixelsPerDay(week) = 24 → dx=48 ⇒ 2 days
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 148, clientY: 50 });

    expect(onTaskMoved).toHaveBeenCalledTimes(1);
    const [taskId, newStart, newEnd] = onTaskMoved.mock.calls[0] as [TaskId, unknown, unknown];
    expect(taskId).toBe('t1');
    // Decision Q4: commit via `.add({days:N})`, compared directly against normalizeDate(...).add(...)
    // — not through `xToDate`.
    expect((newStart as { toString(): string }).toString()).toBe(
      normalizeDate('2026-01-05T09:00', CAL.timezone).add({ days: 2 }).toString(),
    );
    expect((newEnd as { toString(): string }).toString()).toBe(
      normalizeDate('2026-01-07T09:00', CAL.timezone).add({ days: 2 }).toString(),
    );
  });

  it('pointerdown → pointermove (< threshold) → pointerup: plain click, does NOT commit, does NOT set transform', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 102, clientY: 50 }); // dx=2 < 4
    expect(groupEl.getAttribute('transform')).toBeNull();
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 102, clientY: 50 });

    expect(onTaskMoved).not.toHaveBeenCalled();
    expect(groupEl.getAttribute('transform')).toBeNull();
  });

  it('Escape mid-drag: onTaskMoved NOT called, transform removeAttribute, class removed; a later pointerup is safe', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(groupEl.getAttribute('transform')).not.toBeNull();
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(groupEl.getAttribute('transform')).toBeNull();
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(false);
    expect(onTaskMoved).not.toHaveBeenCalled();

    // pointerup after Escape (state already null) — no error, not called again.
    expect(() =>
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 150, clientY: 50 }),
    ).not.toThrow();
    expect(onTaskMoved).not.toHaveBeenCalled();
  });

  it('pointercancel mid-drag: behaves like Escape (no commit, reverts transform)', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(groupEl.getAttribute('transform')).not.toBeNull();

    dispatchPointer(window, 'pointercancel', { pointerId: 1, clientX: 150, clientY: 50 });

    expect(groupEl.getAttribute('transform')).toBeNull();
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(false);
    expect(onTaskMoved).not.toHaveBeenCalled();
  });

  it('disposer: called once → subsequent drags have no effect; called twice does not throw', () => {
    const onTaskMoved = vi.fn();
    const { groupEl, dispose } = setup({ onTaskMoved });

    dispose();
    expect(() => dispose()).not.toThrow();

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 150, clientY: 50 });

    expect(onTaskMoved).not.toHaveBeenCalled();
    expect(groupEl.getAttribute('transform')).toBeNull();
  });

  it('disposer mid-drag: reverts transform, no commit, no leaked window pointermove listener', () => {
    const onTaskMoved = vi.fn();
    const { groupEl, dispose } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(groupEl.getAttribute('transform')).not.toBeNull();

    dispose();

    expect(groupEl.getAttribute('transform')).toBeNull();
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(false);
    expect(onTaskMoved).not.toHaveBeenCalled();

    // Listeners removed — the next pointermove has no side effects (no throw, doesn't set the
    // transform again).
    expect(() =>
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 200, clientY: 50 }),
    ).not.toThrow();
    expect(groupEl.getAttribute('transform')).toBeNull();
    expect(onTaskMoved).not.toHaveBeenCalled();
  });

  it('pointerdown outside .fg-task (on a grid cell): does not start a drag, no stopPropagation (a second listener still receives the event)', () => {
    const onTaskMoved = vi.fn();
    const { handle } = setup({ onTaskMoved });

    const gridCell = handle.svg.querySelector('.fg-timeline__grid-cell') as SVGElement | null;
    const target = gridCell ?? handle.svg;

    const secondListener = vi.fn();
    target.addEventListener('pointerdown', secondListener);

    dispatchPointer(target, 'pointerdown', { pointerId: 2, clientX: 300, clientY: 10, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 2, clientX: 350, clientY: 10 });
    dispatchPointer(window, 'pointerup', { pointerId: 2, clientX: 350, clientY: 10 });

    expect(onTaskMoved).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledTimes(1);
  });

  it('getTasks() no longer has the matching taskId (data race): pointerdown does not throw, does not start state', () => {
    const onTaskMoved = vi.fn();
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    // getTasks() returns an array WITHOUT t1 (race between the old DOM and new data).
    enableDragMove(handle, () => tasks.filter((t) => t.id !== toTaskId('t1')), { onTaskMoved });

    expect(() =>
      dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true }),
    ).not.toThrow();
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 150, clientY: 50 });

    expect(onTaskMoved).not.toHaveBeenCalled();
  });

  it('NaN coordinate mid-valid-drag: the event is skipped, no throw, state is not corrupted — the next valid pointermove still works', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 }); // 2 days
    const transformAfterFirstMove = groupEl.getAttribute('transform');
    expect(transformAfterFirstMove).not.toBeNull();

    // jsdom's `MouseEvent` constructor validates that `clientX`/`clientY` are finite numbers
    // at construction time (`new MouseEvent(...)` with `clientX: NaN` throws outright —
    // unlike a real browser, where these fields are unrestricted WebIDL `double`s). To
    // simulate a `PointerEvent` with corrupt coordinates actually reaching the listener (the
    // security §7 scenario: another script dispatches a forged event), construct a valid
    // event then override `clientX` via `Object.defineProperty` — bypassing constructor
    // validation, exactly what `enableDragMove` reads via `event.clientX`.
    const badEvent = new PointerEventCtor('pointermove', { pointerId: 1, clientX: 0, clientY: 50 });
    Object.defineProperty(badEvent, 'clientX', { value: NaN, configurable: true });

    expect(() => window.dispatchEvent(badEvent)).not.toThrow();
    // The transform is unchanged vs before the garbage event.
    expect(groupEl.getAttribute('transform')).toBe(transformAfterFirstMove);

    // The next valid pointermove still works normally (state was not corrupted).
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 172, clientY: 50 }); // 3 days
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 172, clientY: 50 });

    expect(onTaskMoved).toHaveBeenCalledTimes(1);
    const [, newStart] = onTaskMoved.mock.calls[0] as [TaskId, { toPlainDate(): { toString(): string } }];
    expect(newStart.toPlainDate().toString()).toBe('2026-01-08'); // +3 days from 01-05
  });

  it('onDragging: called on each valid pointermove AFTER the threshold, NOT before it, NOT on pointerup', () => {
    const onTaskMoved = vi.fn();
    const onDragging = vi.fn();
    const { groupEl } = setup({ onTaskMoved, onDragging });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 102, clientY: 50 }); // < threshold
    expect(onDragging).not.toHaveBeenCalled();

    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 }); // exceeds threshold
    expect(onDragging).toHaveBeenCalledTimes(1);

    const callCountBeforeUp = onDragging.mock.calls.length;
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(onDragging).toHaveBeenCalledTimes(callCountBeforeUp); // no extra call on pointerup
    expect(onTaskMoved).toHaveBeenCalledTimes(1);
  });

  it('fg-task--dragging: present after the threshold, gone after release', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(false);
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(true);
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(false);
  });

  it('custom dragThresholdPx (default 4) is respected', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved, dragThresholdPx: 10 });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 108, clientY: 50 }); // dx=8 < 10
    expect(groupEl.getAttribute('transform')).toBeNull();
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 108, clientY: 50 });
    expect(onTaskMoved).not.toHaveBeenCalled();
  });

  // --- Review fixes ---------------------------------------------------------------------

  it('B1: handle.destroy() mid-drag → cleanly removes the window listeners (no leak, no commit)', () => {
    const onTaskMoved = vi.fn();
    const { handle, groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(groupEl.getAttribute('transform')).not.toBeNull();

    handle.destroy(); // destroy the renderer MID-drag — must also dispose drag-move
    expect(container.children).toHaveLength(0); // svg was removed (original destroy still runs)

    // No gesture window listeners remain: subsequent pointermove/up are harmless, no commit,
    // no throw, no re-creating the 'grabbing' cursor.
    expect(() => {
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 300, clientY: 50 });
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 300, clientY: 50 });
    }).not.toThrow();
    expect(onTaskMoved).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
  });

  it('B1: element detached (svg.remove()) without going through destroy → the next pointermove self-cancels the gesture', () => {
    const onTaskMoved = vi.fn();
    const { handle, groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });

    handle.svg.remove(); // remove the DOM directly, do NOT call destroy()
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 200, clientY: 50 });
    // the gesture self-cancelled (isConnected guard) → pointerup does not commit
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 200, clientY: 50 });
    expect(onTaskMoved).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
  });

  it('B2: finite-but-huge delta (clientX ~1e8) → no RangeError, N is clamped, chrome not stuck', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    expect(() => {
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 1e8, clientY: 50 });
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 1e8, clientY: 50 });
    }).not.toThrow();

    expect(onTaskMoved).toHaveBeenCalledTimes(1);
    // cursor + class are reset (not stuck on 'grabbing'/dragging, since the commit no longer throws)
    expect(document.body.style.cursor).toBe('');
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(false);
  });

  it('B2: snapDeltaToDay clamps to ±MAX_DRAG_DAYS for a huge delta', () => {
    const ts = createTimeScale(
      { start: normalizeDate('2026-01-01', CAL.timezone), end: normalizeDate('2026-12-31', CAL.timezone) },
      'week',
      CAL,
    );
    expect(snapDeltaToDay(1e12, ts)).toBe(366_000);
    expect(snapDeltaToDay(-1e12, ts)).toBe(-366_000);
  });

  it('B3: a second pointerdown (2 fingers, different task) mid-drag is ignored — the first gesture is not orphaned', () => {
    const onTaskMoved = vi.fn();
    const { handle, groupEl } = setup({ onTaskMoved });
    const group2 = handle.svg.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;

    // Gesture 1 on t1 (pointerId 1)
    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 }); // 2 days

    // A second finger presses t2 (pointerId 2) WHILE dragging t1 → must be ignored (state stays t1)
    dispatchPointer(group2, 'pointerdown', { pointerId: 2, clientX: 400, clientY: 80, bubbles: true });
    expect(group2.getAttribute('transform')).toBeNull(); // t2 does not start a drag

    // pointerup of finger 1 still commits t1 correctly (the first gesture is NOT orphaned)
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 148, clientY: 50 });
    expect(onTaskMoved).toHaveBeenCalledTimes(1);
    expect(onTaskMoved.mock.calls[0]![0]).toBe('t1');
  });
});
