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

// Default calendar: Mon–Fri 09:00–17:00 (8h/day), timezone UTC.
// 2026 reference: 01-02 = Fri, 01-03/04 = Sat/Sun, 01-05 = Mon, 01-06 = Tue.
const cal = DEFAULT_CALENDAR;

// Helper: format wall-clock for assertions.
const wall = (z: { toPlainDateTime(): { toString(): string } }): string =>
  z.toPlainDateTime().toString();

describe('isWorkingDay / isHoliday', () => {
  it('weekdays are working days, weekends are not', () => {
    expect(isWorkingDay('2026-01-05', cal)).toBe(true); // Mon
    expect(isWorkingDay('2026-01-03', cal)).toBe(false); // Sat
    expect(isWorkingDay('2026-01-04', cal)).toBe(false); // Sun
  });

  it('a holiday is not a working day', () => {
    const withHoliday: WorkingCalendar = { ...cal, holidays: ['2026-01-05'] };
    expect(isHoliday('2026-01-05', withHoliday)).toBe(true);
    expect(isWorkingDay('2026-01-05', withHoliday)).toBe(false);
  });
});

describe('addWorkingHours', () => {
  it('0 hours returns the same instant', () => {
    expect(wall(addWorkingHours('2026-01-05T10:00', 0, cal))).toBe('2026-01-05T10:00:00');
  });

  it('adds a full working day (8h from 09:00 → 17:00)', () => {
    expect(wall(addWorkingHours('2026-01-05T09:00', 8, cal))).toBe('2026-01-05T17:00:00');
  });

  it('overflows to the next day (8h from 13:00 → 13:00 next day)', () => {
    expect(wall(addWorkingHours('2026-01-05T13:00', 8, cal))).toBe('2026-01-06T13:00:00');
  });

  it('jumps over the weekend (Fri 16:00 + 2h → Mon 10:00)', () => {
    expect(wall(addWorkingHours('2026-01-02T16:00', 2, cal))).toBe('2026-01-05T10:00:00');
  });

  it('jumps over a holiday (Fri 16:00 + 2h, Mon off → Tue 10:00)', () => {
    const withHoliday: WorkingCalendar = { ...cal, holidays: ['2026-01-05'] };
    expect(wall(addWorkingHours('2026-01-02T16:00', 2, withHoliday))).toBe('2026-01-06T10:00:00');
  });

  it('an instant before working hours is pulled to the window start (07:00 + 1h → 10:00)', () => {
    expect(wall(addWorkingHours('2026-01-05T07:00', 1, cal))).toBe('2026-01-05T10:00:00');
  });

  it('skips the lunch break with a multi-window calendar (09–12, 13–17)', () => {
    const lunch: WorkingCalendar = {
      ...cal,
      workingHours: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ],
    };
    // 4h from 09:00: 3h to 12:00, 1h left → jump to 13:00 + 1h = 14:00
    expect(wall(addWorkingHours('2026-01-05T09:00', 4, lunch))).toBe('2026-01-05T14:00:00');
  });
});

describe('subtractWorkingHours', () => {
  it('subtracts a full day (8h from 17:00 → 09:00)', () => {
    expect(wall(subtractWorkingHours('2026-01-06T17:00', 8, cal))).toBe('2026-01-06T09:00:00');
  });

  it('goes back to the previous day (8h from Tue 13:00 → Mon 13:00)', () => {
    expect(wall(subtractWorkingHours('2026-01-06T13:00', 8, cal))).toBe('2026-01-05T13:00:00');
  });

  it('goes back over the weekend (Mon 10:00 − 2h → Fri 16:00)', () => {
    expect(wall(subtractWorkingHours('2026-01-05T10:00', 2, cal))).toBe('2026-01-02T16:00:00');
  });
});

describe('round-trip add ↔ subtract', () => {
  it('add then subtract the same hours returns the original instant', () => {
    const start = '2026-01-05T10:00';
    const forward = addWorkingHours(start, 5, cal);
    const back = subtractWorkingHours(forward, 5, cal);
    expect(wall(back)).toBe('2026-01-05T10:00:00');
  });
});

describe('differenceInWorkingHours', () => {
  it('same day 09:00 → 17:00 = 8h', () => {
    expect(differenceInWorkingHours('2026-01-05T09:00', '2026-01-05T17:00', cal)).toBe(8);
  });

  it('across the weekend Fri 16:00 → Mon 10:00 = 2h', () => {
    expect(differenceInWorkingHours('2026-01-02T16:00', '2026-01-05T10:00', cal)).toBe(2);
  });

  it('two consecutive working days = 16h', () => {
    expect(differenceInWorkingHours('2026-01-05T09:00', '2026-01-06T17:00', cal)).toBe(16);
  });

  it('reversing gives a negative result', () => {
    expect(differenceInWorkingHours('2026-01-05T17:00', '2026-01-05T09:00', cal)).toBe(-8);
  });

  it('equal instants = 0', () => {
    expect(differenceInWorkingHours('2026-01-05T10:00', '2026-01-05T10:00', cal)).toBe(0);
  });
});

describe('DST (America/New_York, spring-forward 2026-03-08)', () => {
  const ny: WorkingCalendar = { ...cal, timezone: 'America/New_York' };

  it('adding hours across a DST weekend keeps wall-clock correct (Fri 16:00 + 2h → Mon 10:00)', () => {
    // 2026-03-06 = Fri, 03-08 = Sun (DST), 03-09 = Mon
    const r = addWorkingHours('2026-03-06T16:00', 2, ny);
    expect(wall(r)).toBe('2026-03-09T10:00:00');
    expect(r.timeZoneId).toBe('America/New_York');
  });

  it('difference across DST is still exactly 16h (Fri 09:00 → Mon 17:00)', () => {
    expect(differenceInWorkingHours('2026-03-06T09:00', '2026-03-09T17:00', ny)).toBe(16);
  });
});

describe('holiday set cache', () => {
  const base: WorkingCalendar = { ...DEFAULT_CALENDAR, holidays: ['2026-01-07'] };

  it('results are identical to an uncached calendar (copy of the same data)', () => {
    const copy: WorkingCalendar = { ...base, holidays: [...base.holidays] };
    for (const d of ['2026-01-06', '2026-01-07', '2026-01-08']) {
      expect(isHoliday(d, base)).toBe(isHoliday(d, copy));
      expect(isHoliday(d, base)).toBe(isHoliday(d, base)); // second call hits the cache
    }
    expect(addWorkingHours('2026-01-06T09:00', 24, base).toString()).toBe(
      addWorkingHours('2026-01-06T09:00', 24, copy).toString(),
    );
  });

  it('replacing the holidays array, growing it, or changing the timezone re-parses', () => {
    const cal: WorkingCalendar = { ...base, holidays: ['2026-01-07'] };
    expect(isHoliday('2026-01-07', cal)).toBe(true);
    expect(isHoliday('2026-01-08', cal)).toBe(false);
    cal.holidays.push('2026-01-08'); // grown in place: length differs
    expect(isHoliday('2026-01-08', cal)).toBe(true);
    const replaced: WorkingCalendar = { ...cal, holidays: ['2026-01-09'] }; // new array, same length class
    expect(isHoliday('2026-01-09', replaced)).toBe(true);
    expect(isHoliday('2026-01-07', replaced)).toBe(false);
    // Same array object, different zone: the wall-clock day of a UTC instant moves.
    const shared = ['2026-01-07T23:30:00Z'];
    const utc: WorkingCalendar = { ...base, holidays: shared, timezone: 'UTC' };
    const hcm: WorkingCalendar = { ...base, holidays: shared, timezone: 'Asia/Ho_Chi_Minh' };
    expect(isHoliday('2026-01-07', utc)).toBe(true);
    expect(isHoliday('2026-01-08', hcm)).toBe(true);
    expect(isHoliday('2026-01-07', hcm)).toBe(false);
    expect(isHoliday('2026-01-07', utc)).toBe(true); // flipping back still correct
  });
});
