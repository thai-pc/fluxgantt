---
"@fluxgantt/core": minor
---

Add undo/redo: `gantt.undo()`, `gantt.redo()`, `gantt.canUndo()`, `gantt.canRedo()`, and a
`history:changed` event. A single drag that cascades dependent tasks, or a single multi-selection
Delete, undoes/redoes as ONE step. New `GanttConfig.historyLimit` (default 100, ring-buffer
eviction). `task:*`/`dependency:*` event payloads gain an additive, optional trailing `meta`
argument (`{ source: 'undo' | 'redo' }`) so subscribers can distinguish a replayed mutation from a
normal one — existing subscribers are unaffected. Actual `Ctrl+Z`/`Shift+Z` keyboard binding is a
separate follow-up (the facade methods are usable programmatically today).
