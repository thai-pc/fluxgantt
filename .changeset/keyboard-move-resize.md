---
'@fluxgantt/core': minor
---

Keyboard alternatives to dragging (WCAG 2.2 SC 2.5.7), all acting on the focused row and off under
`readOnly`: Alt+ArrowLeft/Right moves the task one calendar day, Alt+Shift+ArrowLeft/Right moves its
end one day (resize), and Shift+ArrowUp/Down to a target row then Alt+Enter links the range anchor to
the focused row. Left/right are logical under `withRtl`. Previously unbound keys; `preventDefault()` is
called on Alt+Arrow so the browser does not navigate Back. Adds optional `onShift` and `onLink` to
`KeyboardNavOptions`.

Results are announced through a polite live region created by `withInteraction` (moved, resized,
cannot move/resize, linked, link not created with a reason); reword them with the new
`messages.announce` (`GanttAnnouncement`, new kinds may be added). A keyboard resize steps past
weekends and holidays, measured against the painted span. A resize commit is skipped only when it would
write nothing (same resolved end and duration), and a drag-resize now restores its preview bar when
the commit is skipped. Windows note: Alt+Shift can switch keyboard layouts.
Holding a key auto-repeats and every step is its own undo entry, so the history limit applies.
