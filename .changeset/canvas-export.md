---
'@fluxgantt/core': minor
---

`exportSvg()` and `exportPng()` now work when the chart is mounted in Canvas mode (above the
2000-task auto-switch threshold) instead of throwing "not available while mounted in
Canvas-rendering mode". Both export the whole chart, not just the visible window. `exportSvg()`
stays synchronous: it rebuilds an off-screen SVG from what the canvas last painted and runs it
through the same sanitizing pipeline as SVG mode (it throws above 5,000 tasks). `exportPng()` paints
the full chart straight into an offscreen canvas in a lazily loaded chunk, so SVG-only consumers pay
nothing; it rejects with an actionable error past the browser's canvas size limits, so prefer
`exportSvg()` for very large charts.
