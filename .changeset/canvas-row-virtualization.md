---
"@fluxgantt/core": patch
---

fix(core): Canvas mode is no longer structurally unreachable for large flat projects (#37)

`createCanvasRenderer()` sized the `<canvas>` backing-store bitmap's height directly from the
full, unclipped row count (`headerHeight + rowCount * rowHeight`), checked against the
`CanvasDimensionExceededError` guard added by the prior row-limit fix. That guard was correct,
but it meant any flat (no-collapse) project past ~2,047 rows at default density (fewer on
HiDPI displays) could never mount via Canvas at all — `mount()`'s auto-switch would pick
Canvas past its own `>2000`-task threshold, immediately hit the dimension guard, and silently
fall back to SVG, defeating the entire point of the Canvas fallback existing.

`createCanvasRenderer()` now binds the canvas's physical height to a fixed, host-configurable
viewport (`resolveViewportHeightPx()`, default 600px, `GanttConfig.canvasViewportHeight` /
`CanvasRendererOptions.viewportHeight` to override) instead of the full content height.
`container` becomes the real scroll viewport (`overflowY: auto`, sized to the resolved
viewport height); a zero-content spacer element gives it a real `scrollHeight` matching the
full, unbounded row count. Both the canvas bitmap and the hidden ARIA `role="grid"` layer
(issue #36) now materialize only the row band that intersects the current scroll position
(`computeVisibleWindow()`, 20-row overscan on each side) rather than either the full row count
or a focus-centered window — cost no longer scales with total row count at all, so a
10,000-row flat project mounts via Canvas exactly as cheaply as a 2,001-row one.
`ensureFocusedRowVisible()` keeps keyboard navigation (ArrowUp/ArrowDown past the edge of the
current window) scrolled to the newly focused row automatically, gated to only fire when the
resolved focused task actually changes between renders — an unconditional version of this
found during testing would otherwise undo any plain user scroll (mouse wheel, scrollbar drag)
on the very next repaint, since a just-mounted chart's focus defaults to row 0.

A second, independent bug was found and fixed in the same change: the hidden a11y layer's
`position: sticky` pinning (needed so it stays reachable at the container's visible top-left
regardless of scroll) only works once the element's own natural, pre-scroll flow position has
already been reached — the a11y layer was being inserted into `container` AFTER the
zero-content spacer, so its natural offset sat near the very bottom of the (often
tens-of-thousands-of-pixels-tall) content instead of near the top. A bare `Tab` press (or any
`.focus()` call without `preventScroll`) would trigger the browser's native scroll-into-view
behavior, yanking `container.scrollTop` almost to the bottom just to reach the tabindex="0"
row — which then changed which rows the very next render materialized, dropping focus back to
`<body>` entirely. Fixed by inserting the a11y layer before the canvas element (natural offset
~0), matching the canvas element's own existing placement.

Real-Chromium mount budgets (`tests/performance/canvas-mount.spec.ts`, `?taskCount=N` via
`examples/plain-html-demo/canvas-mount-perf-harness.html`): 5,000 flat rows mount via Canvas in
~4.1s (budget 4.2s), 10,000 rows in ~6.8s (budget 8s) — both now genuinely successful Canvas
mounts (`data-renderer="canvas"`, no `data-canvas-fallback-reason`), previously impossible.
Canvas mount is also now consistently faster than a fair forced-SVG mount at the same task
count (this ticket's own prior a11y-layer DOM-node-count fix, issue #36, already improved that
comparison; this fix removes the remaining row-count-scaling cost entirely).

`position: sticky`'s correctness (both for the canvas and the a11y layer, across scroll and
keyboard navigation) is empirically re-verified by a new Playwright a11y test and a new visual-
regression snapshot at 5,000 rows mid-scroll, in addition to unit coverage for
`resolveViewportHeightPx()`, `computeVisibleWindow()`, and `ensureFocusedRowVisible()`.
