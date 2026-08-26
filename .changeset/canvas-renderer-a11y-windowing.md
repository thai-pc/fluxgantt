---
"@fluxgantt/core": patch
---

fix(core): window the Canvas renderer's hidden a11y grid layer instead of rebuilding it in full every render (#36)

`canvas-renderer.ts`'s hidden ARIA `role="grid"` a11y layer (`a11yLayer`) used to tear down and
rebuild one real DOM row (4 nodes: row/gridcell/label/task) per task, for **every** task, on
every `render()` call — an O(taskCount) DOM-construction cost with no relation to what's visible
or focused. At the Canvas auto-switch threshold (2000 tasks) this made a real `mount()` via
Canvas ~33% *slower* than a fair forced-SVG mount at the same task count, inverting the whole
point of the auto-switch (`architecture.md`'s "Canvas fallback... task count > 2000" framing
assumes Canvas is the faster path).

The a11y layer's DOM construction is now windowed: only `2 * A11Y_WINDOW_OVERSCAN + 1` (101) rows
are built, centered on the currently-focused row (`focusedTaskId`), instead of every row in the
project. `aria-rowcount` still always reports the true, full row count — only DOM-node
*construction* is windowed, not the grid's reported size. `row.rowIndex`/`aria-rowindex` still
reflect true row position, and the window is recentered on every render (which already fires
after every focus-changing action — arrow keys, click, `focusedTaskId` prop change), so the
roving-tabindex row and focus-restoration lookup always find their target. True scroll-viewport
tracking (windowing by what's visually on screen rather than by focus) is out of scope — no such
infra exists anywhere in this renderer; a focus-centered window with overscan is the direct,
minimal fix for the O(taskCount) DOM-construction cost.

**Prerequisite fix**: `selection.ts`'s Shift+click range-select (`collectRowRange`) used to query
`handle.interactionRoot.querySelectorAll('[data-row-index]')` directly, which depended on every
row in the clicked range having a real DOM node in the a11y layer — incompatible with any windowed
a11y layer the moment a Shift+click range exceeds the window. Fixed by computing the range purely
from `layoutRows()` instead (mirrors the precedent already set by `gantt.ts`'s
`#commitKeyboardRangeSelect`, which does the same for the keyboard Shift+Arrow range-select),
removing the DOM dependency entirely — behavior is unchanged in SVG mode (whose DOM already
reflects `layoutRows()` 1:1) and now also correct in windowed-Canvas mode. `SelectionOptions` gained
a required `density` field to support this.

## Real-browser performance re-verification (spec-canvas-auto-switch.md §9.4c)

Re-ran `tests/performance/canvas-mount.spec.ts`'s calibration methodology (20 samples per case,
genuine cold `gantt.mount()` on a freshly-navigated page, real Chromium) after this fix:

| Case | n | median | p75 | min | max | committed budget |
|---|---|---|---|---|---|---|
| taskCount=2000, SVG (at threshold) — unaffected by this fix | 20 | 2674.9ms | 2728.6ms | 2573.5ms | 2824.0ms | 5000ms (unchanged) |
| taskCount=2001, Canvas (just over threshold) | 20 | 1228.6ms | 1236.7ms | 1198.8ms | 1253.9ms | 2300ms (was 4600ms) |
| taskCount=2001, forced-SVG comparative path — unaffected by this fix | 20 | 1831.3ms | 1843.3ms | 1747.7ms | 1940.4ms | 3400ms (was 3500ms) |
| taskCount=5000 (SVG-via-dimension-fallback, unrelated to this fix) | 20 | 6543.9ms | 6571.7ms | 6465.9ms | 6620.6ms | 12000ms (unchanged) |
| taskCount=10000 (SVG-via-dimension-fallback, unrelated to this fix) | 10 | 12916.9ms | 13001.0ms | 12562.8ms | 13242.9ms | 26500ms (unchanged) |

The comparative assertion (`tests/performance/canvas-mount.spec.ts`, spec §9.4c) now asserts
`canvasMs < svgForcedMs` — the spec's originally-intended direction — reversing Ticket 3's
original finding (Canvas ~1.3x slower). The two 20-sample distributions don't even overlap
(Canvas max 1253.9ms < forced-SVG min 1747.7ms), so this is not a borderline flip.

## Tests

- `packages/core/tests/unit/canvas-renderer.test.ts`: new `hidden ARIA layer — windowing (issue
  #36)` suite — fewer DOM rows than `taskCount`, `aria-rowcount` still reports the full count, a
  row far outside the window is absent from the DOM, window clamping at both ends of the row
  list, window relocation (+ focus restoration) on a large `focusedTaskId` jump, and safe
  degradation to zero rows.
- `packages/core/tests/unit/selection.test.ts`: new regression test — a Canvas-mode Shift+click
  spanning 396 rows (anchor row 5, target row 400), far wider than the 101-row a11y window, still
  fires `onRangeSelect` with every id in the full range. Updated the 3 existing `enableClickSelect`
  call sites for the new `density` option.
