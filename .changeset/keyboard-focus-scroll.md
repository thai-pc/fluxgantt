---
'@fluxgantt/core': patch
---

Arrow-key navigation now scrolls the SVG chart so the focused row stays visible below the pinned header (also in Firefox, without relying on `scroll-padding`). ArrowUp/ArrowDown and Shift+Arrow move `scrollTop` by the minimum needed and never touch `scrollLeft`; pointer focus still does not scroll.
