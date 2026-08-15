---
"@fluxgantt/core": minor
---

feat(core): keyboard navigation (roving tabindex)

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
