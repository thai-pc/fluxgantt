---
'@fluxgantt/core': minor
---

Keyboard navigation: Home / End jump to the first / last row, PageUp / PageDown move a page of rows,
and `g` scrolls the focused row's bar into view horizontally (requires `withViewport`; honors the
pinned label column, RTL, milestones and reduced motion). ArrowUp / ArrowDown intentionally keep
scrolling vertically only, so scrubbing rows never moves the timeline sideways. Adds an optional
`onReveal` to `KeyboardNavOptions`; return `true` from it to mark the key handled (the key is then
`preventDefault()`ed).
