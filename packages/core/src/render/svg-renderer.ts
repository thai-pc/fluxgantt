// SVG renderer (spec-svg-renderer.md §1.1, §3). DOM-specific: calls into
// `renderer-base.ts` for all layout math, then paints the result with
// `document.createElementNS`/`setAttribute`/`el.style.setProperty`. Contains NO layout
// math of its own — every position/size number comes from `renderer-base.ts`, every
// date/calendar fact comes from `compute/working-calendar.ts`.
//
// SECURITY (security.md, spec §8 — read before touching this file): `task.name` is the
// only free-form string rendered as text in v1, and it is ALWAYS written via
// `document.createTextNode` — never `innerHTML`, never a template string assembled into
// markup. `task.color` is only ever used after `validateTaskColor()` accepts it.
// `<marker>` ids are compile-time constants, never derived from task/user data.
import { getTemporal } from '../internal/temporal.js';
import { DEFAULT_CALENDAR, normalizeDate } from '../compute/working-calendar.js';
import {
  ROW_HEIGHT,
  createTimeScale,
  computeGridColumns,
  deriveTimeRange,
  layoutDependencyPath,
  layoutRows,
  layoutTaskBar,
  validateTaskColor,
  isKnownTaskKind,
  isKnownDependencyType,
  anchorOf,
  type GridColumn,
  type RowLayout,
  type TaskBarLayout,
  type TimeScale,
} from './renderer-base.js';
import type {
  CriticalPathResult,
  DateInput,
  Density,
  Dependency,
  Task,
  TaskId,
  ViewMode,
  WorkingCalendar,
} from '../types.js';

export interface SvgRendererInput {
  readonly tasks: readonly Task[];
  readonly dependencies: readonly Dependency[];
  /** Optional — output of `computeCriticalPath()` called by the caller. `undefined` =
   *  no task painted as critical. */
  readonly criticalPath?: CriticalPathResult;
  /** Default `DEFAULT_CALENDAR` — used to shade weekend/holiday columns. */
  readonly calendar?: WorkingCalendar;
  /** Optional — ids currently selected (already the FULL flattened set, descendants
   *  included). `undefined`/omitted = nothing selected. Mirrors `criticalPath` as an
   *  array-at-the-boundary, `Set` internally (see render()). */
  readonly selectedTaskIds?: readonly TaskId[];
  /** Optional — the task id whose row currently has keyboard focus (roving tabindex,
   *  spec-keyboard-nav.md §4.5). `undefined` = no keyboard interaction has happened yet;
   *  the renderer falls back to the first row so the grid remains exactly one native Tab
   *  stop even before any arrow key has been pressed. */
  readonly focusedTaskId?: TaskId | undefined;
}

export interface SvgRendererOptions {
  readonly viewMode?: ViewMode; // default 'week'
  readonly density?: Density; // default 'default'
  /** Visible date range. Omitted → inferred from min(start)..max(end) of `tasks` + padding. */
  readonly timeRange?: { readonly start: DateInput; readonly end: DateInput };
  /** Locale for date labels (Temporal + Intl formatting). Default 'en'. */
  readonly locale?: string;
  /** `aria-label` for the root `<svg>`. Default `'Gantt chart'`. */
  readonly ariaLabel?: string;
  /** Render the `.fg-task__link-handle` connector handles (+ their hover-reveal `<style>`).
   *  Default `true`. The facade sets this to `false` for a `readOnly` Gantt so a
   *  non-editable chart shows no interactive link affordance. */
  readonly showLinkHandles?: boolean;
}

export interface SvgRendererHandle {
  /** Root `<svg>` created and appended into `container` by the renderer. */
  readonly svg: SVGSVGElement;
  readonly container: HTMLElement;
  /** Full repaint (no diff — spec §5.5) with new input. */
  update(input: SvgRendererInput): void;
  /** Change viewMode/density/timeRange/locale/ariaLabel and repaint with the last input. */
  setOptions(options: Partial<SvgRendererOptions>): void;
  /** Removes all DOM the renderer created from `container`. `update()`/`setOptions()`
   *  after `destroy()` are a no-op. */
  destroy(): void;
  /**
   * `TimeScale` of the most recent render — used by the interaction layer (drag-move,
   * later drag-resize/drag-create-dep) to convert pixel deltas to dates without
   * re-deriving the range/viewMode/calendar defaults a second time
   * (spec-drag-move.md §0). A new object every time `update()`/`setOptions()` runs; the
   * same object for the duration of one render.
   */
  getTimeScale(): TimeScale;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const LABEL_COLUMN_WIDTH = 160;
const HEADER_HEIGHT = 32;
const LABEL_INDENT_PX = 16;
const LABEL_PADDING_PX = 8;

/** Compile-time constant — never derived from task/user data (security §8). Exported so
 *  `interaction/drag-create-dep.ts`'s rubber-band preview can reference the SAME marker id
 *  string instead of a second hardcoded copy (single source of truth). */
export const ARROWHEAD_MARKER_ID = 'fg-dep-arrowhead';

// Static CSS text — NEVER derived from task/user data (security.md: nothing here is
// interpolated; this is a compile-time constant string assigned via .textContent, not
// innerHTML, not a template literal built from any external input). Provides the pure-CSS
// hover-reveal for `.fg-task__link-handle` (spec-drag-create-dependency.md §4.1) — there is no
// base stylesheet file anywhere in `packages/core`, so this is injected as a static inline
// `<style>` child on every full repaint (same "works with zero required host CSS" posture the
// rest of this file already keeps via inline `style.setProperty(...)`).
const LINK_HANDLE_STYLE_TEXT = `
.fg-task__link-handle {
  opacity: 0;
  /* pointer-events none while hidden — an opacity:0 element is STILL hit-testable (unlike
     display/visibility), so with 'all' the invisible handle sitting on the bar's start/end
     anchor would shadow drag-resize's edge zone / drag-move and swallow those pointerdowns
     at priority -10. Only the REVEALED handle (below) is grabbable. */
  pointer-events: none;
  transition: opacity var(--fg-transition-fast, 100ms ease-out);
}
.fg-task:hover .fg-task__link-handle,
.fg-task:focus-within .fg-task__link-handle {
  opacity: 1;
  pointer-events: all;
}
@media (hover: none) {
  /* No hover concept on touch — reveal (and enable) unconditionally rather than ship a
     feature that is structurally invisible/undiscoverable there. */
  .fg-task__link-handle { opacity: 1; pointer-events: all; }
}
@media (prefers-reduced-motion: reduce) {
  .fg-task__link-handle { transition: none; }
}
`;

// Static CSS text — compile-time constant, never derived from task/user data (security.md).
// Selection is a pure-CSS `outline` (a separate box-model property from SVG `stroke`) —
// deliberately NOT the same property the critical-path indicator uses inline on `.fg-task__bar`
// (`stroke`/`stroke-dasharray`/`stroke-width`, see renderTaskBar), so a task that is both
// critical and selected keeps BOTH signals visible (spec-selection.md §7.3). Always-on,
// unconditional (unlike LINK_HANDLE_STYLE_TEXT, which is gated behind `showLinkHandles`) —
// selection must stay visible even in a `readOnly` chart.
const SELECTION_STYLE_TEXT = `
.fg-task--selected .fg-task__bar {
  outline: var(--fg-task-selected-width, 2px) solid var(--fg-task-selected, #4338ca);
  outline-offset: var(--fg-task-selected-offset, 2px);
}
`;

/** Geometry offset (px) between the task bar's own edge and the extra focus-ring `<rect>`'s
 *  edge — matches the `--fg-task-focus-offset` design token's default (spec §5.1). SVG
 *  geometry (x/y/width/height/rx) is plain attributes, not CSS, so unlike the color and
 *  stroke-width of the ring (which stay CSS-custom-property-driven and themeable), the
 *  ring's shape must be computed once in JS at render time — this constant is that single
 *  source of truth, kept in sync with the CSS default by convention (same pattern already
 *  used for LABEL_INDENT_PX/LABEL_PADDING_PX above, which also mirror geometry the CSS layer
 *  cannot itself express). */
const FOCUS_RING_OFFSET_PX = 5;

// Static CSS text — compile-time constant, never derived from task/user data (security.md).
// Keyboard focus indicator (spec-keyboard-nav.md §5.2, corrected mechanism per §12.5).
// IMPLEMENTATION-DETAIL CORRECTION FROM THE SPEC'S ORIGINAL DRAFT: the spec's initial text
// proposed a second CSS `outline` on `.fg-task__bar`, but SVG's `outline` property is a
// single, non-stacking box-model property already claimed by `SELECTION_STYLE_TEXT` above —
// a task that is simultaneously selected AND focused needs BOTH rings visible at once, which
// two `outline` declarations on the same element cannot do (last-wins collision). `box-shadow`
// (the spec's own §12.5 fallback suggestion) was considered but rejected: `box-shadow` does
// not render on inner SVG shape elements (`rect`/`circle`/`path`) in any browser — it only
// applies to elements that establish an actual CSS box (the outer `<svg>`, HTML content, or
// `foreignObject`), not SVG shapes painted via the SVG rendering model. The mechanism actually
// used here — §12.5's OTHER explicitly-offered option — is a second, purpose-built
// `<rect class="fg-task__focus-ring">` sibling (see `renderTaskBar`), always present in the
// DOM (rendered unconditionally, every task, every render) but visually inert by default
// (`stroke: none`); its `stroke` is set ONLY by the `:focus-visible` rule below, targeting the
// ancestor `.fg-timeline__row` (not the ring itself, since SVG has no `:focus-within`-on-self
// concept here) — so ring visibility tracks the browser's native focus-visible heuristic with
// zero extra JS toggling. `:focus-visible` (not bare `:focus`) so focus arriving via pointer
// interaction never spuriously shows the keyboard ring. Always-on, unconditional (matches
// SELECTION_STYLE_TEXT's posture — focus must stay visible even in a `readOnly` chart, since
// Arrow/Space navigation stays active there).
const FOCUS_STYLE_TEXT = `
.fg-timeline__row:focus-visible {
  outline: none; /* the row <g> itself is not the visual target; suppress default UA outline on it */
}
.fg-task__focus-ring {
  fill: none;
  stroke: none;
  pointer-events: none;
}
.fg-timeline__row:focus-visible .fg-task__focus-ring {
  stroke: var(--fg-task-focus, #0ea5e9);
  stroke-width: var(--fg-task-focus-width, 2px);
}
@media (prefers-reduced-motion: reduce) {
  .fg-task__focus-ring {
    transition: none;
  }
}
`;

/** Defensive string-length cap applied to any task field folded into an `aria-label`
 *  attribute value (security.md "limit string length"). */
const MAX_ARIA_NAME_LENGTH = 200;

const DEFAULT_VIEW_MODE: ViewMode = 'week';
const DEFAULT_DENSITY: Density = 'default';
const DEFAULT_LOCALE = 'en';
const DEFAULT_ARIA_LABEL = 'Gantt chart';

/**
 * Creates and mounts an SVG renderer into `container` — appends one
 * `<svg class="fg-timeline">` child (does not accept an existing `<svg>` as `container`).
 */
export function createSvgRenderer(
  container: HTMLElement,
  input: SvgRendererInput,
  options: SvgRendererOptions = {},
): SvgRendererHandle {
  let currentInput = input;
  let currentOptions: SvgRendererOptions = { ...options };
  let destroyed = false;
  // Assigned inside render(), which always runs synchronously below before the handle is
  // returned — never read while unassigned (definite-assignment asserted).
  let currentTimeScale!: TimeScale;

  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('class', 'fg-timeline');
  // `role`/`aria-rowcount`/`aria-multiselectable` are set INSIDE render() (spec-keyboard-nav.md
  // §3.2 point 1) — `aria-rowcount` depends on the row count, which isn't known until the
  // first render(), so no static value is set here beyond the role/attribute EXISTING in the
  // DOM once render() runs synchronously below.
  container.appendChild(svg);

  render();

  return {
    svg,
    container,
    update(nextInput: SvgRendererInput): void {
      if (destroyed) return;
      currentInput = nextInput;
      render();
    },
    setOptions(nextOptions: Partial<SvgRendererOptions>): void {
      if (destroyed) return;
      currentOptions = { ...currentOptions, ...nextOptions };
      render();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      svg.remove();
    },
    getTimeScale(): TimeScale {
      // No `destroyed` guard needed — returns the last render's TimeScale (harmless, pure
      // data) even after destroy(), same non-throwing spirit as the rest of this handle.
      return currentTimeScale;
    },
  };

  function render(): void {
    // Captured BEFORE the full repaint below destroys every existing row element (spec
    // §4.5 point 4) — the gate that prevents this render pass from ever STEALING focus
    // during a purely programmatic/headless mutation (e.g. a host app calling
    // `gantt.addTask()` while the Gantt itself isn't focused): focus is only ever
    // RESTORED, never newly grabbed.
    const hadFocusInside =
      typeof document !== 'undefined' && document.activeElement !== null && svg.contains(document.activeElement);

    const calendar = currentInput.calendar ?? DEFAULT_CALENDAR;
    const viewMode = currentOptions.viewMode ?? DEFAULT_VIEW_MODE;
    const density = currentOptions.density ?? DEFAULT_DENSITY;
    const locale = currentOptions.locale ?? DEFAULT_LOCALE;
    const ariaLabel = (currentOptions.ariaLabel ?? DEFAULT_ARIA_LABEL).slice(0, MAX_ARIA_NAME_LENGTH);

    const optionRange = currentOptions.timeRange;
    const range = optionRange
      ? {
          start: normalizeDate(optionRange.start, calendar.timezone),
          end: normalizeDate(optionRange.end, calendar.timezone),
        }
      : deriveTimeRange(currentInput.tasks, viewMode, calendar);

    const timeScale = createTimeScale(range, viewMode, calendar);
    currentTimeScale = timeScale;
    const rowHeight = ROW_HEIGHT[density];
    const rows = layoutRows(currentInput.tasks, density);

    const barByTaskId = new Map<TaskId, TaskBarLayout>();
    let clampedCount = 0;
    for (const row of rows) {
      const bar = layoutTaskBar(row.task, timeScale, row, rowHeight);
      barByTaskId.set(row.task.id, bar);
      if (
        row.task.type !== 'milestone' &&
        timeScale.dateToX(row.task.end) < timeScale.dateToX(row.task.start)
      ) {
        clampedCount++;
      }
    }
    if (clampedCount > 0) {
      // Single summary warning per render (spec §11 Q5) — not silent, but not a
      // per-task flood either.
      console.warn(
        `@fluxgantt/core svg-renderer: ${clampedCount} task(s) have end before start — bar width clamped to 0.`,
      );
    }

    // "Today" is read from the real clock only here, at the DOM boundary — never inside
    // a pure `renderer-base.ts` function (spec §6).
    const now = getTemporal().Now.zonedDateTimeISO(calendar.timezone);
    const gridColumns = computeGridColumns(timeScale, viewMode, calendar, locale, now);
    const criticalIds = new Set(currentInput.criticalPath?.criticalTaskIds ?? []);
    const selectedIds = new Set(currentInput.selectedTaskIds ?? []);

    const offsetX = LABEL_COLUMN_WIDTH;
    const offsetY = HEADER_HEIGHT;
    const bodyHeight = rows.length > 0 ? rows[rows.length - 1]!.y + rowHeight : rowHeight;
    const totalWidth = offsetX + timeScale.totalWidth;
    const totalHeight = offsetY + bodyHeight;

    // Full repaint — no diff in v1 (spec §5.5 / handle doc).
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    svg.setAttribute('width', String(totalWidth));
    svg.setAttribute('height', String(totalHeight));
    svg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
    svg.setAttribute('aria-label', ariaLabel);
    // ARIA grid structure (spec-keyboard-nav.md §3.2 point 1) — replaces the old placeholder
    // `role="img"`. `aria-multiselectable` is always "true": Core's selection model always
    // supports multi-select (Ctrl/Shift-click, Shift+Arrow), not gated by any config flag.
    svg.setAttribute('role', 'grid');
    svg.setAttribute('aria-rowcount', String(rows.length));
    svg.setAttribute('aria-multiselectable', 'true');

    const showLinkHandles = currentOptions.showLinkHandles ?? true;
    // `focusedTaskId` falls back to the FIRST row when unset (spec §4.5 point 3) — before any
    // keyboard interaction has happened, the grid must still be exactly one native Tab stop.
    const focusedTaskId = currentInput.focusedTaskId ?? rows[0]?.task.id;

    svg.appendChild(createArrowheadMarker());
    svg.appendChild(createSelectionStyle());
    svg.appendChild(createFocusStyle());
    if (showLinkHandles) svg.appendChild(createLinkHandleStyle());
    svg.appendChild(renderGrid(gridColumns, offsetX, totalHeight));
    svg.appendChild(renderHeader(gridColumns, offsetX, timeScale.totalWidth));
    svg.appendChild(
      renderDependencies(currentInput.dependencies, barByTaskId, rowHeight, offsetX, offsetY),
    );
    svg.appendChild(
      renderRows(
        rows,
        barByTaskId,
        criticalIds,
        selectedIds,
        focusedTaskId,
        rowHeight,
        calendar,
        locale,
        offsetX,
        offsetY,
        showLinkHandles,
      ),
    );
    svg.appendChild(renderLabelDivider(offsetX, totalHeight));

    // Focus restoration (spec §4.5 point 4) — MUST run after every element above is already
    // appended to `svg`, since the target row element is freshly created by renderRows() in
    // this same synchronous pass.
    if (hadFocusInside && focusedTaskId !== undefined) {
      const rowEl = svg.querySelector<SVGElement>(
        `.fg-timeline__row[data-task-id="${cssEscapeAttr(focusedTaskId)}"]`,
      );
      rowEl?.focus({ preventScroll: true });
    }
  }
}

/** Minimal CSS.escape-equivalent for a `data-task-id` value interpolated into an attribute
 *  selector string (`querySelector`). `task.id` is a branded, developer-controlled `TaskId`
 *  (never raw untrusted host free-text — same posture already documented at
 *  `renderTaskBar`'s `data-task-id` assignment above), but this is cheap defense-in-depth
 *  against a value containing a `"` breaking the selector string. Uses the platform
 *  `CSS.escape` when available (all supported browsers + modern jsdom), falls back to a
 *  minimal manual escape otherwise so this file never hard-requires `CSS.escape`. */
function cssEscapeAttr(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  if (css?.escape) return css.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

// --- DOM builders (drawing only — no layout math) ------------------------------------

function createArrowheadMarker(): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, 'defs') as SVGDefsElement;
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', ARROWHEAD_MARKER_ID);
  marker.setAttribute('viewBox', '0 0 8 8');
  marker.setAttribute('refX', '7');
  marker.setAttribute('refY', '4');
  marker.setAttribute('markerWidth', '6');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrow = document.createElementNS(SVG_NS, 'path');
  arrow.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z');
  arrow.style.setProperty('fill', 'var(--fg-dep-line, #64748b)');
  marker.appendChild(arrow);
  defs.appendChild(marker);
  return defs;
}

function createLinkHandleStyle(): SVGStyleElement {
  const style = document.createElementNS(SVG_NS, 'style') as SVGStyleElement;
  style.textContent = LINK_HANDLE_STYLE_TEXT;
  return style;
}

function createFocusStyle(): SVGStyleElement {
  const style = document.createElementNS(SVG_NS, 'style') as SVGStyleElement;
  style.textContent = FOCUS_STYLE_TEXT;
  return style;
}

function createSelectionStyle(): SVGStyleElement {
  const style = document.createElementNS(SVG_NS, 'style') as SVGStyleElement;
  style.textContent = SELECTION_STYLE_TEXT;
  return style;
}

function renderGrid(columns: readonly GridColumn[], offsetX: number, totalHeight: number): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.setAttribute('class', 'fg-timeline__grid');
  for (const col of columns) {
    const x = col.x + offsetX;
    if (col.isToday || col.isHoliday || col.isWeekend) {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('class', 'fg-timeline__grid-cell');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', '0');
      rect.setAttribute('width', String(col.width));
      rect.setAttribute('height', String(totalHeight));
      const fill = col.isToday
        ? 'var(--fg-grid-today, #fef3c7)'
        : col.isHoliday
          ? 'var(--fg-grid-holiday, #fee2e2)'
          : 'var(--fg-grid-weekend, #f9fafb)';
      rect.style.setProperty('fill', fill);
      g.appendChild(rect);
    }
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'fg-timeline__grid-line');
    line.setAttribute('x1', String(x));
    line.setAttribute('x2', String(x));
    line.setAttribute('y1', '0');
    line.setAttribute('y2', String(totalHeight));
    line.style.setProperty('stroke', 'var(--fg-grid-line, #e5e7eb)');
    g.appendChild(line);
  }
  return g;
}

function renderHeader(columns: readonly GridColumn[], offsetX: number, timelineWidth: number): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.setAttribute('class', 'fg-timeline__header');

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(offsetX));
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(timelineWidth));
  bg.setAttribute('height', String(HEADER_HEIGHT));
  bg.style.setProperty('fill', 'var(--fg-bg-subtle, #f3f4f6)');
  g.appendChild(bg);

  for (const col of columns) {
    const x = col.x + offsetX;
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', 'fg-timeline__header-label');
    text.setAttribute('x', String(x + col.width / 2));
    text.setAttribute('y', String(HEADER_HEIGHT / 2));
    text.style.setProperty('text-anchor', 'middle');
    text.style.setProperty('dominant-baseline', 'middle');
    text.style.setProperty('fill', 'var(--fg-fg-muted, #71717a)');
    // Label is Temporal/Intl-formatted (never user input), but always via createTextNode
    // regardless — consistent no-innerHTML policy applies everywhere in render/.
    text.appendChild(document.createTextNode(col.label));
    g.appendChild(text);
  }

  const divider = document.createElementNS(SVG_NS, 'line');
  divider.setAttribute('x1', String(offsetX));
  divider.setAttribute('x2', String(offsetX + timelineWidth));
  divider.setAttribute('y1', String(HEADER_HEIGHT));
  divider.setAttribute('y2', String(HEADER_HEIGHT));
  divider.style.setProperty('stroke', 'var(--fg-border-strong, #d4d4d8)');
  g.appendChild(divider);

  return g;
}

function renderLabelDivider(offsetX: number, totalHeight: number): SVGLineElement {
  const line = document.createElementNS(SVG_NS, 'line') as SVGLineElement;
  line.setAttribute('class', 'fg-timeline__label-divider');
  line.setAttribute('x1', String(offsetX));
  line.setAttribute('x2', String(offsetX));
  line.setAttribute('y1', '0');
  line.setAttribute('y2', String(totalHeight));
  line.style.setProperty('stroke', 'var(--fg-border, #e5e7eb)');
  return line;
}

function renderRows(
  rows: readonly RowLayout[],
  barByTaskId: ReadonlyMap<TaskId, TaskBarLayout>,
  criticalIds: ReadonlySet<TaskId>,
  selectedIds: ReadonlySet<TaskId>,
  focusedTaskId: TaskId | undefined,
  rowHeight: number,
  calendar: WorkingCalendar,
  locale: string,
  offsetX: number,
  offsetY: number,
  showLinkHandles: boolean,
): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.setAttribute('class', 'fg-timeline__rows');

  for (const row of rows) {
    const bar = barByTaskId.get(row.task.id);
    if (!bar) continue;

    const isSelected = selectedIds.has(row.task.id);

    // ARIA grid row (spec-keyboard-nav.md §3.2 point 2): `role="row"`, 1-based
    // `aria-rowindex` (distinct from the existing 0-based `data-row-index`, an internal
    // implementation detail), `data-task-id` (promoted up from the nested `.fg-task` `<g>`
    // — see §3.3), `aria-selected`, and roving `tabindex` (exactly one row is `0`, the rest
    // `-1`).
    const rowGroup = document.createElementNS(SVG_NS, 'g');
    rowGroup.setAttribute('class', 'fg-timeline__row');
    rowGroup.setAttribute('role', 'row');
    rowGroup.setAttribute('data-row-index', String(row.rowIndex));
    rowGroup.setAttribute('data-task-id', row.task.id);
    rowGroup.setAttribute('aria-rowindex', String(row.rowIndex + 1));
    rowGroup.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    rowGroup.setAttribute('tabindex', row.task.id === focusedTaskId ? '0' : '-1');

    // Single-column v1 (spec §3.2 point 3): exactly one `role="gridcell"` wrapper per row,
    // a pure ARIA/structural `<g>` with no `transform` of its own — zero rendering diff
    // versus the pre-keyboard-nav DOM shape.
    const cell = document.createElementNS(SVG_NS, 'g');
    cell.setAttribute('class', 'fg-timeline__row-cell');
    cell.setAttribute('role', 'gridcell');

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'fg-timeline__row-label');
    label.setAttribute('x', String(LABEL_PADDING_PX + row.depth * LABEL_INDENT_PX));
    label.setAttribute('y', String(offsetY + row.y + rowHeight / 2));
    label.style.setProperty('dominant-baseline', 'middle');
    label.style.setProperty('fill', 'var(--fg-fg, #18181b)');
    // SECURITY: `task.name` is untrusted host-app data — text node only, never innerHTML
    // or a template string assembled into markup (security.md §1, spec §8).
    label.appendChild(document.createTextNode(row.task.name));
    cell.appendChild(label);

    const isCritical = criticalIds.has(row.task.id);
    cell.appendChild(
      renderTaskBar(row.task, bar, offsetX, offsetY, isCritical, isSelected, calendar, locale, showLinkHandles),
    );

    rowGroup.appendChild(cell);
    g.appendChild(rowGroup);
  }

  return g;
}

function renderTaskBar(
  task: Task,
  bar: TaskBarLayout,
  offsetX: number,
  offsetY: number,
  isCritical: boolean,
  isSelected: boolean,
  calendar: WorkingCalendar,
  locale: string,
  showLinkHandles: boolean,
): SVGGElement {
  const wrapper = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  // Whitelist `task.type` before folding it into a class token (review N3): fall back to
  // the `task` modifier for any value that isn't a known TaskKind, so untrusted data can't
  // inject an arbitrary extra class (CSS-token spoofing).
  const kindClass = isKnownTaskKind(task.type) ? task.type : 'task';
  const classNames = ['fg-task', `fg-task--${kindClass}`];
  if (isCritical) classNames.push('fg-task--critical');
  if (isSelected) classNames.push('fg-task--selected');
  wrapper.setAttribute('class', classNames.join(' '));
  // `task.id` is a branded TaskId (developer-controlled, not free-text host input) —
  // safe as an attribute value via setAttribute regardless.
  wrapper.setAttribute('data-task-id', task.id);
  wrapper.setAttribute('aria-label', buildTaskAriaLabel(task, isCritical, isSelected, calendar, locale));

  const x = bar.x + offsetX;
  const y = bar.y + offsetY;

  const defaultFill =
    task.type === 'milestone' ? 'var(--fg-task-milestone, #f59e0b)' : 'var(--fg-task-default, #6366f1)';
  // SECURITY: only a whitelist-validated color (or the hardcoded fallback token) ever
  // reaches `style.setProperty` — never the raw `task.color` string (security.md, spec §8).
  const fill = validateTaskColor(task.color) ?? defaultFill;

  const shape = document.createElementNS(SVG_NS, 'rect');
  shape.setAttribute('class', 'fg-task__bar');
  shape.setAttribute('x', String(x));
  shape.setAttribute('y', String(y));
  shape.setAttribute('width', String(bar.width));
  shape.setAttribute('height', String(bar.height));
  shape.style.setProperty('fill', fill);

  if (task.type === 'milestone') {
    const cx = x + bar.width / 2;
    const cy = y + bar.height / 2;
    shape.setAttribute('transform', `rotate(45 ${cx} ${cy})`);
  } else {
    shape.setAttribute('rx', '3');
  }

  if (isCritical) {
    // A11y (spec §7): critical path is distinguished WITHOUT relying on color alone —
    // dashed stroke, set via CSSOM property (never a string-interpolated style attribute).
    shape.style.setProperty('stroke', 'var(--fg-task-critical, #ef4444)');
    shape.style.setProperty('stroke-dasharray', 'var(--fg-task-critical-dash, 4 2)');
    shape.style.setProperty('stroke-width', 'var(--fg-task-critical-stroke-width, 2px)');
  }

  wrapper.appendChild(shape);

  // Keyboard-focus ring (spec-keyboard-nav.md §5.2, mechanism corrected — see
  // `FOCUS_STYLE_TEXT`'s doc comment): a purpose-built `<rect>` sibling of the bar, offset
  // outward by `FOCUS_RING_OFFSET_PX` on every edge, rendered unconditionally (every task,
  // every render) but visually inert (`stroke: none`) unless `.fg-timeline__row:focus-visible`
  // matches — pure CSS toggling, no JS visibility branching needed here. Milestone bars are
  // rotated 45° via a `transform` on `.fg-task__bar` itself; the ring intentionally does NOT
  // copy that rotation — an axis-aligned ring around a diamond still unambiguously indicates
  // "this row", and matching the diamond's rotated bounding box exactly is unnecessary
  // precision for a focus indicator.
  const focusRing = document.createElementNS(SVG_NS, 'rect');
  focusRing.setAttribute('class', 'fg-task__focus-ring');
  focusRing.setAttribute('x', String(x - FOCUS_RING_OFFSET_PX));
  focusRing.setAttribute('y', String(y - FOCUS_RING_OFFSET_PX));
  focusRing.setAttribute('width', String(bar.width + FOCUS_RING_OFFSET_PX * 2));
  focusRing.setAttribute('height', String(bar.height + FOCUS_RING_OFFSET_PX * 2));
  focusRing.setAttribute('rx', '3');
  focusRing.setAttribute('aria-hidden', 'true');
  // `fill` MUST be set inline (not left to the `<style>` block's `.fg-task__focus-ring`
  // rule) — an SVG `<rect>`'s initial/default `fill` is BLACK (unlike `stroke`, whose
  // default is already `none`), so if the `<style>` block is ever stripped without this
  // element also being removed (e.g. `exportSvg()`'s blanket `<style>`-removal step, which
  // deliberately does NOT special-case this new element the way it explicitly removes
  // `.fg-task__link-handle` circles), the ring would otherwise render as a solid black box
  // over the task bar. `stroke` itself is safely left to the CSS rule (default is already
  // "none", matching the intended hidden-by-default state).
  focusRing.style.setProperty('fill', 'none');
  wrapper.appendChild(focusRing);

  if (showLinkHandles) {
    wrapper.appendChild(renderLinkHandle(bar, offsetX, offsetY, 'start'));
    wrapper.appendChild(renderLinkHandle(bar, offsetX, offsetY, 'end'));
  }
  return wrapper;
}

/** Connector handle for drag-create-dependency (spec-drag-create-dependency.md §4.1) —
 *  positioned via the shared `anchorOf` geometry helper so it sits exactly where a resulting
 *  FS/SS/FF/SF arrow would attach. Hidden by default, revealed on `.fg-task:hover` by the
 *  static `<style>` injected in `render()` (pure CSS, no JS hover tracking). */
function renderLinkHandle(
  bar: TaskBarLayout,
  offsetX: number,
  offsetY: number,
  edge: 'start' | 'end',
): SVGCircleElement {
  const anchor = anchorOf(bar, edge); // same anchor math committed dependency arrows use
  const circle = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
  circle.setAttribute('class', 'fg-task__link-handle');
  circle.setAttribute('data-handle-end', edge);
  circle.setAttribute('cx', String(anchor.x + offsetX));
  circle.setAttribute('cy', String(anchor.y + offsetY));
  // A11y: no keyboard-reachable equivalent exists yet in v1 (same posture as drag-move/
  // drag-resize, which are also pointer-only today) — hide from AT rather than expose an
  // affordance that can't actually be operated without a pointer.
  circle.setAttribute('aria-hidden', 'true');
  circle.style.setProperty('r', 'var(--fg-link-handle-radius, 4px)');
  circle.style.setProperty('fill', 'var(--fg-link-handle-fill, #ffffff)');
  circle.style.setProperty('stroke', 'var(--fg-link-handle-stroke, #6366f1)');
  circle.style.setProperty('stroke-width', 'var(--fg-link-handle-stroke-width, 1.5px)');
  return circle;
}

function buildTaskAriaLabel(
  task: Task,
  isCritical: boolean,
  isSelected: boolean,
  calendar: WorkingCalendar,
  locale: string,
): string {
  const name = task.name.slice(0, MAX_ARIA_NAME_LENGTH);
  const start = normalizeDate(task.start, calendar.timezone).toPlainDate();
  const end = normalizeDate(task.end, calendar.timezone).toPlainDate();
  const dateOptions: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  const startLabel = start.toLocaleString(locale, dateOptions);
  const endLabel = end.toLocaleString(locale, dateOptions);
  const progressPct = Math.round((task.progress ?? 0) * 100);
  const base = `${name}, ${startLabel}–${endLabel} (${progressPct}% complete)`;
  const withCritical = isCritical ? `${base}, critical path` : base;
  return isSelected ? `${withCritical}, selected` : withCritical;
}

function renderDependencies(
  dependencies: readonly Dependency[],
  barByTaskId: ReadonlyMap<TaskId, TaskBarLayout>,
  rowHeight: number,
  offsetX: number,
  offsetY: number,
): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.setAttribute('class', 'fg-timeline__dependencies');

  for (const dep of dependencies) {
    // Unknown dependency type from untrusted data (review N3/N5) — skip, same resilience
    // posture as a dangling reference; also keeps `dep.type` out of the class token unless
    // it is one of the four known values.
    if (!isKnownDependencyType(dep.type)) continue;
    const fromBar = barByTaskId.get(dep.from);
    const toBar = barByTaskId.get(dep.to);
    // Dangling dependency reference (from/to task not in the current row layout) — skip
    // rather than throw, same resilience posture as layoutTaskBar (spec §4).
    if (!fromBar || !toBar) continue;

    const layout = layoutDependencyPath(dep, fromBar, toBar, rowHeight);
    const d = layout.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x + offsetX} ${p.y + offsetY}`)
      .join(' ');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', `fg-dependency fg-dependency--${dep.type.toLowerCase()}`);
    path.setAttribute('d', d);
    path.setAttribute('marker-end', `url(#${ARROWHEAD_MARKER_ID})`);
    path.style.setProperty('fill', 'none');
    path.style.setProperty('stroke', 'var(--fg-dep-line, #64748b)');
    g.appendChild(path);
  }

  return g;
}
