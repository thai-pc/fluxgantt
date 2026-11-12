---
'@fluxgantt/core': minor
---

Tier the public API with TSDoc release tags (see `STABILITY.md`). No runtime change: every bundle fixture is byte-identical.

Beta: these 61 symbols are now `@beta` and may change or be removed in any minor release without a deprecation window.

- `@fluxgantt/core`: `signal`, `computed`, `effect`, `batch`, `untracked`, `ReadonlySignal`, `TaskStore`, `DependencyStore`, `LinkOptions`, `normalizeDate`, `computeCascade`, `CascadeResult`, `CascadeShift`, `ComputeCriticalPathOptions`, `ConstraintResolver`, `ConstraintResolverContext`, `toResourceId`, `toBaselineId`, `toProjectId`, `ResourceId`, `BaselineId`, `ProjectId`, `ResourceAssignment`, `TaskConstraint`, `GanttAnnouncement` (and the `GanttMessages.announce` member that takes it).
- `@fluxgantt/core/io`: `escapeCsvValue`.
- `@fluxgantt/core/render`: `createSvgRenderer`, `createTimeScale`, `deriveTimeRange`, `layoutRows`, `layoutTaskBar`, `layoutDependencyPath`, `computeGridColumns`, `anchorOf`, `validateTaskColor`, `ROW_HEIGHT`, `SvgRendererInput`, `SvgRendererOptions`, `SvgRendererHandle`, `BarHit`, `BarZone`, `InteractiveRendererHandle`, `TimeRange`, `TimeScale`, `RowLayout`, `TaskBarLayout`, `DependencyPathLayout`, `GridColumn`.
- `@fluxgantt/core/interaction`: `enableDragMove`, `enableDragResize`, `enableDragCreateDep`, `enableClickSelect`, `enableKeyboardNav`, `enableWheelZoom` and their option/handle types `DragMoveOptions`, `DragResizeOptions`, `DragCreateDepOptions`, `SelectionOptions`, `KeyboardNavOptions`, `KeyboardNavHandle`, `WheelZoomOptions`.

Deprecated: these 7 symbols were exported by accident. They still work, are also `@beta`, and will stop being exported no earlier than 2 minor releases and 30 days after this release.

- `Signal` (class, from `@fluxgantt/core`): annotate with the `ReadonlySignal` type instead; a type-only export will remain.
- `SelectionStore` (from `@fluxgantt/core`): use `GanttInstance.select()` / `getSelection()`.
- `CollapseStore` (from `@fluxgantt/core`): use `GanttInstance.toggleCollapse()` / `isCollapsed()`.
- `ARROWHEAD_MARKER_ID`, `LABEL_COLUMN_WIDTH`, `PIXELS_PER_DAY`, `MAX_GRID_COLUMNS` (from `@fluxgantt/core/render`): no replacement.

Also deprecated at member level: `TaskStore.restore()` and `DependencyStore.restore()` (history replay only: they bypass validation and events; no replacement).

`TaskStore` and `DependencyStore` are `@beta`, not deprecated. Public declarations that reference a `@beta` type (`Task.constraint`, `Task.resources`, `computeCriticalPath`'s options) are recorded as `ae-incompatible-release-tags` warnings in `core.api.md`.
