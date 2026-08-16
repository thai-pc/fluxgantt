---
"@fluxgantt/core": minor
---

Wire `Ctrl/Cmd+Z` (undo) and `Ctrl/Cmd+Shift+Z` (redo) into keyboard navigation. Both are gated
by `readOnly` (mirroring the existing `Delete`/`Backspace` gate) and call `preventDefault()` when
handled. No `Ctrl+Y` alternate binding. `gantt.undo()`/`gantt.redo()` themselves (shipped
separately) are unaffected — this only adds the keyboard trigger. `KeyboardNavOptions` gains two
new required callbacks, `onUndo`/`onRedo`, for hosts constructing `enableKeyboardNav` directly.
