// Shared date serialization/parsing helpers (spec-io-json-csv.md §4) — used by both json.ts
// and csv.ts so there is exactly one implementation of the export/import date rules to audit.
import { normalizeDate } from '../compute/working-calendar.js';
import { getTemporal } from '../internal/temporal.js';
import type { DateInput } from '../types.js';
import { IoValidationError, truncateForError } from './errors.js';
import { MAX_DATE_STRING_LENGTH } from './limits.js';

/**
 * Export: every `DateInput` field (`Task.start`/`end`, `TaskConstraint.date`) serializes to
 * an ISO-8601 UTC instant string with a literal `Z` suffix, e.g. `"2026-01-15T17:00:00Z"`.
 * `timezone` only matters for disambiguating a bare wall-clock input (a string with no
 * offset/`Z`, or a `Temporal.PlainDate`) — see spec §4.1.
 */
export function dateInputToIso(input: DateInput, timezone: string): string {
  return normalizeDate(input, timezone).toInstant().toString();
}

/**
 * Export: `createdAt`/`updatedAt` are native `Date` (store-stamped, not `DateInput`).
 * Serialized to the SAME ISO-`Z`-instant style as `dateInputToIso` (not
 * `Date.prototype.toISOString()`, which always emits exactly 3 fractional digits — a
 * visibly different style, see spec §4.2). The native `Date` is touched only via this single
 * `.getTime()` read, immediately handed to Temporal (golden rule #3: native `Date` only at
 * the serialize boundary).
 */
export function dateToIso(date: Date): string {
  return getTemporal().Instant.fromEpochMilliseconds(date.getTime()).toString();
}

/**
 * Import: validates that `raw` can be parsed as a `DateInput` (throws `IoValidationError`
 * otherwise) and returns it verbatim as a string — no eager Temporal conversion, matching
 * `DateInput`'s own `string` acceptance. JSON/CSV values are always strings; a non-string
 * `raw` is rejected here too (a JSON producer could still hand a number/bool by mistake).
 */
export function assertParsableDateInput(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new IoValidationError('expected a non-empty date string', path);
  }
  // Bound per-field parse work + error echo (security review B2) — a date string can only
  // legitimately be a short ISO-8601 value; anything longer is rejected before it reaches
  // Temporal's parser (which otherwise had only the blanket maxInputLengthChars gate).
  if (raw.length > MAX_DATE_STRING_LENGTH) {
    throw new IoValidationError(
      `date string exceeds max length ${MAX_DATE_STRING_LENGTH} (got ${raw.length})`,
      path,
    );
  }
  try {
    normalizeDate(raw, 'UTC');
  } catch {
    throw new IoValidationError(`unparseable date "${truncateForError(raw)}"`, path);
  }
  return raw;
}
