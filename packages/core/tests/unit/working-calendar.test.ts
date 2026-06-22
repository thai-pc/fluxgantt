import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CALENDAR,
  isWorkingDay,
  isHoliday,
  addWorkingHours,
  subtractWorkingHours,
  differenceInWorkingHours,
} from '../../src/compute/working-calendar.js';
import type { WorkingCalendar } from '../../src/types.js';

// Lịch mặc định: Mon–Fri 09:00–17:00 (8h/ngày), timezone UTC.
// Mốc 2026: 01-02 = Fri, 01-03/04 = Sat/Sun, 01-05 = Mon, 01-06 = Tue.
const cal = DEFAULT_CALENDAR;

// Helper: định dạng wall-clock để assert.
const wall = (z: { toPlainDateTime(): { toString(): string } }): string =>
  z.toPlainDateTime().toString();

describe('isWorkingDay / isHoliday', () => {
  it('weekday là ngày làm việc, cuối tuần thì không', () => {
    expect(isWorkingDay('2026-01-05', cal)).toBe(true); // Mon
    expect(isWorkingDay('2026-01-03', cal)).toBe(false); // Sat
    expect(isWorkingDay('2026-01-04', cal)).toBe(false); // Sun
  });

  it('holiday không phải ngày làm việc', () => {
    const withHoliday: WorkingCalendar = { ...cal, holidays: ['2026-01-05'] };
    expect(isHoliday('2026-01-05', withHoliday)).toBe(true);
    expect(isWorkingDay('2026-01-05', withHoliday)).toBe(false);
  });
});

describe('addWorkingHours', () => {
  it('0 giờ trả về chính mốc đó', () => {
    expect(wall(addWorkingHours('2026-01-05T10:00', 0, cal))).toBe('2026-01-05T10:00:00');
  });

  it('cộng đủ 1 ngày làm việc (8h từ 09:00 → 17:00)', () => {
    expect(wall(addWorkingHours('2026-01-05T09:00', 8, cal))).toBe('2026-01-05T17:00:00');
  });

  it('tràn sang ngày kế (8h từ 13:00 → 13:00 hôm sau)', () => {
    expect(wall(addWorkingHours('2026-01-05T13:00', 8, cal))).toBe('2026-01-06T13:00:00');
  });

  it('nhảy qua cuối tuần (Fri 16:00 + 2h → Mon 10:00)', () => {
    expect(wall(addWorkingHours('2026-01-02T16:00', 2, cal))).toBe('2026-01-05T10:00:00');
  });

  it('nhảy qua holiday (Fri 16:00 + 2h, Mon nghỉ → Tue 10:00)', () => {
    const withHoliday: WorkingCalendar = { ...cal, holidays: ['2026-01-05'] };
    expect(wall(addWorkingHours('2026-01-02T16:00', 2, withHoliday))).toBe('2026-01-06T10:00:00');
  });

  it('thời điểm trước giờ làm được kéo tới đầu cửa sổ (07:00 + 1h → 10:00)', () => {
    expect(wall(addWorkingHours('2026-01-05T07:00', 1, cal))).toBe('2026-01-05T10:00:00');
  });

  it('bỏ qua nghỉ trưa với lịch nhiều cửa sổ (09–12, 13–17)', () => {
    const lunch: WorkingCalendar = {
      ...cal,
      workingHours: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ],
    };
    // 4h từ 09:00: 3h tới 12:00, còn 1h → nhảy 13:00 + 1h = 14:00
    expect(wall(addWorkingHours('2026-01-05T09:00', 4, lunch))).toBe('2026-01-05T14:00:00');
  });
});

describe('subtractWorkingHours', () => {
  it('trừ đủ 1 ngày (8h từ 17:00 → 09:00)', () => {
    expect(wall(subtractWorkingHours('2026-01-06T17:00', 8, cal))).toBe('2026-01-06T09:00:00');
  });

  it('lùi qua ngày trước (8h từ Tue 13:00 → Mon 13:00)', () => {
    expect(wall(subtractWorkingHours('2026-01-06T13:00', 8, cal))).toBe('2026-01-05T13:00:00');
  });

  it('lùi qua cuối tuần (Mon 10:00 − 2h → Fri 16:00)', () => {
    expect(wall(subtractWorkingHours('2026-01-05T10:00', 2, cal))).toBe('2026-01-02T16:00:00');
  });
});

describe('round-trip add ↔ subtract', () => {
  it('add rồi subtract cùng số giờ trả về mốc ban đầu', () => {
    const start = '2026-01-05T10:00';
    const forward = addWorkingHours(start, 5, cal);
    const back = subtractWorkingHours(forward, 5, cal);
    expect(wall(back)).toBe('2026-01-05T10:00:00');
  });
});

describe('differenceInWorkingHours', () => {
  it('cùng ngày 09:00 → 17:00 = 8h', () => {
    expect(differenceInWorkingHours('2026-01-05T09:00', '2026-01-05T17:00', cal)).toBe(8);
  });

  it('qua cuối tuần Fri 16:00 → Mon 10:00 = 2h', () => {
    expect(differenceInWorkingHours('2026-01-02T16:00', '2026-01-05T10:00', cal)).toBe(2);
  });

  it('hai ngày làm việc liên tiếp = 16h', () => {
    expect(differenceInWorkingHours('2026-01-05T09:00', '2026-01-06T17:00', cal)).toBe(16);
  });

  it('đảo chiều cho kết quả âm', () => {
    expect(differenceInWorkingHours('2026-01-05T17:00', '2026-01-05T09:00', cal)).toBe(-8);
  });

  it('bằng nhau = 0', () => {
    expect(differenceInWorkingHours('2026-01-05T10:00', '2026-01-05T10:00', cal)).toBe(0);
  });
});

describe('DST (America/New_York, spring-forward 2026-03-08)', () => {
  const ny: WorkingCalendar = { ...cal, timezone: 'America/New_York' };

  it('cộng giờ qua cuối tuần chứa DST giữ đúng wall-clock (Fri 16:00 + 2h → Mon 10:00)', () => {
    // 2026-03-06 = Fri, 03-08 = Sun (DST), 03-09 = Mon
    const r = addWorkingHours('2026-03-06T16:00', 2, ny);
    expect(wall(r)).toBe('2026-03-09T10:00:00');
    expect(r.timeZoneId).toBe('America/New_York');
  });

  it('difference qua DST vẫn đúng 16h (Fri 09:00 → Mon 17:00)', () => {
    expect(differenceInWorkingHours('2026-03-06T09:00', '2026-03-09T17:00', ny)).toBe(16);
  });
});
