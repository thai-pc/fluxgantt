---
'@fluxgantt/core': minor
---

Grid column resize, for both the SVG and the Canvas renderer.

Beta: `GridCapability.resizeGridColumn(id, width)` sets one column's width (rounded, clamped to its `[minWidth, maxWidth]`) with one repaint and one `column:resized` event, and returns whether anything changed. It works headless, is not gated by `readOnly` (widths are view state) and returns false for an unknown id, a non-finite width, an unchanged width, or when `GridOptions.resizable` is false. Beta: `GridOptions.resizable` (default true); `false` freezes the widths: no drag handles and no header keyboard mode. A column whose `minWidth` equals its `maxWidth` has no handle. Beta: the `column:resized` event and its `ColumnResizedPayload` (`{ columnId, width, widths }`, `widths` maps every configured column to its px width). The library never persists widths: save them from the event and pass them back as `width` in `columns`. Beta: `GanttAnnouncement` gains the `'column-resized'` kind (`columnId`, `header`, `width`, `locale`); a host `messages.announce` switch should keep a `default` branch.

Pointer: drag the divider at the end of a column header (an 8 px hot zone, 16 px on a coarse pointer); a guide line follows the pointer, the width commits once on release, Escape cancels, a repaint during the drag does not disturb it, and the gesture never reaches selection, drag or edit hooks. The drag grows "toward the chart", so it flips under RTL. On Canvas the drag starts from the header band of the pinned label canvas, and the resize cursor shows with `withInteraction` composed.

Keyboard (WCAG 2.1.1): the chart stays ONE Tab stop (the active row, as before). ArrowUp on the first row enters the column headers (the start of the grid's header mode); Left/Right/Home/End move between them (logical under RTL), Alt+Left/Right resizes the focused column by 16 px (Alt+Shift 2 px; "toward the chart grows", so Alt+Left under RTL), and ArrowDown or Escape returns to the rows. The focused header gets a 2 px frame in both renderers, keeps focus across a repaint, and the new width is announced through the polite live region when `withInteraction` is composed (silent otherwise). Alt+Arrow on a task row still moves and resizes the task. Full cell navigation is a later PR. WCAG 2.2 SC 2.5.7 asks for a single-pointer alternative to dragging: the keyboard path does not provide one, so a host that needs it wires its own control (a column menu with "wider" and "narrower") to `resizeGridColumn()`.

Known limits: the sum of the widths is not bounded by the container (a grid can be widened over the timeline; drag or Alt+Left back), and the drag's guide line is `position: fixed`, so inside a host ancestor with `transform`, `filter` or `contain: paint` it is drawn offset (the committed width is unaffected).

Canvas renderer (lazy chunk): a focused column header now survives the hidden accessibility layer's rebuild instead of handing focus to the row, and `CanvasGridPainter.paintHeader` (internal) draws its frame.

Docs wording: the keyboard move/resize of tasks (#126) is WCAG 2.1.1 Keyboard, not a 2.5.7 single-pointer alternative; comments and the README now say so.

Bundle cost (gzip): hello world +0 B, `+ withRender + withInteraction` +0 B, kitchen sink +0 B; `+ withRender + withGrid` +1372 B (soft) and the everything gate +1234 B, re-based from 40.25 to 41.5 KiB under the build-out window recorded in CLAUDE.md. The drag, the header key actions and the focus frame are a lazy chunk (`grid/resize-ui`, 1664 B gzip) fetched on first use.
