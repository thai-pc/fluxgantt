---
"@fluxgantt/core": minor
---

feat(core): wire Canvas renderer into `mount()`'s automatic SVG↔Canvas switch

This is **Ticket 3 of 3** of the Canvas renderer effort (`.claude/work/plan-canvas-renderer.md`).
`mount()` now decides once, at mount time, between the SVG renderer (task count `<=
CANVAS_AUTO_SWITCH_THRESHOLD`, 2000) and the Canvas renderer (task count above it), reachable via
`await import('./render/canvas-renderer.js')` so Canvas code only enters the bundle for consumers
whose datasets actually need it. Any failure along that path (dynamic-import failure,
`CanvasDimensionExceededError`, or any other construction error) falls back to SVG automatically,
with one `console.warn` explaining why. A new `renderer:selected` event
(`{ renderer: 'svg' | 'canvas', canvasFallbackReason?: 'dimension-exceeded' | 'load-failed' |
'construction-failed' }`) fires once per `mount()`/remount, letting a host app know which renderer
actually ended up on screen. A monotonic mount-generation guard makes rapid `mount()` →
`unmount()`/`destroy()` → `mount()` sequences race-safe against the async Canvas path resolving
after it's been superseded.

Bundle size verified unaffected for consumers who never exceed the threshold: hello-world and full
core budgets both hold (see `pnpm size` output in the PR). Added `packages/core/tests/unit/gantt-
dom.test.ts` coverage for both renderer paths, the threshold boundary, all three fallback reasons,
and the race-guard.

## Real-browser performance verification (spec-canvas-auto-switch.md §9.1/§9.3/§9.4)

Added `tests/performance/canvas-mount.spec.ts` (new Playwright `performance` project,
`devices['Desktop Chrome']`) and `examples/plain-html-demo/canvas-mount-perf-harness.html`. Budgets
are real, empirically calibrated numbers (20 samples per case, 10 for the 10,000-task case — each a
genuine cold `gantt.mount()` on a freshly-navigated page; committed budget = p75 × ~1.8-2x CI-safety
margin, per spec §9.4's own calibration procedure), not placeholders:

| Case | n | median | p75 | min | max | committed budget |
|---|---|---|---|---|---|---|
| taskCount=2000, SVG (at threshold) | 20 | 2752.2ms | 2777.2ms | 2636.5ms | 3436.8ms | 5000ms |
| taskCount=2001, Canvas (just over threshold) | 20 | 2519.5ms | 2538.8ms | 2371.5ms | 2578.3ms | 4600ms |
| taskCount=2001, forced-SVG comparative path | 20 | 1897.4ms | 1914.3ms | 1862.5ms | 1954.4ms | 3500ms |
| taskCount=5000 (see finding 2 below — actually SVG-via-fallback) | 20 | 6626.0ms | 6646.4ms | 6519.8ms | 6761.4ms | 12000ms |
| taskCount=10000 (see finding 2 below — actually SVG-via-fallback) | 10 | 13107.4ms | 13146.4ms | 12971.8ms | 13158.0ms | 26500ms |

Also added `tests/visual/canvas-auto-switch-boundary.spec.ts` (2000→SVG / 2001→Canvas boundary +
a11y grid structure, through the real `mount()` path) and extended
`tests/visual/canvas-renderer-webkit-dimension-guard.spec.ts` with a real-`mount()`-path case
confirming the fallback (`console.warn` + `renderer:selected`) works under a second engine, not
just through direct `createCanvasRenderer()` construction.

## Two empirically-confirmed findings that contradict the spec's stated assumptions

Both are flagged here deliberately rather than papered over, per this project's own "call out
spec conflicts, don't guess" principle. Neither is fixed in this ticket — both are architectural,
out of this ticket's scope, and are recorded here as candidate follow-ups for maintainer review.

**(1) Real Canvas `mount()` is currently SLOWER than a fair forced-SVG mount at the same task
count**, not faster as spec-canvas-auto-switch.md §9.4c assumes. Measured fairly (both paths pay
the same `computeCriticalPath()` + double-render cost `gantt.ts`'s `#mountSvg`/`#finishMount`/
`#renderNow` actually perform) at taskCount=2001: Canvas median 2519.5ms vs forced-SVG median
1897.4ms — Canvas is ~33% slower. Root cause: Canvas mode's hidden ARIA a11y grid layer (Ticket 2)
unconditionally builds 4 DOM nodes per task row, an O(taskCount) DOM cost layered on top of the
(cheap) canvas draw calls, which SVG's own DOM tree doesn't have to duplicate (SVG elements
themselves ARE the accessible tree). `tests/performance/canvas-mount.spec.ts`'s comparative test
asserts the true (inverted) relationship rather than a false claim in the spec's originally-
intended direction, with a comment explaining how to flip it back once/if this is fixed. Likely
follow-up: virtualize the a11y layer so it only builds DOM nodes for visible rows.

**(2) Canvas is structurally unreachable for genuinely large flat/all-expanded projects — a more
severe finding than (1).** `layoutRows()` (`renderer-base.ts`) has no collapse/virtualization
concept: every task always produces exactly one row. Canvas's own (pre-existing, correct,
unrelated-to-this-ticket) `MAX_CANVAS_DIMENSION_PX` guard (65,535px) is reached at just 2,047 rows
at the default density (`ROW_HEIGHT.default = 32px`) — barely 47 rows above the 2,000-task
auto-switch threshold itself. Confirmed empirically: flat 5,000- and 10,000-task datasets never
actually render via Canvas; `mount()` picks Canvas (task count over threshold), the construction
attempt throws `CanvasDimensionExceededError` internally, and it silently falls back to SVG
(`canvasFallbackReason: 'dimension-exceeded'`, one `console.warn`) — a real, working-as-designed
safety net from an earlier ticket, but it means the auto-switch cannot deliver Canvas rendering at
all for the very "large project" sizes it exists to help. The two large-N performance test cases
were relabeled to test this real reachable path (SVG-via-dimension-fallback) honestly rather than
asserting a "successful Canvas mount" that cannot occur with this dataset shape today. Likely
follow-up: collapse-aware or virtualized row layout, so a large task *store* doesn't force a large
row *count* at mount time.
