---
'@fluxgantt/core': patch
---

Performance and security (DoS): `DependencyStore` keeps from/to pair indices. Loading dependencies is now
linear (`createGantt({ dependencies })` and `importJson`/`importCsv` staging use one bulk `linkAll`: a
self-link and duplicate check in one pass, then a single Kahn cycle check), where it used to be quadratic
(4x the edges cost 16x the work). `MAX_DEPENDENCY_COUNT` stays at 100,000, and importing a worst-case
100,000-edge / 50,000-task file now spends under half a second in the dependency store. `hasCycle()` is
iterative (a 100,000-edge chain no longer throws `RangeError`), and `of()`, `predecessors()`, `successors()`,
`unlink()` and `removeForTask()` no longer scan every dependency. Event and result order is unchanged.

Error text: for input that is invalid in more than one way, the error class is still `DependencyLinkError`
but the message can name a different edge than the old edge-by-edge loader did (a self-link or duplicate
anywhere in the list is reported before a cycle, and a cycle names the first edge on or downstream of it).
A constructor `dependencies` list that repeats the same `from`/`to` pair still throws, as before.
`DependencyStore.linkAll` is new and marked `@internal`. Costs about 0.2 KiB gzip.
