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
  TOGGLE_GLYPH_SIZE_PX,
  TOGGLE_GLYPH_GUTTER_PX,
  createTimeScale,
  computeGridColumns,
  computeHeaderTiers,
  HEADER_FONT_PX,
  deriveTimeRange,
  layoutDependencyPath,
  layoutRows,
  isTreeLayout,
  layoutTaskBar,
  progressFillWidth,
  todayLineX,
  validateTaskColor,
  isKnownTaskKind,
  isKnownDependencyType,
  anchorOf,
  buildTaskAriaLabel,
  type GanttMessages,
  type GridColumn,
  type HeaderTiers,
  type RolledUpRow,
  type RowLayout,
  type TaskBarLayout,
  type TimeScale,
} from './renderer-base.js';
import type { InteractiveRendererHandle } from './interactive-renderer-handle.js';
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
  /** Optional — ids currently collapsed (spec-collapse-expand.md §6.2). `undefined`/omitted
   *  = nothing collapsed. A collapsed id whose task has no children has no effect (mirrors
   *  `layoutRows()`'s own `hasChildren` gate on `isCollapsed`). */
  readonly collapsedIds?: ReadonlySet<TaskId>;
  /** Optional — output of `computeRollup()` called by the caller, exactly like `criticalPath`
   *  is the caller's `computeCriticalPath()` output. A parent row with an entry is drawn at its
   *  aggregate span and announces its aggregate progress instead of its authored values;
   *  everything else renders unchanged. `undefined`/omitted = no rollup, byte-identical to the
   *  pre-B2 behavior. `RollupResult` is structurally assignable to `RolledUpRow`, so the map
   *  passes straight through with no adapter (spec-summary-rollup.md Ticket B2). */
  readonly rollup?: ReadonlyMap<TaskId, RolledUpRow>;
}

export interface SvgRendererOptions {
  readonly viewMode?: ViewMode; // default 'week'
  readonly density?: Density; // default 'default'
  /** Visible date range. Omitted → inferred from min(start)..max(end) of `tasks` + padding. */
  readonly timeRange?: { readonly start: DateInput; readonly end: DateInput };
  /** Locale for date labels (Temporal + Intl formatting). Default 'en'. */
  readonly locale?: string;
  /** Width (px) of the left label column. Default `LABEL_COLUMN_WIDTH` (160). Set by
   *  `withResponsive()` from `@fluxgantt/core/responsive` to narrow the column on a small
   *  viewport; a non-finite or negative value falls back to the default rather than painting
   *  `NaN` geometry into the DOM. */
  readonly labelColumnWidth?: number;
  /** `aria-label` for the root `<svg>`. Default `'Gantt chart'`. */
  readonly ariaLabel?: string;
  /** Host-supplied accessible-name builders (spec §6.3 i18n scaffold). Omitted → the built-in
   *  English sentences. Only `taskLabel` is consulted by this renderer today. */
  readonly messages?: GanttMessages;
  /** Render the `.fg-task__link-handle` connector handles (+ their hover-reveal `<style>`).
   *  Default `true`. The facade sets this to `false` for a `readOnly` Gantt so a
   *  non-editable chart shows no interactive link affordance. */
  readonly showLinkHandles?: boolean;
}

export interface SvgRendererHandle extends InteractiveRendererHandle {
  /** Root `<svg>` created and appended into `container` by the renderer. */
  readonly svg: SVGSVGElement;
  /** Same node as `svg` — `enableClickSelect`/`enableKeyboardNav` query `.fg-timeline__row`
   *  structure and attach their `keydown` listener here (spec-canvas-renderer-ticket2.md §3.3). */
  readonly interactionRoot: SVGSVGElement;
  /** Same node as `svg` — SVG has no separate hit-testing layer, the visible `<svg>` receives
   *  real pointer events directly (spec-canvas-renderer-ticket2.md §3.3). */
  readonly pointerEventTarget: SVGSVGElement;
  readonly container: HTMLElement;
  /** Full repaint (no diff — spec §5.5) with new input. */
  update(input: SvgRendererInput): void;
  /** Change viewMode/density/timeRange/locale/ariaLabel/labelColumnWidth and repaint with the
   *  last input. */
  setOptions(options: Partial<SvgRendererOptions>): void;
  /** The label-column width (px) of the most recent render — the ACTUAL painted offset, which
   *  `labelColumnWidth` may have moved off the `LABEL_COLUMN_WIDTH` default. Consumers doing
   *  painted-space <-> content-space conversion (`render/mixin.ts`'s scroll anchor) must read
   *  this rather than importing the constant. */
  getLabelColumnWidth(): number;
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

// The DEFAULT label-column width — `SvgRendererOptions.labelColumnWidth` overrides it per
// instance (spec-responsive-mobile.md: 160px is 41% of a 393px phone viewport). Still exported
// (same pattern as ARROWHEAD_MARKER_ID below) because it remains the default every caller falls
// back to, but it is NO LONGER the authoritative painted offset: read `handle.getLabelColumnWidth()`
// for that. `render/mixin.ts`'s scroll-anchor math does exactly that when converting between the
// renderer's own painted coordinate space (which includes this offset, see the `offsetX`
// assignment below) and `TimeScale.dateToX`/`xToDate`'s "content-only" space (which does not).
export const LABEL_COLUMN_WIDTH = 160;
const HEADER_HEIGHT = 32;
const LABEL_INDENT_PX = 16;
const LABEL_PADDING_PX = 8;

/** Compile-time constant — never derived from task/user data (security §8). Exported so
 *  `interaction/drag-create-dep.ts`'s rubber-band preview can reference the SAME marker id
 *  string instead of a second hardcoded copy (single source of truth). */
export const ARROWHEAD_MARKER_ID = 'fg-dep-arrowhead';

// NOTE on what is deliberately NOT here: the coarse-pointer link-handle radius override
// (`--fg-link-handle-radius: 12px` under `@media (pointer: coarse)`) lives in
// `responsive/mixin.ts`'s injected stylesheet, not in the literal below. Reason is byte budget,
// not taste: every character inside these style literals — comments and indentation included —
// is SHIPPED in `withRender`'s bundle (so the three literals below are minified by hand and their
// rationale lives in `//` comments above them, which cost nothing), and that block measured
// ~480 B gzip against 307 B of headroom (spec-responsive-mobile.md's budget gate, lever (a)).
// Putting it in the opt-in mixin keeps it at +0 B for charts that do not compose `withResponsive()`.
// Static CSS text — NEVER derived from task/user data (security.md: nothing here is
// interpolated; this is a compile-time constant string assigned via .textContent, not
// innerHTML, not a template literal built from any external input). Provides the pure-CSS
// hover-reveal for `.fg-task__link-handle` (spec-drag-create-dependency.md §4.1) — there is no
// base stylesheet file anywhere in `packages/core`, so this is injected as a static inline
// `<style>` child on every full repaint (same "works with zero required host CSS" posture the
// rest of this file already keeps via inline `style.setProperty(...)`).
// Why each rule exists (kept here, NOT in the literal — comments there would ship):
//  - `pointer-events:none` while hidden: an opacity:0 element is STILL hit-testable (unlike
//    display/visibility), so with 'all' the invisible handle sitting on the bar's start/end
//    anchor would shadow drag-resize's edge zone / drag-move and swallow those pointerdowns at
//    priority -10. Only the REVEALED handle (hover / focus-within) is grabbable.
//  - `@media (hover:none)`: no hover concept on touch — reveal (and enable) unconditionally
//    rather than ship a feature that is structurally invisible/undiscoverable there.
const LINK_HANDLE_STYLE_TEXT =
  '.fg-task__link-handle{opacity:0;pointer-events:none;transition:opacity var(--fg-transition-fast,100ms ease-out)}' +
  '.fg-task:hover .fg-task__link-handle,.fg-task:focus-within .fg-task__link-handle{opacity:1;pointer-events:all}' +
  '@media (hover:none){.fg-task__link-handle{opacity:1;pointer-events:all}}' +
  '@media (prefers-reduced-motion:reduce){.fg-task__link-handle{transition:none}}';

// Static CSS text — compile-time constant, never derived from task/user data (security.md).
// Selection is a pure-CSS `outline` (a separate box-model property from SVG `stroke`) —
// deliberately NOT the same property the critical-path indicator uses inline on `.fg-task__bar`
// (`stroke`/`stroke-dasharray`/`stroke-width`, see renderTaskBar), so a task that is both
// critical and selected keeps BOTH signals visible (spec-selection.md §7.3). Always-on,
// unconditional (unlike LINK_HANDLE_STYLE_TEXT, which is gated behind `showLinkHandles`) —
// selection must stay visible even in a `readOnly` chart.
const SELECTION_STYLE_TEXT =
  '.fg-task--selected .fg-task__bar{outline:var(--fg-task-selected-width,2px) solid var(--fg-task-selected,#4338ca);outline-offset:var(--fg-task-selected-offset,2px)}';

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
// `.fg-timeline__row:focus-visible{outline:none}`: the row <g> itself is not the visual target,
// so the default UA outline on it is suppressed (the ring is the `.fg-task__focus-ring` rect).
const FOCUS_STYLE_TEXT =
  '.fg-timeline__row:focus-visible{outline:none}' +
  '.fg-task__focus-ring{fill:none;stroke:none;pointer-events:none}' +
  '.fg-timeline__row:focus-visible .fg-task__focus-ring{stroke:var(--fg-task-focus,#0ea5e9);stroke-width:var(--fg-task-focus-width,2px)}';

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
  // Same contract as `currentTimeScale`: the label-column width the last render actually
  // painted with, so `getLabelColumnWidth()` never has to re-derive the resolution below.
  let currentLabelColumnWidth = LABEL_COLUMN_WIDTH;

  // `display:block`: no inline descender gap under the chart, and the overlay float below lands under it.
  const svg = el('svg', { class: 'fg-timeline' }, { display: 'block' });
  // `role`/`aria-rowcount`/`aria-multiselectable` are set INSIDE render() (spec-keyboard-nav.md
  // §3.2 point 1) — `aria-rowcount` depends on the row count, which isn't known until the
  // first render(), so no static value is set here beyond the role/attribute EXISTING in the
  // DOM once render() runs synchronously below.

  // Pinned date axis: an aria-hidden presentation replica of the in-svg header, placed AFTER the
  // chart svg so `container.querySelector('svg')` stays the grid. `position:sticky` is
  // compositor-native; `overflow:visible` keeps the 1px divider half below the box; the
  // background also fills the label-column corner so scrolled row labels do not show through.
  const BAND_BG = 'var(--fg-bg-subtle, #f3f4f6)';
  const overlay = el(
    'svg',
    { class: 'fg-timeline__sticky-header', 'aria-hidden': 'true', height: HEADER_HEIGHT },
    {
      position: 'sticky',
      top: '0',
      // Logical, not 'left': in an RTL host the chart svg sits at the inline-start (right) edge, and
      // a physical left float would misalign the date labels with the day columns.
      float: 'inline-start',
      overflow: 'visible',
      // -1px top: Firefox does not pixel-snap a sticky box, so at a fractional container y the
      // opaque fill starts mid-pixel; the shadow adds an opaque row above (clipped at rest).
      'clip-path': 'inset(-1px 0 -1px)',
      background: BAND_BG,
      'box-shadow': `0 -1px 0 ${BAND_BG}`,
    },
  );
  container.append(svg, overlay);
  // Keeps natively focus-scrolled rows out from under the band; restored on destroy().
  const priorScrollPaddingTop = container.style.scrollPaddingTop;
  container.style.scrollPaddingTop = `${HEADER_HEIGHT}px`;

  render();

  return {
    svg,
    interactionRoot: svg,
    pointerEventTarget: svg,
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
      overlay.remove();
      container.style.scrollPaddingTop = priorScrollPaddingTop;
    },
    getLabelColumnWidth(): number {
      // No `destroyed` guard, matching `getTimeScale()` below — pure data from the last render.
      return currentLabelColumnWidth;
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
    const messages = currentOptions.messages;
    // `String()` because `??` only guards null/undefined: a loosely-typed JS host can hand us a
    // number or an object here, and a bare `.slice` would throw mid-render. Same coercion the
    // custom `messages.taskLabel` return value gets in `renderer-base.ts`.
    const ariaLabel = String(currentOptions.ariaLabel ?? DEFAULT_ARIA_LABEL).slice(
      0,
      MAX_ARIA_NAME_LENGTH,
    );

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
    const rows = layoutRows(currentInput.tasks, density, currentInput.collapsedIds);

    const barByTaskId = new Map<TaskId, TaskBarLayout>();
    let clampedCount = 0;
    for (const row of rows) {
      const bar = layoutTaskBar(row.task, timeScale, row, rowHeight, currentInput.rollup);
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

    // Host/mixin-supplied widths are untrusted numeric input (security.md: validate, don't
    // propagate) — a `NaN`, Infinity or negative value would paint `NaN` into every `x`
    // attribute and silently blank the chart, so it degrades to the default instead.
    const requestedLabelWidth = currentOptions.labelColumnWidth;
    const offsetX =
      requestedLabelWidth !== undefined && Number.isFinite(requestedLabelWidth) && requestedLabelWidth >= 0
        ? requestedLabelWidth
        : LABEL_COLUMN_WIDTH;
    currentLabelColumnWidth = offsetX;
    const offsetY = HEADER_HEIGHT;
    const bodyHeight = rows.length > 0 ? rows[rows.length - 1]!.y + rowHeight : rowHeight;
    const totalWidth = offsetX + timeScale.totalWidth;
    const totalHeight = offsetY + bodyHeight;

    // Full repaint — no diff in v1 (spec §5.5 / handle doc).
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    setAttrs(svg, {
      width: totalWidth,
      height: totalHeight,
      viewBox: `0 0 ${totalWidth} ${totalHeight}`,
      'aria-label': ariaLabel,
    });
    // ARIA grid structure (spec-keyboard-nav.md §3.2 point 1) — replaces the old placeholder
    // `role="img"`. `aria-multiselectable` is always "true": Core's selection model always
    // supports multi-select (Ctrl/Shift-click, Shift+Arrow), not gated by any config flag.
    //
    // `treegrid` vs `grid` (spec-collapse-expand.md §6.4, REVISED): the root role is now chosen
    // by whether the current layout actually contains an expandable row. This supersedes §0
    // decision 1 ("defer treegrid, keep grid for v1"), which was not tenable: WAI-ARIA allows
    // `aria-expanded` on a row only under `treegrid`, never under `grid`, so shipping §6.3's
    // `aria-expanded` while keeping `role="grid"` produces a genuine, serious-impact violation
    // (axe `aria-conditional-attr`: "This attribute is supported with treegrid rows, but not
    // grid") — caught by `tests/a11y/collapse-expand.spec.ts`. A flat project emits no
    // `aria-expanded` at all and therefore stays a plain `grid`, so this changes nothing for
    // charts without hierarchy. Both roles take `aria-rowcount`/`aria-multiselectable`
    // identically, and the keyboard contract (roving tabindex, arrow navigation) is unchanged.
    const isTree = isTreeLayout(rows);
    setAttrs(svg, {
      role: isTree ? 'treegrid' : 'grid',
      'aria-rowcount': rows.length,
      'aria-multiselectable': 'true',
    });

    const showLinkHandles = currentOptions.showLinkHandles ?? true;
    // `focusedTaskId` falls back to the FIRST row when unset (spec §4.5 point 3) — before any
    // keyboard interaction has happened, the grid must still be exactly one native Tab stop.
    const focusedTaskId = currentInput.focusedTaskId ?? rows[0]?.task.id;

    svg.append(
      createArrowheadMarker(),
      createStyle(SELECTION_STYLE_TEXT),
      createStyle(FOCUS_STYLE_TEXT),
      ...(showLinkHandles ? [createStyle(LINK_HANDLE_STYLE_TEXT)] : []),
      renderGrid(gridColumns, offsetX, totalHeight),
    );
    const header = renderHeader(
      computeHeaderTiers(timeScale, viewMode, locale, gridColumns),
      offsetX,
      timeScale.totalWidth,
    );
    svg.appendChild(header);
    // Negative top margin pulls the overlay's natural position to y=0 so sticky engages at once.
    // It is a float so it takes no in-flow height (the scroll container, a BFC, still contains
    // it) and its margin box ends at the 32px band: a sticky box may only travel while its margin
    // box stays inside the container, so an in-flow `margin-bottom` would pin it in place.
    overlay.setAttribute('width', `${totalWidth}`);
    overlay.style.marginTop = `-${totalHeight}px`;
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
        currentInput.rollup,
        messages,
      ),
    );
    // Today marker (spec §9.1). Appended after the rows so it crosses OVER bars and
    // dependency arrows — document order is z-order — but before the label divider, which must
    // stay the topmost thing along the label column's own edge.
    const todayX = todayLineX(timeScale, now);
    const todayLine = todayX === null ? null : renderTodayLine(todayX, offsetX, totalHeight);
    if (todayLine) svg.appendChild(todayLine);
    const divider = renderLabelDivider(offsetX, totalHeight);
    svg.appendChild(divider);
    // The band replicates everything that crosses the header in the chart (the full-height rules
    // included; `clip-path` trims them to the band), or the band would hide them there.
    overlay.replaceChildren(
      ...(todayLine ? [header, todayLine, divider] : [header, divider]).map((n) => n.cloneNode(true)),
    );

    // Focus restoration (spec §4.5 point 4) — MUST run after every element above is already
    // appended to `svg`, since the target row element is freshly created by renderRows() in
    // this same synchronous pass. `preventScroll`: a native focus() on a row scrolls the
    // container itself (measured: Firefox resets BOTH scroll offsets to 0, even for a visible
    // row; Chromium scrolls vertically only, and only when the row is off screen; WebKit does not
    // scroll). The keyboard path reveals the row explicitly instead (interaction/keyboard-nav.ts
    // revealFocusedRow), so pointer focus never scrolls.
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
  const defs = el('defs', {});
  const marker = el('marker', {
    id: ARROWHEAD_MARKER_ID,
    viewBox: '0 0 8 8',
    refX: 7,
    refY: 4,
    markerWidth: 6,
    markerHeight: 6,
    orient: 'auto-start-reverse',
  });
  marker.appendChild(
    el('path', { d: 'M 0 0 L 8 4 L 0 8 z' }, { fill: 'var(--fg-dep-line, #64748b)' }),
  );
  defs.appendChild(marker);
  return defs;
}

function createStyle(text: string): SVGStyleElement {
  return Object.assign(el('style', {}), { textContent: text });
}

function setAttrs<E extends Element>(e: E, attrs: Record<string, string | number>): E {
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

/** Creates an SVG element with `attrs` set in insertion order (so serialized attribute order is
 *  stable) and inline `style` properties. Values are only ever numbers, constants or the
 *  already-validated task fields the callers passed before this helper existed. */
function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  style?: Record<string, string>,
): SVGElementTagNameMap[K] {
  const e = setAttrs(document.createElementNS(SVG_NS, tag), attrs);
  for (const k in style) e.style.setProperty(k, style[k]!);
  return e;
}

function renderGrid(columns: readonly GridColumn[], offsetX: number, totalHeight: number): SVGGElement {
  const g = el('g', { class: 'fg-timeline__grid' });
  for (const col of columns) {
    const x = col.x + offsetX;
    if (col.isToday || col.isHoliday || col.isWeekend) {
      const fill = col.isToday
        ? 'var(--fg-grid-today, #fef3c7)'
        : col.isHoliday
          ? 'var(--fg-grid-holiday, #fee2e2)'
          : 'var(--fg-grid-weekend, #f9fafb)';
      const rect = el(
        'rect',
        { class: 'fg-timeline__grid-cell', x, y: 0, width: col.width, height: totalHeight },
        { fill },
      );
      g.appendChild(rect);
    }
    const line = el(
      'line',
      { class: 'fg-timeline__grid-line', x1: x, x2: x, y1: 0, y2: totalHeight },
      { stroke: 'var(--fg-grid-line, #e5e7eb)' },
    );
    g.appendChild(line);
  }
  return g;
}

function renderHeader(tiers: HeaderTiers, offsetX: number, timelineWidth: number): SVGGElement {
  const g = el('g', { class: 'fg-timeline__header' });

  const bg = el('rect', { x: offsetX, y: 0, width: timelineWidth, height: HEADER_HEIGHT }, {
    fill: 'var(--fg-bg-subtle, #f3f4f6)',
  });
  g.appendChild(bg);

  [tiers.upper, tiers.lower].forEach((tier, row) => {
    for (const l of tier) {
      // Inline style (not presentation attributes): a host `text { font-size }` rule beats an
      // attribute but never an inline style, and `exportSvg` clones keep it. Family is pinned
      // too (unlike row labels, which inherit the host font) because the label-fit estimator
      // is only conservative for system-ui metrics. The label is Temporal/Intl-formatted (never
      // user input) but still goes through createTextNode: no innerHTML policy applies everywhere.
      const text = el(
        'text',
        { class: 'fg-timeline__header-label', x: offsetX + l.x, y: row ? 24 : 8 },
        {
          font: `${HEADER_FONT_PX}px system-ui, sans-serif`,
          'text-anchor': row ? 'middle' : 'start',
          'dominant-baseline': 'middle',
          fill: 'var(--fg-fg-muted, #6b6b73)',
        },
      );
      text.appendChild(document.createTextNode(l.text));
      g.appendChild(text);
    }
  });

  const divider = el(
    'line',
    { x1: offsetX, x2: offsetX + timelineWidth, y1: HEADER_HEIGHT, y2: HEADER_HEIGHT },
    { stroke: 'var(--fg-border-strong, #d4d4d8)' },
  );
  g.appendChild(divider);

  return g;
}

/**
 * The today marker: a full-height rule at the current instant (spec §9.1). `x` is CONTENT
 * space from `todayLineX` — `offsetX` is added here, the same way every other renderer in
 * this file localizes its coordinates.
 *
 * Complements, never replaces, `GridColumn.isToday`'s column wash: that is a `fill` saying
 * "this DAY is today", this is a `stroke` saying "we are HERE within it". Both are visible at
 * once by construction (different properties, different elements).
 *
 * There is no "Today" text label: it did not fit the `withRender + withInteraction` gzip
 * budget, and golden rule 5 says shrink the feature rather than the budget. The rule alone
 * carries the meaning; revisit if the budget ever gains headroom.
 *
 * SECURITY/EXPORT: `stroke` is an inline CSSOM property, NOT a CSS rule. `exportSvg()` strips
 * every `<style>` element from its clone and bakes only inline/computed values for
 * `BAKED_STYLE_PROPERTIES`, so a rule-based stroke would export as SVG's default black.
 *
 * `aria-hidden`: this is decoration, and the root is a `grid`/`treegrid` whose children must
 * be row-structured — an exposed element here would be an axe `aria-required-children`
 * violation. Same treatment as the row toggle and the focus ring.
 */
function renderTodayLine(x: number, offsetX: number, totalHeight: number): SVGLineElement {
  const lineX = x + offsetX;
  const line = el(
    'line',
    {
      class: 'fg-timeline__today-line',
      'aria-hidden': 'true',
      x1: lineX,
      x2: lineX,
      y1: 0,
      y2: totalHeight,
    },
    { stroke: 'var(--fg-task-critical, #ef4444)', 'stroke-width': '2' },
  );
  return line;
}

function renderLabelDivider(offsetX: number, totalHeight: number): SVGLineElement {
  return el(
    'line',
    { class: 'fg-timeline__label-divider', x1: offsetX, x2: offsetX, y1: 0, y2: totalHeight },
    { stroke: 'var(--fg-border, #e5e7eb)' },
  );
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
  rollup: ReadonlyMap<TaskId, RolledUpRow> | undefined,
  messages: GanttMessages | undefined,
): SVGGElement {
  const g = el('g', { class: 'fg-timeline__rows' });

  // Same predicate the root `role` is chosen from — see `isTreeLayout`.
  const isTree = isTreeLayout(rows);

  for (const row of rows) {
    const bar = barByTaskId.get(row.task.id);
    if (!bar) continue;

    const isSelected = selectedIds.has(row.task.id);

    // ARIA grid row (spec-keyboard-nav.md §3.2 point 2): `role="row"`, 1-based
    // `aria-rowindex` (distinct from the existing 0-based `data-row-index`, an internal
    // implementation detail), `data-task-id` (promoted up from the nested `.fg-task` `<g>`
    // — see §3.3), `aria-selected`, and roving `tabindex` (exactly one row is `0`, the rest
    // `-1`).
    const rowGroup = el('g', {
      class: 'fg-timeline__row',
      role: 'row',
      'data-row-index': row.rowIndex,
      'data-task-id': row.task.id,
      'aria-rowindex': row.rowIndex + 1,
      'aria-selected': isSelected ? 'true' : 'false',
      tabindex: row.task.id === focusedTaskId ? '0' : '-1',
      // Omitted entirely on a leaf row, per WAI-ARIA (a non-expandable node must not carry
      // `aria-expanded="false"`). `aria-level` goes on EVERY row of a `treegrid` (leaves
      // included: a leaf still has a real depth) and on none of a plain `grid`, where axe's
      // `invalidTableRowAttrs` would flag it (same gating as `aria-expanded`).
      ...(row.hasChildren ? { 'aria-expanded': String(!row.isCollapsed) } : {}),
      ...(isTree ? { 'aria-level': row.depth + 1 } : {}),
    });
    // Single-column v1 (spec §3.2 point 3): exactly one `role="gridcell"` wrapper per row,
    // a pure ARIA/structural `<g>` with no `transform` of its own — zero rendering diff
    // versus the pre-keyboard-nav DOM shape.
    const cell = el('g', { class: 'fg-timeline__row-cell', role: 'gridcell' });

    if (row.hasChildren) {
      cell.appendChild(renderRowToggle(row, offsetY, rowHeight));
    }

    const label = el(
      'text',
      {
        class: 'fg-timeline__row-label',
        x: LABEL_PADDING_PX + row.depth * LABEL_INDENT_PX + TOGGLE_GLYPH_GUTTER_PX,
        y: offsetY + row.y + rowHeight / 2,
      },
      { 'dominant-baseline': 'middle', fill: 'var(--fg-fg, #18181b)' },
    );
    // SECURITY: `task.name` is untrusted host-app data — text node only, never innerHTML
    // or a template string assembled into markup (security.md §1, spec §8).
    label.appendChild(document.createTextNode(row.task.name));
    cell.appendChild(label);

    const isCritical = criticalIds.has(row.task.id);
    cell.appendChild(
      renderTaskBar(row.task, bar, offsetX, offsetY, isCritical, isSelected, calendar, locale, showLinkHandles, rollup?.get(row.task.id), messages),
    );

    rowGroup.appendChild(cell);
    g.appendChild(rowGroup);
  }

  return g;
}

/** Collapse/expand toggle glyph (spec-collapse-expand.md §6.1/§6.2) — a small triangle,
 *  rotated via `transform` between "pointing right" (collapsed) and "pointing down"
 *  (expanded), the same rotation technique already used for the milestone diamond in
 *  `renderTaskBar`. Only called for rows where `row.hasChildren` is `true`. No task-derived
 *  string content (`<path>`, no `<text>`) — zero new XSS surface (security.md, spec §8).
 *  `aria-hidden` since the row itself already carries `aria-expanded` (avoids double-
 *  announcing expanded/collapsed once on the glyph and once on the row). */
function renderRowToggle(row: RowLayout, offsetY: number, rowHeight: number): SVGPathElement {
  const size = TOGGLE_GLYPH_SIZE_PX;
  const cx = LABEL_PADDING_PX + row.depth * LABEL_INDENT_PX + size / 2;
  const cy = offsetY + row.y + rowHeight / 2;
  const half = size / 2;
  // Right-pointing triangle in local space, rotated to point down when expanded.
  const d = `M ${cx - half} ${cy - half} L ${cx + half} ${cy} L ${cx - half} ${cy + half} Z`;
  return el(
    'path',
    {
      class: 'fg-timeline__row-toggle',
      d,
      'aria-hidden': 'true',
      ...(row.isCollapsed ? {} : { transform: `rotate(90 ${cx} ${cy})` }),
    },
    { fill: 'var(--fg-fg-muted, #6b6b73)' },
  );
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
  rolled: RolledUpRow | undefined,
  messages: GanttMessages | undefined,
): SVGGElement {
  // Whitelist `task.type` before folding it into a class token (review N3): fall back to
  // the `task` modifier for any value that isn't a known TaskKind, so untrusted data can't
  // inject an arbitrary extra class (CSS-token spoofing).
  const kindClass = isKnownTaskKind(task.type) ? task.type : 'task';
  const classNames = ['fg-task', `fg-task--${kindClass}`];
  if (isCritical) classNames.push('fg-task--critical');
  if (isSelected) classNames.push('fg-task--selected');
  // `data-rolled-up` marks a bar whose geometry came from `computeRollup` (spec-summary-rollup.md
  // Ticket B2): the ONLY channel by which the interaction layer learns that, and it makes
  // drag-move/drag-resize decline such a bar (a rolled-up span is derived on read, so there is
  // no authored value under the cursor). Gated like `layoutTaskBar`'s rollup branch: a
  // milestone is drawn at its authored `start`, so it is NOT rolled up and stays draggable.
  // `task.id` is a branded TaskId (developer-controlled), safe as an attribute value.
  const wrapper = el('g', {
    class: classNames.join(' '),
    'data-task-id': task.id,
    ...(rolled !== undefined && task.type !== 'milestone' ? { 'data-rolled-up': 'true' } : {}),
    'aria-label': buildTaskAriaLabel(task, isCritical, isSelected, calendar, locale, rolled, messages),
  });

  const x = bar.x + offsetX;
  const y = bar.y + offsetY;

  const defaultFill =
    task.type === 'milestone' ? 'var(--fg-task-milestone, #f59e0b)' : 'var(--fg-task-default, #6366f1)';
  // SECURITY: only a whitelist-validated color (or the hardcoded fallback token) ever
  // reaches `style.setProperty` — never the raw `task.color` string (security.md, spec §8).
  const fill = validateTaskColor(task.color) ?? defaultFill;

  const isMilestone = task.type === 'milestone';
  const shape = el(
    'rect',
    {
      class: 'fg-task__bar',
      x,
      y,
      width: bar.width,
      height: bar.height,
      ...(isMilestone
        ? { transform: `rotate(45 ${x + bar.width / 2} ${y + bar.height / 2})` }
        : { rx: 3 }),
    },
    {
      fill,
      // A11y (spec §7): critical path is distinguished WITHOUT relying on color alone —
      // dashed stroke, set via CSSOM property (never a string-interpolated style attribute).
      ...(isCritical
        ? {
            stroke: 'var(--fg-task-critical, #ef4444)',
            'stroke-dasharray': 'var(--fg-task-critical-dash, 4 2)',
            'stroke-width': 'var(--fg-task-critical-stroke-width, 2px)',
          }
        : {}),
    },
  );

  wrapper.appendChild(shape);

  // Completed portion (`.fg-task__progress`), painted over the bar. Appended here — after the
  // bar, before the focus ring and link handles — because SVG paints in document order, so the
  // z-order falls out of the append order with no explicit stacking.
  //
  // SECURITY/EXPORT: the fill is an inline CSSOM property, NOT a CSS rule. `exportSvg()` strips
  // every `<style>` element from its clone and bakes only inline/computed values for
  // `BAKED_STYLE_PROPERTIES`, so a rule-based fill would export as SVG's default black.
  // The value is a host-CSS design token — a different trust boundary from `task.color`, which
  // alone needs `validateTaskColor`.
  //
  // The class is deliberately NOT `fg-task__bar`: `interaction/drag-resize.ts` resolves the bar
  // by that exact selector and must keep matching the bar itself.
  const progressWidth = progressFillWidth(task, bar, rolled);
  if (progressWidth > 0) {
    const progressShape = el(
      'rect',
      { class: 'fg-task__progress', x, y, width: progressWidth, height: bar.height, rx: 3 },
      { fill: 'var(--fg-task-completed, #10b981)' },
    );
    wrapper.appendChild(progressShape);
  }

  // Keyboard-focus ring (spec-keyboard-nav.md §5.2, mechanism corrected — see
  // `FOCUS_STYLE_TEXT`'s doc comment): a purpose-built `<rect>` sibling of the bar, offset
  // outward by `FOCUS_RING_OFFSET_PX` on every edge, rendered unconditionally (every task,
  // every render) but visually inert (`stroke: none`) unless `.fg-timeline__row:focus-visible`
  // matches — pure CSS toggling, no JS visibility branching needed here. Milestone bars are
  // rotated 45° via a `transform` on `.fg-task__bar` itself; the ring intentionally does NOT
  // copy that rotation — an axis-aligned ring around a diamond still unambiguously indicates
  // "this row", and matching the diamond's rotated bounding box exactly is unnecessary
  // precision for a focus indicator.
  // `fill` MUST be set inline (not left to the `<style>` block's `.fg-task__focus-ring` rule):
  // an SVG `<rect>`'s default `fill` is BLACK (unlike `stroke`, already `none`), so when
  // `exportSvg()` strips every `<style>` element the ring would otherwise export as a solid
  // black box over the bar. `stroke` is safely left to the CSS rule.
  const focusRing = el(
    'rect',
    {
      class: 'fg-task__focus-ring',
      x: x - FOCUS_RING_OFFSET_PX,
      y: y - FOCUS_RING_OFFSET_PX,
      width: bar.width + FOCUS_RING_OFFSET_PX * 2,
      height: bar.height + FOCUS_RING_OFFSET_PX * 2,
      rx: 3,
      'aria-hidden': 'true',
    },
    { fill: 'none' },
  );
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
  // A11y: `aria-hidden` — no keyboard-reachable equivalent exists yet (same posture as
  // drag-move/drag-resize, which are pointer-only today): hide from AT rather than expose an
  // affordance that cannot be operated without a pointer.
  const circle = el(
    'circle',
    {
      class: 'fg-task__link-handle',
      'data-handle-end': edge,
      cx: anchor.x + offsetX,
      cy: anchor.y + offsetY,
      'aria-hidden': 'true',
    },
    {
      r: 'var(--fg-link-handle-radius, 4px)',
      fill: 'var(--fg-link-handle-fill, #ffffff)',
      stroke: 'var(--fg-link-handle-stroke, #6366f1)',
      'stroke-width': 'var(--fg-link-handle-stroke-width, 1.5px)',
    },
  );
  return circle;
}

function renderDependencies(
  dependencies: readonly Dependency[],
  barByTaskId: ReadonlyMap<TaskId, TaskBarLayout>,
  rowHeight: number,
  offsetX: number,
  offsetY: number,
): SVGGElement {
  const g = el('g', { class: 'fg-timeline__dependencies' });

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

    const path = el(
      'path',
      {
        class: `fg-dependency fg-dependency--${dep.type.toLowerCase()}`,
        d,
        'marker-end': `url(#${ARROWHEAD_MARKER_ID})`,
      },
      { fill: 'none', stroke: 'var(--fg-dep-line, #64748b)' },
    );
    g.appendChild(path);
  }

  return g;
}
