---
"@fluxgantt/core": minor
---

feat(core): Canvas a11y hidden layer + click-select/keyboard-nav parity (internal, unwired)

Ticket 2 of 3 of the Canvas renderer effort (`.claude/work/plan-canvas-renderer.md`), building on
Ticket 1's `createCanvasRenderer()`. Adds the offscreen ARIA grid layer mandated by spec §8.5 (real,
focusable per-row DOM elements — `role="row"`/`role="gridcell"`, roving `tabindex`, `aria-selected`,
`aria-rowindex`/`aria-rowcount`) mirroring the accessible-name contract `svg-renderer.ts` already
establishes, so a Canvas-mode chart is not an a11y regression versus SVG.

Introduces a shared `InteractiveRendererHandle` type (`{ interactionRoot, pointerEventTarget }`) that
both `SvgRendererHandle` and `CanvasRendererHandle` extend, letting `enableClickSelect`/
`enableKeyboardNav` retype to this narrower interface with no change to `gantt.ts`. Adds
`CanvasRendererHandle.hitTestRow(clientX, clientY)` for O(1) pixel-space row hit-testing (no
`viewBox`/DOM-hit-test equivalent exists for Canvas), so real mouse clicks on the visible `<canvas>`
resolve to a task row exactly like SVG's DOM-based click-select. Adds a self-contained
`focusin`/`focusout`-driven repaint that paints a focus ring (new `--fg-task-focus`/
`--fg-task-focus-width` tokens) with a reentrancy guard against the render's own focus-restoration
step. Relocates `buildTaskAriaLabel()` into the shared, still-DOM-free `renderer-base.ts` so both
renderers produce identical accessible names. The hidden layer's DOM uses distinct
`fg-timeline-canvas__*` classes (not SVG's `.fg-timeline__row`/`.fg-task`) so host/theme CSS can't
accidentally target the offscreen layer; row/task lookups elsewhere use the renderer-agnostic
`data-row-index`/`data-task-id` attribute contract instead of class selectors.

Explicitly excludes drag-move/drag-resize/drag-create-dep — those stay SVG-only in v1 (Canvas has no
cheap pixel-space-hit-test equivalent for drag gestures; a materially larger, separate problem, see
the plan doc). Still not re-exported from the package barrel and not wired into `mount()`'s
renderer-selection logic — that's Ticket 3.

Note: this ticket was rebased onto the separately-shipped canvas-dimension-guard fix (patch release,
`createCanvasRenderer()` no longer silently blanks past the ~65,535px browser backing-store limit —
it now throws a structured `CanvasDimensionExceededError` instead). `createCanvasRenderer()` still
has no virtual scrolling and sizes its canvas bitmap to the full row count, so the guard can still
trip on very large projects; Ticket 3 (the `>2000`-task auto-switch) must catch that error and fall
back to `createSvgRenderer()` rather than letting it propagate out of `mount()`.
