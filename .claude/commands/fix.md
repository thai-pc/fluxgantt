---
description: Apply the findings from a review via the gantt-core-engineer subagent, then re-run typecheck + the relevant tests.
argument-hint: [findings or slug; empty = latest review-*.md in .claude/work/]
---
Use the **gantt-core-engineer** subagent to fix the findings: $ARGUMENTS

If $ARGUMENTS is empty, read the latest `.claude/work/review-<slug>.md` as the findings list.

Apply every **Blocking** finding, plus the cheap-and-correct non-blocking ones. Follow the
FluxGantt grain (headless-first, core doesn't import a framework, Temporal, branded IDs,
tree-shakable, tier-gate). Re-run `pnpm typecheck` + the relevant tests until green. **Report
by finding number** (fixed / skipped + why). If a behavior change was needed to fix something,
say so, so it can go back through the security-reviewer.

Do not commit/tag/push.
