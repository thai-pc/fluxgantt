---
'@fluxgantt/core': minor
---

Add the today marker: a vertical rule at the current instant, drawn across the full chart
height (header band included) in both the SVG and Canvas renderers.

Complements the existing `--fg-grid-today` column shading rather than replacing it — the wash
says "this day is today", the line says "we are here within it". At `viewMode: 'year'`
(1 px/day) the shaded column is a hairline and the marker is the only legible signal.

Always on, no configuration and no timer: the position is recomputed from the clock on each
render. When "now" falls outside the chart's time range the marker is omitted entirely rather
than clamped onto an edge, where it would read as "today is the first day of this project".
The rule is painted with `--fg-task-critical`, written inline so it survives `exportSvg()`,
and is `aria-hidden` (decoration under a `role="grid"`/`"treegrid"` root).

It ships without the "Today" text label the design originally called for: the label did not
fit the `withRender + withInteraction` gzip budget, and golden rule 5 says shrink the feature
rather than the budget.
