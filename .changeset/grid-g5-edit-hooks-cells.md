---
'@fluxgantt/core': minor
---

`withEditHooks` reports grid cells when `withGrid` is composed. Without the grid nothing changes: the payloads, the part names and the bundle of every non-grid composition are as before.

Beta: a double-click, a context menu (right click, the ContextMenu key, Shift+F10, a touch long-press) and F2 / Enter on a grid cell now emit `task:activated` / `task:context-requested` with `part: 'cell'` and `columnId` (the id of the column; custom columns too). This is SVG and Canvas, LTR and RTL. A pointer gesture anywhere in a pinned cell counts, not only on its text (SVG resolves the blank part of a cell by its position against the column widths; Canvas already did). The `name` column keeps its part: a pointer gesture there is `'label'` (or `'row'` on a blank part of the label column that has no text) and carries no `columnId`, and a keyboard gesture from the `name` cell is `'row'`, as before. The keyboard gesture from a focused cell reports that cell (a column header is not a task gesture and reports nothing). The anchor of a keyboard gesture is still the centre of the focused row. `part: 'cell'` and `columnId` were already in the `@beta` types; the `TaskHitPart` and payload doc comments no longer call them reserved.

Enter on a parent row still toggles it (it is handled before the hooks, as without a grid). When the editing PR lands, Enter and F2 on an editable cell go to its `cell:edit-requested` first; `task:activated` keeps firing for pointer gestures.

`collapseBelow` (a name-only grid in a narrow container) was already complete in the grid PRs; with it, a collapsed grid reports no cells.

Bundle cost (gzip): hello world +0 B, `+ withRender + withInteraction` +0 B, kitchen sink +0 B, `+ withRender + withEditHooks` +98 B (soft), `+ withRender + withGrid` +117 B (soft), the everything gate +215 B (38795 -> 39010), inside the 41.5 KiB limit, which is therefore not raised.
