export { createSvgRenderer, ARROWHEAD_MARKER_ID, LABEL_COLUMN_WIDTH } from './svg-renderer.js';
export type { SvgRendererInput, SvgRendererOptions, SvgRendererHandle } from './svg-renderer.js';
export type { InteractiveRendererHandle } from './interactive-renderer-handle.js';

export {
  createTimeScale,
  deriveTimeRange,
  layoutRows,
  layoutTaskBar,
  layoutDependencyPath,
  computeGridColumns,
  validateTaskColor,
  anchorOf,
  PIXELS_PER_DAY,
  ROW_HEIGHT,
  MAX_GRID_COLUMNS,
} from './renderer-base.js';
export type {
  TimeRange,
  TimeScale,
  RowLayout,
  TaskBarLayout,
  DependencyPathLayout,
  GridColumn,
} from './renderer-base.js';

// Opt-in facade capability (spec-facade-split.md §3.3) — `withRender(createGantt(cfg))` adds
// the `mount`/`unmount`/`refresh` methods that used to live on the `Gantt` class itself.
export { withRender, CANVAS_AUTO_SWITCH_THRESHOLD } from './mixin.js';
export type { RenderCapability } from './mixin.js';
