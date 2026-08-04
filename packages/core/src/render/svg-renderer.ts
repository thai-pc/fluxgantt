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
  // NOTE (spec §7): placeholder `role="img"` — matches the existing e2e smoke fixture.
  // Once keyboard-nav lands this must become `role="grid"` with `role="row"`/
  // `role="gridcell"` per §8.5. Not done here: nothing is focusable in v1.
  svg.setAttribute('role', 'img');
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

    const showLinkHandles = currentOptions.showLinkHandles ?? true;

    svg.appendChild(createArrowheadMarker());
    if (showLinkHandles) svg.appendChild(createLinkHandleStyle());
    svg.appendChild(renderGrid(gridColumns, offsetX, totalHeight));
    svg.appendChild(renderHeader(gridColumns, offsetX, timeScale.totalWidth));
    svg.appendChild(
      renderDependencies(currentInput.dependencies, barByTaskId, rowHeight, offsetX, offsetY),
    );
    svg.appendChild(
      renderRows(rows, barByTaskId, criticalIds, rowHeight, calendar, locale, offsetX, offsetY, showLinkHandles),
    );
    svg.appendChild(renderLabelDivider(offsetX, totalHeight));
  }
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

    const rowGroup = document.createElementNS(SVG_NS, 'g');
    rowGroup.setAttribute('class', 'fg-timeline__row');
    rowGroup.setAttribute('data-row-index', String(row.rowIndex));

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'fg-timeline__row-label');
    label.setAttribute('x', String(LABEL_PADDING_PX + row.depth * LABEL_INDENT_PX));
    label.setAttribute('y', String(offsetY + row.y + rowHeight / 2));
    label.style.setProperty('dominant-baseline', 'middle');
    label.style.setProperty('fill', 'var(--fg-fg, #18181b)');
    // SECURITY: `task.name` is untrusted host-app data — text node only, never innerHTML
    // or a template string assembled into markup (security.md §1, spec §8).
    label.appendChild(document.createTextNode(row.task.name));
    rowGroup.appendChild(label);

    const isCritical = criticalIds.has(row.task.id);
    rowGroup.appendChild(
      renderTaskBar(row.task, bar, offsetX, offsetY, isCritical, calendar, locale, showLinkHandles),
    );

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
  wrapper.setAttribute('class', classNames.join(' '));
  // `task.id` is a branded TaskId (developer-controlled, not free-text host input) —
  // safe as an attribute value via setAttribute regardless.
  wrapper.setAttribute('data-task-id', task.id);
  wrapper.setAttribute('aria-label', buildTaskAriaLabel(task, isCritical, calendar, locale));

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
  return isCritical ? `${base}, critical path` : base;
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
