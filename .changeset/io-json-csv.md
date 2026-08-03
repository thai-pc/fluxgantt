---
"@fluxgantt/core": minor
---

feat(core): JSON + CSV import/export (IO layer)

Add a headless, tree-shakable `io/` module for persisting/loading Gantt data:

- `exportJson(tasks, dependencies, options?)` → a `{ fluxgantt: { schemaVersion, exported_at },
  tasks, dependencies }` bundle (full JSON round-trip of logical fields); `importJson(input)`
  validates it against a hand-written schema and returns `{ tasks, dependencies }` to feed
  `createGantt(...)`.
- `exportCsv(tasks, options?)` / `importCsv(csv)` — a flat, spreadsheet-friendly tasks CSV
  (RFC-4180). `gantt.exportJson()` / `gantt.exportCsv()` facade methods delegate over the live
  instance.

Security-hardened per `.claude/rules/security.md` §2: always-on CSV formula-injection escaping
on export (cells starting `= + - @` / tab / CR); CSV import takes values literally (never
re-materializes a live formula, and never corrupts a third-party CSV); schema validation is
reject-not-best-effort and atomic; import DoS limits (task/dependency count, string/date length,
meta key-count + depth at every level, hierarchy depth, a pre-parse input-size gate); untrusted
values are truncated in error messages. Dates serialize as ISO-8601 UTC instants via Temporal;
duplicate-id and dependency-cycle detection are delegated to the store on `createGantt`.

`importJson` validates but drops store-generated fields (`createdAt`/`updatedAt`, dependency
`id`) — they're regenerated on re-import, so the round-trip guarantee is over logical fields.
Not included (separate tickets/tiers): PNG/SVG/PDF export, MS Project XML I/O.
