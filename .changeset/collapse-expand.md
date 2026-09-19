---
"@fluxgantt/core": minor
---

feat(core): collapse/expand hierarchy

Add `toggleCollapse(id)`, `collapseAll()`, `expandAll()`, `isCollapsed(id)` on
`GanttInstance`, a `GanttConfig.initialCollapsed?: TaskId[]` option, and a `collapse:changed`
event carrying the full collapsed id set. Collapse state is a headless `CollapseStore`
(`Set<TaskId>` + signal, mirrors `SelectionStore`) exported from the base barrel, so a
`createGantt()` instance with no renderer attached can toggle state and emit events — the
renderer is what reacts visually, not what owns the state.

Only a task that currently HAS children can be collapsed; unknown or leaf ids are silently
dropped rather than throwing, including in `initialCollapsed` at construction. Collapsing a
row hides its entire subtree, not just its direct children. `removeTask()` prunes the
collapsed set, matching the existing `SelectionStore` precedent.

`layoutRows()` takes the collapsed set and emits only visible rows, so every consumer derived
from it — painting, hit-testing, keyboard traversal, and the Canvas hidden ARIA layer — stays
consistent by construction. Both renderers paint a chevron on rows with children; the SVG
toggle is a real element (`.fg-timeline__row-toggle`), while Canvas hit-tests a glyph gutter
band since it has no per-glyph DOM. `Enter` toggles the focused row and is inert on a leaf.

Keyboard focus is corrected when a collapse hides the focused row: focus moves to the nearest
VISIBLE ancestor rather than being lost or clamped to the last row. The mouse path batches
the state change with that focus sync — effects run synchronously outside `batch()`, so an
unbatched toggle would repaint while focus still pointed at a row about to be hidden, leaving
the roving tabindex on a detached element with no further repaint to correct it.

**a11y**: rows with children carry `aria-expanded`; leaves omit the attribute entirely rather
than reporting `aria-expanded="false"`, which would announce them as collapsed containers.
This forced a companion change: the root role is now derived per render — `treegrid` when the
layout contains an expandable row, plain `grid` otherwise — because WAI-ARIA permits
`aria-expanded` on a row only under `treegrid`. Emitting it under `role="grid"` is a
serious-impact axe violation (`aria-conditional-attr`). Projects with no hierarchy emit no
`aria-expanded` and keep `role="grid"`, so flat charts are unaffected. `aria-level` remains
deferred.

`exportSvg()` strips the toggle glyph alongside the existing link-handle strip — an exported
static SVG has no click handler behind the chevron, so leaving it in would render a dead
affordance.
