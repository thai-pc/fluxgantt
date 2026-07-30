// Interaction layer — drag-move (spec-drag-move.md, plan-drag-move.md). Kéo một task bar
// bằng Pointer Events để đổi `start`/`end` của MỘT task, commit một lần khi thả chuột qua
// callback `onTaskMoved`. Không cascade, không resize, không tạo dependency, không
// keyboard-nav (v1, plan §5). KHÔNG import TaskStore — nhận `getTasks()` duck-typed để
// tránh coupling vào state layer cụ thể (spec §1).
//
// ĐÃ ĐỤNG DOM (Pointer Events thuần) — đây là layer duy nhất trong core được phép, theo
// architecture.md "Interaction". `@fluxgantt/core` vẫn KHÔNG import react/vue/svelte.
//
// CHỐT Q4 (main session, spec §10 — override §4.3 gốc): commit dùng lịch Temporal
// (`normalizeDate(...).add({ days: N })`), KHÔNG dùng `timeScale.xToDate`/elapsed-nanosecond
// cho phần commit — cách cũ lệch giờ-trong-ngày ~1h khi kéo băng qua mốc DST. `.add({days})`
// giữ nguyên wall-clock time-of-day + duration, an toàn DST (xem test DST bên dưới).
import { normalizeDate } from '../compute/working-calendar.js';
import type { SvgRendererHandle, TimeScale } from '../render/index.js';
import type { DateInput, Task, TaskId } from '../types.js';
import { toTaskId } from '../types.js';
import type { Temporal } from '@js-temporal/polyfill';

export interface DragMoveOptions {
  /**
   * Gọi ĐÚNG MỘT LẦN khi một thao tác kéo đã vượt ngưỡng (`dragThresholdPx`) được thả
   * (`pointerup`) — KHÔNG gọi cho một cú click thường (chưa vượt ngưỡng) hay một lần kéo
   * bị huỷ (Escape/`pointercancel`/disposer giữa lúc kéo). Đây là cơ chế commit DUY NHẤT
   * — `enableDragMove` KHÔNG tự ghi vào `TaskStore` hay bất kỳ store nào. Nếu muốn cập
   * nhật `TaskStore`, gọi `taskStore.update(taskId, { start: newStart, end: newEnd })`
   * bên trong callback này.
   */
  onTaskMoved(taskId: TaskId, newStart: Temporal.ZonedDateTime, newEnd: Temporal.ZonedDateTime): void;

  /**
   * Ngưỡng di chuyển (px, toạ độ client) trước khi một pointerdown được coi là kéo thay
   * vì click. Default 4.
   */
  dragThresholdPx?: number;

  /**
   * Gọi trên MỖI `pointermove` hợp lệ sau khi đã vượt ngưỡng, với start/end TẠM THỜI
   * (chưa commit) — tuỳ chọn, dành cho UI live (vd tooltip hiển thị ngày dưới con trỏ).
   * Không bao giờ dùng để commit — chỉ `onTaskMoved` mới commit.
   */
  onDragging?(
    taskId: TaskId,
    tentativeStart: Temporal.ZonedDateTime,
    tentativeEnd: Temporal.ZonedDateTime,
  ): void;
}

const DEFAULT_DRAG_THRESHOLD_PX = 4;
const DRAGGING_CLASS = 'fg-task--dragging';

/**
 * Clamp for the snapped day-delta (review B2). `Number.isFinite` alone lets a finite but
 * absurd `clientX` (e.g. 1e8) through, and `ZonedDateTime.add({ days: 1e8 })` throws a
 * `RangeError` (Temporal's representable-instant limit) — which would escape a pointer
 * handler and leave the drag UI wedged. ±366,000 days ≈ 1,000 years: far beyond any real
 * drag, always inside Temporal's range regardless of the task's base date.
 */
const MAX_DRAG_DAYS = 366_000;

interface DragState {
  readonly taskId: TaskId;
  readonly groupEl: SVGGElement;
  /** Element thật nhận pointerdown (có thể là con của `groupEl`, vd `.fg-task__bar`) —
   *  dùng để gọi `releasePointerCapture` đúng cặp với `setPointerCapture` gốc. */
  readonly captureEl: Element;
  readonly originalStart: DateInput;
  readonly originalEnd: DateInput;
  readonly startClientX: number;
  readonly pointerId: number;
  /** Chụp MỘT LẦN tại pointerdown (Q5) — không đọc lại `handle.getTimeScale()` mỗi
   *  pointermove, để một `setOptions()` giữa chừng không đổi ý nghĩa delta đang tích luỹ. */
  readonly timeScale: TimeScale;
  exceededThreshold: boolean;
}

/**
 * Snap delta pixel về số ngày nguyên gần nhất (theo `timeScale.pixelsPerDay`) — đúng yêu
 * cầu "snap tối thiểu về ranh giới ngày, không snap theo working-calendar" (plan §5).
 * Trả về SỐ NGÀY (N), không phải pixel — chốt Q4.
 */
export function snapDeltaToDay(dxPixels: number, timeScale: TimeScale): number {
  if (!Number.isFinite(dxPixels) || !Number.isFinite(timeScale.pixelsPerDay) || timeScale.pixelsPerDay === 0) {
    return 0;
  }
  const n = Math.round(dxPixels / timeScale.pixelsPerDay);
  // Clamp a finite-but-absurd delta so the commit path (`.add({ days: n })`) can never
  // throw a Temporal RangeError (review B2).
  return Math.max(-MAX_DRAG_DAYS, Math.min(MAX_DRAG_DAYS, n));
}

/**
 * Tính start/end mới bằng lịch Temporal — chốt Q4 (main session §10): cộng `deltaDays`
 * NGÀY LỊCH vào `originalStart`/`originalEnd` đã normalize theo timezone của `timeScale`
 * (`timeScale.range.start.timeZoneId` — cùng timezone mà renderer dùng để dựng scale này,
 * không cần truyền `WorkingCalendar` riêng). Giữ nguyên giờ-trong-ngày (wall-clock) +
 * duration, an toàn qua mốc DST — KHÔNG dùng `timeScale.xToDate`/elapsed-nanosecond
 * (cách đó lệch ~1h khi băng qua DST, xem spec §4.3 — bị override bởi §10 Q4).
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
 * Gắn drag-move vào một `SvgRendererHandle` đã mount. Uỷ quyền sự kiện: một listener
 * `pointerdown` DUY NHẤT trên `handle.svg` (không phải trên từng `.fg-task`) — bắt buộc vì
 * `update()` full-repaint xoá/dựng lại toàn bộ `.fg-task` mỗi lần gọi; listener gắn trực
 * tiếp trên từng task-bar sẽ mất sau lần repaint đầu tiên. `pointermove`/`pointerup`/
 * `pointercancel`/`keydown` gắn TẠM THỜI trên `window` trong khoảng thời gian có một lần
 * kéo đang diễn ra (gắn ở pointerdown, gỡ ở pointerup/cancel/Escape/disposer) — không bao
 * giờ tích luỹ vô hạn qua nhiều lần kéo (security.md "không leak listener").
 *
 * Trả về disposer — gỡ toàn bộ listener. Gọi disposer khi đang kéo dở = huỷ kéo đó (không
 * commit), tương đương Escape. Gọi disposer nhiều lần = no-op an toàn.
 */
export function enableDragMove(
  handle: SvgRendererHandle,
  getTasks: () => readonly Task[],
  options: DragMoveOptions,
): () => void {
  const dragThresholdPx = options.dragThresholdPx ?? DEFAULT_DRAG_THRESHOLD_PX;
  let state: DragState | null = null;
  let disposed = false;

  handle.svg.addEventListener('pointerdown', onPointerDown);

  // B1 (High): `enableDragMove` and the renderer handle are two independent lifecycles.
  // If the host calls `handle.destroy()` while a drag gesture is open, `destroy()` only
  // removes the <svg> — the 4 `window` listeners added at pointerdown would leak (and keep
  // the detached DOM alive) until some later pointerup/cancel happens to fire. Link them:
  // wrap `destroy` so tearing down the renderer also disposes drag-move. The disposer
  // restores the original, so a normal `dispose()` → `destroy()` sequence stays clean.
  const originalDestroy = handle.destroy;
  const destroyWithDrag = (): void => {
    disposeDragMove();
    originalDestroy.call(handle);
  };
  handle.destroy = destroyWithDrag;

  return disposeDragMove;

  function disposeDragMove(): void {
    if (disposed) return;
    disposed = true;
    handle.svg.removeEventListener('pointerdown', onPointerDown);
    if (handle.destroy === destroyWithDrag) handle.destroy = originalDestroy;
    if (state) cancelDrag(state);
  }

  function onPointerDown(event: PointerEvent): void {
    // B3: ignore a second concurrent pointerdown (e.g. a 2nd finger on a touch screen)
    // while a gesture is already open — overwriting `state` would orphan the first gesture
    // (its window listeners persist but its pointerId no longer matches any handler).
    if (disposed || state) return;
    if (!(event.target instanceof Element)) return;
    // Không phải kéo trên một task bar — trả sớm, KHÔNG preventDefault/stopPropagation
    // (spec §6 — không chặn click/selection tương lai trên grid/header/khoảng trống).
    const groupEl = event.target.closest('.fg-task[data-task-id]');
    if (!groupEl) return;

    const taskIdAttr = groupEl.getAttribute('data-task-id');
    if (taskIdAttr === null) return;
    const taskId = toTaskId(taskIdAttr);
    const task = getTasks().find((t) => t.id === taskId);
    // Race giữa DOM đã render và `tasks` mới nhất — bỏ qua, không throw (spec §7).
    if (!task) return;

    // Toạ độ pointer là input số không tin cậy (security.md/spec §7) — bỏ qua ngay từ
    // pointerdown nếu đã hỏng, đừng khởi tạo một gesture kéo trên dữ liệu rác.
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;

    const captureEl = event.target;
    state = {
      taskId,
      groupEl: groupEl as unknown as SVGGElement,
      captureEl,
      originalStart: task.start,
      originalEnd: task.end,
      startClientX: event.clientX,
      pointerId: event.pointerId,
      timeScale: handle.getTimeScale(),
      exceededThreshold: false,
    };

    try {
      captureEl.setPointerCapture?.(event.pointerId);
    } catch {
      // Best-effort — jsdom và một số môi trường không cài đặt pointer capture thật
      // (spec §7/§9). Không bao giờ để lỗi này làm vỡ luồng kéo chính.
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
  }

  function onPointerMove(event: PointerEvent): void {
    const s = state;
    if (!s || event.pointerId !== s.pointerId) return;
    // Defensive (B1): if the dragged group was detached (renderer removed/repainted
    // without going through the wrapped destroy), abort the gesture and clean up rather
    // than keep mutating an orphaned node / holding window listeners.
    if (!s.groupEl.isConnected) {
      cancelDrag(s);
      return;
    }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      // Toạ độ rác giữa chừng — bỏ qua event này, giữ nguyên trạng thái (spec §7).
      return;
    }

    const dxRaw = event.clientX - s.startClientX;

    if (!s.exceededThreshold) {
      if (Math.abs(dxRaw) < dragThresholdPx) return; // tiềm năng click, chưa làm gì
      s.exceededThreshold = true;
      s.groupEl.classList.add(DRAGGING_CLASS);
      document.body.style.cursor = 'grabbing';
      // Chặn text-selection khi kéo bằng chuột — chỉ sau khi chắc chắn đây là kéo.
      event.preventDefault();
    }

    const deltaDays = snapDeltaToDay(dxRaw, s.timeScale);
    const pixelDx = deltaDays * s.timeScale.pixelsPerDay;
    // Phản hồi trực quan trong lúc kéo: chỉ dịch transform, KHÔNG gọi handle.update()/
    // taskStore.update() mỗi frame (lý do hiệu năng, plan §3 — renderer full-repaint).
    s.groupEl.setAttribute('transform', `translate(${pixelDx} 0)`);

    if (options.onDragging) {
      const { newStart, newEnd } = computeDraggedDates(s.timeScale, s.originalStart, s.originalEnd, deltaDays);
      options.onDragging(s.taskId, newStart, newEnd);
    }
  }

  function onPointerUp(event: PointerEvent): void {
    const s = state;
    if (!s || event.pointerId !== s.pointerId) return;
    teardown(s);
    state = null;

    if (!s.exceededThreshold) return; // click thường — không commit, chưa từng set transform

    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      // Toạ độ rác ở event thả cuối cùng — không commit dữ liệu từ toạ độ hỏng.
      revertVisual(s);
      return;
    }

    // Reset drag chrome (class + cursor) BEFORE computing/committing (B2): the commit path
    // is now clamped and cannot throw, but resetting first also means a throw from the
    // host's `onTaskMoved` callback can't leave `grabbing`/`fg-task--dragging` stuck.
    // The transform is intentionally kept — the bar holds its dragged position until the
    // caller re-renders with the updated task (spec §4.1).
    s.groupEl.classList.remove(DRAGGING_CLASS);
    document.body.style.cursor = '';

    const dxRaw = event.clientX - s.startClientX;
    const deltaDays = snapDeltaToDay(dxRaw, s.timeScale);
    const { newStart, newEnd } = computeDraggedDates(s.timeScale, s.originalStart, s.originalEnd, deltaDays);
    options.onTaskMoved(s.taskId, newStart, newEnd);
  }

  function onPointerCancel(event: PointerEvent): void {
    const s = state;
    if (!s || event.pointerId !== s.pointerId) return;
    cancelDrag(s);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const s = state;
    if (!s) return;
    if (event.key !== 'Escape') return;
    cancelDrag(s);
  }

  /** Huỷ một lần kéo đang diễn ra: gỡ listener, revert transform, KHÔNG commit. Dùng
   *  chung cho pointercancel/Escape/disposer-giữa-lúc-kéo. */
  function cancelDrag(s: DragState): void {
    teardown(s);
    state = null;
    revertVisual(s);
  }

  function teardown(s: DragState): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown);
    try {
      s.captureEl.releasePointerCapture?.(s.pointerId);
    } catch {
      // Best-effort, xem ghi chú ở setPointerCapture.
    }
  }

  function revertVisual(s: DragState): void {
    if (!s.exceededThreshold) return; // chưa từng set transform/class — không gì để gỡ
    s.groupEl.removeAttribute('transform');
    s.groupEl.classList.remove(DRAGGING_CLASS);
    document.body.style.cursor = '';
  }
}
