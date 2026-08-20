// Canvas renderer — static paint layer (spec-canvas-renderer-ticket1.md, Ticket 1 of
// `.claude/work/plan-canvas-renderer.md`'s 3-ticket breakdown). Mirrors `svg-renderer.ts`'s
// structure and visual feature set, but paints via `CanvasRenderingContext2D` primitives
// (`fillRect`/`roundRect`/`moveTo`+`lineTo`+`stroke`/`fillText`/`setLineDash`) instead of
// `document.createElementNS`.
//
// **THIS MODULE IS INERT AND UNWIRED (Ticket 1 only).** It is not re-exported from
// `render/index.ts` or the public barrel (`src/index.ts`), not referenced from `gantt.ts`,
// and adds no new `tsup`/`package.json` entry — it costs the default build ZERO bytes
// (verified: nothing in the module graph reachable from `src/index.ts` references this
// file). Tickets 2 (hidden ARIA DOM layer) and 3 (auto-switch wiring into `mount()` via a
// dynamic `import()`) are separate, future changes.
//
// **ACCESSIBILITY — NOT WCAG 2.1 AA COMPLIANT ON ITS OWN.** This module must not ship
// reachable to real end users until Ticket 2 lands. A `<canvas>` element has no per-row
// focusable structure, no `role="row"`/`aria-selected`/roving `tabindex` equivalent to what
// `svg-renderer.ts`'s `renderRows()` already provides, and is therefore not keyboard-operable
// or per-task-navigable by assistive technology. This ticket adds only a minimal stopgap —
// `role="img"` + a capped `aria-label` — so the module isn't a *total* silence if it is ever
// directly instantiated ahead of Ticket 2 (e.g. by this ticket's own visual-regression
// harness). Do NOT mistake `role="img"` for "accessibility done" (spec §7).
//
// SECURITY (security.md, spec §6 — read before touching this file): `task.name` is the
// only free-form string painted in v1, and it is passed ONLY as the literal first argument
// to `ctx.fillText(text, x, y)` — `fillText` paints pixels, it cannot be interpreted as
// markup/code, so this is injection-safe by construction. It is NEVER concatenated into
// `ctx.font` or any other property string; `ctx.font` is assigned only from a fixed,
// compile-time-constant string. `task.color` is only ever used after `validateTaskColor()`
// (from `renderer-base.ts`) accepts it — its return value, or a hardcoded/token-resolved
// default, is the ONLY thing ever assigned to `ctx.fillStyle`/`ctx.strokeStyle` for a
// task-colored element; the raw `task.color` string never reaches a Canvas API call. This
// file NEVER calls `ctx.createPattern()`/`ctx.createLinearGradient()`/
// `ctx.createRadialGradient()` anywhere — `fillStyle`/`strokeStyle` are only ever assigned a
// plain string (a compile-time-constant fallback or `validateTaskColor`'s output), so the
// pattern/gradient injection vector security.md flags is closed by construction, not merely
// by validation discipline. `canvas.getContext('2d')` returning `null` throws synchronously
// rather than silently no-op'ing (a confusing "nothing rendered, no error" state is itself a
// defensive-programming failure mode security.md's "reject rather than best-effort"
// principle argues against).
//
// MODULE-ISOLATION RULE (spec §2.1): this file must NEVER statically import anything from
// `svg-renderer.ts` — not even a pure numeric constant. This is deliberate: Ticket 3 will
// `import()` this file as a separate chunk specifically so a large-project host downloads
// Canvas code without SVG code; importing even one binding from `svg-renderer.ts` would drag
// the entire SVG paint module into that chunk, defeating the whole reason the split exists.
// A handful of small layout constants are therefore intentionally DUPLICATED locally below
// (see §5.1) rather than imported — kept in sync BY HAND with `svg-renderer.ts`'s
// identically-named constants.
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
  isKnownDependencyType,
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
  // NOTE: no `focusedTaskId` field in Ticket 1 (see file header a11y note) — there is no
  // focusable element to point it at yet (no hidden ARIA row layer exists until Ticket 2).
  // Adding a dead/no-op field now would be more misleading than omitting it; Ticket 2 adds
  // it back when it becomes meaningful, mirroring `SvgRendererInput.focusedTaskId`.
}

export interface CanvasRendererOptions {
  readonly viewMode?: ViewMode; // default 'week'
  readonly density?: Density; // default 'default'
  /** Visible date range. Omitted → inferred from min(start)..max(end) of `tasks` + padding. */
  readonly timeRange?: { readonly start: DateInput; readonly end: DateInput };
  /** Locale for date labels (Temporal + Intl formatting). Default 'en'. */
  readonly locale?: string;
  /** `aria-label` for the root `<canvas>`. Default `'Gantt chart'`. NOT WCAG-sufficient
   *  alone — see file header. Ticket 2 supersedes it with real per-row semantics. */
  readonly ariaLabel?: string;
  // NOTE: no `showLinkHandles` — Canvas mode has no connector-handle affordance in v1 at all
  // (drag-create-dep is excluded from Canvas mode entirely, not just deferred), so there is
  // nothing for this flag to toggle. Do not add a no-op option.
}

export interface CanvasRendererHandle {
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
  /** Removes the canvas element from `container`. `update()`/`setOptions()` after
   *  `destroy()` are a no-op — same contract as `SvgRendererHandle.destroy`. */
  destroy(): void;
  /** Same contract as `SvgRendererHandle.getTimeScale()` — `TimeScale` of the most recent
   *  **successful** render. */
  getTimeScale(): TimeScale;
  /**
   * RESERVED for Ticket 2. `undefined` in Ticket 1 — no hidden ARIA DOM layer exists yet.
   * Once Ticket 2 lands, this becomes the real, focusable per-row grid root element (the
   * Canvas equivalent of attaching `enableClickSelect`/`enableKeyboardNav` to `handle.svg`
   * today), so those interaction modules only need to generalize their "attach to
   * `handle.svg`" call sites to "attach to `handle.interactionRoot ?? handle.svg`"-shaped
   * logic, not learn an entirely new handle shape.
   */
  readonly interactionRoot: HTMLElement | undefined;
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

// --- Canvas backing-store dimension guard (spec-canvas-row-limit-fix.md) -----------------
//
// A `<canvas>` element's backing-store bitmap has a real, silent-failure ceiling per axis in
// every browser this repo tests (Chromium/`playwright.config.ts`'s only project family):
// `canvas.height`/`canvas.width` = 65536 makes every subsequent `ctx.*` draw call silently
// no-op — no thrown exception, `getImageData` reads back fully transparent. `65535` paints
// correctly. This is empirically confirmed against the CURRENT, post-Chromium-fix ceiling
// (see spec §4.2 for why no additional safety margin is subtracted). Only validated against
// Chromium — Safari/WebKit's real constraint is shaped differently (area-based, not
// per-axis) and is NOT covered by this guard (spec §4.3), a flagged, explicitly-scoped
// residual risk, not silently assumed solved.

/**
 * Hard per-axis ceiling for a `<canvas>` element's backing-store bitmap — see the comment
 * above for how this number was derived and its known (Safari/WebKit) limits.
 */
export const MAX_CANVAS_DIMENSION_PX = 65_535;

/**
 * Thrown by `createCanvasRenderer()`/`CanvasRendererHandle.update()`/`.setOptions()` when the
 * computed physical (post-devicePixelRatio) canvas bitmap size would exceed the browser's real
 * `<canvas>` backing-store limit (see `MAX_CANVAS_DIMENSION_PX` above) — this is the ONLY way
 * this file fails on an oversized project; it never silently renders a blank bitmap. See the
 * module-level comment above `MAX_CANVAS_DIMENSION_PX` for the full empirical rationale
 * (Chromium-only validation, known Safari/WebKit gap) — not repeated here so there is exactly
 * ONE place to update if that rationale ever changes (e.g. WebKit testing lands).
 */
export class CanvasDimensionExceededError extends Error {
  readonly axis: 'width' | 'height';
  readonly physicalPx: number;
  readonly limitPx: number;
  readonly rowCount: number;
  readonly devicePixelRatio: number;

  constructor(axis: 'width' | 'height', physicalPx: number, limitPx: number, rowCount: number, devicePixelRatio: number) {
    super(
      `canvas-renderer: computed canvas ${axis} (${physicalPx}px physical) exceeds the browser's ` +
        `safe <canvas> backing-store limit (${limitPx}px). This chart has ${rowCount} row(s) at ` +
        `devicePixelRatio=${devicePixelRatio}. Reduce the task/row count, use a more compact ` +
        `density, narrow the visible time range, or catch this error and fall back to ` +
        `createSvgRenderer(), which has no such limit.`,
    );
    this.name = 'CanvasDimensionExceededError';
    this.axis = axis;
    this.physicalPx = physicalPx;
    this.limitPx = limitPx;
    this.rowCount = rowCount;
    this.devicePixelRatio = devicePixelRatio;
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

/**
 * Creates and mounts a Canvas renderer into `container` — appends one
 * `<canvas class="fg-timeline-canvas">` child. Same call shape as `createSvgRenderer`
 * (container-first, input, optional options) — deliberate, so a future auto-switch call
 * site is a one-line change, not a signature adaptation.
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

  try {
    render();
  } catch (err) {
    // Mirrors the null-2D-context guard above (§5.3 of the fix spec) — leave no half-mounted
    // canvas behind on a construction-time failure.
    canvas.remove();
    throw err;
  }

  return {
    canvas,
    container,
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
      canvas.remove();
    },
    getTimeScale(): TimeScale {
      // No `destroyed` guard needed — returns the last render's TimeScale (harmless, pure
      // data) even after destroy(), same non-throwing spirit as the rest of this handle.
      return state.timeScale;
    },
    // RESERVED for Ticket 2 — no hidden ARIA DOM layer exists yet (see interface doc comment).
    interactionRoot: undefined,
  };

  function render(): void {
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
    // accidental ordering — spec §11).
    if (physicalHeight > MAX_CANVAS_DIMENSION_PX) {
      throw new CanvasDimensionExceededError('height', physicalHeight, MAX_CANVAS_DIMENSION_PX, rows.length, dpr);
    }
    if (physicalWidth > MAX_CANVAS_DIMENSION_PX) {
      throw new CanvasDimensionExceededError('width', physicalWidth, MAX_CANVAS_DIMENSION_PX, rows.length, dpr);
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

    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', ariaLabel);

    // Paint order mirrors svg-renderer.ts's DOM append order exactly (bottom → top z-order).
    paintGrid(ctx, gridColumns, offsetX, totalHeight, tokens);
    paintHeader(ctx, gridColumns, offsetX, timeScale.totalWidth, tokens);
    paintDependencies(ctx, state.input.dependencies, barByTaskId, rowHeight, offsetX, offsetY, tokens);
    paintRows(ctx, rows, barByTaskId, criticalIds, selectedIds, rowHeight, offsetX, offsetY, tokens);
    paintLabelDivider(ctx, offsetX, totalHeight, tokens);
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
