---
"@fluxgantt/core": minor
---

feat(core): selection module

Add `select(id | id[])`, `selectAll()`, `deselect()`, `getSelection()` on `GanttInstance`,
plus a `selection:changed` event. Selection is a headless `SelectionStore` (`Set<TaskId>` +
signal, mirrors `TaskStore`/`DependencyStore`), reactive through the existing render effect —
no framework coupling.

Click-select is a new, independent interaction module (`enableClickSelect`,
`interaction/selection.ts`) that does *not* register through the shared `pointer-drag.ts`
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
