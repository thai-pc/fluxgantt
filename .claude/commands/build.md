---
description: Implement a feature/fix in @fluxgantt/core via the gantt-core-engineer subagent, following repo conventions with tests included.
argument-hint: <what to do, or an existing spec slug>
---
Use the **gantt-core-engineer** subagent to implement: $ARGUMENTS

If `.claude/work/spec-<slug>.md` already exists, read it as input.

Per `.claude/agents/gantt-core-engineer.md`: keep it headless-first (store/compute no DOM),
core doesn't import react/vue/svelte, Temporal for all date math, TypeScript strict + branded
IDs, tree-shakable within budget, tier-gate correctly (no Pro/Cloud code in core),
naming/file-layout per coding-conventions. Tight diff, correct layer. **Write tests**, run
`pnpm typecheck` + the relevant tests, report the real results.

Do not commit/tag/push — that's the user's step.
