---
"@fluxgantt/core": minor
---

feat(core): Canvas paint layer (internal, unwired)

Add `createCanvasRenderer(container, input, options?)` in `render/canvas-renderer.ts` — a
Canvas 2D counterpart to `createSvgRenderer`, built on the same headless `renderer-base.ts`
layout math (time-scale, row/bar/dependency geometry, grid columns). Paints the day grid and
header, hierarchy-indented task bars (including rotated-diamond milestones), FS/SS/FF/SF
dependency arrows (hand-drawn arrowheads — Canvas has no `<marker>`), critical-path dashed
outlines, and selection outlines, with `update()`/`setOptions()`/`destroy()`/`getTimeScale()`
on the returned handle.

This is **Ticket 1 of 3** of the Canvas renderer effort (`.claude/work/plan-canvas-renderer.md`):
a standalone, inert module with **no public API surface change**. It is intentionally not
re-exported from the package barrel, not wired into `mount()`'s renderer-selection logic, and
not reachable by any published entry point — verified to add zero bytes to the built
`dist/index.js`/`dist/index.cjs` (gzip size unchanged). It duplicates a handful of layout
constants locally rather than importing from `svg-renderer.ts`, by design, to keep the two
renderers independently tree-shakable ahead of Ticket 3's dynamic-`import()` wiring and
automatic SVG↔Canvas switching (at the 2000-task threshold per `architecture.md`).

Security-hardened the same way as the SVG renderer: `task.name` only ever reaches the canvas
through `ctx.fillText()`'s literal argument (never interpolated into `ctx.font` or any other
property), `task.color` is only used after passing the shared `validateTaskColor()` whitelist,
and the renderer never calls `createPattern`/`createLinearGradient`/`createRadialGradient`.
Sets `role="img"` and a capped `aria-label` as a stopgap — explicitly documented as not
WCAG 2.1 AA-sufficient on its own; full keyboard/SR parity with the SVG renderer is out of
scope for this ticket.
