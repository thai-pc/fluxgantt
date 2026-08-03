// IO layer error type (spec-io-json-csv.md §7, security.md §2).
// Every rejection from `importJson`/`importCsv` — schema, type, limit, hierarchy-depth — is
// this single error type, so a caller only ever needs to catch one error class from this
// module. A `JSON.parse` `SyntaxError` is caught and re-wrapped as an `IoValidationError` too
// (see json.ts `parseIfString`). Dependency-cycle errors thrown later by
// `DependencyStore.link()`/`createGantt()` are explicitly NOT `IoValidationError` — they occur
// outside this module (see spec §5.5): `instanceof IoValidationError` means "this module
// rejected the raw input," not "any error anywhere in the import pipeline."
export class IoValidationError extends Error {
  /**
   * JSON-Path-ish pointer to the offending value, e.g. `"$.tasks[3].name"` or
   * `"$.rows[7].progress"`. Always present (never an empty string) so a caller/test can
   * assert on WHERE validation failed, not just that it failed.
   */
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} (at ${path})`);
    this.name = 'IoValidationError';
    this.path = path;
  }
}

/**
 * Truncate an untrusted value before echoing it into an error message (security review B2).
 * A malformed input could otherwise carry a multi-megabyte string all the way into
 * `err.message`, bloating logs / spiking memory for any caller that logs the error. Keeps a
 * short, useful prefix + an elision marker.
 */
export function truncateForError(value: string, max = 120): string {
  return value.length <= max ? value : `${value.slice(0, max)}… (${value.length} chars)`;
}
