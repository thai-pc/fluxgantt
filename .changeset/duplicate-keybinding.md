---
"@fluxgantt/core": minor
---

Wire `Ctrl/Cmd + D` (duplicate selected task(s)) into keyboard navigation. Matches
`event.key === 'd' || event.key === 'D'` with `Shift` state irrelevant (no paired opposite action
shares this key, unlike undo/redo's `z`/`Z`). Gated by `readOnly` (mirroring the existing
`Delete`/`Backspace`/undo/redo gate) — `duplicateTask()` mutates the task store. Calls
`preventDefault()` to suppress the browser's native "bookmark this page" shortcut; note some
browsers (notably Firefox) do not honor `preventDefault()` for this specific reserved shortcut, a
known cross-browser limitation. Unlike calling `gantt.duplicateTask()` directly (which leaves
selection on the original task(s), unchanged), the keyboard gesture re-selects the newly created
copies so they're immediately actionable (drag/reposition) without an extra click.
`gantt.duplicateTask()` itself (shipped separately, PR #26) is unaffected — this only adds the
keyboard trigger and, in the keyboard path specifically, the post-duplicate re-selection.
`KeyboardNavOptions` gains one new required callback, `onDuplicateSelected`, for hosts constructing
`enableKeyboardNav` directly.
