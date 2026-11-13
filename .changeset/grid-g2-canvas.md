---
'@fluxgantt/core': minor
---

Grid columns on the Canvas renderer: `withGrid()` now paints in Canvas mode (a project above 2000 tasks) instead of logging a warning and showing no grid.

Beta: `@fluxgantt/core/grid` (`@beta`) now paints on Canvas. On a Canvas mount the grid is painted on the pinned label canvas (the header band in its corner, the sub-column cells and the column dividers), cut with the same ellipsis estimate as the SVG grid, so a cell reads the same in both renderers and in every export. The painter is a separate lazy chunk (`grid/canvas-grid`, about 1.4 KiB gzip) fetched on the first Canvas mount; until it arrives the chart shows the plain label column. `collapseBelow`, `durationUnit`, `setGridColumns()` and RTL (the grid at the right edge, the column order and each cell's logical alignment mirrored) behave as on SVG. The "paints on the SVG renderer only" warning is removed.

Accessibility (Canvas): the hidden a11y layer now carries the treegrid structure of the SVG chart: `aria-colcount`, a `columnheader` row at `aria-rowindex` 1, real `gridcell`s with `aria-colindex` and `data-column-id`, and data rows at `aria-rowindex` = row + 2 (`aria-rowcount` includes the header). The name cell keeps no `aria-label`, so the bar's own accessible name (dates, progress, "critical path", "selected") is never replaced, even when the painted name is cut; the layer always holds the full text. Without `withGrid` the layer is unchanged.

Hit testing: the Canvas `hitTestRow` result reports `columnId` for a pointer in the pinned zone (the `name` column included), and never reports a toggle hit past the name column. A click on a cell selects the row exactly like a click on its label.

Exports: Canvas `exportPng()` paints the header, the cells and the dividers; Canvas `exportSvg()` (a throwaway SVG renderer) and `exportGridCsv()` include the grid, with no DOM requirement for the CSV.

Internal and unexported: `CanvasGridPainter` (the renderer's grid option) gains `colCount`, `nameText`, `appendHeader` and a `height` argument on `paintHeader`; `paintRows` and `paintRowLabels` take an optional painter. No package entry exports them.

Bundle cost (gzip): hello world +0 B, `+ withRender + withInteraction` +0 B, kitchen sink +0 B; `+ withRender + withGrid` +48 B (20603, a soft warning against its 20 KiB reference) and the everything gate +81 B (37355; its limit stays 40.25 KiB under the same formula). The Canvas renderer chunk grows by about 211 B gzip and a Canvas chart with the grid downloads about 1.5 KiB gzip more than one without.
