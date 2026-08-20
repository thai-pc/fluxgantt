---
"@fluxgantt/core": patch
---

fix(core): guard against WebKit's stricter Canvas backing-store area limit

The prior fix (`canvas-row-limit-fix.md`) added `MAX_CANVAS_DIMENSION_PX = 65_535` as a
per-axis guard matching Chromium's real ceiling, but explicitly flagged Safari/WebKit's
differently-shaped limit as an out-of-scope residual risk. This change closes that gap.

Empirical testing against a real WebKit engine (via Playwright) found:
- **Failure mode matches Chromium**: exceeding the limit silently no-ops every draw call
  rather than throwing — same class of bug, not a crash.
- **A reproducible, independent per-axis cap exists (~4,194,305px)**, but it is strictly
  dominated by the pre-existing, engine-agnostic 65,535px per-axis check that already runs
  for every engine first — WebKit never reaches its own per-axis ceiling before Chromium's
  check already would have caught it. No separate per-axis constant was added for this reason.
- **The area ceiling is not a stable constant** — it degrades under memory pressure across
  runs/aspect ratios, so rather than chase a moving empirical maximum, `render()` now enforces
  a conservative constant, `MAX_CANVAS_AREA_PX_WEBKIT = 16_777_216` (4096×4096), leaving
  meaningful headroom below every observed real ceiling.

`CanvasDimensionExceededError.axis` is widened from `'width' | 'height'` to
`'width' | 'height' | 'area'`, with new optional `physicalWidth`/`physicalHeight` fields
populated only when `axis === 'area'`. `render()` runs a new `isWebKitEngine()`
(`navigator.userAgent` sniff, Option A per `.claude/work/spec-canvas-webkit-dimension-limit.md`)
check strictly *after* the existing, unchanged Chromium width/height checks, and the WebKit
area check only ever adds restriction — a Chromium (or any non-WebKit) user agent can never
become more restrictive than the previously-shipped behavior.

Like the sibling fix, this module remains internal/unwired (no public API surface change,
zero behavioral impact on any real consumer today). The same Ticket 3 auto-switch requirement
applies: it must catch `CanvasDimensionExceededError` (any axis) and fall back to
`createSvgRenderer()`.
