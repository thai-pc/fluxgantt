---
"@fluxgantt/core": patch
---

fix(core): Canvas renderer no longer silently blanks on oversized bitmaps

`createCanvasRenderer()` sized the `<canvas>` backing-store bitmap directly from the full,
unclipped row count and time-range width with no check against a browser's real per-axis
`<canvas>` size ceiling. Once the computed physical (post-`devicePixelRatio`) `canvas.width`/
`canvas.height` exceeded 65,535px, every subsequent draw call silently no-op'd — the chart
rendered completely blank, with no thrown error anywhere. This was reachable at surprisingly
low row counts on HiDPI/Retina displays (`devicePixelRatio = 2`): as few as ~1,023 rows at
default density, below the ≥2,000-task threshold `architecture.md` mandates for the (not yet
wired) Canvas auto-switch.

`render()` now computes the physical width/height up front and throws a new, structured
`CanvasDimensionExceededError` (exported alongside the new `MAX_CANVAS_DIMENSION_PX = 65_535`
constant) before any canvas/DOM mutation whenever either axis would exceed the limit — no
margin subtracted, since the constant already matches Chromium's real, current ceiling exactly
(this repo's only CI-tested browser engine; Safari/WebKit's differently-shaped, area-based
limit is a known, explicitly out-of-scope residual risk, not addressed here). `update()`/
`setOptions()` roll back the handle's entire render-derived state (input, options, and
`getTimeScale()`'s time scale) atomically on any error `render()` throws — not just the new
dimension guard, also e.g. `renderer-base.ts`'s existing grid-column overflow guard — so the
handle's exposed state always reflects the last successful frame, never a half-applied one.

This module is still internal/unwired (Ticket 1 of `.claude/work/plan-canvas-renderer.md`,
merged via PR #31) — no public API surface change, zero behavioral impact on any real consumer
today. Flagged as a hard requirement for the not-yet-built Ticket 3 (auto-switch wiring): it
must catch `CanvasDimensionExceededError` specifically and fall back to `createSvgRenderer()`
rather than letting it propagate out of `mount()`, or the ≥2,000-task Canvas auto-switch would
be unsafe for a real slice of HiDPI-display users.
