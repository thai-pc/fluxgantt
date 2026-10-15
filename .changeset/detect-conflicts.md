---
'@fluxgantt/core': minor
---

Add schedule conflict detection. The pure `detectConflicts(tasks, dependencies, calendar, options?)`
function is exported from the main entry, and the opt-in `withConflicts()` mixin on the new
`@fluxgantt/core/conflicts` subpath adds `detectConflicts()` and the `conflict:detected` event to an
instance. Three conflict kinds are reported: `dependency-violation` (per violated dependency, same
rule as the auto-scheduling cascade), `outside-parent` and `invalid-span`. `conflict:detected` runs a
watcher only while a listener is subscribed, is microtask-coalesced, fires only when the set changes
(`[]` when it clears) and does not fire on subscribe. New `Conflict` and `ConflictKind` types.
Purely additive: existing bundle sizes are unchanged.
