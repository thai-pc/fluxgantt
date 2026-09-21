---
'@fluxgantt/core': minor
---

feat(core): announce hierarchy depth with `aria-level` on treegrid rows

Rows in a hierarchical chart now carry `aria-level`, the 1-based nesting depth, in both the SVG
renderer and the Canvas renderer's hidden accessibility layer. A screen reader can therefore
announce how deeply a task sits in the hierarchy — previously the only structural cue in the
accessibility tree was `aria-expanded`, which says whether a row can be expanded but nothing
about where it sits.

Two details are worth knowing if you assert on the rendered ARIA:

- Unlike `aria-expanded`, which is omitted on a leaf, `aria-level` appears on **every** row of a
  tree, leaves included — a leaf still has a real depth.
- It is emitted only when the chart is a tree (`role="treegrid"`). A flat project stays
  `role="grid"` and no row carries `aria-level`, because WAI-ARIA permits the attribute on a row
  only under a `treegrid` owner; emitting it under a plain `grid` would be a real violation
  rather than harmless extra metadata. With no hierarchy every row is trivially level 1 anyway.

Canvas derives the level from the full-tree layout rather than the virtualized window, so a row's
announced level does not change as it scrolls into view.

No API change — this is purely additional markup on rendered rows.
