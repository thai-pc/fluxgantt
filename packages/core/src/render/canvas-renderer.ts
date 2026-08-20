// Canvas renderer — static paint layer + hidden ARIA a11y layer (spec-canvas-renderer-
// ticket1.md, spec-canvas-renderer-ticket2.md; Tickets 1+2 of `.claude/work/plan-canvas-
// renderer.md`'s 3-ticket breakdown). Mirrors `svg-renderer.ts`'s structure and visual
// feature set, but paints via `CanvasRenderingContext2D` primitives (`fillRect`/`roundRect`/
// `moveTo`+`lineTo`+`stroke`/`fillText`/`setLineDash`) instead of `document.createElementNS`.
//
// **THIS MODULE IS STILL INERT AND UNWIRED (Ticket 2, same posture as Ticket 1).** It is not
// re-exported from `render/index.ts` or the public barrel (`src/index.ts`), not referenced
// from `gantt.ts`, and adds no new `tsup`/`package.json` entry — it costs the default build
// ZERO bytes (verified: nothing in the module graph reachable from `src/index.ts` references
// this file). Ticket 3 (auto-switch wiring into `mount()` via a dynamic `import()`) is a
// separate, future change.
//
// **ACCESSIBILITY — Ticket 2 closes the gap Ticket 1 explicitly flagged.** A hidden
// (offscreen, but focusable/AT-reachable) `role="grid"` DOM layer (`a11yLayer`, §5 in the
// ticket-2 spec) is constructed once at setup and fully rebuilt on every `render()`, mirroring
// `svg-renderer.ts`'s `renderRows()` attribute-for-attribute (`role="row"`/`role="gridcell"`/
// `aria-selected`/roving `tabindex`/per-task `aria-label`). The visible `<canvas>` itself is
// `aria-hidden="true"` — Ticket 1's `role="img"` stopgap is superseded, not layered on top of,
// since exposing both would double-announce the same data to a screen reader. Click-select
// (`hitTestRow()`, §7) and a `focusin`/`focusout`-driven on-canvas focus ring (§8) bring Canvas
// mode to full keyboard+mouse+screen-reader parity with SVG mode. Drag-move/drag-resize/
// drag-create-dep remain SVG-only (unrelated to accessibility, out of scope for both tickets).
//
// SECURITY (security.md, spec §6/§9 — read before touching this file): `task.name` is the
// only free-form string painted/rendered in v1. On the bitmap it is passed ONLY as the
// literal first argument to `ctx.fillText(text, x, y)` — `fillText` paints pixels, it cannot
// be interpreted as markup/code, so this is injection-safe by construction. It is NEVER
// concatenated into `ctx.font` or any other property string; `ctx.font` is assigned only from
// a fixed, compile-time-constant string. In the hidden a11y layer, `task.name` reaches the DOM
// ONLY via `labelEl.textContent`, never `innerHTML`, never a template string assembled into
// markup — same posture as `svg-renderer.ts`'s `document.createTextNode`. `buildTaskAriaLabel`
// output reaches the DOM ONLY via `setAttribute('aria-label', ...)`, which never interprets
// its value as markup. `task.color` is only ever used after `validateTaskColor()` (from
// `renderer-base.ts`) accepts it — its return value, or a hardcoded/token-resolved default, is
// the ONLY thing ever assigned to `ctx.fillStyle`/`ctx.strokeStyle` for a task-colored element;
// the raw `task.color` string never reaches a Canvas API call, and is never read anywhere in
// the hidden a11y layer's code (the focus ring's color comes from a validated design token,
// not task data). This file NEVER calls `ctx.createPattern()`/`ctx.createLinearGradient()`/
// `ctx.createRadialGradient()` anywhere — `fillStyle`/`strokeStyle` are only ever assigned a
// plain string (a compile-time-constant fallback or `validateTaskColor`'s output), so the
// pattern/gradient injection vector security.md flags is closed by construction, not merely
// by validation discipline. `canvas.getContext('2d')` returning `null` throws synchronously
// rather than silently no-op'ing (a confusing "nothing rendered, no error" state is itself a
// defensive-programming failure mode security.md's "reject rather than best-effort" principle
// argues against). Focus-restoration `querySelector` interpolation applies `cssEscapeAttr()`
// to `focusedTaskId` before building the attribute-selector string (same defense-in-depth
// `svg-renderer.ts` already applies).
//
// MODULE-ISOLATION RULE (spec §2.1): this file must NEVER statically import anything from
// `svg-renderer.ts` — not even a pure numeric constant. This is deliberate: Ticket 3 will
// `import()` this file as a separate chunk specifically so a large-project host downloads
// Canvas code without SVG code; importing even one binding from `svg-renderer.ts` would drag
// the entire SVG paint module into that chunk, defeating the whole reason the split exists.
// A handful of small layout constants are therefore intentionally DUPLICATED locally below
// (see §5.1) rather than imported — kept in sync BY HAND with `svg-renderer.ts`'s
// identically-named constants. `buildTaskAriaLabel`/`isKnownTaskKind` ARE imported — but from
// `renderer-base.ts`, the shared DOM-free seam BOTH renderer files already depend on, never
// from `svg-renderer.ts` itself — the isolation rule is about the two renderer files never
// importing from EACH OTHER, not about avoiding all shared code.
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
  buildTaskAriaLabel,
  type GridColumn,
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

export interface CanvasRendererInput {
  readonly tasks: readonly Task[];
  readonly dependencies: readonly Dependency[];
  /** Optional — output of `computeCriticalPath()` called by the caller. `undefined` =
   *  no task painted as critical. */
  readonly criticalPath?: CriticalPathResult;
  /** Default `DEFAULT_CALENDAR` — used to shade weekend/holiday columns. */
  readonly calendar?: WorkingCalendar;
  /** Optional — ids currently selected (already the FULL flattened set, descendants
   *  included). `undefined`/omitted = nothing selected. */
  readonly selectedTaskIds?: readonly TaskId[];
  /**
   * (Ticket 2). Mirrors `SvgRendererInput.focusedTaskId` field-for-field, including its
   * fallback semantics: `undefined` = no keyboard interaction has happened yet, and `render()`
   * falls back to the first row so the hidden grid remains exactly one native Tab stop even
   * before any arrow key has been pressed. Drives THREE things: the roving-tabindex assignment
   * on hidden-layer rows, the DOM focus-restoration target after a rebuild, and the on-canvas
   * focus ring's target row.
   */
  readonly focusedTaskId?: TaskId | undefined;
}

export interface CanvasRendererOptions {
  readonly viewMode?: ViewMode; // default 'week'
  readonly density?: Density; // default 'default'
  /** Visible date range. Omitted → inferred from min(start)..max(end) of `tasks` + padding. */
  readonly timeRange?: { readonly start: DateInput; readonly end: DateInput };
  /** Locale for date labels (Temporal + Intl formatting). Default 'en'. */
  readonly locale?: string;
  /** `aria-label` for the hidden a11y layer's `role="grid"` root. Default `'Gantt chart'`. The
   *  visible `<canvas>` itself carries no `aria-label` (it is `aria-hidden`, Ticket 2). */
  readonly ariaLabel?: string;
  // NOTE: no `showLinkHandles` — Canvas mode has no connector-handle affordance in v1 at all
  // (drag-create-dep is excluded from Canvas mode entirely, not just deferred), so there is
  // nothing for this flag to toggle. Do not add a no-op option.
}

export interface CanvasRendererHandle extends InteractiveRendererHandle {
  /** Root `<canvas class="fg-timeline-canvas">` created and appended into `container`.
   *  Deliberately a DIFFERENT block class than SVG's `.fg-timeline` (not a modifier of it)
   *  so the two can coexist in a DOM/CSS sense without rule bleed. */
  readonly canvas: HTMLCanvasElement;
  readonly container: HTMLElement;
  /** Full repaint (no diff — same v1 posture as `SvgRendererHandle.update`) with new input.
   *  Throws `CanvasDimensionExceededError` if the resulting canvas would exceed the
   *  browser's real backing-store limit (see `MAX_CANVAS_DIMENSION_PX`), or propagates any
   *  other error `render()` raises (e.g. `renderer-base.ts`'s `MAX_GRID_COLUMNS` guard) — on
   *  ANY such throw, every piece of state this handle exposes (the canvas bitmap, the input/
   *  options this call would have applied, and `getTimeScale()`) is rolled back atomically
   *  to the last successful render, as if the call never happened. */
  update(input: CanvasRendererInput): void;
  /** Change viewMode/density/timeRange/locale/ariaLabel and repaint with the last input.
   *  Throws `CanvasDimensionExceededError` if the resulting canvas would exceed the
   *  browser's real backing-store limit (see `MAX_CANVAS_DIMENSION_PX`), or propagates any
   *  other error `render()` raises — on ANY such throw, every piece of state this handle
   *  exposes (the canvas bitmap, the input/options this call would have applied, and
   *  `getTimeScale()`) is rolled back atomically to the last successful render, as if the
   *  call never happened. */
  setOptions(options: Partial<CanvasRendererOptions>): void;
  /** Removes the canvas element AND the hidden a11y layer from `container`. `update()`/
   *  `setOptions()` after `destroy()` are a no-op — same contract as `SvgRendererHandle.destroy`. */
  destroy(): void;
  /** Same contract as `SvgRendererHandle.getTimeScale()` — `TimeScale` of the most recent
   *  **successful** render. */
  getTimeScale(): TimeScale;
  /**
   * (Ticket 2). Root of the offscreen (visually hidden, `role="grid"`) DOM subtree
   * `enableKeyboardNav` attaches its `keydown` listener to and both interaction modules query
   * via the renderer-agnostic `[data-row-index]`/`[data-task-id]` attribute contract (NOT class
   * names — this layer's rows/cells/task elements use their own `fg-timeline-canvas__*` classes,
   * deliberately distinct from SVG's `.fg-timeline__row`/`.fg-task`, so host/theme CSS targeting
   * the real visible SVG chart can never accidentally match this offscreen layer). See the
   * hidden-layer construction below for its exact structure/attribute contract.
   * Always a real, attached `HTMLElement` — never `undefined`, built synchronously inside
   * `createCanvasRenderer()`, before this handle is ever returned.
   */
  readonly interactionRoot: HTMLElement;
  /**
   * (Ticket 2). Same node as `canvas` — the element real pointer events actually land on.
   * `enableClickSelect` attaches its `pointerdown` listener here, not to `interactionRoot`
   * (which is never under the user's cursor).
   */
  readonly pointerEventTarget: HTMLCanvasElement;
  /**
   * (Ticket 2). Resolves a client-space pointer coordinate to the task row it falls inside, in
   * the same logical/CSS-pixel coordinate space `layoutRows()`/`paintRows()` already use
   * internally. Returns `undefined` for header-band clicks, out-of-canvas clicks, or clicks
   * below the last row (all treated as "empty space", matching SVG's `resolveRowHitDom()`
   * returning `undefined` for the same cases). Row-band-wide (not bar/label-precise) —
   * deliberate v1 UX design (bigger, simpler click target), documented divergence from SVG.
   */
  hitTestRow(clientX: number, clientY: number): { taskId: TaskId; rowIndex: number } | undefined;
}

// --- §5.1 Duplicated local constants (module-isolation rule, §2.1) --------------------
// Kept in sync BY HAND with `svg-renderer.ts`'s identically-named constants — this file
// must not import them.
const LABEL_COLUMN_WIDTH = 160;
const HEADER_HEIGHT = 32;
const LABEL_INDENT_PX = 16;
const LABEL_PADDING_PX = 8;
const MAX_ARIA_NAME_LENGTH = 200;
const DEFAULT_VIEW_MODE: ViewMode = 'week';
const DEFAULT_DENSITY: Density = 'default';
const DEFAULT_LOCALE = 'en';
const DEFAULT_ARIA_LABEL = 'Gantt chart';

/** Fixed, compile-time-constant font string — NEVER built from task/user data (§6). */
const TASK_LABEL_FONT = '12px system-ui, sans-serif';

/** ~half-size of the hand-drawn dependency arrowhead triangle (px), §5.4. */
const ARROWHEAD_SIZE_PX = 6;

// --- Canvas backing-store dimension guard (spec-canvas-row-limit-fix.md, extended by
// spec-canvas-webkit-dimension-limit.md for WebKit/Safari) --------------------------------
//
// A `<canvas>` element's backing-store bitmap has a real, silent-failure ceiling in every
// browser this repo tests. Chromium's is a simple PER-AXIS cutoff:
// `canvas.height`/`canvas.width` = 65536 makes every subsequent `ctx.*` draw call silently
// no-op — no thrown exception, `getImageData` reads back fully transparent. `65535` paints
// correctly. This is empirically confirmed against the CURRENT, post-Chromium-fix ceiling
// (see spec-canvas-row-limit-fix.md §4.2 for why no additional safety margin is subtracted).
//
// WEBKIT/SAFARI (spec-canvas-webkit-dimension-limit.md §4) — measured 2026-08-20 against
// Playwright's bundled `webkit` project, build version "26.5" (`browser.version()`), via a
// binary-search methodology mirroring the Chromium fix's own. Findings:
//
// 1. FAILURE MODE (§4 Step 1): identical shape to Chromium — silent no-op. No exception is
//    ever thrown at `canvas.width =`/`canvas.height =` assignment, at `getContext('2d')`, or
//    at any draw call (`fillRect`), for shapes far beyond every plausible ceiling (confirmed
//    up to 100,000 x 100,000). `getImageData` simply reads back fully transparent
//    (`[0,0,0,0]`) past the ceiling. This confirms the proactive-guard shape (this file's
//    existing approach) is still correct for WebKit too — no `try/catch`-around-paint
//    redesign needed.
// 2. INDEPENDENT PER-AXIS CAP (§4 Step 2): a genuine, reproducible per-axis ceiling DOES
//    exist, independent of area — measured at exactly 4,194,305px on either axis alone
//    (`width=1, height=4,194,305` paints; `height=4,194,306` does not; confirmed symmetric
//    for `height=1` varying width; reproduced identically across 3 independent fresh-browser
//    trials). However, this WebKit-real per-axis ceiling (~4.19M) is dramatically LARGER than
//    Chromium's existing `MAX_CANVAS_DIMENSION_PX` (65,535), which already runs UNCONDITIONALLY
//    for every engine, including WebKit, strictly before the WebKit-only branch below. Any
//    shape that reaches the WebKit branch has therefore already had both axes confirmed
//    `<= 65,535` — WebKit's own, much larger per-axis ceiling can never be the binding
//    constraint. Per this measurement, no separate `MAX_CANVAS_DIMENSION_PX_WEBKIT` constant
//    or check is added — it would be permanently unreachable dead code. (If a future
//    WebKit build is ever found with a per-axis ceiling BELOW 65,535, that would need its own
//    re-measurement and a new constant — not expected given this finding, but noting the
//    reasoning so a future re-check knows what to look for.)
// 3. AREA CEILING (§4 Step 3) — NOT a single stable number. Binary-searching a near-square
//    shape in a freshly-launched, single-canvas browser page found the boundary at exactly
//    `16384 x 16384` (`16383 x 16383` paints; `16384 x 16384` — 268,435,456px², exactly 2^28 —
//    does not) in that isolated condition, consistent with an underlying ~1 GiB
//    (2^30 byte, `width * height * 4`) total backing-store budget. BUT this ceiling was found
//    to be highly sensitive to the page's accumulated allocation history: the exact same
//    `16384 x 16384` shape PAINTED SUCCESSFULLY when it was the very first canvas ever
//    created in a fresh page, yet FAILED after ~14 prior large-canvas probes earlier in the
//    same page session (each explicitly shrunk back to `1x1` after use, which did not fully
//    prevent the effect) — i.e., the real ceiling moved down under realistic cumulative
//    memory pressure, not just varying by aspect ratio. This directly matches the
//    RAM-relative-limit concern flagged in the spec (§3 point 3 / §4 Step 4) rather than a
//    fixed platform fact the way Chromium's 65,535 was judged to be.
// 4. CHOSEN CONSTANT — a DEFENSIBLY CONSERVATIVE FLOOR, not the best-case empirical number,
//    per the spec's explicit instruction (§4 Step 4, §5 Option A's own "still inherently a
//    conservative guess" framing): `MAX_CANVAS_AREA_PX_WEBKIT = 16_777_216` (4096 x 4096,
//    2^24px²). This is ~16x under the best-case ~2^28px² ceiling measured above, is itself
//    the most-conservative figure independently cited across public sources for older iOS
//    Safari (spec §3 point 2), and was confirmed (2026-08-20, same Playwright webkit build)
//    to paint correctly even as the very first canvas allocation in a fresh browser page —
//    i.e. it is never the binding constraint in any condition this methodology observed,
//    leaving real headroom for (a) actual Safari/iOS builds this Linux/WPE-based Playwright
//    `webkit` project does not claim to reproduce exactly (spec §4 Step 4/§12.2's caveat),
//    (b) real host pages that have already allocated meaningful memory before Canvas mode
//    mounts (the realistic embedding scenario, unlike this measurement's isolated lab
//    conditions), and (c) lower-RAM real devices than this measurement's CI/dev machine.

/**
 * Hard per-axis ceiling for a `<canvas>` element's backing-store bitmap — applies to EVERY
 * engine (Chromium and default/fallback branch alike). See the comment block above for how
 * this number was derived and WebKit's own (much larger, and therefore non-binding) per-axis
 * finding.
 */
export const MAX_CANVAS_DIMENSION_PX = 65_535;

/**
 * WebKit-only backing-store AREA ceiling (physical `width * height`, in px²) — see the
 * comment block above `MAX_CANVAS_DIMENSION_PX` for the full empirical methodology, the
 * measured-but-unstable real ceiling this deliberately sits far under, and why it is framed
 * as a conservative floor rather than an exact number. Only checked on the `isWebKitEngine()`
 * branch — never applied to Chromium or any other engine (§5 Option A, engine detection).
 */
export const MAX_CANVAS_AREA_PX_WEBKIT = 16_777_216;

/**
 * Inferred, not queried — no capability-query API exists for a `<canvas>` backing-store
 * limit. Internal only, not exported (small public surface, coding-conventions.md).
 * Standard "Safari but not actually Chrome/Chromium/Android" UA pattern — Chrome/Edge/etc.
 * all include the literal substring "Safari" in their UA string for legacy-compat reasons, so
 * a plain substring check is insufficient; this must positively EXCLUDE every known
 * Chromium-family marker too. `navigator.userAgent` is client-controlled/spoofable — see
 * spec-canvas-webkit-dimension-limit.md §10 for why this is treated as a correctness
 * (not security) concern: the worst case of a misdetection is the same "blank chart, no
 * error" failure this guard exists to close, never a data-integrity/injection risk.
 */
function isWebKitEngine(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /^((?!chrome|chromium|crios|edg|android).)*safari/i.test(ua);
}

/**
 * Thrown by `createCanvasRenderer()`/`CanvasRendererHandle.update()`/`.setOptions()` when the
 * computed physical (post-devicePixelRatio) canvas bitmap size would exceed the applicable
 * `<canvas>` backing-store limit — this is the ONLY way this file fails on an oversized
 * project; it never silently renders a blank bitmap. See the module-level comment above
 * `MAX_CANVAS_DIMENSION_PX` for the full empirical rationale (Chromium's per-axis ceiling,
 * applied to every engine; WebKit's additional, engine-gated area ceiling) — not repeated
 * here so there is exactly ONE place to update if that rationale ever changes.
 */
export class CanvasDimensionExceededError extends Error {
  /** 'area' is reported when neither individual axis exceeds `MAX_CANVAS_DIMENSION_PX`, but
   *  `width * height` exceeds `MAX_CANVAS_AREA_PX_WEBKIT` on the WebKit-only branch. Existing
   *  'width'/'height' members and their meaning are UNCHANGED from the shipped Chromium fix. */
  readonly axis: 'width' | 'height' | 'area';

  /** For axis 'width'|'height': the offending physical pixel LENGTH on that axis (unchanged
   *  meaning/unit from the shipped Chromium fix). For axis 'area': the offending physical
   *  pixel AREA (`physicalWidth * physicalHeight`). Always the exact quantity compared
   *  against `limitPx` to decide to throw — kept as one field (not made optional) so existing
   *  'width'/'height' consumers see no type-level change. */
  readonly physicalPx: number;
  /** The ceiling `physicalPx` was compared against — `MAX_CANVAS_DIMENSION_PX` for
   *  'width'/'height', `MAX_CANVAS_AREA_PX_WEBKIT` for 'area'. */
  readonly limitPx: number;
  readonly rowCount: number;
  readonly devicePixelRatio: number;

  /** Populated ONLY when `axis === 'area'`; `undefined` for 'width'/'height' (unchanged shape
   *  there). The two physical dimensions whose product produced `physicalPx`, given for free
   *  since render() already computed both — lets a catch site log/report the actual shape
   *  that overflowed, not just the product. */
  readonly physicalWidth?: number | undefined;
  readonly physicalHeight?: number | undefined;

  constructor(
    axis: 'width' | 'height' | 'area',
    physicalPx: number,
    limitPx: number,
    rowCount: number,
    devicePixelRatio: number,
    areaDimensions?: { readonly physicalWidth: number; readonly physicalHeight: number },
  ) {
    const message =
      axis === 'area'
        ? `canvas-renderer: computed canvas area (${physicalPx}px², ${areaDimensions?.physicalWidth}x` +
          `${areaDimensions?.physicalHeight} physical) exceeds this engine's safe <canvas> ` +
          `backing-store area limit (${limitPx}px²). This chart has ${rowCount} row(s) at ` +
          `devicePixelRatio=${devicePixelRatio}. Reduce the task/row count, use a more compact ` +
          `density, narrow the visible time range, or catch this error and fall back to ` +
          `createSvgRenderer(), which has no such limit.`
        : `canvas-renderer: computed canvas ${axis} (${physicalPx}px physical) exceeds the browser's ` +
          `safe <canvas> backing-store limit (${limitPx}px). This chart has ${rowCount} row(s) at ` +
          `devicePixelRatio=${devicePixelRatio}. Reduce the task/row count, use a more compact ` +
          `density, narrow the visible time range, or catch this error and fall back to ` +
          `createSvgRenderer(), which has no such limit.`;
    super(message);
    this.name = 'CanvasDimensionExceededError';
    this.axis = axis;
    this.physicalPx = physicalPx;
    this.limitPx = limitPx;
    this.rowCount = rowCount;
    this.devicePixelRatio = devicePixelRatio;
    this.physicalWidth = areaDimensions?.physicalWidth;
    this.physicalHeight = areaDimensions?.physicalHeight;
  }
}

// --- §5.2 Design tokens ------------------------------------------------------------------

interface DesignTokens {
  readonly gridToday: string;
  readonly gridHoliday: string;
  readonly gridWeekend: string;
  readonly gridLine: string;
  readonly bgSubtle: string;
  readonly fgMuted: string;
  readonly borderStrong: string;
  readonly border: string;
  readonly fg: string;
  readonly taskMilestone: string;
  readonly taskDefault: string;
  readonly taskCritical: string;
  readonly taskCriticalDash: readonly number[];
  readonly taskCriticalStrokeWidth: number;
  readonly taskSelected: string;
  readonly taskSelectedWidth: number;
  readonly taskSelectedOffset: number;
  readonly taskFocus: string;
  readonly taskFocusWidth: number;
  readonly depLine: string;
}

/**
 * Resolves `--fg-*` CSS custom properties into concrete color/number values, once per
 * `render()` call. Unlike SVG (which paints `var(--fg-*, fallback)` directly and lets the
 * browser resolve it at paint time), `CanvasRenderingContext2D.fillStyle`/`strokeStyle` do
 * NOT understand `var(...)` — they need an already-resolved string, so this function exists
 * to avoid a real theming regression versus SVG (spec §5.2). Every value here is host-app
 * CSS, not `task`-scoped untrusted data — a different trust boundary than `task.color`
 * (§6), which always flows through `validateTaskColor` on its own path, never through here.
 */
function resolveDesignTokens(container: HTMLElement): DesignTokens {
  const style = getComputedStyle(container);
  const color = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  const dash = (name: string, fallback: readonly number[]): readonly number[] => {
    const raw = style.getPropertyValue(name).trim();
    if (!raw) return fallback;
    const parsed = raw.split(/\s+/).map(Number);
    return parsed.every((n) => Number.isFinite(n) && n >= 0) ? parsed : fallback;
  };
  const num = (name: string, fallback: number): number => {
    const raw = Number(style.getPropertyValue(name));
    return Number.isFinite(raw) && raw !== 0 ? raw : fallback;
  };
  return {
    gridToday: color('--fg-grid-today', '#fef3c7'),
    gridHoliday: color('--fg-grid-holiday', '#fee2e2'),
    gridWeekend: color('--fg-grid-weekend', '#f9fafb'),
    gridLine: color('--fg-grid-line', '#e5e7eb'),
    bgSubtle: color('--fg-bg-subtle', '#f3f4f6'),
    fgMuted: color('--fg-fg-muted', '#71717a'),
    borderStrong: color('--fg-border-strong', '#d4d4d8'),
    border: color('--fg-border', '#e5e7eb'),
    fg: color('--fg-fg', '#18181b'),
    taskMilestone: color('--fg-task-milestone', '#f59e0b'),
    taskDefault: color('--fg-task-default', '#6366f1'),
    taskCritical: color('--fg-task-critical', '#ef4444'),
    taskCriticalDash: dash('--fg-task-critical-dash', [4, 2]),
    taskCriticalStrokeWidth: num('--fg-task-critical-stroke-width', 2),
    taskSelected: color('--fg-task-selected', '#4338ca'),
    taskSelectedWidth: num('--fg-task-selected-width', 2),
    taskSelectedOffset: num('--fg-task-selected-offset', 2),
    taskFocus: color('--fg-task-focus', '#0ea5e9'),
    taskFocusWidth: num('--fg-task-focus-width', 2),
    depLine: color('--fg-dep-line', '#64748b'),
  };
}

/** Feature-detected once at module load (spec §10.2): `ctx.roundRect` is broadly supported
 *  in modern evergreen browsers but not universal on older engines — fall back to a plain
 *  rect (square corners) when absent, a graceful visual degradation, not a functional
 *  failure. */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, width, height);
  }
}

/** Minimal CSS.escape-equivalent for a `data-task-id` value interpolated into an attribute
 *  selector string (`querySelector`). `task.id` is a branded, developer-controlled `TaskId`
 *  (never raw untrusted host free-text), but this is cheap defense-in-depth against a value
 *  containing a `"` breaking the selector string. Kept in sync BY HAND with
 *  `svg-renderer.ts`'s identically-behaved copy (spec §2.1 — small/isolated enough that
 *  duplication, not extraction, is the deliberate choice here). */
function cssEscapeAttr(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  if (css?.escape) return css.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Creates and mounts a Canvas renderer into `container` — appends one
 * `<canvas class="fg-timeline-canvas">` child plus one hidden `<div class="fg-timeline-a11y-
 * layer">` child (Ticket 2). Same call shape as `createSvgRenderer` (container-first, input,
 * optional options) — deliberate, so a future auto-switch call site is a one-line change, not
 * a signature adaptation.
 */
/**
 * Every piece of closure state `render()` reads from or assigns to, grouped into ONE object
 * so `update()`/`setOptions()` can snapshot-and-restore it atomically on a failed `render()`
 * (spec-canvas-row-limit-fix.md §5.3, hardened per its own follow-up review — a previous,
 * hand-rolled per-field rollback missed `timeScale`, since `render()` can still throw AFTER
 * assigning it, from `renderer-base.ts`'s independent `MAX_GRID_COLUMNS` guard inside
 * `computeGridColumns`, not just from the dimension guard above). Grouping every mutated
 * field into one object makes the rollback exhaustive BY CONSTRUCTION — a future field
 * `render()` starts assigning is automatically covered by the same snapshot/restore, no
 * per-field bookkeeping to remember.
 */
interface RenderState {
  readonly input: CanvasRendererInput;
  readonly options: CanvasRendererOptions;
  // Mutable (not readonly) — the only field `render()` itself assigns, once, after every
  // guard that can still throw has passed.
  timeScale: TimeScale;
}

export function createCanvasRenderer(
  container: HTMLElement,
  input: CanvasRendererInput,
  options: CanvasRendererOptions = {},
): CanvasRendererHandle {
  // `timeScale` is assigned inside render(), which always runs synchronously below before
  // the handle is returned — never read while still the placeholder (definite-assignment
  // asserted, same spirit as the previous `let currentTimeScale!: TimeScale`).
  let state: RenderState = {
    input,
    options: { ...options },
    timeScale: undefined as unknown as TimeScale,
  };
  let destroyed = false;

  const canvas = document.createElement('canvas');
  canvas.className = 'fg-timeline-canvas';
  container.appendChild(canvas);

  const maybeCtx = canvas.getContext('2d');
  if (maybeCtx === null) {
    // §6 point 4: reject rather than silently no-op — a confusing "nothing rendered, no
    // error" state is itself a defensive-programming/DoS-adjacent failure mode.
    canvas.remove();
    throw new Error('canvas-renderer: 2D context unavailable');
  }
  // Re-bound with a non-nullable declared type (not a narrowing) — TypeScript does not
  // preserve control-flow narrowing of an outer `const` across the nested `render()`
  // closure below, so this must be its own definitely-typed binding, not a relied-upon
  // narrow of `maybeCtx`.
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // The hidden a11y layer below is positioned `absolute; top:0; left:0` — for that to anchor
  // at `container`'s own top-left corner (co-located with `canvas`, which is `container`'s
  // first child) rather than the nearest ANY positioned ancestor somewhere else in the host
  // page, `container` itself must establish a positioning context. Only set when the host app
  // hasn't already positioned it (`static` is the CSS-default, so "unset" and "explicitly
  // static" are indistinguishable and both safe to upgrade) — never overrides a host app's own
  // `relative`/`absolute`/`fixed`/`sticky` choice.
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  // --- Hidden ARIA grid layer construction (Ticket 2, spec §5.1) --------------------------
  // Visually hidden, but focusable/AT-reachable — the standard "sr-only" technique, NOT
  // display:none/visibility:hidden (both remove an element from the accessibility tree AND
  // the tab order). Set via inline styles — `@fluxgantt/core` ships no base stylesheet.
  // Deliberately OFFSCREEN, not positioned to overlay the visible canvas (spec §5.1).
  const a11yLayer = document.createElement('div');
  a11yLayer.className = 'fg-timeline-a11y-layer';
  a11yLayer.style.position = 'absolute';
  // `top`/`left` MUST be pinned (not left to the "static position" fallback) — without them,
  // an unpositioned `position: absolute` element renders wherever it would fall in normal
  // document flow, which for a tall chart (many rows -> a tall `canvas`, this layer appended
  // right after it) can be thousands of pixels down the page. A keyboard/AT user focusing a
  // row then drags the WHOLE PAGE (canvas included) into a huge scroll jump via the browser's
  // built-in scroll-into-view-on-focus behavior, defeating the entire point of "offscreen but
  // visually in place." Pinning to the container's own top-left keeps the hidden layer (and
  // therefore the focus scroll target) co-located with the visible canvas regardless of row
  // count. Empirically confirmed via a Playwright repro while authoring this ticket's harness.
  a11yLayer.style.top = '0';
  a11yLayer.style.left = '0';
  a11yLayer.style.width = '1px';
  a11yLayer.style.height = '1px';
  a11yLayer.style.margin = '-1px';
  a11yLayer.style.border = '0';
  a11yLayer.style.padding = '0';
  a11yLayer.style.overflow = 'hidden';
  a11yLayer.style.clip = 'rect(0px, 0px, 0px, 0px)';
  a11yLayer.style.clipPath = 'inset(50%)';
  a11yLayer.style.whiteSpace = 'nowrap';
  container.appendChild(a11yLayer);

  // Reentrancy guard (spec §5.1/§8.3) — prevents the a11y-layer rebuild's own `.focus()` call
  // (below, in render()) or DOM removal from recursively re-entering render() via focusin/
  // focusout, which the rebuild itself synchronously fires.
  let isRendering = false;
  a11yLayer.addEventListener('focusin', handleFocusChange);
  a11yLayer.addEventListener('focusout', handleFocusChange);

  try {
    render();
  } catch (err) {
    // Mirrors the null-2D-context guard above (§5.3 of the fix spec) — leave no half-mounted
    // canvas or a11y layer behind on a construction-time failure.
    canvas.remove();
    a11yLayer.remove();
    throw err;
  }

  return {
    canvas,
    container,
    interactionRoot: a11yLayer,
    pointerEventTarget: canvas,
    update(nextInput: CanvasRendererInput): void {
      if (destroyed) return;
      const previousState = state;
      state = { ...state, input: nextInput };
      try {
        render();
      } catch (err) {
        // Roll back the WHOLE state object at once (input, options, AND timeScale) —
        // atomic-by-construction, so every piece of state this handle exposes reflects the
        // last SUCCESSFUL render, never a half-applied new one, no matter which guard inside
        // render() is what actually threw (spec §5.3).
        state = previousState;
        throw err;
      }
    },
    setOptions(nextOptions: Partial<CanvasRendererOptions>): void {
      if (destroyed) return;
      const previousState = state;
      state = { ...state, options: { ...state.options, ...nextOptions } };
      try {
        render();
      } catch (err) {
        state = previousState;
        throw err;
      }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      a11yLayer.removeEventListener('focusin', handleFocusChange);
      a11yLayer.removeEventListener('focusout', handleFocusChange);
      canvas.remove();
      a11yLayer.remove();
    },
    getTimeScale(): TimeScale {
      // No `destroyed` guard needed — returns the last render's TimeScale (harmless, pure
      // data) even after destroy(), same non-throwing spirit as the rest of this handle.
      return state.timeScale;
    },
    hitTestRow,
  };

  function handleFocusChange(): void {
    // Ignore focus events caused by our OWN DOM rebuild inside render() (spec §5.2/§8.3), and
    // any stray event arriving after destroy().
    if (isRendering || destroyed) return;
    render();
  }

  /** (Ticket 2, spec §7.2) O(1) index arithmetic, not a per-row scan — safe to call on every
   *  `pointerdown` even at 10,000+ rows, since `ROW_HEIGHT` is constant across all rows
   *  regardless of hierarchy indentation. Reads live `state.input`/`state.options`, never a
   *  stale cache from the last `render()` — same freshness posture `keyboard-nav.ts` already
   *  uses for its own `layoutRows()` calls. */
  function hitTestRow(clientX: number, clientY: number): { taskId: TaskId; rowIndex: number } | undefined {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Same logical/CSS-pixel coordinate space paintRows() already uses internally — no DPR
    // conversion needed here (the 2D context is scaled by devicePixelRatio ONCE at paint
    // time; layout math always operates in plain CSS pixels, matching clientX/clientY units).
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) return undefined; // outside canvas entirely
    if (y < HEADER_HEIGHT) return undefined; // header band — not a row

    const density = state.options.density ?? DEFAULT_DENSITY;
    const rows = layoutRows(state.input.tasks, density); // same call render() makes
    const rowHeight = ROW_HEIGHT[density]; // uniform per density, independent of hierarchy depth
    const rowIndex = Math.floor((y - HEADER_HEIGHT) / rowHeight);
    const row = rows[rowIndex];
    if (row === undefined) return undefined; // below the last row — empty space

    return { taskId: row.task.id, rowIndex };
  }

  function render(): void {
    isRendering = true;
    try {
      renderPixels();
    } finally {
      isRendering = false;
    }
  }

  function renderPixels(): void {
    const calendar = state.input.calendar ?? DEFAULT_CALENDAR;
    const viewMode = state.options.viewMode ?? DEFAULT_VIEW_MODE;
    const density = state.options.density ?? DEFAULT_DENSITY;
    const locale = state.options.locale ?? DEFAULT_LOCALE;
    const ariaLabel = (state.options.ariaLabel ?? DEFAULT_ARIA_LABEL).slice(0, MAX_ARIA_NAME_LENGTH);

    const optionRange = state.options.timeRange;
    const range = optionRange
      ? {
          start: normalizeDate(optionRange.start, calendar.timezone),
          end: normalizeDate(optionRange.end, calendar.timezone),
        }
      : deriveTimeRange(state.input.tasks, viewMode, calendar);

    const timeScale = createTimeScale(range, viewMode, calendar);
    // NOTE: `state.timeScale = timeScale` is deliberately NOT assigned here — deferred until
    // after EVERY guard that can still throw has passed (the dimension guard below, AND
    // `computeGridColumns`'s own `MAX_GRID_COLUMNS` guard further down), so `getTimeScale()`
    // never reports a range that was never actually painted
    // (spec-canvas-row-limit-fix.md §5.2, hardened per its own follow-up review).

    const rowHeight = ROW_HEIGHT[density];
    const rows = layoutRows(state.input.tasks, density);

    const offsetX = LABEL_COLUMN_WIDTH;
    const offsetY = HEADER_HEIGHT;
    const bodyHeight = rows.length > 0 ? rows[rows.length - 1]!.y + rowHeight : rowHeight;
    const totalWidth = offsetX + timeScale.totalWidth;
    const totalHeight = offsetY + bodyHeight;
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

    const physicalWidth = Math.round(totalWidth * dpr);
    const physicalHeight = Math.round(totalHeight * dpr);

    // --- Guards that can still throw — ALL of them MUST run before any canvas/DOM mutation,
    // before the barByTaskId loop (avoids wasted O(rows) work and a misleading
    // `clampedCount` console.warn firing right before a hard failure), and before
    // `state.timeScale` is assigned (spec-canvas-row-limit-fix.md §5.2/§5.3, hardened): a
    // throw at ANY point below this comment must leave the canvas's prior bitmap, and every
    // other piece of exposed state, entirely untouched (see update()/setOptions() rollback
    // above, which now rolls back `state` as one atomic unit for exactly this reason — a
    // second, independent throw site here, `computeGridColumns`'s own `MAX_GRID_COLUMNS`
    // guard, is not the dimension guard added by this fix, but must be treated identically:
    // both run, and can both throw, before any state mutation).

    // Dimension guard — height is checked first; both axes are independently checked, but if
    // both overflow simultaneously the error reports 'height' (documented tie-break, not
    // accidental ordering — spec-canvas-row-limit-fix.md §11). Runs UNCHANGED, for every
    // engine, before the WebKit-only branch below (spec-canvas-webkit-dimension-limit.md §7.1
    // — a Chromium (or any other non-WebKit) user must never see a MORE restrictive outcome
    // than today's shipped behavior; this branch only ever ADDS restriction, never removes it).
    if (physicalHeight > MAX_CANVAS_DIMENSION_PX) {
      throw new CanvasDimensionExceededError('height', physicalHeight, MAX_CANVAS_DIMENSION_PX, rows.length, dpr);
    }
    if (physicalWidth > MAX_CANVAS_DIMENSION_PX) {
      throw new CanvasDimensionExceededError('width', physicalWidth, MAX_CANVAS_DIMENSION_PX, rows.length, dpr);
    }

    // WebKit-only area guard (spec-canvas-webkit-dimension-limit.md §5 Option A / §7.1). Only
    // reachable once BOTH Chromium-shaped per-axis checks above have already passed — see the
    // module-level comment above `MAX_CANVAS_AREA_PX_WEBKIT` for the full empirical rationale,
    // including why no separate WebKit per-axis check exists (dominated by the check above).
    // Tie-break order stays height -> width -> area, extending the existing precedent.
    if (isWebKitEngine()) {
      const physicalArea = physicalWidth * physicalHeight;
      if (physicalArea > MAX_CANVAS_AREA_PX_WEBKIT) {
        throw new CanvasDimensionExceededError(
          'area',
          physicalArea,
          MAX_CANVAS_AREA_PX_WEBKIT,
          rows.length,
          dpr,
          { physicalWidth, physicalHeight },
        );
      }
    }

    // "Today" is read from the real clock only here, at the DOM boundary — never inside a
    // pure `renderer-base.ts` function.
    const now = getTemporal().Now.zonedDateTimeISO(calendar.timezone);
    // `computeGridColumns` has its own independent `MAX_GRID_COLUMNS` guard (anti-DoS,
    // `renderer-base.ts`) that can throw here — unrelated to, and checked after, the
    // dimension guard above, but still strictly before any state mutation/canvas paint.
    const gridColumns = computeGridColumns(timeScale, viewMode, calendar, locale, now);

    // First mutation of exposed state, now that EVERY guard that could still throw has
    // passed — this frame WILL complete successfully from here on.
    state.timeScale = timeScale;

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
      // Single summary warning per render — parity/debuggability with svg-renderer.ts's
      // identical guard, cheap to keep consistent.
      console.warn(
        `@fluxgantt/core canvas-renderer: ${clampedCount} task(s) have end before start — bar width clamped to 0.`,
      );
    }

    const criticalIds = new Set(state.input.criticalPath?.criticalTaskIds ?? []);
    const selectedIds = new Set(state.input.selectedTaskIds ?? []);

    const tokens = resolveDesignTokens(container);

    // Reassigning .width/.height clears the bitmap AND resets any transform, per the
    // HTMLCanvasElement spec — always reassigned even if numerically unchanged, so every
    // render() starts from a truly blank, untransformed canvas (no accumulation bugs).
    canvas.width = physicalWidth;
    canvas.height = physicalHeight;
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${totalHeight}px`;
    // Defensive — stated explicitly rather than relying silently on width/height-
    // reassignment semantics.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Paint order mirrors svg-renderer.ts's DOM append order exactly (bottom → top z-order).
    paintGrid(ctx, gridColumns, offsetX, totalHeight, tokens);
    paintHeader(ctx, gridColumns, offsetX, timeScale.totalWidth, tokens);
    paintDependencies(ctx, state.input.dependencies, barByTaskId, rowHeight, offsetX, offsetY, tokens);
    paintRows(ctx, rows, barByTaskId, criticalIds, selectedIds, rowHeight, offsetX, offsetY, tokens);
    paintLabelDivider(ctx, offsetX, totalHeight, tokens);

    // --- Hidden ARIA layer rebuild (Ticket 2, spec §5.2) -----------------------------------
    // `focusedTaskId` falls back to the FIRST row when unset — before any keyboard interaction
    // has happened, the grid must still be exactly one native Tab stop (mirrors SVG's
    // identical fallback).
    const focusedTaskId = state.input.focusedTaskId ?? rows[0]?.task.id;
    // Captured BEFORE the full rebuild below destroys every existing row element — the gate
    // that prevents this render pass from ever STEALING focus during a purely programmatic/
    // headless mutation: focus is only ever RESTORED, never newly grabbed.
    const hadFocusInside = a11yLayer.contains(document.activeElement);

    while (a11yLayer.firstChild) a11yLayer.removeChild(a11yLayer.firstChild);

    a11yLayer.setAttribute('role', 'grid');
    a11yLayer.setAttribute('aria-rowcount', String(rows.length));
    a11yLayer.setAttribute('aria-multiselectable', 'true');
    a11yLayer.setAttribute('aria-label', ariaLabel);

    for (const row of rows) {
      const isSelected = selectedIds.has(row.task.id);
      const isCritical = criticalIds.has(row.task.id);

      const rowEl = document.createElement('div');
      // Deliberately a DIFFERENT class than SVG's `.fg-timeline__row` (own `fg-timeline-canvas__`
      // prefix — mirrors the `.fg-timeline-canvas` vs `.fg-timeline` split above) — this layer is
      // never meant to be styled directly, so it must not accidentally pick up host/theme CSS
      // written against the real visible SVG chart's classes. The shared interaction modules
      // (`selection.ts`, `keyboard-nav.ts`) never rely on these class names — they use the
      // `[data-row-index]`/`[data-task-id]` attribute contract instead, which is identical
      // between both renderers.
      rowEl.className = 'fg-timeline-canvas__row';
      rowEl.setAttribute('role', 'row');
      rowEl.setAttribute('data-row-index', String(row.rowIndex));
      rowEl.setAttribute('data-task-id', row.task.id);
      rowEl.setAttribute('aria-rowindex', String(row.rowIndex + 1));
      rowEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      rowEl.setAttribute('tabindex', row.task.id === focusedTaskId ? '0' : '-1');

      const cellEl = document.createElement('div');
      cellEl.className = 'fg-timeline-canvas__row-cell';
      cellEl.setAttribute('role', 'gridcell');

      const labelEl = document.createElement('span');
      labelEl.className = 'fg-timeline-canvas__row-label';
      // SECURITY: `task.name` is untrusted host-app data — textContent only, never innerHTML
      // or a template string assembled into markup (security.md §1, spec §9).
      labelEl.textContent = row.task.name;

      const taskEl = document.createElement('div');
      // Whitelist `task.type` before folding it into a class token — fall back to the `task`
      // modifier for any value that isn't a known TaskKind, so untrusted data can't inject an
      // arbitrary extra class (CSS-token spoofing).
      const kindClass = isKnownTaskKind(row.task.type) ? row.task.type : 'task';
      const classNames = ['fg-timeline-canvas__task', `fg-timeline-canvas__task--${kindClass}`];
      if (isCritical) classNames.push('fg-timeline-canvas__task--critical');
      if (isSelected) classNames.push('fg-timeline-canvas__task--selected');
      taskEl.className = classNames.join(' ');
      // `task.id` is a branded TaskId (developer-controlled, not free-text host input) — safe
      // as an attribute value via setAttribute regardless.
      taskEl.setAttribute('data-task-id', row.task.id);
      taskEl.setAttribute('aria-label', buildTaskAriaLabel(row.task, isCritical, isSelected, calendar, locale));

      cellEl.appendChild(labelEl);
      cellEl.appendChild(taskEl);
      rowEl.appendChild(cellEl);
      a11yLayer.appendChild(rowEl);
    }

    // Canvas itself is now purely decorative — all semantic content lives in `a11yLayer`
    // (Ticket 1's `role="img"`/`aria-label` stopgap is superseded, not layered on top of).
    canvas.setAttribute('aria-hidden', 'true');
    canvas.removeAttribute('role');
    canvas.removeAttribute('aria-label');

    if (hadFocusInside && focusedTaskId !== undefined) {
      // Attribute-only selector (not `.fg-timeline-canvas__row[...]`) — `data-task-id` alone is
      // already unique within this layer, and staying attribute-only keeps this lookup decoupled
      // from the class-naming choice above.
      const rowEl = a11yLayer.querySelector<HTMLElement>(
        `[data-task-id="${cssEscapeAttr(focusedTaskId)}"]`,
      );
      // Fires focusin/focusout synchronously — SAFE, `isRendering` is still true here (set by
      // the outer render() wrapper), so handleFocusChange() no-ops instead of recursing.
      rowEl?.focus({ preventScroll: true });
    }

    // Always the LAST paint step (spec §8.2) — drawn on top of everything else, so the ring
    // is never obscured by a bar, dependency arrow, or critical-path dash.
    const focusBar = focusedTaskId !== undefined ? barByTaskId.get(focusedTaskId) : undefined;
    paintFocusRing(ctx, focusBar, hadFocusInside, offsetX, offsetY, tokens);
  }
}

// --- Paint primitives (drawing only — no layout math) -----------------------------------

function paintGrid(
  ctx: CanvasRenderingContext2D,
  columns: readonly GridColumn[],
  offsetX: number,
  totalHeight: number,
  tokens: DesignTokens,
): void {
  ctx.save();
  try {
    for (const col of columns) {
      const x = col.x + offsetX;
      if (col.isToday || col.isHoliday || col.isWeekend) {
        const fill = col.isToday ? tokens.gridToday : col.isHoliday ? tokens.gridHoliday : tokens.gridWeekend;
        ctx.fillStyle = fill;
        ctx.fillRect(x, 0, col.width, totalHeight);
      }
      ctx.strokeStyle = tokens.gridLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalHeight);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

function paintHeader(
  ctx: CanvasRenderingContext2D,
  columns: readonly GridColumn[],
  offsetX: number,
  timelineWidth: number,
  tokens: DesignTokens,
): void {
  ctx.save();
  try {
    ctx.fillStyle = tokens.bgSubtle;
    ctx.fillRect(offsetX, 0, timelineWidth, HEADER_HEIGHT);

    ctx.fillStyle = tokens.fgMuted;
    ctx.font = TASK_LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const col of columns) {
      const x = col.x + offsetX;
      // Label is Temporal/Intl-formatted (never user input), but fillText is
      // injection-safe by construction regardless — consistent no-markup-sink policy.
      ctx.fillText(col.label, x + col.width / 2, HEADER_HEIGHT / 2);
    }
    ctx.textAlign = 'start'; // restore default before the divider stroke below (defensive)

    ctx.strokeStyle = tokens.borderStrong;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(offsetX, HEADER_HEIGHT);
    ctx.lineTo(offsetX + timelineWidth, HEADER_HEIGHT);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

function paintLabelDivider(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  totalHeight: number,
  tokens: DesignTokens,
): void {
  ctx.save();
  try {
    ctx.strokeStyle = tokens.border;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(offsetX, 0);
    ctx.lineTo(offsetX, totalHeight);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

function paintRows(
  ctx: CanvasRenderingContext2D,
  rows: readonly RowLayout[],
  barByTaskId: ReadonlyMap<TaskId, TaskBarLayout>,
  criticalIds: ReadonlySet<TaskId>,
  selectedIds: ReadonlySet<TaskId>,
  rowHeight: number,
  offsetX: number,
  offsetY: number,
  tokens: DesignTokens,
): void {
  for (const row of rows) {
    const bar = barByTaskId.get(row.task.id);
    if (!bar) continue;

    // Label paint (per row, BEFORE the bar — same append order as svg-renderer.ts's
    // `cell.appendChild(label)` then `cell.appendChild(renderTaskBar(...))`, though the
    // regions don't spatially overlap so paint order has no visible effect; kept identical
    // purely for call-log/parity consistency with the SVG file's structure).
    ctx.save();
    try {
      ctx.fillStyle = tokens.fg;
      // COMPILE-TIME CONSTANT — see §6, never built from task data.
      ctx.font = TASK_LABEL_FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'start';
      // SECURITY: `task.name` is untrusted host-app data — passed ONLY as fillText's
      // literal text argument, never concatenated into `ctx.font` or any other property.
      ctx.fillText(
        row.task.name,
        LABEL_PADDING_PX + row.depth * LABEL_INDENT_PX,
        offsetY + row.y + rowHeight / 2,
      );
    } finally {
      ctx.restore();
    }

    const isCritical = criticalIds.has(row.task.id);
    const isSelected = selectedIds.has(row.task.id);
    paintTaskBar(ctx, row.task, bar, offsetX, offsetY, isCritical, isSelected, tokens);
  }
}

/** Mandatory `save()`/`restore()` discipline (§5.3) — prevents Canvas's persistent context
 *  state (dash pattern, stroke style, line width) from leaking between tasks, a bug class
 *  with no SVG equivalent (each SVG element carries its own attributes independently; a
 *  `<canvas>` 2D context is one shared, mutable state machine). */
function paintTaskBar(
  ctx: CanvasRenderingContext2D,
  task: Task,
  bar: TaskBarLayout,
  offsetX: number,
  offsetY: number,
  isCritical: boolean,
  isSelected: boolean,
  tokens: DesignTokens,
): void {
  const x = bar.x + offsetX;
  const y = bar.y + offsetY;

  ctx.save();
  try {
    // SECURITY: `fill` is EITHER the whitelist-validated `task.color` OR a hardcoded/
    // token-resolved default — `task.color`'s raw string NEVER reaches `ctx.fillStyle` (§6).
    const fill = validateTaskColor(task.color) ?? (task.type === 'milestone' ? tokens.taskMilestone : tokens.taskDefault);
    ctx.fillStyle = fill;

    if (task.type === 'milestone') {
      const cx = x + bar.width / 2;
      const cy = y + bar.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      // Square, rotated 45° == SVG's diamond. Geometry stays a plain rect drawn relative to
      // the translated/rotated origin.
      ctx.beginPath();
      ctx.rect(-bar.width / 2, -bar.height / 2, bar.width, bar.height);
      ctx.fill();
      if (isCritical) {
        strokeCriticalOutline(ctx, -bar.width / 2, -bar.height / 2, bar.width, bar.height, tokens);
      }
      // No manual transform reset needed — restore() below undoes translate/rotate.
    } else {
      drawRoundedRect(ctx, x, y, bar.width, bar.height, 3);
      ctx.fill();
      if (isCritical) {
        strokeCriticalOutline(ctx, x, y, bar.width, bar.height, tokens);
      }
    }
  } finally {
    // ALWAYS restore, even if the isCritical branch mutated setLineDash — save() above
    // snapshots dash/stroke/transform state, restore() undoes it unconditionally.
    ctx.restore();
  }

  if (isSelected) {
    paintSelectionOutline(ctx, x, y, bar.width, bar.height, tokens);
  }
}

/** Called INSIDE the same `save()`/`restore()` pair as the fill in `paintTaskBar` above. */
function strokeCriticalOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tokens: DesignTokens,
): void {
  drawRoundedRect(ctx, x, y, width, height, 3);
  ctx.strokeStyle = tokens.taskCritical;
  ctx.lineWidth = tokens.taskCriticalStrokeWidth;
  // A11y: dashed, NOT color-alone — matches SVG's stroke-dasharray.
  ctx.setLineDash([...tokens.taskCriticalDash]);
  ctx.stroke();
}

/** Own `save()`/`restore()` pair, drawn as a second, larger, non-dashed outset rect —
 *  mirrors SVG's separate `outline` box-model property, so critical + selected compose
 *  without collision. */
function paintSelectionOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tokens: DesignTokens,
): void {
  ctx.save();
  try {
    const o = tokens.taskSelectedOffset;
    drawRoundedRect(ctx, x - o, y - o, width + 2 * o, height + 2 * o, 3);
    ctx.strokeStyle = tokens.taskSelected;
    ctx.lineWidth = tokens.taskSelectedWidth;
    // Explicit — must NOT inherit a dash pattern from anything else.
    ctx.setLineDash([]);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

/**
 * Focus ring (Ticket 2, spec §8.2) — a solid, distinctly-colored/toned outline around the
 * focused task's bar, painted LAST so it always sits on top of everything else. `bar` is
 * `undefined` when nothing is focused, or when `focusedTaskId` no longer resolves in the
 * current row set (e.g. just filtered/removed) — both are silent no-ops, never a throw.
 * Solid stroke (NOT dashed, unlike the critical-path outline) — a third, independent visual
 * signal from both critical (dashed) and selected (solid, different token/offset), so all
 * three compose without visual collision (matches SVG's three-independent-signals model).
 */
function paintFocusRing(
  ctx: CanvasRenderingContext2D,
  bar: TaskBarLayout | undefined,
  hadFocusInside: boolean,
  offsetX: number,
  offsetY: number,
  tokens: DesignTokens,
): void {
  if (!hadFocusInside || bar === undefined) return;
  const x = bar.x + offsetX;
  const y = bar.y + offsetY;

  ctx.save();
  try {
    ctx.strokeStyle = tokens.taskFocus;
    ctx.lineWidth = tokens.taskFocusWidth;
    ctx.setLineDash([]);
    drawRoundedRect(ctx, x - 2, y - 2, bar.width + 4, bar.height + 4, 3);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

/**
 * Dependency arrows — hand-drawn arrowhead (§5.4). Canvas has no `<marker>` concept.
 * `layoutDependencyPath` returns the same elbow-routed `points` array SVG already consumes;
 * paint as a polyline, then hand-draw a small filled triangle at the final point, oriented
 * from the last segment's axis-aligned direction (all segments are strictly horizontal or
 * vertical, so direction is a simple sign check, never a diagonal).
 */
function paintDependencies(
  ctx: CanvasRenderingContext2D,
  dependencies: readonly Dependency[],
  barByTaskId: ReadonlyMap<TaskId, TaskBarLayout>,
  rowHeight: number,
  offsetX: number,
  offsetY: number,
  tokens: DesignTokens,
): void {
  for (const dep of dependencies) {
    // Unknown dependency type from untrusted data — skip, same resilience posture as a
    // dangling reference.
    if (!isKnownDependencyType(dep.type)) continue;
    const fromBar = barByTaskId.get(dep.from);
    const toBar = barByTaskId.get(dep.to);
    // Dangling dependency reference — skip rather than throw, same resilience posture as
    // svg-renderer.ts's `renderDependencies`.
    if (!fromBar || !toBar) continue;

    const layout = layoutDependencyPath(dep, fromBar, toBar, rowHeight);
    const points = layout.points.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }));
    if (points.length < 2) continue;

    ctx.save();
    try {
      ctx.strokeStyle = tokens.depLine;
      ctx.lineWidth = 1;
      // Explicit reset — dependencies are never dashed, must not inherit from a previous
      // critical-task paint call earlier in the same render pass.
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(points[0]!.x, points[0]!.y);
      for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();

      const last = points[points.length - 1]!;
      const prev = points[points.length - 2]!;
      // Exactly one of dx/dy is nonzero — all segments are axis-aligned.
      const dx = Math.sign(last.x - prev.x);
      const dy = Math.sign(last.y - prev.y);
      drawArrowheadTriangle(ctx, last, dx, dy, tokens.depLine);
    } finally {
      ctx.restore();
    }
  }
}

/** ~`ARROWHEAD_SIZE_PX`-wide filled triangle at `tip`, pointing along `(dx, dy)` (exactly
 *  one nonzero, per `layoutDependencyPath`'s axis-aligned segments). */
function drawArrowheadTriangle(
  ctx: CanvasRenderingContext2D,
  tip: { readonly x: number; readonly y: number },
  dx: number,
  dy: number,
  fill: string,
): void {
  const s = ARROWHEAD_SIZE_PX;
  // Base point, offset backward along the direction of travel from the tip.
  const baseX = tip.x - dx * s;
  const baseY = tip.y - dy * s;
  // Perpendicular offset for the two base corners.
  const perpX = dy * (s / 2);
  const perpY = dx * (s / 2);

  ctx.save();
  try {
    ctx.fillStyle = fill;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(baseX + perpX, baseY + perpY);
    ctx.lineTo(baseX - perpX, baseY - perpY);
    ctx.closePath();
    ctx.fill();
  } finally {
    ctx.restore();
  }
}
