// Cell editor input parsers (spec-grid-columns.md sections 10.1, 10.6, 10.7). Pure and DOM-free: a string the user
// typed or pasted in, a validated value or an `EditErrorReason` out. They never throw and never read the DOM.
//
// SECURITY (security.md): the input is untrusted. Length is checked BEFORE parsing; text loses controls and bidi
// overrides; numbers accept ASCII digits (after mapping the locale's own) with one decimal separator and nothing
// else (no sign, exponent, hex, `Infinity`, grouping); a date is `YYYY-MM-DD` and a real calendar day.
import { getTemporal } from '../internal/temporal.js';
import type { EditErrorReason } from '../types.js';
import { UNSAFE_TEXT } from '../grid/columns.js';

/** Longest edit string, in characters (numbers: `MAX_NUMBER_CHARS`). */
export const MAX_EDIT_CHARS = 1000;
const MAX_NUMBER_CHARS = 32;

export type Parsed<T> = { readonly ok: T } | { readonly error: EditErrorReason };

/** A name: trimmed, controls and bidi overrides removed, at most `max` characters. */
export function parseText(input: string, max = MAX_EDIT_CHARS): Parsed<string> {
  if (input.length > MAX_EDIT_CHARS) return { error: 'too-long' };
  const text = input.replace(UNSAFE_TEXT, '').trim();
  return !text ? { error: 'empty' } : text.length > max ? { error: 'too-long' } : { ok: text };
}

/** A `YYYY-MM-DD` calendar day in 1900..2200. */
export function parseDay(input: string): Parsed<string> {
  const text = input.trim();
  if (!text) return { error: 'empty' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || +text.slice(0, 4) < 1900 || +text.slice(0, 4) > 2200) return { error: 'not-a-date' };
  try {
    return { ok: getTemporal().PlainDate.from(text, { overflow: 'reject' }).toString() };
  } catch {
    return { error: 'not-a-date' };
  }
}

interface Syntax {
  readonly digits: ReadonlyMap<string, string>;
  readonly decimal: string;
  readonly percent: string;
}
const syntaxes = new Map<string, Syntax>();

/** The digits, decimal separator and percent sign `locale` writes (an unknown tag reads as English). */
function syntaxOf(locale: string): Syntax {
  let s = syntaxes.get(locale);
  if (!s) {
    let nf: Intl.NumberFormat;
    let pf: Intl.NumberFormat;
    try {
      nf = new Intl.NumberFormat(locale, { useGrouping: false });
      pf = new Intl.NumberFormat(locale, { style: 'percent' });
    } catch {
      nf = new Intl.NumberFormat('en', { useGrouping: false });
      pf = new Intl.NumberFormat('en', { style: 'percent' });
    }
    // 9876543210 written in the locale's digits: character n is the digit 9 - n.
    const written = Array.from(nf.format(9876543210));
    const digits = new Map<string, string>(written.map((c, i) => [c, String(9 - i)]));
    const part = (f: Intl.NumberFormat, type: string, n: number): string => f.formatToParts(n).find((p) => p.type === type)?.value ?? '';
    if (syntaxes.size > 64) syntaxes.clear();
    syntaxes.set(locale, (s = { digits, decimal: part(nf, 'decimal', 1.5) || '.', percent: part(pf, 'percentSign', 0.5) || '%' }));
  }
  return s;
}

/**
 * A non-negative decimal number in `locale`'s digits. Accepts the locale's decimal separator and `.`; a trailing
 * percent sign when `percent` is set. Everything else (a sign, grouping, an exponent, hex, letters) is
 * `not-a-number`; an empty field is `empty`.
 */
export function parseNumber(input: string, locale: string, percent = false): Parsed<number> {
  if (input.length > MAX_NUMBER_CHARS) return { error: 'too-long' };
  let text = input.trim();
  if (!text) return { error: 'empty' };
  const syn = syntaxOf(locale);
  if (percent) text = text.replace(new RegExp(`(?:%|${syn.percent.replace(/[^\w%]/g, '\\$&')})$`), '').trim();
  let ascii = '';
  for (const c of text) ascii += syn.digits.get(c) ?? (c === syn.decimal ? '.' : c);
  // At most one separator, with digits on at least one side of it; no other character.
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(ascii)) return { error: 'not-a-number' };
  const n = Number(ascii);
  return Number.isFinite(n) ? { ok: n } : { error: 'not-a-number' };
}
