// `parseString` now tries a date-only parse first for strings of <= 10 chars (it used to call
// `Instant.from` first, which THROWS on date-only input). Equivalence argument: an absolute-instant
// string needs a time and an offset or `Z` ("2026-01-05T00Z" is the shortest, 14 chars; the basic
// form "20260105T00Z" is 12), so no string of <= 10 chars was ever accepted by `Instant.from`; the
// old code always reached the same `PlainDate.from` fallback. The tests pin that against a copy of
// the old order.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Temporal } from '@js-temporal/polyfill';
import { normalizeDate } from '../../src/compute/working-calendar.js';

function oldParse(s: string, tz: string): Temporal.ZonedDateTime {
  try {
    return Temporal.Instant.from(s).toZonedDateTimeISO(tz);
  } catch {
    /* not an absolute instant */
  }
  if (s.length <= 10) return Temporal.PlainDate.from(s).toZonedDateTime({ timeZone: tz });
  return Temporal.PlainDateTime.from(s).toZonedDateTime(tz);
}

const outcome = (f: () => Temporal.ZonedDateTime): string => {
  try {
    return f().toString();
  } catch (e) {
    return `throws ${(e as Error).constructor.name}`;
  }
};

const ZONES = ['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York'];

describe('normalizeDate string parsing (date-only fast path)', () => {
  it('pins each documented form to its expected value', () => {
    expect(normalizeDate('2026-03-08', 'America/New_York').toString()).toBe(
      '2026-03-08T00:00:00-05:00[America/New_York]',
    );
    expect(normalizeDate('2026-01-05T09:00:00Z', 'Asia/Ho_Chi_Minh').toString()).toBe(
      '2026-01-05T16:00:00+07:00[Asia/Ho_Chi_Minh]',
    );
    expect(normalizeDate('2026-01-05T09:00:00+02:00', 'UTC').toString()).toBe('2026-01-05T07:00:00+00:00[UTC]');
    expect(normalizeDate('2026-01-05T09:00', 'UTC').toString()).toBe('2026-01-05T09:00:00+00:00[UTC]');
  });

  it('matches the old Instant-first order for every accepted form and every failure', () => {
    const date = fc
      .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2032-12-31T00:00:00Z'), noInvalidDate: true })
      .map((d) => d.toISOString());
    const strings = fc.oneof(
      date.map((iso) => iso.slice(0, 10)), // 2026-01-05
      date.map((iso) => iso.slice(0, 10).replaceAll('-', '')), // 20260105 (basic form)
      date.map((iso) => iso.slice(0, 19)), // wall-clock datetime
      date.map((iso) => iso.slice(0, 16)), // wall-clock, no seconds
      date, // Z with millis
      date.map((iso) => `${iso.slice(0, 19)}+05:30`), // explicit offset
      date.map((iso) => `${iso.slice(0, 19)}-08:00`),
      fc.constantFrom('', '2026', '2026-01', '2026-13-45', 'not a date', '2026-02-30', 'T09:00', '2026-01-05T'),
      fc.string({ maxLength: 12 }),
    );
    fc.assert(
      fc.property(strings, fc.constantFrom(...ZONES), (s, tz) => {
        expect(outcome(() => normalizeDate(s, tz))).toBe(outcome(() => oldParse(s, tz)));
      }),
      { numRuns: 400 },
    );
  });

  it('no string of <= 10 chars is an absolute instant (the premise of the reorder)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 10 }), (s) => {
        expect(() => Temporal.Instant.from(s)).toThrow();
      }),
      { numRuns: 500 },
    );
    for (const s of ['2026-01-05', '20260105', '2026-01-05Z', '2026-01Z', '1T00Z', '2026T00Z']) {
      expect(() => Temporal.Instant.from(s), s).toThrow();
    }
  });
});
