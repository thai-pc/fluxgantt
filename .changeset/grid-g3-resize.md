---
'@fluxgantt/core': minor
---

Grid column resize, for both the SVG and the Canvas renderer.

Beta: `GridCapability.resizeGridColumn(id, width)` sets one column's width (rounded, clamped to its `[minWidth, maxWidth]`) with one repaint and one `column:resized` event, and returns whether anything changed. It works headless, is not gated by `readOnly` (widths are view state) and returns false for an unknown id, a non-finite width, an unchanged width, or when `GridOptions.resizable` is false. Beta: `GridOptions.resizable` (default true); `false` freezes the widths: no drag handles, no keyboard resize, headers take no focus. Beta: the `column:resized` event and its `ColumnResizedPayload` (`{ columnId, width, widths }`, `widths` maps every configured column to its px width). The library never persists widths: save them from the event and pass them back as `width` in `columns`. Beta: `GanttAnnouncement` gains the `'column-resized'` kind (`columnId`, `header`, `width`, `locale`); a host `messages.announce` switch should keep a `default` branch.

Pointer: drag the divider at the end of a column header (an 8 px hot zone, 16 px on a coarse pointer); a guide line follows the pointer, the width commits once on release, Escape cancels, and the gesture never reaches selection, drag or edit hooks. The drag grows "toward the chart", so it flips under RTL. On Canvas the drag starts from the header band of the pinned label canvas.

Keyboard (WCAG 2.5.7, a single-pointer path without dragging): the column headers are now one roving Tab stop (a new Tab stop before the rows when the grid is composed with `resizable` on); Left/Right/Home/End move between headers (logical under RTL), and Alt+Left/Right resizes the focused column by 16 px (Alt+Shift 2 px; "toward the chart grows", so Alt+Left under RTL). The focused header gets a 2 px frame in both renderers and the new width is announced through the polite live region when `withInteraction` is composed (silent otherwise). Alt+Arrow on a task row still moves and resizes the task. Full cell navigation is a later PR.

Canvas renderer (lazy chunk): a focused column header now survives the hidden accessibility layer's rebuild instead of handing focus to the row, and `CanvasGridPainter.paintHeader` (internal) draws its frame.

Bundle cost (gzip): hello world +0 B, `+ withRender + withInteraction` +0 B, kitchen sink +0 B; `+ withRender + withGrid` +1950 B (soft) and the everything gate +1792 B, re-based from 40.25 to 42.25 KiB under the build-out window recorded in CLAUDE.md.
