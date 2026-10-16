---
'@fluxgantt/core': patch
---

Fix overlapping timeline header labels: the header is now two tiers (month or year spans above, left-aligned at the span start; days or months below) with width-aware label selection in both the SVG and Canvas renderers and their exports. No label leaves the chart area or is clipped by the right edge, and the dense tiers use one uniform stride. The header font is pinned (inline `12px system-ui, sans-serif`, so a host `text { font-size }` rule cannot break the fit and exports match the live view; row labels still inherit the host font). `GridColumn.label` in week view is now the day number only (the weekday was dropped to fit 24px columns). The default `--fg-fg-muted` fallback (`#71717a` to `#6b6b73`) is darker so the header text meets WCAG AA contrast (4.8:1, was 4.39:1) on the light header background; hosts that set `--fg-fg-muted` themselves are unaffected.

Also fix a pre-existing Canvas paint-order bug: when the chart was scrolled vertically, task bars and label-column row text painted into the pinned header band and covered its labels. Row, dependency and focus-ring paints are now clipped to the row band below the header.
