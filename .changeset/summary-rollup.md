---
"@fluxgantt/core": minor
---

feat(core): summary auto-rollup

Add `computeRollup(tasks, calendar?)` to the compute layer: a pure, headless function that
derives each parent's span, progress and working-hour duration from its children, returning a
`ReadonlyMap<TaskId, RollupResult>` keyed only by tasks that actually have children. It never
mutates the input — a caller decides whether to apply the rolled-up values, so a host that
wants author-controlled summary dates keeps them.

Rollup is bottom-up and recursive: a parent whose own children are parents aggregates their
already-rolled-up values, not their authored fields. Authored `start`/`end`/`progress` on a
task that has children are ignored by design; a summary bar that disagrees with its subtree is
a data-entry bug, not a value to preserve. Leaves contribute their own normalized fields plus
`resolveDuration`.

Progress is **duration-weighted** (`sum(d_i * p_i) / sum(d_i)`), so an 80h task at 100% and a
20h task at 0% rolls up to 0.8 rather than 0.5. When every child has zero duration (all
milestones, `sum(d_i) == 0`) it falls back to the plain mean, which keeps all-milestone
parents meaningful instead of dividing by zero. The result is clamped to 0..1 with `NaN`
mapped to 0, so hostile child values (`NaN`, `+/-Infinity`, negative, > 1) can never produce a
non-finite or out-of-range summary.

Min/max of the child instants use `compareInstant`, never the sign of
`differenceInWorkingHours`: two instants less than an hour apart, or both inside non-working
time, are genuinely different yet that difference is exactly 0. Using it to order instants
would silently pick the wrong bound.

Cyclic and over-deep parent chains are rejected rather than looped over: the walk is bounded
by a shared `MAX_HIERARCHY_DEPTH` (1000) and a `visiting` guard, and a final coverage pass
visits tasks unreachable from any root, so a pure cycle (including a self-parent) still
throws. The throw is a plain `Error`, matching `layoutRows` — `CyclicDependencyError` stays
reserved for dependency-graph cycles. `MAX_HIERARCHY_DEPTH` moved to a new shared
`compute/hierarchy.ts` because both `layoutRows` (render) and `computeRollup` (compute) need
it and the compute layer may not import from `render/`; `renderer-base.ts` re-exports it, so
every existing import path keeps working. It is distinct from `io/limits.ts`'s depth of 100,
which bounds what an untrusted imported file may declare.

`computeRollup` is exported from the barrel but referenced by nothing in the facade, so
tree-shaking drops it from every size fixture: all five budgets are unchanged and still pass
(hello-world 7.76 / with-io 12.73 / with-render 14.28 / with-render-interaction 18.55 /
kitchen-sink 23.21 KiB).

Renderer integration, a facade method, and CPM summary-row handling are deliberately out of
scope for this change.
