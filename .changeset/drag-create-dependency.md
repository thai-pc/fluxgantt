---
"@fluxgantt/core": minor
---

feat(core): drag-create-dependency interaction

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
