---
'@fluxgantt/core': patch
---

Fix keyboard navigation desyncing from pointer selection. Clicking (or Ctrl+clicking) a bar now moves the roving-tabindex row to that task, so ArrowUp/ArrowDown/Enter/Space continue from the row you clicked instead of from wherever the last key press left off. Before, after a click the next arrow key could appear to do nothing (the internal focus moved but the selection, and so the repaint, did not change).

The roving row now also follows DOM focus itself: a programmatic `row.focus()` (for example a host returning focus to a row after closing its context menu) and a right-click on a row both update it, so Enter on that row no longer acts on a stale row (a summary collapsing instead of the focused leaf activating).
