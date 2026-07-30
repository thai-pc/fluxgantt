---
description: Run the full plan → spec → build → test → review → fix pipeline for a feature idea, using the FluxGantt subagents.
argument-hint: <feature idea>
---
Take a FluxGantt feature end-to-end for: $ARGUMENTS

Run the subagents in sequence, each using the previous step's output (artifacts in
`.claude/work/`):

1. **planner** — decide *whether & what*: Core (MIT) vs Pro vs Cloud vs plugin vs don't-build,
   who pays, v1 scope + out-of-scope. Write `.claude/work/plan-<slug>.md`. **Stop and show me
   the decision.** If it's don't-build or use-OSS, stop there — do not proceed to spec.
2. **spec-writer** — turn the approved plan into a design (public API, types + branded IDs,
   layer, algorithm + edge cases, Temporal, a11y, security, test plan) that fits the grain.
   Write `.claude/work/spec-<slug>.md`. Show me the spec; if there's a big open question, ask
   first.
3. **gantt-core-engineer** — implement the spec (correct tier/layer, headless-first, core
   doesn't import a framework, tests included). Tight diff; `pnpm typecheck` + relevant tests.
4. **test-engineer** — write + run tests until the relevant suite is green (prioritize the
   compute layer, fast-check + edge cases).
5. **security-reviewer** — if the change touches external input (IO/render/AI/Cloud), review
   per the checklist and write numbered findings to `.claude/work/review-<slug>.md`.
6. **gantt-core-engineer** (fix pass) — fix every **Blocking** finding + the cheap-and-correct
   non-blocking ones; re-run typecheck + relevant tests. Report by finding number. If a
   behavior change was needed, send it back through **security-reviewer** once more.

Then summarize for me: the tier decision, what shipped, test results, which findings are
unfixed and why. **Do NOT commit/tag/push** — I handle the release step (changeset before
every public change).
