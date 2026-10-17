---
'@fluxgantt/core': minor
'@fluxgantt/react': minor
'@fluxgantt/vue': minor
---

Right-to-left charts. New subpath `@fluxgantt/core/rtl` exports `withRtl()` (no new methods) and `GanttConfig` gains `rtl?: boolean` (default `false`, read only by `withRtl`, inert without it, construction-time only). With `rtl: true` the whole chart is mirrored in both renderers: the earliest date and the label column sit at the right, text stays upright and gets an RTL base direction, the container gets `dir="rtl"` (restored on unmount), and `exportSvg()` / `exportPng()` (SVG and Canvas mode) export the mirrored chart. Zoom anchoring, `scrollToTask()` and `scrollToDate()` use the logical scroll offset of a RTL scroll container (`scrollLeft` runs from 0 down to negative). Dragging a bar visually left moves it later; resize grabs the visually-left (end) edge; the link rubber band starts at the mirrored handle; Canvas hit-testing, the drag overlay and edit-hook label classification follow the mirror. Not included: translated built-in strings (use `messages`), a runtime toggle, left-edge resize. See the new "Right-to-left charts" docs page.

Additions to published types (all optional, marked for `withRtl`; do not rely on them): `SvgRendererOptions.onPaint`, `CanvasRendererOptions.rtl` and `InteractiveRendererHandle.mirrorX` (the single "is mirrored" predicate); `MountState.anchored` is no longer `readonly`. The new `with-rtl` size fixture is `withRender + withRtl`; every existing fixture grew by at most 61 B (hello world, `+ withIo` and `+ withConflicts` by 0 B) and no existing limit moved.

`@fluxgantt/react` and `@fluxgantt/vue`: new `rtl` prop (construction-time; change `key` to switch). Both compose `withRtl` unconditionally, which is a no-op unless `rtl` is true.
