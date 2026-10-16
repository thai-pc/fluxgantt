---
'@fluxgantt/core': minor
---

Exports now carry the chart's ground. `exportSvg()` adds a full-size background `<rect>` (first rendered element, after `<title>`) to the exported copy, and `exportPng()` fills with the same color. The default is the chart's resolved `--fg-bg` custom property (`#0a0a0a` under `withTheme` dark), falling back to `#ffffff`, so a dark chart no longer exports as pale text on white or on a transparent page. `ExportSvgOptions` gains `background` (a hex/`rgb()`/`hsl()` color, a plain keyword, or `'transparent'`); an invalid value throws. Behavior change: `exportSvg()` was previously transparent, so hosts compositing the SVG over their own background should pass `background: 'transparent'`. Light charts with no `--fg-bg` export `#ffffff` PNGs exactly as before. Also trims a few diagnostic message tails (CSV unknown column, date length, JSON `schemaVersion`, PNG size/scale errors) to keep the bundle budget.
