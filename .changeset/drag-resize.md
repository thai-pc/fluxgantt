---
"@fluxgantt/core": minor
---

feat(core): drag-resize interaction

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
