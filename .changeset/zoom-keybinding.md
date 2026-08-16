---
"@fluxgantt/core": minor
---

Wire `Ctrl/Cmd + Plus` (zoom in) and `Ctrl/Cmd + Minus` (zoom out) into keyboard navigation.
Matches `event.key === '+' || event.key === '='` for zoom-in (covers the common unshifted
`Ctrl+=` keystroke, the literal Shift+`=` press, and Numpad `+`) and `event.key === '-'` for
zoom-out (covers the unshifted main-row key and Numpad `-`); `Shift` state is not otherwise
consulted. Unlike Delete/undo/redo, neither binding is gated by `readOnly` — zoom mutates no
store state. Both call `preventDefault()` to suppress the browser's native page-zoom shortcut.
`gantt.zoomIn()`/`gantt.zoomOut()` themselves (shipped separately, PR #25) are unaffected — this
only adds the keyboard trigger. `KeyboardNavOptions` gains two new required callbacks,
`onZoomIn`/`onZoomOut`, for hosts constructing `enableKeyboardNav` directly.
