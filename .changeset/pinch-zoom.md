---
'@fluxgantt/core': minor
---

`withResponsive()` now supports two-finger pinch to zoom on the chart (SVG and Canvas): each pinch past 1.4x / 0.7x steps one view mode, anchored at the fingers' midpoint, and cancels any pan, drag or long-press in progress. Opt out with `withResponsive(g, { pinchZoom: false })`. A pinch with both fingers on the sticky header band stays a browser gesture.
