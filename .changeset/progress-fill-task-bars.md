---
'@fluxgantt/core': minor
---

Paint task progress: every non-milestone bar now carries a `.fg-task__progress` overlay.

`Task.progress` has always been required, aggregated by `computeRollup()`, and announced by
screen readers — a bar's `aria-label` has read `"(N% complete)"` since the first renderer.
Nothing ever painted it, so sighted users saw a plain bar while assistive technology reported
a percentage. This closes that name/role/value gap in both the SVG and Canvas renderers.

The overlay is drawn over the bar and under the focus ring, at a width of `progress` times
the bar width, in `--fg-task-completed` (default `#10b981`, previously declared but unused).
Its fraction resolves exactly as the `aria-label` does — the rolled-up aggregate when a
`rollup` provider supplies one, the authored `task.progress` otherwise — so the painted and
the spoken value cannot drift apart.

No new API: there is no flag to turn it on. A progress bar is what a Gantt chart is for, and
plumbing an option through `GanttConfig` and both renderers would have cost bytes in the
budget fixture with the least headroom.

Details worth knowing:

- Milestones never get a fill. They render as a rotated square, where a partial fill reads as
  a different shape rather than a different value — the same exemption `layoutTaskBar` and
  `buildTaskAriaLabel` already apply to rollup.
- A task at `progress: 0`, or with a zero-width bar, emits no element at all.
- `progress` is clamped to 0..1 at paint time. It is validated by `setProgress` and on import,
  but not by `addTask`, so an out-of-range or `NaN` value can reach the renderer; unclamped it
  would paint past the bar's own edge.
- The fill is set inline rather than by a CSS rule, so `exportSvg()` bakes it like every other
  painted value instead of exporting an unstyled (black) rect.
- Resizing a bar scales its fill live, keeping the fraction proportional for the whole gesture.

This changes the appearance of every existing chart — an intended visual change, not a
breaking API change. Hosts that want the old look can set `--fg-task-completed` to match
`--fg-task-default`.
