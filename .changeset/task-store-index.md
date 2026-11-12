---
'@fluxgantt/core': patch
---

Performance and stack safety: `TaskStore` keeps a parent to children index. `children()` is no longer a scan
of every task (global insertion order is preserved, so `task:removed` and history order are unchanged),
`collapseAll()` is no longer quadratic, and removing a task with descendants is iterative with a single
revision bump, so a very deep parent chain no longer overflows the stack. Costs about 0.2 KiB gzip.
