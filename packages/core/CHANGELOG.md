# @fluxgantt/core

## 0.1.0

### Minor Changes

- f040cf9: feat(core): Canvas paint layer (internal, unwired)

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

- 02a9e59: feat(core): Canvas a11y hidden layer + click-select/keyboard-nav parity (internal, unwired)

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

- 59df15a: feat(core): wire Canvas renderer into `mount()`'s automatic SVG↔Canvas switch

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

  | Case                                                              | n   | median    | p75       | min       | max       | committed budget |
  | ----------------------------------------------------------------- | --- | --------- | --------- | --------- | --------- | ---------------- |
  | taskCount=2000, SVG (at threshold)                                | 20  | 2752.2ms  | 2777.2ms  | 2636.5ms  | 3436.8ms  | 5000ms           |
  | taskCount=2001, Canvas (just over threshold)                      | 20  | 2519.5ms  | 2538.8ms  | 2371.5ms  | 2578.3ms  | 4600ms           |
  | taskCount=2001, forced-SVG comparative path                       | 20  | 1897.4ms  | 1914.3ms  | 1862.5ms  | 1954.4ms  | 3500ms           |
  | taskCount=5000 (see finding 2 below — actually SVG-via-fallback)  | 20  | 6626.0ms  | 6646.4ms  | 6519.8ms  | 6761.4ms  | 12000ms          |
  | taskCount=10000 (see finding 2 below — actually SVG-via-fallback) | 10  | 13107.4ms | 13146.4ms | 12971.8ms | 13158.0ms | 26500ms          |

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
  follow-up: collapse-aware or virtualized row layout, so a large task _store_ doesn't force a large
  row _count_ at mount time.

- 47c1a40: feat(core): cascade scheduling (opt-in `schedulingMode: 'auto'`)

  Add `computeCascade(tasks, dependencies, calendar, changedTaskIds)` — a headless, pure
  function that, when a task moves/resizes, computes which transitive successors must shift
  LATER to keep their FS/SS/FF/SF (+lag) relationship satisfied, respecting the working
  calendar. Push-only (never pulls a successor earlier), forward, downstream; the
  directly-changed task is authoritative and never re-derived.

  Wired into the facade opt-in via `GanttConfig.schedulingMode?: 'manual' | 'auto'`
  (**default `'manual'` — no behavior change**). When `'auto'`, `moveTask`/`resizeTask`/an
  `updateTask` that touches start/end/duration, and a drag commit, cascade their dependents,
  emitting `task:moved` for every shifted task. This closes the documented spec §7.2 gap as an
  opt-in (a later deliberate version bump can flip the default).

  `task.constraint` stays inert here (consistent with `computeCriticalPath`, a Pro seam).
  Internally, the shared FS/SS/FF/SF earliest-start math + topological sort were extracted to
  `compute/dependency-math.ts` and are now shared by critical-path and cascade (a
  behavior-preserving refactor — the CPM test suite is unchanged and green).

- 4f192b2: feat(core): collapse/expand hierarchy

  Add `toggleCollapse(id)`, `collapseAll()`, `expandAll()`, `isCollapsed(id)` on
  `GanttInstance`, a `GanttConfig.initialCollapsed?: TaskId[]` option, and a `collapse:changed`
  event carrying the full collapsed id set. Collapse state is a headless `CollapseStore`
  (`Set<TaskId>` + signal, mirrors `SelectionStore`) exported from the base barrel, so a
  `createGantt()` instance with no renderer attached can toggle state and emit events — the
  renderer is what reacts visually, not what owns the state.

  Only a task that currently HAS children can be collapsed; unknown or leaf ids are silently
  dropped rather than throwing, including in `initialCollapsed` at construction. Collapsing a
  row hides its entire subtree, not just its direct children. `removeTask()` prunes the
  collapsed set, matching the existing `SelectionStore` precedent.

  `layoutRows()` takes the collapsed set and emits only visible rows, so every consumer derived
  from it — painting, hit-testing, keyboard traversal, and the Canvas hidden ARIA layer — stays
  consistent by construction. Both renderers paint a chevron on rows with children; the SVG
  toggle is a real element (`.fg-timeline__row-toggle`), while Canvas hit-tests a glyph gutter
  band since it has no per-glyph DOM. `Enter` toggles the focused row and is inert on a leaf.

  Keyboard focus is corrected when a collapse hides the focused row: focus moves to the nearest
  VISIBLE ancestor rather than being lost or clamped to the last row. The mouse path batches
  the state change with that focus sync — effects run synchronously outside `batch()`, so an
  unbatched toggle would repaint while focus still pointed at a row about to be hidden, leaving
  the roving tabindex on a detached element with no further repaint to correct it.

  **a11y**: rows with children carry `aria-expanded`; leaves omit the attribute entirely rather
  than reporting `aria-expanded="false"`, which would announce them as collapsed containers.
  This forced a companion change: the root role is now derived per render — `treegrid` when the
  layout contains an expandable row, plain `grid` otherwise — because WAI-ARIA permits
  `aria-expanded` on a row only under `treegrid`. Emitting it under `role="grid"` is a
  serious-impact axe violation (`aria-conditional-attr`). Projects with no hierarchy emit no
  `aria-expanded` and keep `role="grid"`, so flat charts are unaffected. `aria-level` remains
  deferred.

  `exportSvg()` strips the toggle glyph alongside the existing link-handle strip — an exported
  static SVG has no click handler behind the chevron, so leaving it in would render a dead
  affordance.

- d3422c6: feat(core): critical path (CPM) compute layer

  Add `computeCriticalPath(tasks, dependencies, calendar, options?)` — a headless,
  pure-function forward/backward pass (ES/EF/LS/LF/slack) over FS/SS/FF/SF dependencies
  with lag/lead, honoring the working calendar. Detects cycles via Kahn's algorithm and
  throws `CyclicDependencyError` (`.taskIds`). Core schedules ASAP only; `task.constraint`
  is inert and never read — constraint resolution is exposed as a Pro-tier seam via
  `ComputeCriticalPathOptions.resolveConstraint`. Also exports `TaskSchedule` and
  `CriticalPathResult` types for the render layer.

- 5fc8746: feat(core): drag-create-dependency interaction

  Add `enableDragCreateDep(handle, getTasks, options)` — drag from a task bar's connector
  handle onto another task to create a dependency (default `FS`), committing once on drop via
  an `onDependencyCreated(fromId, toId)` callback. Registered as a third recognizer on the
  shared `pointer-drag.ts` coordinator with the highest priority, so a pointerdown on a handle
  wins over drag-move/drag-resize. Headless of any framework (raw Pointer Events); no
  `TaskStore`/`DependencyStore` coupling in the recognizer — the caller decides what to do.

  The SVG renderer draws two `.fg-task__link-handle` connector circles (start + end) per task,
  hidden by default and revealed on `.fg-task:hover` via a static inline `<style>` (pure CSS,
  zero required host CSS). A new `SvgRendererOptions.showLinkHandles` (default `true`) lets the
  facade omit them for a `readOnly` chart. A dashed rubber-band `<path>` previews the link
  during the drag (built with `createElementNS`, never interpolated markup).

  The facade wires it through a private `#commitCreateDep` that reuses the existing
  `linkTasks()` / `dependency:added` and silently reverts an invalid drop. Invalid links
  (self / duplicate pair / cycle) are now raised as a distinct `DependencyLinkError`
  (exported), so the silent-revert catch swallows only the expected validation rejections and
  lets real errors propagate.

  The shared coordinator's drag threshold is now radial (both axes) instead of horizontal-only,
  so a purely vertical link drag (to the task directly below) starts correctly — drag-move and
  drag-resize are unaffected.

- 7f4df10: feat(core): drag-move interaction

  Add `enableDragMove(handle, getTasks, options)` — pointer-drag a task bar horizontally to
  change its `start`/`end` (duration preserved), committing once on drop via an
  `onTaskMoved` callback. Headless of any framework (raw Pointer Events); no `TaskStore`
  coupling — the caller decides what to do in the callback. Day-snapped and DST-safe: the
  new dates are computed with calendar arithmetic (`.add({ days: N })`), never elapsed-time,
  so wall-clock time-of-day is preserved across DST boundaries.

  Also adds `SvgRendererHandle.getTimeScale()` so the interaction layer can convert pixels to
  dates through the renderer's single source of truth.

  Hardened per security review: `handle.destroy()` mid-drag now tears down the gesture (no
  leaked window listeners / detached DOM), the day-delta is clamped so a pathological pointer
  coordinate can't throw a Temporal `RangeError`, and a second concurrent pointerdown is
  ignored so a two-finger gesture can't orphan the first drag.

- 731902f: feat(core): drag-resize interaction

  Add `enableDragResize(handle, getTasks, options)` — pointer-drag a task bar's right edge to
  change its `end` (keeping `start`), committing once on drop via an `onTaskResized` callback.
  Right-edge only in v1; milestones are never resizable. Headless of any framework (raw
  Pointer Events); no `TaskStore` coupling — the caller decides what to do in the callback.
  Day-snapped and DST-safe (calendar arithmetic, wall-clock time-of-day preserved).

  Introduces an internal shared pointer-gesture coordinator (`pointer-drag.ts`): drag-move and
  drag-resize now register `PointerGestureRecognizer`s against ONE delegated `pointerdown`
  listener per renderer handle, with an explicit numeric priority so an edge-zone claim always
  wins over a whole-bar claim on the same pointerdown — deterministic regardless of
  registration order. `drag-move.ts` is refactored onto this coordinator behavior-preservingly
  (its existing tests pass unedited); the B1/B2/B3 hardening (destroy-wrap, day-delta clamp,
  second-pointerdown ignore) is preserved and now shared.

  The right-edge hit-zone reads the already-rendered `.fg-task__bar` `x`/`width` attributes
  plus one `svg.getBoundingClientRect().left`, so it needs no renderer change. Wired into the
  facade via a private `#commitResize` that reuses the existing `resizeTask()` pipeline
  (`differenceInWorkingHours` → validate → emit `task:resized` → cascade); no new public method.

- df70560: Wire `Ctrl/Cmd + D` (duplicate selected task(s)) into keyboard navigation. Matches
  `event.key === 'd' || event.key === 'D'` with `Shift` state irrelevant (no paired opposite action
  shares this key, unlike undo/redo's `z`/`Z`). Gated by `readOnly` (mirroring the existing
  `Delete`/`Backspace`/undo/redo gate) — `duplicateTask()` mutates the task store. Calls
  `preventDefault()` to suppress the browser's native "bookmark this page" shortcut; note some
  browsers (notably Firefox) do not honor `preventDefault()` for this specific reserved shortcut, a
  known cross-browser limitation. Unlike calling `gantt.duplicateTask()` directly (which leaves
  selection on the original task(s), unchanged), the keyboard gesture re-selects the newly created
  copies so they're immediately actionable (drag/reposition) without an extra click.
  `gantt.duplicateTask()` itself (shipped separately, PR #26) is unaffected — this only adds the
  keyboard trigger and, in the keyboard path specifically, the post-duplicate re-selection.
  `KeyboardNavOptions` gains one new required callback, `onDuplicateSelected`, for hosts constructing
  `enableKeyboardNav` directly.
- d4655c0: feat(core): duplicateTask()

  Add `duplicateTask(taskId?)` on `GanttInstance`. With an explicit `taskId`, duplicates exactly
  that task (throws via the existing `#requireTask` if it doesn't resolve). With no argument,
  duplicates the current selection in its insertion order; an empty selection is a safe no-op
  that returns `[]`.

  Built entirely on top of the existing `addTask()` — one call per copy, reusing its id
  generation, `createdAt`/`updatedAt` stamping, `task:added` emission, and undo-stack recording
  in full. A multi-select duplicate wraps its N `addTask()` calls in a single
  `#beginTransaction()`/`#endTransaction()` (mirroring `#commitDeleteSelected()`'s existing
  pattern), so the whole batch undoes/redoes as ONE history entry.

  Per-copy field handling: `id`/`createdAt`/`updatedAt` are always fresh (via `addTask`);
  `start`/`end` are offset to begin immediately after the source task ends, preserving the
  source's own working-hours span via the already-imported `addWorkingHours`/
  `differenceInWorkingHours`/`normalizeDate` helpers (each copy in a multi-select is offset from
  its OWN source, not a shared anchor); `progress` always resets to `0`; every other field
  (`name`, `priority`, `parent`, `type`, `constraint`, `resources`, `notes`, `color`, `meta`,
  `duration`) is copied verbatim via a shallow spread, matching `TaskStore.add()`'s own existing
  shallow-copy convention — no `"(copy)"` name suffix, no deep-clone. The copy starts with zero
  dependency edges; `duplicateTask` never touches `DependencyStore`.

  No new event — reuses `task:added`, fired once per copy. Not gated by `readOnly` (matches
  every other programmatic mutation method); throws after `destroy()`. Keyboard (Cmd/Ctrl+D)
  wiring is a separate follow-up ticket, not included here.

- ce92382: feat(core): PNG/SVG export

  Add `gantt.exportSvg(options?): string` and `gantt.exportPng(options?): Promise<Blob>` (and
  the underlying `exportSvg`/`exportPng` functions taking an `SVGSVGElement`). Both serialize the
  currently-mounted chart; they require a mounted renderer and throw (svg) / reject (png) with a
  clear "not mounted" message otherwise.

  `exportSvg` deep-clones the live SVG and, by default, bakes each element's `getComputedStyle`-
  resolved paint values inline so the output matches the host's actual theme (WYSIWYG, including
  any host override of `--fg-*` tokens) — accepting modern space-separated CSS Color 4
  serializations, reusing `Task.color`'s whitelist for the legacy forms. It strips the
  interaction-only link-handle circles and their hover `<style>`, promotes `aria-label` into a
  `<title>`, emits an XML declaration + `xmlns`. Security (security.md §1): user text stays inert
  (text nodes escaped by `XMLSerializer`), the `<title>` is set via `textContent`, and every
  baked value passes a safety gate that blocks `javascript:`/`expression(`/external `url()`.

  `exportPng` rasterizes the baked SVG onto a canvas (default solid-white background, overridable;
  `scale` for HiDPI) and resolves a `Blob`. It validates `scale`/`background`/dimensions up front
  (rejecting non-numeric SVG size, a degenerate sub-pixel scale, and outputs past the per-side or
  total-area canvas limit) so a bad request is a clear rejection rather than a silent blank raster.

  `exportPng` is a separate module importing `exportSvg` one-directionally, so importing only
  `exportSvg` never pulls the canvas path into a consumer's bundle. PDF/branding remains Pro
  (out of scope).

- 7986f80: refactor(core)!: split the monolithic `Gantt` facade into a base instance plus three opt-in capability mixins

  **Breaking change.** `createGantt(config)` now returns the _headless base_ instance only. The
  IO, rendering and interaction methods it used to carry are opt-in mixins, each on its own
  subpath export:

  | Subpath                       | Mixin             | Adds                                                                                                                       |
  | ----------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | `@fluxgantt/core/io`          | `withIo`          | `exportJson`/`exportCsv`/`exportSvg`/`exportPng`, `importJson`/`importCsv`                                                 |
  | `@fluxgantt/core/render`      | `withRender`      | `mount()`, `unmount()`, `refresh()`                                                                                        |
  | `@fluxgantt/core/interaction` | `withInteraction` | no new methods — wires drag-move/resize, drag-create-dependency, click-select and keyboard navigation into every `mount()` |

  ```ts
  import { createGantt, toTaskId } from '@fluxgantt/core';
  import { withRender } from '@fluxgantt/core/render';
  import { withInteraction } from '@fluxgantt/core/interaction';

  const gantt = withInteraction(withRender(createGantt({ tasks })));
  gantt.mount(document.getElementById('gantt')!);
  ```

  Each mixin returns the _same_ instance (augmented in place) with a widened type, so application
  order does not matter — but **apply every mixin before the first `mount()` call**: interaction
  hooks are consulted while a mount is being built, so composing `withInteraction` onto an
  already-mounted instance takes effect only on the next mount. This is a documented v1 limitation.

  **Why.** Class prototype methods can never be tree-shaken. As one monolithic class, the facade
  billed every consumer for the IO, render _and_ interaction bytes whether they called them or not
  — a headless server-side scheduling consumer downloaded the SVG renderer, and a read-only chart
  downloaded the CSV exporter. The budget had ~0.25 KiB of headroom left before this change.

  **Measured effect** (gzip, esbuild fixture bundles in `packages/core/size-limit/`):

  | Fixture                             | Before   | After         |
  | ----------------------------------- | -------- | ------------- |
  | `createGantt()` only                | 22.3 KiB | **7.51 KiB**  |
  | `+ withIo`                          | —        | 12.45 KiB     |
  | `+ withRender`                      | —        | 13.47 KiB     |
  | `+ withRender + withInteraction`    | —        | 17.40 KiB     |
  | everything (≡ the pre-split facade) | 34.9 KiB | **22.01 KiB** |

  `.size-limit.json` now enforces one budget per fixture. The old file-based "Full core" check on
  `dist/index.js` is gone: `tsup`'s code splitting moves shared code into `chunk-*.js`, so reading
  that one file's size no longer reflects what any consumer actually downloads. The `kitchen-sink`
  fixture replaces it.

  **Barrel trimming.** `createSvgRenderer`, `CANVAS_AUTO_SWITCH_THRESHOLD`, the `enableDrag*`/keyboard/selection helpers and the
  `exportJson`/`importCsv`-family free functions are no longer re-exported from `@fluxgantt/core`.
  Import them from `@fluxgantt/core/render`, `/interaction` and `/io` respectively — re-exporting
  them from the root barrel pinned the renderer and the IO layer into every consumer's module
  graph, defeating the split.

  **Migration.** Wrap your `createGantt()` call in the mixins for the capabilities you use:

  ```diff
  -const gantt = createGantt({ tasks });
  +const gantt = withInteraction(withRender(createGantt({ tasks })));
  ```

  `@fluxgantt/react` and `@fluxgantt/vue` compose `withRender` + `withInteraction` internally, so
  their public surface is unchanged — a wrapper is by definition a rendering, interactive consumer.
  They deliberately do _not_ compose `withIo`, so wrapper users who never import or export stop
  paying for that code.

- 6096edb: feat(core): public facade `createGantt()` / `GanttInstance`

  Add the top-level API `createGantt(config)` — the single front door of `@fluxgantt/core`.
  It privately owns a `TaskStore` + `DependencyStore` (composed from the config data),
  exposes task ops (`addTask`/`updateTask`/`removeTask`/`moveTask`/`resizeTask`/`setProgress`/
  `getTask`/`getTasks`/`findTasks`), dependency ops (`linkTasks`/`unlinkTasks`/
  `getDependencies`/`getDependenciesOf`), `computeCriticalPath()`, a typed event bus
  `on(event, cb): UnsubscribeFn` (`task:added/moved/resized/progressed/removed`,
  `dependency:added/removed`, `critical-path:computed`), and lifecycle
  `mount`/`unmount`/`destroy`/`refresh`.

  The instance is fully headless until `.mount(container)` — mutations, compute, and the
  event bus all work with no DOM. `mount()` wires a reactive `effect()` (store revision →
  re-render + critical-path recompute) and drag-move (a drag commit flows through the same
  mutation pipeline as `moveTask`, so it emits the identical `task:moved` contract). `unmount()`
  detaches rendering but keeps state + subscriptions (remountable); `destroy()` tears
  everything down.

  Known gap (tracked, prerequisite before 1.0): no cascade — `moveTask`/`resizeTask` affect
  only the named task; dependents are not auto-shifted yet (spec §7.2 default). Not in v1:
  viewport/selection/IO/baselines/resources/AI methods, and the React/Vue wrappers.

- 26eb3d6: feat(core): wire `importJson`/`importCsv` into the `Gantt` facade

  Add `gantt.importJson(data, options?)` and `gantt.importCsv(csv, options?)` on
  `GanttInstance`, plus a `data:imported` event. Both wholesale-REPLACE the entire live
  task/dependency set — equivalent to what `createGantt({ tasks, dependencies })` would have
  produced from the same data, not a merge/append.

  The complete replacement dataset is validated and staged against throwaway store instances
  BEFORE any live store is touched, so a rejected import (invalid schema, or a cyclic
  dependency set — which the pure `importJson()` deliberately does not detect) leaves the live
  instance's tasks, dependencies, undo/redo history, and selection completely unchanged. On
  success, both undo/redo stacks are cleared (import is not itself undoable, same precedent as
  construction-time `config.tasks`/`config.dependencies` seeding), the selection is cleared,
  and exactly one `data:imported` event fires — never a `task:added`/`dependency:added` storm.
  Not gated by `readOnly` (matches every other programmatic mutation method). Both methods
  return an `ImportSummary` (`{ format, taskCount, dependencyCount }`), the same value emitted
  by `data:imported`; `importCsv`'s `dependencyCount` is always `0` (CSV has no dependency
  concept).

- 6e3bee5: feat(core): JSON + CSV import/export (IO layer)

  Add a headless, tree-shakable `io/` module for persisting/loading Gantt data:

  - `exportJson(tasks, dependencies, options?)` → a `{ fluxgantt: { schemaVersion, exported_at },
tasks, dependencies }` bundle (full JSON round-trip of logical fields); `importJson(input)`
    validates it against a hand-written schema and returns `{ tasks, dependencies }` to feed
    `createGantt(...)`.
  - `exportCsv(tasks, options?)` / `importCsv(csv)` — a flat, spreadsheet-friendly tasks CSV
    (RFC-4180). `gantt.exportJson()` / `gantt.exportCsv()` facade methods delegate over the live
    instance.

  Security-hardened per `.claude/rules/security.md` §2: always-on CSV formula-injection escaping
  on export (cells starting `= + - @` / tab / CR); CSV import takes values literally (never
  re-materializes a live formula, and never corrupts a third-party CSV); schema validation is
  reject-not-best-effort and atomic; import DoS limits (task/dependency count, string/date length,
  meta key-count + depth at every level, hierarchy depth, a pre-parse input-size gate); untrusted
  values are truncated in error messages. Dates serialize as ISO-8601 UTC instants via Temporal;
  duplicate-id and dependency-cycle detection are delegated to the store on `createGantt`.

  `importJson` validates but drops store-generated fields (`createdAt`/`updatedAt`, dependency
  `id`) — they're regenerated on re-import, so the round-trip guarantee is over logical fields.
  Not included (separate tickets/tiers): PNG/SVG/PDF export, MS Project XML I/O.

- fc07b88: feat(core): keyboard navigation (roving tabindex)

  Add roving-tabindex keyboard navigation over the timeline grid (`enableKeyboardNav`,
  `interaction/keyboard-nav.ts`), wired into `Gantt#mount()` alongside `enableClickSelect`.

  - **Arrow Up/Down** move focus one row at a time (select-follows-focus: the newly focused
    row replaces the current selection), with no wraparound at the first/last row.
  - **Shift+Arrow Up/Down** extends a contiguous range selection from a fixed anchor (the
    anchor is set on the last plain selection and stays fixed across a Shift-arrow sequence).
  - **Space** toggles the focused row's selection membership without moving focus.
  - **Delete/Backspace** removes every currently selected task (`removeTask()`, cascades
    through hierarchy exactly like the existing `removeTask` API); gated off when
    `readOnly: true` — navigation (Arrow/Space) stays active in read-only charts since it never
    mutates task data.
  - **ArrowLeft/ArrowRight/Enter** are explicitly no-ops in this pass (reserved for future
    horizontal/cell navigation).
  - Focus is re-resolved against a fresh row layout on every keydown (never a stale cached
    index), and clamps to a valid row if the previously focused task no longer exists (e.g.
    removed by other code between renders).

  The SVG renderer's root `<svg>` now carries `role="grid"` (was `role="img"`), with
  `aria-rowcount` and `aria-multiselectable="true"`. Each row carries `role="row"`,
  `aria-rowindex` (1-based), `data-task-id`, `aria-selected`, and a roving `tabindex`
  (`"0"` on exactly the focused row, `"-1"` on the rest — defaulting to the first row when no
  task has focus yet). Each row wraps a single `role="gridcell"` child (single-column v1).

  Adds a new keyboard-focus indicator: a separate `<rect class="fg-task__focus-ring">` sibling
  of the task bar, shown only while its ancestor row matches `:focus-visible`, styled via new
  `--fg-task-focus` / `--fg-task-focus-width` design tokens — visually distinct from both the
  existing selection `outline` and the critical-path `stroke-dasharray`, so all three signals
  can compose on the same task without collision. `exportSvg()` strips the now-meaningless
  `tabindex` attribute from exported markup while keeping the static ARIA structure intact.

  **Deviations from the original spec, called out explicitly:**
  - `KeyboardNavOptions.getTasks` reads the full `Task[]` (matching `enableClickSelect`'s real
    contract), not the spec's `{id, parentId}` duck-type sketch.
  - `KeyboardNavOptions` gained a `getSelection: () => readonly TaskId[]` field (needed to
    resolve the initial focused row when a selection already exists at mount time).
  - Shift+Arrow range-select is implemented via a new private `Gantt#commitKeyboardRangeSelect`
    adapter (not a signature change to the existing `#commitRangeSelect`, which callers already
    depend on taking a flat `TaskId[]` — used by Shift+click).

- a87302b: feat(core): selection module

  Add `select(id | id[])`, `selectAll()`, `deselect()`, `getSelection()` on `GanttInstance`,
  plus a `selection:changed` event. Selection is a headless `SelectionStore` (`Set<TaskId>` +
  signal, mirrors `TaskStore`/`DependencyStore`), reactive through the existing render effect —
  no framework coupling.

  Click-select is a new, independent interaction module (`enableClickSelect`,
  `interaction/selection.ts`) that does _not_ register through the shared `pointer-drag.ts`
  coordinator, since that coordinator ignores below-threshold presses and click-select needs
  exactly that case. It tracks its own pointerdown/pointerup pair against the same
  `DEFAULT_DRAG_THRESHOLD_PX` so a completed drag never also fires a click. Plain click
  replaces the selection; Ctrl/Cmd+click toggles; Shift+click range-selects between the last
  anchor and the clicked row; a click on empty canvas clears the selection. Hit-testing
  resolves the row wrapper (not just `.fg-task`), so clicking a task's label selects it the
  same as clicking its bar.

  Selecting a task recursively selects all of its descendants (and deselecting a parent
  recursively deselects them); `getSelection()`/`selection:changed` always report the full
  flattened set. `removeTask()` now prunes the selection so it never references a deleted task.

  The SVG renderer adds a `.fg-task--selected` class and a CSS `outline` (not `stroke`, so it
  never collides with the critical-path dashed-stroke a11y indicator on the same `<rect>`) plus
  a ", selected" suffix on the task's `aria-label`. Selection stays interactive under
  `readOnly: true` (unlike drag-move/drag-resize/drag-create-dep, which stay disabled) since it
  doesn't mutate task data.

- a88271f: feat(core): summary auto-rollup

  Add `computeRollup(tasks, calendar?)` to the compute layer: a pure, headless function that
  derives each parent's span, progress and working-hour duration from its children, returning a
  `ReadonlyMap<TaskId, RollupResult>` keyed only by tasks that actually have children. It never
  mutates the input — a caller decides whether to apply the rolled-up values, so a host that
  wants author-controlled summary dates keeps them.

  Rollup is bottom-up and recursive: a parent whose own children are parents aggregates their
  already-rolled-up values, not their authored fields. Authored `start`/`end`/`progress` on a
  task that has children are ignored by design; a summary bar that disagrees with its subtree is
  a data-entry bug, not a value to preserve. Leaves contribute their own normalized fields plus
  `resolveDuration`.

  Progress is **duration-weighted** (`sum(d_i * p_i) / sum(d_i)`), so an 80h task at 100% and a
  20h task at 0% rolls up to 0.8 rather than 0.5. When every child has zero duration (all
  milestones, `sum(d_i) == 0`) it falls back to the plain mean, which keeps all-milestone
  parents meaningful instead of dividing by zero. The result is clamped to 0..1 with `NaN`
  mapped to 0, so hostile child values (`NaN`, `+/-Infinity`, negative, > 1) can never produce a
  non-finite or out-of-range summary.

  Min/max of the child instants use `compareInstant`, never the sign of
  `differenceInWorkingHours`: two instants less than an hour apart, or both inside non-working
  time, are genuinely different yet that difference is exactly 0. Using it to order instants
  would silently pick the wrong bound.

  Cyclic and over-deep parent chains are rejected rather than looped over: the walk is bounded
  by a shared `MAX_HIERARCHY_DEPTH` (1000) and a `visiting` guard, and a final coverage pass
  visits tasks unreachable from any root, so a pure cycle (including a self-parent) still
  throws. The throw is a plain `Error`, matching `layoutRows` — `CyclicDependencyError` stays
  reserved for dependency-graph cycles. `MAX_HIERARCHY_DEPTH` moved to a new shared
  `compute/hierarchy.ts` because both `layoutRows` (render) and `computeRollup` (compute) need
  it and the compute layer may not import from `render/`; `renderer-base.ts` re-exports it, so
  every existing import path keeps working. It is distinct from `io/limits.ts`'s depth of 100,
  which bounds what an untrusted imported file may declare.

  `computeRollup` is exported from the barrel but referenced by nothing in the facade, so
  tree-shaking drops it from every size fixture: all five budgets are unchanged and still pass
  (hello-world 7.76 / with-io 12.73 / with-render 14.28 / with-render-interaction 18.55 /
  kitchen-sink 23.21 KiB).

  Renderer integration, a facade method, and CPM summary-row handling are deliberately out of
  scope for this change.

- 2c76e69: feat(core): basic SVG renderer (render layer)

  Add `createSvgRenderer(container, input, options?)` — the first render-layer surface. It
  paints tasks (bars by `TaskKind`, hierarchy indent, milestones), FS/SS/FF/SF dependency
  lines, a day grid with weekend/holiday shading, and critical-path highlighting into an
  `<svg class="fg-timeline">`. Returns a handle with `update()`/`setOptions()`/`destroy()`.

  Pure layout math (time-scale, row/bar/dependency geometry, grid columns) lives in
  `renderer-base.ts` — headless, testable without a DOM, and the shared seam a future Canvas
  renderer reuses. All date math calls back into the working-calendar/CPM compute layer.

  Security-hardened (this is the first time core renders untrusted host data to the DOM):
  `task.name` only via `createTextNode`, `task.color` through a strict full-match whitelist,
  `task.type`/`dependency.type` whitelisted before class interpolation, constant `<marker>`
  ids, bounded grid columns and hierarchy depth (DoS guards), and an ESLint rule banning
  HTML-string sinks (`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`DOMParser`)
  in `render/`. Critical tasks are distinguished with a dashed stroke, not color alone (a11y).

  Adds `ViewMode`, `Density`, `TaskSchedule`-adjacent render types to the public surface.

- e2b4a28: Wire `Ctrl/Cmd+Z` (undo) and `Ctrl/Cmd+Shift+Z` (redo) into keyboard navigation. Both are gated
  by `readOnly` (mirroring the existing `Delete`/`Backspace` gate) and call `preventDefault()` when
  handled. No `Ctrl+Y` alternate binding. `gantt.undo()`/`gantt.redo()` themselves (shipped
  separately) are unaffected — this only adds the keyboard trigger. `KeyboardNavOptions` gains two
  new required callbacks, `onUndo`/`onRedo`, for hosts constructing `enableKeyboardNav` directly.
- a69b85e: Add undo/redo: `gantt.undo()`, `gantt.redo()`, `gantt.canUndo()`, `gantt.canRedo()`, and a
  `history:changed` event. A single drag that cascades dependent tasks, or a single multi-selection
  Delete, undoes/redoes as ONE step. New `GanttConfig.historyLimit` (default 100, ring-buffer
  eviction). `task:*`/`dependency:*` event payloads gain an additive, optional trailing `meta`
  argument (`{ source: 'undo' | 'redo' }`) so subscribers can distinguish a replayed mutation from a
  normal one — existing subscribers are unaffected. Actual `Ctrl+Z`/`Shift+Z` keyboard binding is a
  separate follow-up (the facade methods are usable programmatically today).
- 5ee6168: Wire `Ctrl + mouse wheel` (zoom in/out) into the interaction layer. New module
  `enableWheelZoom` attaches a single `wheel` listener to the mounted chart; a wheel event with
  `ctrlKey` held calls `preventDefault()` and steps the view one level toward `'day'`
  (`deltaY < 0`, scroll-up/pinch-out) or `'year'` (`deltaY > 0`, scroll-down/pinch-in) via the
  already-shipped `gantt.zoomIn()`/`gantt.zoomOut()`. A plain wheel event (no Ctrl) is
  completely untouched — normal page/container scrolling is unaffected. Not gated by `readOnly`
  (zoom mutates no store state, same posture as the existing Ctrl/Cmd+Plus/Minus keyboard
  binding). Deliberately does NOT also match `metaKey` (unlike the keyboard binding and
  click-select's Ctrl/Cmd pattern) — see spec-wheel-zoom.md §1 for the trackpad-pinch-vs-physical-
  gesture rationale. Registered with `{ passive: false }`, required for `preventDefault()` to
  actually suppress the browser's native Ctrl+wheel page-zoom (and macOS trackpad pinch-zoom,
  which the browser delivers as a synthetic Ctrl+wheel event).
- 95db331: Wire `Ctrl/Cmd + Plus` (zoom in) and `Ctrl/Cmd + Minus` (zoom out) into keyboard navigation.
  Matches `event.key === '+' || event.key === '='` for zoom-in (covers the common unshifted
  `Ctrl+=` keystroke, the literal Shift+`=` press, and Numpad `+`) and `event.key === '-'` for
  zoom-out (covers the unshifted main-row key and Numpad `-`); `Shift` state is not otherwise
  consulted. Unlike Delete/undo/redo, neither binding is gated by `readOnly` — zoom mutates no
  store state. Both call `preventDefault()` to suppress the browser's native page-zoom shortcut.
  `gantt.zoomIn()`/`gantt.zoomOut()` themselves (shipped separately, PR #25) are unaffected — this
  only adds the keyboard trigger. `KeyboardNavOptions` gains two new required callbacks,
  `onZoomIn`/`onZoomOut`, for hosts constructing `enableKeyboardNav` directly.
- 4632393: feat(core): runtime zoom / view-mode switching

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

### Patch Changes

- 9d8a42d: fix(core): window the Canvas renderer's hidden a11y grid layer instead of rebuilding it in full every render (#36)

  `canvas-renderer.ts`'s hidden ARIA `role="grid"` a11y layer (`a11yLayer`) used to tear down and
  rebuild one real DOM row (4 nodes: row/gridcell/label/task) per task, for **every** task, on
  every `render()` call — an O(taskCount) DOM-construction cost with no relation to what's visible
  or focused. At the Canvas auto-switch threshold (2000 tasks) this made a real `mount()` via
  Canvas ~33% _slower_ than a fair forced-SVG mount at the same task count, inverting the whole
  point of the auto-switch (`architecture.md`'s "Canvas fallback... task count > 2000" framing
  assumes Canvas is the faster path).

  The a11y layer's DOM construction is now windowed: only `2 * A11Y_WINDOW_OVERSCAN + 1` (101) rows
  are built, centered on the currently-focused row (`focusedTaskId`), instead of every row in the
  project. `aria-rowcount` still always reports the true, full row count — only DOM-node
  _construction_ is windowed, not the grid's reported size. `row.rowIndex`/`aria-rowindex` still
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

  | Case                                                                 | n   | median    | p75       | min       | max       | committed budget    |
  | -------------------------------------------------------------------- | --- | --------- | --------- | --------- | --------- | ------------------- |
  | taskCount=2000, SVG (at threshold) — unaffected by this fix          | 20  | 2674.9ms  | 2728.6ms  | 2573.5ms  | 2824.0ms  | 5000ms (unchanged)  |
  | taskCount=2001, Canvas (just over threshold)                         | 20  | 1228.6ms  | 1236.7ms  | 1198.8ms  | 1253.9ms  | 2300ms (was 4600ms) |
  | taskCount=2001, forced-SVG comparative path — unaffected by this fix | 20  | 1831.3ms  | 1843.3ms  | 1747.7ms  | 1940.4ms  | 3400ms (was 3500ms) |
  | taskCount=5000 (SVG-via-dimension-fallback, unrelated to this fix)   | 20  | 6543.9ms  | 6571.7ms  | 6465.9ms  | 6620.6ms  | 12000ms (unchanged) |
  | taskCount=10000 (SVG-via-dimension-fallback, unrelated to this fix)  | 10  | 12916.9ms | 13001.0ms | 12562.8ms | 13242.9ms | 26500ms (unchanged) |

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

- d4f26e7: fix(core): Canvas renderer no longer silently blanks on oversized bitmaps

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

- f3f107a: fix(core): Canvas mode is no longer structurally unreachable for large flat projects (#37)

  `createCanvasRenderer()` sized the `<canvas>` backing-store bitmap's height directly from the
  full, unclipped row count (`headerHeight + rowCount * rowHeight`), checked against the
  `CanvasDimensionExceededError` guard added by the prior row-limit fix. That guard was correct,
  but it meant any flat (no-collapse) project past ~2,047 rows at default density (fewer on
  HiDPI displays) could never mount via Canvas at all — `mount()`'s auto-switch would pick
  Canvas past its own `>2000`-task threshold, immediately hit the dimension guard, and silently
  fall back to SVG, defeating the entire point of the Canvas fallback existing.

  `createCanvasRenderer()` now binds the canvas's physical height to a fixed, host-configurable
  viewport (`resolveViewportHeightPx()`, default 600px, `GanttConfig.canvasViewportHeight` /
  `CanvasRendererOptions.viewportHeight` to override) instead of the full content height.
  `container` becomes the real scroll viewport (`overflowY: auto`, sized to the resolved
  viewport height); a zero-content spacer element gives it a real `scrollHeight` matching the
  full, unbounded row count. Both the canvas bitmap and the hidden ARIA `role="grid"` layer
  (issue #36) now materialize only the row band that intersects the current scroll position
  (`computeVisibleWindow()`, 20-row overscan on each side) rather than either the full row count
  or a focus-centered window — cost no longer scales with total row count at all, so a
  10,000-row flat project mounts via Canvas exactly as cheaply as a 2,001-row one.
  `ensureFocusedRowVisible()` keeps keyboard navigation (ArrowUp/ArrowDown past the edge of the
  current window) scrolled to the newly focused row automatically, gated to only fire when the
  resolved focused task actually changes between renders — an unconditional version of this
  found during testing would otherwise undo any plain user scroll (mouse wheel, scrollbar drag)
  on the very next repaint, since a just-mounted chart's focus defaults to row 0.

  A second, independent bug was found and fixed in the same change: the hidden a11y layer's
  `position: sticky` pinning (needed so it stays reachable at the container's visible top-left
  regardless of scroll) only works once the element's own natural, pre-scroll flow position has
  already been reached — the a11y layer was being inserted into `container` AFTER the
  zero-content spacer, so its natural offset sat near the very bottom of the (often
  tens-of-thousands-of-pixels-tall) content instead of near the top. A bare `Tab` press (or any
  `.focus()` call without `preventScroll`) would trigger the browser's native scroll-into-view
  behavior, yanking `container.scrollTop` almost to the bottom just to reach the tabindex="0"
  row — which then changed which rows the very next render materialized, dropping focus back to
  `<body>` entirely. Fixed by inserting the a11y layer before the canvas element (natural offset
  ~0), matching the canvas element's own existing placement.

  Real-Chromium mount budgets (`tests/performance/canvas-mount.spec.ts`, `?taskCount=N` via
  `examples/plain-html-demo/canvas-mount-perf-harness.html`): 5,000 flat rows mount via Canvas in
  ~4.1s (budget 4.2s), 10,000 rows in ~6.8s (budget 8s) — both now genuinely successful Canvas
  mounts (`data-renderer="canvas"`, no `data-canvas-fallback-reason`), previously impossible.
  Canvas mount is also now consistently faster than a fair forced-SVG mount at the same task
  count (this ticket's own prior a11y-layer DOM-node-count fix, issue #36, already improved that
  comparison; this fix removes the remaining row-count-scaling cost entirely).

  `position: sticky`'s correctness (both for the canvas and the a11y layer, across scroll and
  keyboard navigation) is empirically re-verified by a new Playwright a11y test and a new visual-
  regression snapshot at 5,000 rows mid-scroll, in addition to unit coverage for
  `resolveViewportHeightPx()`, `computeVisibleWindow()`, and `ensureFocusedRowVisible()`.

- 1ca8a67: fix(core): guard against WebKit's stricter Canvas backing-store area limit

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
  check strictly _after_ the existing, unchanged Chromium width/height checks, and the WebKit
  area check only ever adds restriction — a Chromium (or any non-WebKit) user agent can never
  become more restrictive than the previously-shipped behavior.

  Like the sibling fix, this module remains internal/unwired (no public API surface change,
  zero behavioral impact on any real consumer today). The same Ticket 3 auto-switch requirement
  applies: it must catch `CanvasDimensionExceededError` (any axis) and fall back to
  `createSvgRenderer()`.

- 078ba05: fix(core): don't throw when a mounted Gantt transitions from 0 to 1 task

  `Gantt#renderNow` called `handle.update()` and `handle.setOptions()` (which each trigger an
  independent synchronous `render()`) in an order that briefly exposed an empty task list with
  no `timeRange` set, making the renderer's `deriveTimeRange()` throw
  (`tasks must not be empty`) when a mounted chart went from 0 → 1 task (e.g.
  `createGantt({}).mount(el)` then `addTask(...)`). The two calls are now ordered by transition
  direction so that "empty tasks + unset timeRange" is never observed. Adds 0→1 and N→0→1
  regression tests.
