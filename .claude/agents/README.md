# FluxGantt subagents

Project-scoped subagents for Claude Code. Each agent is a specialist with its own tools + a
system prompt preloaded with FluxGantt conventions (headless-first, framework-agnostic core,
Temporal, branded IDs, tree-shakable bundle budget, tier-gate Core/Pro/Cloud, security
checklist). Claude Code auto-discovers them from `.claude/agents/`.

| Agent | Role | Tools | Edits code? |
|---|---|---|---|
| **planner** | Decides *whether/what*: Core (MIT) vs Pro vs Cloud vs plugin vs don't-build, who pays, v1 scope. No API design. | Read/Grep/Glob/Write/Web | writes a plan doc |
| **spec-writer** | Turns an idea into a concrete design (API, type/branded-ID, layer, algorithm, a11y, security, test plan) that fits the grain — before coding. | Read/Grep/Glob/Write/Web | writes docs |
| **gantt-core-engineer** | Implements features/fixes in `@fluxgantt/core` following repo patterns. Also runs the post-review fix pass. | Read/Edit/Write/Bash/Grep/Glob | yes |
| **security-reviewer** | Security review (render XSS, untrusted parsing/XXE, AI prompt-injection, Cloud authZ). | Read/Grep/Glob/Bash | no (reports) |
| **test-engineer** | Writes + runs tests following repo patterns until the suite is green. Prioritizes the compute layer. | Read/Edit/Write/Bash/Grep/Glob | tests only |

## Suggested workflow for a non-trivial feature

```
planner → spec-writer → gantt-core-engineer → test-engineer → security-reviewer → gantt-core-engineer (fix) → (you) changeset + commit
```

1. **planner** decides whether to build, which tier (Core/Pro/Cloud/plugin), who pays, v1
   scope → `.claude/work/plan-<slug>.md`. Stop if it's don't-build or use-OSS.
2. **spec-writer** produces the design (API, types, layer, algorithm, a11y, security, test
   plan) → `.claude/work/spec-<slug>.md`.
3. **gantt-core-engineer** implements it (correct tier/layer, headless-first, tests included).
4. **test-engineer** writes + locks in tests, gets the relevant suite green (compute layer
   first).
5. **security-reviewer** does a read-only review if it touches external input
   (IO/render/AI/Cloud), writing numbered **Blocking**/non-blocking findings to
   `.claude/work/review-<slug>.md`.
6. **gantt-core-engineer** (fix pass) applies the Blocking findings + re-runs typecheck/test;
   reports by finding number.
7. You (main session) do the release step: **changeset before every public change**, then
   commit. Subagents **never** commit/tag/push.

Steps run **sequentially**, not in parallel: the reviewer needs a green suite to review
against, and the fix pass needs the reviewer's findings. Handoff artifacts live in
`.claude/work/` (gitignored) — each step hands off a file instead of re-deriving the diff.

## How to invoke

- **Slash commands** (`.claude/commands/`) — the quick way:
  | Command | Runs |
  |---|---|
  | `/plan <idea>` | planner → tier decision / build-embed-skip |
  | `/spec <idea>` | spec-writer → design doc |
  | `/build <task>` | gantt-core-engineer → implement |
  | `/test [what]` | test-engineer → write + run tests green |
  | `/review [what]` | security-reviewer → checklist review + findings file |
  | `/fix [findings]` | gantt-core-engineer → apply the Blocking findings |
  | `/feature <idea>` | the full plan → spec → build → test → review → fix pipeline |
- Explicitly: say "use the **security-reviewer** subagent to review the CSV importer change".
- Automatically: Claude Code may delegate based on each agent's `description`.

Each subagent starts fresh (no shared memory) and loads context by reading `CLAUDE.md`
+ the relevant rules in `.claude/rules/`. Keep those files up to date.

> The agents **deliberately don't** commit/tag/push. Release is the user's step in the main
> session (changeset → version → changelog automated).
