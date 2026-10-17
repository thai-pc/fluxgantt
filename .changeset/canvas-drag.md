---
'@fluxgantt/core': minor
---

Drag-move, drag-resize and drag-create-dependency now work in Canvas mode (>= 2,000 tasks). A drag is previewed with a ghost bar on a viewport-sized overlay canvas, so the main canvas is never repainted mid-gesture; hover cursors and link handles (hovered and selected bars) are drawn on the same overlay. Touch pan no longer steals a bar drag in Canvas under `withResponsive`, and a long-press under `withEditHooks` keeps the drag's 4 px slop on a Canvas bar. `InteractiveRendererHandle` gains the optional `hitTestBar` (returning the new `BarHit` / `BarZone` types, exported from `@fluxgantt/core/render`), and `hitTestRow` results gain an optional `onBar`.
