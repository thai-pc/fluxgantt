---
description: Write + run tests for a change via the test-engineer subagent until the suite is green — prioritizing the compute layer (critical path, leveling, calendar).
argument-hint: [what to test, e.g. "critical path negative lag", or empty = current change]
---
Use the **test-engineer** subagent to test: $ARGUMENTS

If $ARGUMENTS is empty, test the uncommitted change (`git status` / `git diff`).

Per `.claude/agents/test-engineer.md`: prioritize the **compute layer** (CPM cross-checked
against MS Project reference, fast-check invariants, edge cases
cycle/constraint/non-working-day/lag±/DST), then state (correct deltas, no extra emits,
undo/redo), IO round-trip, render visual, e2e interaction, a11y WCAG 2.1 AA. Tests run
headless, fake timers, multiple timezones + DST. Put tests in the right place, `*.test.ts`
kebab-case.

**Run the tests for real** (`pnpm -r test` or scoped to the package) and report honestly — if
they fail, paste the output; never claim "passed" without running.
