---
'@fluxgantt/core': patch
---

Security: the default import cap on dependencies (`MAX_DEPENDENCY_COUNT`, `DEFAULT_IMPORT_LIMITS.maxDependencyCount`) drops from 100,000 to 2,500. Loading dependencies is quadratic in their number (each `link()` rescans every existing dependency, rebuilds the adjacency map and runs a cycle search), so a crafted file inside the old limit could hang a tab or worker for minutes. 2,500 is the largest count whose worst-case shape (a reversed chain) loads in under about one second.

- `importJson()` / `gantt.importJson()` now reject a `dependencies` array longer than 2,500 with an `IoValidationError` at `$.dependencies`. `importCsv()` is unaffected (CSV carries no dependencies).
- If you import trusted data with more dependencies, pass `{ limits: { maxDependencyCount: N } }`; load time grows quadratically with N.
- The `createGantt({ dependencies })` constructor path is host-supplied data and still has no count limit; it has the same quadratic cost.
- The limit will be restored once dependency loading is made linear.
