// Shared parent/child-hierarchy walk guards. Lives in `compute/` rather than `render/` because
// BOTH layers walk the same `Task.parent` graph and must agree on the bound: `layoutRows`
// (render) and `computeRollup` (compute). The compute layer may not import from `render/`
// (architecture.md principle 1 — headless first), so the constant's home has to be here;
// `renderer-base.ts` re-exports it so its existing public import path keeps working.
//
// Distinct from `io/limits.ts`'s own `MAX_HIERARCHY_DEPTH` (100), which bounds what an
// UNTRUSTED imported file may declare — a much tighter, security-driven limit on parse input.
// This one bounds an in-memory walk the host already owns.

/**
 * Max hierarchy nesting depth (review N1). A `visiting` set already rejects genuine cycles,
 * but a very deep *acyclic* parent chain (e.g. 50k tasks each parenting the next, from
 * untrusted host data) would recurse deep enough to blow the call stack with an opaque
 * `RangeError` instead of a controlled, explainable throw. 1,000 levels is far beyond any
 * real project WBS.
 */
export const MAX_HIERARCHY_DEPTH = 1_000;
