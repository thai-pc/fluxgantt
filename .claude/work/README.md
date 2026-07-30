# .claude/work — subagent handoff artifacts

Working directory (gitignored) for the subagent pipeline. Each step writes a file for the
next step to read, instead of re-deriving the diff from scratch:

- `plan-<slug>.md` — planner: tier decision + v1 scope.
- `spec-<slug>.md` — spec-writer: design (API, types, layer, algorithm, test plan).
- `review-<slug>.md` — security-reviewer: numbered Blocking/non-blocking findings for `/fix`.

Contents here are **not committed** (only this README is tracked). See
`.claude/agents/README.md` for the full workflow.
