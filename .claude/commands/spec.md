---
description: Turn an idea (already through the planner) into a concrete design/spec via the spec-writer subagent — public API, types, layer, algorithm, a11y, test plan, security.
argument-hint: <idea or an existing plan slug>
---
Use the **spec-writer** subagent to design: $ARGUMENTS

If `.claude/work/plan-<slug>.md` already exists, read it as input.

Per `.claude/agents/spec-writer.md`: define the public API (verb+noun methods, past-tense
events), types + branded IDs, where the code lives (confirm headless-first + core doesn't
import a framework), tier (Core/Pro/Cloud/plugin), algorithm + edge cases
(cycle/constraint/non-working-day/lag±/DST), Temporal for dates, a11y if it renders, security
if it takes external input, and a test plan for test-engineer.

Write the spec to `.claude/work/spec-<slug>.md`. If there is a big open question, ask before
finalizing. Docs only — do not implement.
