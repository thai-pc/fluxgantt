---
'@fluxgantt/core': patch
---

SVG charts at 2000 tasks repaint 2-5x faster, and mount 4x faster. A zoom, collapse, selection change or `updateTask` used to recompute the critical path and paint the whole chart **twice**; a cold `mount()` painted three times. Now:

- the critical path and rollup are memoized per mount by the task + dependency store revisions (a zoom, collapse or selection change reuses them; `refresh()` still recomputes);
- each reactive run paints once: `SvgRendererHandle.update()` and `CanvasRendererHandle.update()` take an optional second argument `options` (additive, merged exactly like `setOptions()` before the single repaint; Canvas rolls both back if the render throws);
- the constructor paint is the complete one (critical path and rollup included), and the effect's first run no longer repeats it unless an initially selected row owns the focus; `critical-path:computed` still fires once on mount, before `renderer:selected` (also when a Canvas construction failure falls back to SVG, which now reuses the already-derived critical path instead of recomputing it);
- `computeGridColumns` parses the holiday list once instead of once per column;
- `aria-label` date formatting is memoized (bounded: cleared at 512 entries), removing one `Intl.DateTimeFormat` construction per date per task per repaint, the largest remaining per-render cost;
- two diagnostic warnings lost their second sentence, and the focus restore scans for the row by attribute instead of building a `CSS.escape`d selector (bytes).

Exported SVG is byte-identical. A cyclic dependency graph now warns once per data revision instead of once per repaint.

Measured on a quiet Mac, Chromium, 2000 SVG tasks, median ms to two animation frames (before -> after, full renders per operation): mount 3500 -> 830 (3 -> 1), zoom 2350 -> 500 (2 -> 1), setDensity 940 -> 450 (1 -> 1), collapse 2100 -> 850 (2 -> 1), select 2100 -> 550 (2 -> 1), select all 2100 -> 600 (2 -> 1), `updateTask` 2100 -> 860 (2 -> 1). Raw after-samples (20 fresh pages, ms): zoom 506,578,555,491,495,496,565,561,494,518,503,500,492,470,530,500,486,485,479,459; select 2403,2027,2005,1753,860,666,627,684,620,596,590,570,575,621,574,560,542,546,532,556 (the first five ran under heavy machine load); density 547,499,601,549,536,514,501,499,500,501,510,507; collapse 1187,1149,1245,1385,790,806,648,727,663,653,663,699 and selectAll 677,719,666,1353,1376,1400,1427,1587,1295,793,759,835 (both with a loaded stretch at the start or middle); updateTask 989,967,963,948,935,873,1053,878,896,855,842,863,946,871,909,854,865,824,860,839; mount 836,809,826,904,898,846,797,814,806,800,825,810,810,822,825,838,885,873,866,863. Bundle: `+ withRender` 14820 -> 14879 B, kitchen sink 24386 -> 24425 B (151 B headroom left); every other fixture is unchanged or smaller.

Not done, deliberately: row-level patching for selection/focus (selection is still ~550 ms against the 50 ms target; its ~+100-260 B does not fit the remaining kitchen-sink headroom) and caching the working-calendar holiday set (+60 B, would drop two fixtures under 150 B). Both need a bundle-budget decision.
