---
"@fluxgantt/core": minor
---

Wire `Ctrl + mouse wheel` (zoom in/out) into the interaction layer. New module
`enableWheelZoom` attaches a single `wheel` listener to the mounted chart; a wheel event with
`ctrlKey` held calls `preventDefault()` and steps the view one level toward `'day'`
(`deltaY < 0`, scroll-up/pinch-out) or `'year'` (`deltaY > 0`, scroll-down/pinch-in) via the
already-shipped `gantt.zoomIn()`/`gantt.zoomOut()`. A plain wheel event (no Ctrl) is
completely untouched — normal page/container scrolling is unaffected. Not gated by `readOnly`
(zoom mutates no store state, same posture as the existing Ctrl/Cmd+Plus/Minus keyboard
binding). Deliberately does NOT also match `metaKey` (unlike the keyboard binding and
click-select's Ctrl/Cmd pattern) — see spec-wheel-zoom.md §1 for the trackpad-pinch-vs-physical-
gesture rationale. Registered with `{ passive: false }`, required for `preventDefault()` to
actually suppress the browser's native Ctrl+wheel page-zoom (and macOS trackpad pinch-zoom,
which the browser delivers as a synthetic Ctrl+wheel event).
