// @vitest-environment jsdom
//
// Interaction — drag-move tests (spec-drag-move.md §8, chốt Q1–Q5 §10). Runs under
// jsdom (per-file override; the rest of core stays `environment: 'node'`), giống
// `svg-renderer.test.ts`.
//
// Q4 (main session, override §4.3 gốc — quan trọng): commit dùng lịch Temporal
// (`normalizeDate(...).add({ days: N })`), KHÔNG dùng `timeScale.xToDate`/
// elapsed-nanosecond. Test DST bên dưới khoá lại đúng đặc tính này: giờ-trong-ngày
// (wall-clock) không đổi khi kéo băng qua mốc DST, chỉ ngày dịch N.
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

// --- §8.1 smoke test: PointerEvent phải dựng được + dispatch được dưới jsdom@25 --------
//
// LỆCH SPEC (báo lại theo đúng yêu cầu §8.1, không âm thầm đổi hướng): spec giả định
// `jsdom@25.0.1` có sẵn hàm dựng `PointerEvent` toàn cục. Verify trực tiếp bản `jsdom`
// thật cài trong repo (`node_modules/.pnpm/jsdom@25.0.1`, ngoài lẫn trong vitest) cho
// thấy `'PointerEvent' in window` là `false` — KHÔNG có `PointerEvent` nào, kể cả dạng
// no-op. Vì đây là single-agent run (không có kênh hỏi ngược đồng bộ tới spec-writer),
// tôi dùng một polyfill tối thiểu CHỈ trong file test này (không đụng `src/`, không đụng
// `tests/setup/temporal.ts` dùng chung toàn `core`) thay vì để toàn bộ test DOM đỏ vĩnh
// viễn — xem giải thích đầy đủ ở `PointerEventPolyfill` bên dưới. Cần
// spec-writer/planner xác nhận lại ở review kế tiếp.
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId: number }) {
    super(type, init);
    this.pointerId = init.pointerId;
  }
}
/** `globalThis.PointerEvent` thật nếu môi trường có (browser thật, jsdom version khác);
 *  nếu không, polyfill tối thiểu ở trên — `enableDragMove` chỉ đọc
 *  `clientX`/`clientY`/`pointerId`, không dùng API nào riêng của `PointerEvent` thật, nên
 *  polyfill đủ để mô phỏng đúng hành vi cần test. */
const PointerEventCtor: typeof PointerEvent =
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
  (PointerEventPolyfill as unknown as typeof PointerEvent);

describe('smoke — PointerEvent under jsdom', () => {
  it('xác nhận thật: globalThis.PointerEvent KHÔNG tồn tại trong jsdom@25.0.1 cài trong repo này (lệch giả định spec §8.1)', () => {
    expect('PointerEvent' in globalThis).toBe(false);
  });

  it('PointerEventCtor (thật hoặc polyfill) dựng được và dispatchEvent không throw', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(() => {
      const ev = new PointerEventCtor('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true });
      el.dispatchEvent(ev);
    }).not.toThrow();
    el.remove();
  });
});

// --- Toán thuần: snapDeltaToDay / computeDraggedDates (không cần DOM thật) -------------

describe('snapDeltaToDay — snap về số ngày nguyên (chốt Q4)', () => {
  const cal = DEFAULT_CALENDAR;
  const range = { start: normalizeDate('2026-01-01', cal.timezone), end: normalizeDate('2026-12-31', cal.timezone) };
  const ts = createTimeScale(range, 'week', cal); // pixelsPerDay = 24

  it('1.4 ngày → làm tròn xuống 1', () => {
    expect(snapDeltaToDay(1.4 * ts.pixelsPerDay, ts)).toBe(1);
  });
  it('1.6 ngày → làm tròn lên 2', () => {
    expect(snapDeltaToDay(1.6 * ts.pixelsPerDay, ts)).toBe(2);
  });
  it('đúng nửa (1.5 ngày) → Math.round quy ước JS làm tròn lên 2', () => {
    expect(snapDeltaToDay(1.5 * ts.pixelsPerDay, ts)).toBe(2);
  });
  it('delta âm cũng snap đúng hướng', () => {
    expect(snapDeltaToDay(-1.6 * ts.pixelsPerDay, ts)).toBe(-2);
  });
  it('NaN/Infinity pixel → trả về 0, không throw', () => {
    expect(snapDeltaToDay(NaN, ts)).toBe(0);
    expect(snapDeltaToDay(Infinity, ts)).toBe(0);
  });
});

describe('computeDraggedDates — cộng lịch Temporal .add({days:N}) (chốt Q4)', () => {
  const cal = DEFAULT_CALENDAR; // UTC
  const range = { start: normalizeDate('2026-01-01', cal.timezone), end: normalizeDate('2026-12-31', cal.timezone) };
  const ts = createTimeScale(range, 'week', cal);

  it('cộng đúng N ngày lịch, giữ giờ-trong-ngày và kết quả khớp normalizeDate(...).add({days:N}) trực tiếp', () => {
    const { newStart, newEnd } = computeDraggedDates(ts, '2026-03-10T09:30', '2026-03-12T17:00', 3);
    expect(newStart.toString()).toBe(normalizeDate('2026-03-10T09:30', 'UTC').add({ days: 3 }).toString());
    expect(newEnd.toString()).toBe(normalizeDate('2026-03-12T17:00', 'UTC').add({ days: 3 }).toString());
  });

  it('N âm dịch lùi', () => {
    const { newStart } = computeDraggedDates(ts, '2026-03-10T09:30', '2026-03-12T17:00', -2);
    expect(newStart.toPlainDate().toString()).toBe('2026-03-08');
  });

  it('N = 0 → không đổi (ngoại trừ có thể re-normalize) nhưng cùng instant', () => {
    const { newStart } = computeDraggedDates(ts, '2026-03-10T09:30', '2026-03-12T17:00', 0);
    expect(newStart.equals(normalizeDate('2026-03-10T09:30', 'UTC'))).toBe(true);
  });

  it('milestone (originalStart === originalEnd) → newStart === newEnd với mọi N', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (n) => {
        const { newStart, newEnd } = computeDraggedDates(ts, '2026-06-15T12:00', '2026-06-15T12:00', n);
        expect(newStart.equals(newEnd)).toBe(true);
      }),
    );
  });

  it('property: giờ-trong-ngày (wall-clock hour/minute) không đổi sau khi cộng N ngày', () => {
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

  it('kéo ra ngoài timeScale.range: dx rất lớn vẫn trả về ZonedDateTime hợp lệ, không throw', () => {
    expect(() => computeDraggedDates(ts, '2026-03-10T09:30', '2026-03-12T17:00', 100_000)).not.toThrow();
    const { newStart } = computeDraggedDates(ts, '2026-03-10T09:30', '2026-03-12T17:00', 100_000);
    expect(newStart.toPlainDate().year).toBeGreaterThan(2026);
  });
});

describe('DST boundary — America/New_York, spring-forward 2026-03-08 (bắt buộc theo testing.md)', () => {
  const nyCal: WorkingCalendar = { ...DEFAULT_CALENDAR, timezone: 'America/New_York' };
  const range = {
    start: normalizeDate('2026-03-01', nyCal.timezone),
    end: normalizeDate('2026-03-31', nyCal.timezone),
  };
  const ts = createTimeScale(range, 'week', nyCal);

  it('kéo 2 ngày băng qua mốc DST → giờ-trong-ngày KHÔNG đổi, chỉ ngày dịch N (đặc tính Q4 có chủ đích)', () => {
    // 2026-03-07 09:00 (EST, offset -05:00) → +2 ngày → 2026-03-09 09:00 (EDT, offset -04:00).
    const { newStart, newEnd } = computeDraggedDates(ts, '2026-03-07T09:00', '2026-03-07T17:00', 2);

    expect(newStart.hour).toBe(9);
    expect(newStart.minute).toBe(0);
    expect(newStart.toPlainDate().toString()).toBe('2026-03-09');
    expect(newEnd.hour).toBe(17);
    expect(newEnd.minute).toBe(0);
    expect(newEnd.toPlainDate().toString()).toBe('2026-03-09');

    // Khoá lại bằng chứng đã thật sự băng qua DST: offset UTC đổi từ -05:00 → -04:00, dù
    // giờ địa phương (wall-clock) 09:00/17:00 không bị dịch theo — đây CHÍNH LÀ đặc tính
    // Q4 (cộng ngày lịch, không phải elapsed-nanosecond/xToDate).
    const before = normalizeDate('2026-03-07T09:00', nyCal.timezone);
    expect(before.offset).toBe('-05:00');
    expect(newStart.offset).toBe('-04:00');
  });
});

// --- DOM/interaction — cần jsdom, dispatch PointerEvent (polyfill — xem ghi chú §8.1 ở
// trên `PointerEventCtor`) ---------------------------------------------------------------

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

  it('pointerdown → pointermove (≥ threshold) → pointerup: onTaskMoved gọi đúng 1 lần với N ngày đúng', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    // pixelsPerDay(week) = 24 → dx=48 ⇒ 2 ngày
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 148, clientY: 50 });

    expect(onTaskMoved).toHaveBeenCalledTimes(1);
    const [taskId, newStart, newEnd] = onTaskMoved.mock.calls[0] as [TaskId, unknown, unknown];
    expect(taskId).toBe('t1');
    // Chốt Q4: commit qua `.add({days:N})`, so sánh trực tiếp với normalizeDate(...).add(...)
    // — không đi qua `xToDate`.
    expect((newStart as { toString(): string }).toString()).toBe(
      normalizeDate('2026-01-05T09:00', CAL.timezone).add({ days: 2 }).toString(),
    );
    expect((newEnd as { toString(): string }).toString()).toBe(
      normalizeDate('2026-01-07T09:00', CAL.timezone).add({ days: 2 }).toString(),
    );
  });

  it('pointerdown → pointermove (< threshold) → pointerup: click thường, KHÔNG commit, KHÔNG set transform', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 102, clientY: 50 }); // dx=2 < 4
    expect(groupEl.getAttribute('transform')).toBeNull();
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 102, clientY: 50 });

    expect(onTaskMoved).not.toHaveBeenCalled();
    expect(groupEl.getAttribute('transform')).toBeNull();
  });

  it('Escape giữa lúc đang kéo: onTaskMoved KHÔNG gọi, transform bị removeAttribute, class gỡ; pointerup sau đó an toàn', () => {
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

    // pointerup sau Escape (state đã null) — không lỗi, không gọi lại.
    expect(() =>
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 150, clientY: 50 }),
    ).not.toThrow();
    expect(onTaskMoved).not.toHaveBeenCalled();
  });

  it('pointercancel giữa lúc đang kéo: hành vi giống Escape (không commit, revert transform)', () => {
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

  it('disposer: gọi 1 lần → drag sau đó không còn tác dụng; gọi 2 lần không throw', () => {
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

  it('disposer giữa lúc đang kéo: revert transform, không commit, window không còn pointermove listener leak', () => {
    const onTaskMoved = vi.fn();
    const { groupEl, dispose } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(groupEl.getAttribute('transform')).not.toBeNull();

    dispose();

    expect(groupEl.getAttribute('transform')).toBeNull();
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(false);
    expect(onTaskMoved).not.toHaveBeenCalled();

    // Listener đã gỡ — pointermove tiếp theo không còn side-effect nào (không throw, không
    // đổi lại transform).
    expect(() =>
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 200, clientY: 50 }),
    ).not.toThrow();
    expect(groupEl.getAttribute('transform')).toBeNull();
    expect(onTaskMoved).not.toHaveBeenCalled();
  });

  it('pointerdown ngoài .fg-task (trên grid cell): không khởi tạo kéo, không stopPropagation (listener thứ hai vẫn nhận event)', () => {
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

  it('getTasks() không còn taskId tương ứng (race dữ liệu): pointerdown không throw, không khởi tạo state', () => {
    const onTaskMoved = vi.fn();
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    // getTasks() trả về mảng KHÔNG chứa t1 (race giữa DOM cũ và data mới).
    enableDragMove(handle, () => tasks.filter((t) => t.id !== toTaskId('t1')), { onTaskMoved });

    expect(() =>
      dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true }),
    ).not.toThrow();
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 150, clientY: 50 });

    expect(onTaskMoved).not.toHaveBeenCalled();
  });

  it('NaN toạ độ giữa lúc kéo hợp lệ: event bị bỏ qua, không throw, state không hỏng — pointermove hợp lệ tiếp theo vẫn hoạt động', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 }); // 2 ngày
    const transformAfterFirstMove = groupEl.getAttribute('transform');
    expect(transformAfterFirstMove).not.toBeNull();

    // jsdom's `MouseEvent` constructor validates `clientX`/`clientY` phải là số hữu hạn
    // ngay tại thời điểm dựng (`new MouseEvent(...)` với `clientX: NaN` throw thẳng —
    // khác hành vi trình duyệt thật, nơi các field này là WebIDL `double` không ràng
    // buộc). Để mô phỏng một `PointerEvent` có toạ độ hỏng THỰC SỰ lọt tới listener
    // (kịch bản security §7 nhắm tới: script khác dispatch event giả), dựng một event
    // hợp lệ rồi ghi đè `clientX` bằng `Object.defineProperty` — bỏ qua validation ở
    // constructor, đúng những gì `enableDragMove` sẽ đọc được qua `event.clientX`.
    const badEvent = new PointerEventCtor('pointermove', { pointerId: 1, clientX: 0, clientY: 50 });
    Object.defineProperty(badEvent, 'clientX', { value: NaN, configurable: true });

    expect(() => window.dispatchEvent(badEvent)).not.toThrow();
    // Transform không đổi so với trước event rác.
    expect(groupEl.getAttribute('transform')).toBe(transformAfterFirstMove);

    // pointermove hợp lệ tiếp theo vẫn hoạt động bình thường (state không bị hỏng).
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 172, clientY: 50 }); // 3 ngày
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 172, clientY: 50 });

    expect(onTaskMoved).toHaveBeenCalledTimes(1);
    const [, newStart] = onTaskMoved.mock.calls[0] as [TaskId, { toPlainDate(): { toString(): string } }];
    expect(newStart.toPlainDate().toString()).toBe('2026-01-08'); // +3 ngày từ 01-05
  });

  it('onDragging: gọi trên mỗi pointermove hợp lệ SAU threshold, KHÔNG gọi trước threshold, KHÔNG gọi tại pointerup', () => {
    const onTaskMoved = vi.fn();
    const onDragging = vi.fn();
    const { groupEl } = setup({ onTaskMoved, onDragging });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 102, clientY: 50 }); // < threshold
    expect(onDragging).not.toHaveBeenCalled();

    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 }); // vượt threshold
    expect(onDragging).toHaveBeenCalledTimes(1);

    const callCountBeforeUp = onDragging.mock.calls.length;
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(onDragging).toHaveBeenCalledTimes(callCountBeforeUp); // không tăng thêm tại pointerup
    expect(onTaskMoved).toHaveBeenCalledTimes(1);
  });

  it('fg-task--dragging: có mặt sau threshold, biến mất sau thả', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(false);
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(true);
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(false);
  });

  it('dragThresholdPx tuỳ chỉnh (default 4) được tôn trọng', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved, dragThresholdPx: 10 });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 108, clientY: 50 }); // dx=8 < 10
    expect(groupEl.getAttribute('transform')).toBeNull();
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 108, clientY: 50 });
    expect(onTaskMoved).not.toHaveBeenCalled();
  });

  // --- Review fixes ---------------------------------------------------------------------

  it('B1: handle.destroy() giữa lúc đang kéo → gỡ sạch window listener (không leak, không commit)', () => {
    const onTaskMoved = vi.fn();
    const { handle, groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });
    expect(groupEl.getAttribute('transform')).not.toBeNull();

    handle.destroy(); // destroy renderer GIỮA lúc kéo — phải kéo theo dispose drag-move
    expect(container.children).toHaveLength(0); // svg đã bị gỡ (destroy gốc vẫn chạy)

    // Không còn window listener nào của gesture: pointermove/up sau đó vô hại, không commit,
    // không throw, không tái tạo cursor 'grabbing'.
    expect(() => {
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 300, clientY: 50 });
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 300, clientY: 50 });
    }).not.toThrow();
    expect(onTaskMoved).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
  });

  it('B1: element bị detach (svg.remove()) không qua destroy → pointermove kế tiếp tự huỷ gesture', () => {
    const onTaskMoved = vi.fn();
    const { handle, groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 150, clientY: 50 });

    handle.svg.remove(); // gỡ DOM trực tiếp, KHÔNG gọi destroy()
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 200, clientY: 50 });
    // gesture đã tự huỷ (isConnected guard) → pointerup không commit
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 200, clientY: 50 });
    expect(onTaskMoved).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
  });

  it('B2: delta hữu hạn nhưng cực lớn (clientX ~1e8) → không throw RangeError, N bị clamp, chrome không kẹt', () => {
    const onTaskMoved = vi.fn();
    const { groupEl } = setup({ onTaskMoved });

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    expect(() => {
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 1e8, clientY: 50 });
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 1e8, clientY: 50 });
    }).not.toThrow();

    expect(onTaskMoved).toHaveBeenCalledTimes(1);
    // cursor + class được reset (không kẹt 'grabbing'/dragging vì commit không throw nữa)
    expect(document.body.style.cursor).toBe('');
    expect(groupEl.classList.contains('fg-task--dragging')).toBe(false);
  });

  it('B2: snapDeltaToDay clamp về ±MAX_DRAG_DAYS với delta khổng lồ', () => {
    const ts = createTimeScale(
      { start: normalizeDate('2026-01-01', CAL.timezone), end: normalizeDate('2026-12-31', CAL.timezone) },
      'week',
      CAL,
    );
    expect(snapDeltaToDay(1e12, ts)).toBe(366_000);
    expect(snapDeltaToDay(-1e12, ts)).toBe(-366_000);
  });

  it('B3: pointerdown thứ hai (2 ngón, task khác) giữa lúc kéo bị bỏ qua — gesture đầu không bị mồ côi', () => {
    const onTaskMoved = vi.fn();
    const { handle, groupEl } = setup({ onTaskMoved });
    const group2 = handle.svg.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;

    // Gesture 1 trên t1 (pointerId 1)
    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 }); // 2 ngày

    // Ngón thứ hai nhấn t2 (pointerId 2) GIỮA lúc kéo t1 → phải bị bỏ qua (state giữ nguyên t1)
    dispatchPointer(group2, 'pointerdown', { pointerId: 2, clientX: 400, clientY: 80, bubbles: true });
    expect(group2.getAttribute('transform')).toBeNull(); // t2 không khởi tạo kéo

    // pointerup của ngón 1 vẫn commit t1 đúng (gesture đầu KHÔNG bị mồ côi)
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 148, clientY: 50 });
    expect(onTaskMoved).toHaveBeenCalledTimes(1);
    expect(onTaskMoved.mock.calls[0]![0]).toBe('t1');
  });
});
