// Import size/depth/count limits (spec-io-json-csv.md §5.1, security.md §2 "Limits: task
// count, hierarchy depth, string length -> avoid DoS via a malicious file"). All caps are
// overridable (tightened, not just loosened is the common case) via `options.limits` on
// `importJson`/`importCsv` — merged shallowly over `DEFAULT_IMPORT_LIMITS`.
import type { ImportLimits } from './types.js';

export const MAX_TASK_COUNT = 50_000;
export const MAX_DEPENDENCY_COUNT = 100_000;
export const MAX_ID_LENGTH = 256;
export const MAX_NAME_LENGTH = 500;
export const MAX_STRING_LENGTH = 10_000;
export const MAX_META_KEYS = 100;
export const MAX_META_DEPTH = 5;
export const MAX_HIERARCHY_DEPTH = 100;
/** Cap on a single date-string field (`start`/`end`/`constraint.date`/`createdAt`/`updatedAt`)
 *  before it reaches Temporal's parser (security review B2). ISO-8601 with offset + IANA zone
 *  is comfortably under this; the point is to bound per-field parse work + error echo, since
 *  date fields otherwise had only the blanket `maxInputLengthChars` gate. Not per-import
 *  configurable (unlike name/id length) — ISO date length is fixed by the format. */
export const MAX_DATE_STRING_LENGTH = 64;
/** Pre-parse gate on the raw string form of `input`/`csv`, checked via `.length` (UTF-16
 *  code units) before `JSON.parse`/CSV tokenizing — a cheap proxy for byte size, not an
 *  exact `TextEncoder` byte count (see spec §5.1 for the accepted slack). Only applies when
 *  the input is a string; an already-parsed object skips this specific check. */
export const MAX_INPUT_LENGTH_CHARS = 20_000_000;

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxTaskCount: MAX_TASK_COUNT,
  maxDependencyCount: MAX_DEPENDENCY_COUNT,
  maxIdLength: MAX_ID_LENGTH,
  maxNameLength: MAX_NAME_LENGTH,
  maxStringLength: MAX_STRING_LENGTH,
  maxMetaKeys: MAX_META_KEYS,
  maxMetaDepth: MAX_META_DEPTH,
  maxHierarchyDepth: MAX_HIERARCHY_DEPTH,
  maxInputLengthChars: MAX_INPUT_LENGTH_CHARS,
};
