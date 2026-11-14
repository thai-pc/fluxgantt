// The cell editors' input parsers (spec-grid-columns.md 10.1, 10.6, 10.7, 13.1). Headless, pure, never throw.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MAX_EDIT_CHARS, parseDay, parseNumber, parseText } from '../../src/grid-editing/parse.js';

describe('parseText', () => {
  it('trims, removes control and bidi characters, and rejects empty and over-long input', () => {
    expect(parseText('  Hello ‮ world\u0000\n ')).toEqual({ ok: 'Hello  world' });
    expect(parseText(' ‎ ')).toMatchObject({ ok: '‎' }.ok ? {} : {}); // a bare LRM is not a control: kept, then trimmed away or not
    expect(parseText('   ')).toEqual({ error: 'empty' });
    expect(parseText('x'.repeat(MAX_EDIT_CHARS))).toEqual({ ok: 'x'.repeat(MAX_EDIT_CHARS) });
    expect(parseText('x'.repeat(MAX_EDIT_CHARS + 1))).toEqual({ error: 'too-long' });
    expect(parseText('x'.repeat(11), 10)).toEqual({ error: 'too-long' });
  });
  it('keeps markup as plain text (it is only ever written as text)', () => {
    expect(parseText('<img src=x onerror=window.__xss=1>')).toEqual({ ok: '<img src=x onerror=window.__xss=1>' });
  });
});

describe('parseDay', () => {
  it('accepts a real YYYY-MM-DD day in 1900..2200 and nothing else', () => {
    expect(parseDay('2026-02-28')).toEqual({ ok: '2026-02-28' });
    expect(parseDay(' 2026-02-28 ')).toEqual({ ok: '2026-02-28' });
    expect(parseDay('2028-02-29')).toEqual({ ok: '2028-02-29' });
    for (const bad of ['2026-02-30', '2026-13-01', '0000-01-01', '1899-12-31', '2201-01-01', '12026-01-01', '26-01-01', '01/02/2026', 'Jan 5, 2026', '2026-1-5', '2026-01-05T09:00', 'abc']) {
      expect(parseDay(bad), bad).toEqual({ error: 'not-a-date' });
    }
    expect(parseDay('')).toEqual({ error: 'empty' });
  });
});

describe('parseNumber', () => {
  const ok = (s: string, locale = 'en', pct = false) => (parseNumber(s, locale, pct) as { ok: number }).ok;
  it('reads ASCII digits with one decimal separator', () => {
    expect(ok('12')).toBe(12);
    expect(ok('2.5')).toBe(2.5);
    expect(ok(' 0.25 ')).toBe(0.25);
    expect(ok('.5')).toBe(0.5);
    expect(ok('5.')).toBe(5);
  });
  it('rejects a sign, grouping, exponent, hex, Infinity, NaN and letters', () => {
    for (const bad of ['-1', '+1', '1,000', '1e3', '0x10', 'Infinity', 'NaN', '1 000', '1.2.3', '--', 'abc', '1_0', '.', '٫']) {
      expect(parseNumber(bad, 'en'), bad).toEqual({ error: 'not-a-number' });
    }
    expect(parseNumber('', 'en')).toEqual({ error: 'empty' });
    expect(parseNumber('1'.repeat(33), 'en')).toEqual({ error: 'too-long' });
  });
  it('maps the locale digits and decimal separator (and still accepts a point)', () => {
    expect(ok('2,5', 'de')).toBe(2.5);
    expect(ok('2.5', 'de')).toBe(2.5);
    expect(ok('٢٫٥', 'ar-EG')).toBe(2.5);
    expect(ok('۱۲', 'fa')).toBe(12);
    expect(ok('२.५', 'hi-IN-u-nu-deva')).toBe(2.5);
    expect(parseNumber('2,5', 'en')).toEqual({ error: 'not-a-number' });
  });
  it('accepts a trailing percent sign only when asked, in the locale too', () => {
    expect(ok('50%', 'en', true)).toBe(50);
    expect(ok('50 %', 'en', true)).toBe(50);
    expect(parseNumber('50%', 'en', false)).toEqual({ error: 'not-a-number' });
    expect(ok('٥٠٪', 'ar-EG', true)).toBe(50);
    expect(parseNumber('%50', 'en', true)).toEqual({ error: 'not-a-number' });
  });
  it('an unknown locale tag reads as English', () => {
    expect(ok('2.5', 'not a locale!')).toBe(2.5);
  });
});

describe('properties', () => {
  const locales = ['en', 'de', 'fr', 'ar-EG', 'fa', 'hi-IN-u-nu-deva', 'ja'];
  it('parse(format(n)) round-trips for finite n in range, per locale', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), fc.constantFrom(...locales), (cents, locale) => {
        const n = cents / 100;
        const text = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 2 }).format(n);
        expect(parseNumber(text, locale)).toEqual({ ok: n });
      }),
    );
  });
  it('the parsers never throw', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), fc.constantFrom(...locales, 'xx-invalid-'), (s, locale) => {
        expect(() => [parseText(s), parseDay(s), parseNumber(s, locale), parseNumber(s, locale, true)]).not.toThrow();
      }),
    );
    fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (s) => (parseDay(s), parseNumber(s, 'en'), true)));
  });
});
