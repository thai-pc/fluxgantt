---
"@fluxgantt/core": minor
---

feat(core): duplicateTask()

Add `duplicateTask(taskId?)` on `GanttInstance`. With an explicit `taskId`, duplicates exactly
that task (throws via the existing `#requireTask` if it doesn't resolve). With no argument,
duplicates the current selection in its insertion order; an empty selection is a safe no-op
that returns `[]`.

Built entirely on top of the existing `addTask()` — one call per copy, reusing its id
generation, `createdAt`/`updatedAt` stamping, `task:added` emission, and undo-stack recording
in full. A multi-select duplicate wraps its N `addTask()` calls in a single
`#beginTransaction()`/`#endTransaction()` (mirroring `#commitDeleteSelected()`'s existing
pattern), so the whole batch undoes/redoes as ONE history entry.

Per-copy field handling: `id`/`createdAt`/`updatedAt` are always fresh (via `addTask`);
`start`/`end` are offset to begin immediately after the source task ends, preserving the
source's own working-hours span via the already-imported `addWorkingHours`/
`differenceInWorkingHours`/`normalizeDate` helpers (each copy in a multi-select is offset from
its OWN source, not a shared anchor); `progress` always resets to `0`; every other field
(`name`, `priority`, `parent`, `type`, `constraint`, `resources`, `notes`, `color`, `meta`,
`duration`) is copied verbatim via a shallow spread, matching `TaskStore.add()`'s own existing
shallow-copy convention — no `"(copy)"` name suffix, no deep-clone. The copy starts with zero
dependency edges; `duplicateTask` never touches `DependencyStore`.

No new event — reuses `task:added`, fired once per copy. Not gated by `readOnly` (matches
every other programmatic mutation method); throws after `destroy()`. Keyboard (Cmd/Ctrl+D)
wiring is a separate follow-up ticket, not included here.
