---
"@fluxgantt/core": minor
---

feat(core): runtime zoom / view-mode switching

Add `zoomTo(mode)`, `zoomIn()`, `zoomOut()`, and `getViewMode()` on `GanttInstance`, plus a
`viewport:changed` event (`{ viewMode }` payload) — the first real implementation of this
previously-reserved event name.

`zoomTo()` is headless-safe (works before `mount()` — state-only update, no DOM math
attempted). When mounted, it preserves the visible date range: the date currently centered
in the viewport stays centered after the repaint, computed via the existing
`TimeScale.dateToX`/`xToDate` (already Temporal-backed — no new date math). Calling
`zoomTo()` with the mode already active is a no-op (no event, no render); `zoomIn()`/
`zoomOut()` clamp safely at the `'day'`/`'year'` boundary through the same no-op path. Not
gated by `readOnly` (a view concern, not a data mutation) and not part of the undo/redo
history. Throws on an invalid mode or after `destroy()`, mirroring `resizeTask`/
`setProgress`'s validate-primitive-input posture.

View-mode state now lives in a `Signal<ViewMode>` on the `Gantt` instance (read inside the
existing reactive render effect), so a `zoomTo()` write triggers exactly the same
store-revision-driven repaint path every other mutation already uses — no second, parallel
render call path.

`render/svg-renderer.ts`'s `LABEL_COLUMN_WIDTH` constant is now exported (via
`render/index.ts` too) — needed to convert between the renderer's painted coordinate space
and `TimeScale`'s content-only coordinate space when computing the scroll-anchor date.
