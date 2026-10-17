// Opt-in RENDER capability (spec-facade-split.md §3.3) — `withRender(createGantt(cfg))`.
//
// WHY A MIXIN, NOT A CLASS METHOD: prototype methods can never be tree-shaken. While
// `mount()`/`unmount()`/`refresh()` lived on the `Gantt` class, every consumer — including a
// purely headless one running in Node — was billed for the whole SVG renderer graph. Moving
// them behind a free function on a separate subpath means the render layer's bytes enter a
// bundle only when `@fluxgantt/core/render` is actually imported.
//
// The Canvas renderer stays reachable ONLY through the dynamic `import()` below — it is never
// statically imported by anything and never named in the package `exports` map.
import type { Temporal } from '@js-temporal/polyfill';
import { effect, type ReadonlySignal } from '../signals.js';
import {
  getInternal,
  type GanttInternal,
  type MountState,
  type RendererKind,
} from '../gantt-internal.js';
import { computeCriticalPath as computeCriticalPathFn } from '../compute/critical-path.js';
import { getTemporal } from '../internal/temporal.js';
import { createSvgRenderer } from './svg-renderer.js';
import type { SvgRendererHandle, SvgRendererInput, SvgRendererOptions } from './svg-renderer.js';
// TYPE-ONLY imports — erased at compile time, so they create NO runtime dependency edge into
// `canvas-renderer.ts`'s module graph (see the dynamic `import()` in `mountCanvasAsync`).
import type { CanvasRendererHandle, CanvasRendererOptions } from './canvas-renderer.js';
import type * as CanvasRendererModule from './canvas-renderer.js';
// TYPE-ONLY import back into the base facade — erased at compile time, so no runtime cycle.
import type { GanttInstance } from '../gantt.js';
import type { CriticalPathResult, Task, TaskId } from '../types.js';
import type { RolledUpRow } from './renderer-base.js';

/** Task count above which `mount()` lazily loads and uses the Canvas renderer instead of SVG
 *  (architecture.md: "Canvas fallback automatically when task count > 2000"). Decided once, at
 *  `mount()` time only — see `RenderCapability.mount()`'s own doc comment. */
export const CANVAS_AUTO_SWITCH_THRESHOLD = 2000;

/** Fixed window used as the renderer's `timeRange` fallback whenever the task count is 0 —
 *  otherwise `createSvgRenderer`'s internal `deriveTimeRange()` throws on an empty `tasks`
 *  array. */
const EMPTY_STATE_WINDOW_DAYS = 14;

type FallbackReason = 'dimension-exceeded' | 'load-failed' | 'construction-failed';

/** The three methods `withRender` adds to a `createGantt()` instance. */
export interface RenderCapability {
  /**
   * Mounts the chart into `container`. If already mounted, implicitly tears down the previous
   * mount first.
   *
   * **Renderer auto-switch (spec-canvas-auto-switch.md).** The task count at THIS INSTANT is
   * compared once against `CANVAS_AUTO_SWITCH_THRESHOLD` (2000):
   *  - At or below the threshold: `createSvgRenderer()` is used, synchronously, and the
   *    container reflects the chart before `mount()` returns.
   *  - Above the threshold: `mount()` still returns synchronously (this signature never
   *    changes), but the Canvas renderer is loaded via an internal dynamic `import()` and the
   *    container is EMPTY until that resolves — listen for `renderer:selected` to know when
   *    the chart has actually become visible. If the Canvas path fails for any reason
   *    (chunk-load failure, `CanvasDimensionExceededError`, or any other construction error),
   *    this falls back to SVG automatically; `renderer:selected`'s `canvasFallbackReason`
   *    reports which.
   *
   * **v1 limitation, by design (not an oversight):** the renderer choice is decided ONCE, at
   * the moment `mount()` is called. Adding/removing tasks while already mounted does NOT
   * re-evaluate or swap renderers mid-session, until the next explicit `unmount()`+`mount()`.
   *
   * **v1 limitation, by design:** `withInteraction` must be applied BEFORE the first
   * `mount()` call. Interaction hooks are consulted inside this method, so applying
   * `withInteraction` to an already-mounted instance has no effect until the next remount.
   *
   * Drag-move/drag-resize/drag-create-dependency are SVG-only — a Canvas-rendered chart
   * supports click-select and keyboard navigation, but not those. `exportSvg()`/`exportPng()`
   * (from `withIo`) work in both modes.
   */
  mount(container: HTMLElement): void;
  unmount(): void;
  refresh(): void;
}

/**
 * Adds `mount`/`unmount`/`refresh` to a `createGantt()` instance.
 *
 * ```ts
 * import { createGantt } from '@fluxgantt/core';
 * import { withRender } from '@fluxgantt/core/render';
 *
 * const gantt = withRender(createGantt({ tasks }));
 * gantt.mount(document.getElementById('chart')!);
 * ```
 *
 * Application order relative to `withInteraction`/`withIo` is irrelevant (the result type is an
 * intersection, and interaction hooks are consulted lazily) — but every mixin must be applied
 * before the first `mount()`.
 */
export function withRender<T extends GanttInstance>(instance: T): T & RenderCapability {
  const internal = getInternal(instance);

  const render: RenderCapability = {
    mount(container: HTMLElement): void {
      if (internal.dead()) return; // safe no-op
      internal.teardown(); // implicit remount if already mounted (no-op otherwise)

      // Monotonic race-guard token (spec-canvas-auto-switch.md §5) — bumped on every mount()
      // call (both the sync-SVG and async-Canvas paths, for symmetry), and also by unmount()/
      // destroy() so those invalidate any in-flight Canvas attempt too.
      const generation = internal.bumpGen();
      // Read ONCE, at this instant — the auto-switch decision is made once, at mount() time
      // only; adding/removing tasks later does not re-evaluate it.
      const taskCount = internal.tasks.size;

      if (taskCount <= CANVAS_AUTO_SWITCH_THRESHOLD) {
        mountSvg(internal, container, generation, taskCount); // fully synchronous
        return;
      }

      // Above the threshold: fire-and-forget async path — mount() itself still returns
      // synchronously; the container stays empty until `mountCanvasAsync` resolves (or falls
      // back to SVG). Not awaited — `void` documents that this is intentional.
      void mountCanvasAsync(internal, container, generation, taskCount);
    },

    unmount(): void {
      if (internal.dead()) return;
      // Bumped BEFORE the mount-state check — an in-flight async Canvas attempt has no mount
      // state assigned yet, but must still be invalidated here (spec §5).
      internal.bumpGen();
      internal.teardown();
    },

    refresh(): void {
      // Nothing to refresh headless or post-destroy.
      if (!internal.dead()) internal.mountOf()?.refresh();
    },
  };

  return Object.assign(instance, render);
}

/**
 * Loads the Canvas renderer via a real dynamic `import()` (keeps Canvas code out of the default
 * bundle — spec-canvas-auto-switch.md §3) and mounts it. On ANY failure along the way — the
 * chunk failing to load, `CanvasDimensionExceededError`, or any other construction error —
 * falls back to `mountSvg()` rather than letting the failure propagate; a `console.warn`
 * reports which. Re-checks the race-guard `generation` at every `await` boundary and abandons
 * silently (no DOM touch, no mount-state assignment, no `renderer:selected`) if a later
 * `mount()`/`unmount()`/`destroy()` call already superseded this attempt (spec §5).
 */
async function mountCanvasAsync(
  internal: GanttInternal,
  container: HTMLElement,
  generation: number,
  taskCount: number,
): Promise<void> {
  const superseded = (): boolean => generation !== internal.gen() || internal.dead();

  let canvasModule: typeof CanvasRendererModule;
  try {
    canvasModule = await import('./canvas-renderer.js');
  } catch (importErr) {
    if (superseded()) return; // superseded — abandon silently
    console.warn(
      '@fluxgantt/core: Canvas renderer failed to load — falling back to the SVG renderer.',
      importErr,
    );
    mountSvg(internal, container, generation, taskCount, 'load-failed');
    return;
  }

  if (superseded()) return; // superseded while awaiting the import

  let handle: CanvasRendererHandle;
  const memo = createMemo();
  try {
    handle = canvasModule.createCanvasRenderer(
      container,
      renderInput(internal, memo, false),
      rendererOptions(internal),
      createSvgRenderer,
    );
  } catch (constructErr) {
    if (superseded()) return; // superseded — abandon silently
    const reason: FallbackReason =
      constructErr instanceof canvasModule.CanvasDimensionExceededError
        ? 'dimension-exceeded'
        : 'construction-failed';
    console.warn(
      `@fluxgantt/core: Canvas renderer initialization failed (${reason}) — falling back to the SVG renderer.`,
      constructErr,
    );
    mountSvg(internal, container, generation, taskCount, reason);
    return;
  }

  // Not re-checked a second time here: `createCanvasRenderer()` above is synchronous (no
  // `await` between the check above and this call), and JS is single-threaded, so no new race
  // window can have opened (spec §5's own reasoning).
  finishMount(internal, 'canvas', handle, taskCount, memo);
}

/** Synchronous SVG mount, reachable both directly from `mount()` (sub-threshold path) and as
 *  `mountCanvasAsync`'s fallback (any Canvas-path failure, `fallbackReason` set accordingly). */
function mountSvg(
  internal: GanttInternal,
  container: HTMLElement,
  generation: number,
  taskCount: number,
  fallbackReason?: FallbackReason,
): void {
  // Defensive, cheap even on the sync path.
  if (generation !== internal.gen() || internal.dead()) return;
  const memo = createMemo();
  const handle = createSvgRenderer(container, renderInput(internal, memo, false), rendererOptions(internal));
  finishMount(internal, 'svg', handle, taskCount, memo, fallbackReason);
}

/**
 * Shared tail of every successful mount path (SVG direct, Canvas, or SVG-as-fallback): asks the
 * interaction layer (if `withInteraction` was applied) to wire itself into the fresh handle,
 * starts the reactive render effect, stores the mount state, and emits `renderer:selected`.
 *
 * The hook consultation is what makes mixin application order irrelevant: `withInteraction`
 * only registers hooks; they are read HERE, at mount time, by which point both mixins have
 * necessarily been applied.
 */
function finishMount(
  internal: GanttInternal,
  renderer: RendererKind,
  handle: SvgRendererHandle | CanvasRendererHandle,
  taskCount: number,
  memo: RenderMemo,
  fallbackReason?: FallbackReason,
): void {
  const interactions = internal.hooks()?.wire(handle, renderer, internal);
  const getFocusedTaskId = interactions?.focusedId ?? ((): TaskId | undefined => undefined);
  const disposeInteractions = interactions?.dispose ?? ((): void => {});

  // `getFocusedTaskId` is captured directly from this closure (NOT read back off the mount
  // state) because `effect()` runs its callback synchronously, immediately, on this very call —
  // BEFORE the mount state is stored below.
  const paint = (): void => {
    renderNow(internal, handle, getFocusedTaskId, memo);
  };
  const disposeEffect = effect(paint);

  const state: MountState = {
    renderer,
    handle: handle,
    stopFx: disposeEffect,
    stopUi: disposeInteractions,
    focusedId: getFocusedTaskId,
    anchored: (mutate) => {
      withScrollAnchor(handle, mutate);
    },
    refresh: () => {
      memo.rev = -1; // refresh() is the "recompute everything" escape hatch
      paint();
    },
  };
  internal.setMount(state);

  internal.emit('renderer:selected', {
    renderer,
    taskCount,
    ...(fallbackReason ? { canvasFallbackReason: fallbackReason } : {}),
  });
}

/**
 * Runs `mutate()` — a view-mode write, which synchronously repaints — between a capture and a
 * restore of the date currently centered in the viewport, so a zoom keeps the user's anchor date
 * on screen (spec-zoom-runtime.md). Called by base `zoomTo()` through `MountState`, which is why
 * this math lives here and not in `gantt.ts`: it needs the renderer's label-column offset and its
 * `TimeScale`, neither of which the base bundle may depend on.
 */
function withScrollAnchor(
  handle: SvgRendererHandle | CanvasRendererHandle,
  mutate: () => void,
): void {
  const container = handle.container;

  // 1. Capture the date currently at the viewport's CENTER, in the OLD time scale.
  //    `container.scrollLeft`/`clientWidth` are measured in the renderer's PAINTED coordinate
  //    space (which includes the label-column offset), while `TimeScale.dateToX`/`xToDate`
  //    operate in "content-only" space (x=0 = range.start, no label-column offset) — the offset
  //    must be subtracted before `xToDate()` and re-added after `dateToX()`.
  //    Read from the HANDLE, never from the `LABEL_COLUMN_WIDTH` constant: `withResponsive()`
  //    narrows the painted column on a small viewport, and a stale 160 here would mis-anchor
  //    every zoom by `160 - actual` px (spec-responsive-mobile.md).
  const labelColumnWidth = handle.getLabelColumnWidth();
  const beforeScale = handle.getTimeScale();
  // No clamping — xToDate extrapolates linearly; fine even if this is negative (e.g. all-zero
  // DOM geometry in an unstubbed jsdom test).
  const anchorDate = beforeScale.xToDate(
    container.scrollLeft + container.clientWidth / 2 - labelColumnWidth,
  );

  // 2. Mutate — repaints synchronously, so the new time scale is readable immediately below.
  mutate();

  // 3. Restore, in the NEW time scale, so the same date is centered again. The browser
  //    self-clamps scrollLeft to [0, scrollWidth - clientWidth] — no manual clamp needed.
  const newAnchorContentX = handle.getTimeScale().dateToX(anchorDate);
  //    The SAME width captured in step 1 is reused deliberately: `mutate()` is a view-mode
  //    write only, so it cannot change the column, and re-reading would risk anchoring against
  //    a different offset than the one the capture used.
  container.scrollLeft = newAnchorContentX + labelColumnWidth - container.clientWidth / 2;
}

/**
 * Per-mount cache of the two expensive derivations (closure state created per mount, never module
 * state: two charts must not share it). `renderNow` re-runs on ANY store revision or the view mode,
 * but the critical path and the rollup can only change when a task or dependency did, so a zoom, a
 * collapse or a selection change reuses them instead of paying `computeCriticalPath()` again.
 */
interface RenderMemo {
  /** Task + dependency revisions summed (both only ever increase, so the sum moves iff either did). */
  rev: number;
  criticalPath: CriticalPathResult | undefined;
  rollup: ReadonlyMap<TaskId, RolledUpRow> | undefined;
  /** Critical ids waiting to be announced: the constructor paint derives before the renderer handle
   *  exists, and a `critical-path:computed` listener must not run until it does. */
  emit: readonly TaskId[] | undefined;
}

function createMemo(): RenderMemo {
  return { rev: -1, criticalPath: undefined, rollup: undefined, emit: undefined };
}

/** The paint input, recomputing the memoized parts only when the data revision moved. `track`
 *  is true inside the reactive effect, where reading `.value` registers the dependencies. */
function renderInput(internal: GanttInternal, memo: RenderMemo, track: boolean): SvgRendererInput {
  const read = (revision: ReadonlySignal<number>): number => (track ? revision.value : revision.peek());
  // Read unconditionally so the effect re-runs on ANY task, dependency, selection or collapse
  // mutation (coarse — no per-field granularity here). The collapse revision is
  // (spec-collapse-expand.md §9) the single most important integration assertion of that feature.
  read(internal.sel.revision);
  read(internal.fold.revision);
  const rev = read(internal.tasks.revision) + read(internal.deps.revision);
  const tasks = internal.tasks.all();
  const dependencies = internal.deps.all();
  if (rev !== memo.rev) {
    memo.rev = rev;
    memo.criticalPath = undefined;
    if (tasks.length === 0) {
      // No tasks → no critical path; reset so the next non-empty compute always re-emits.
      internal.resetCrit();
    } else {
      try {
        memo.criticalPath = computeCriticalPathFn(tasks, dependencies, internal.calendar);
        // Emit only when the critical set actually changed (not on every mutation / render).
        if (internal.noteCrit(memo.criticalPath.criticalTaskIds)) {
          memo.emit = memo.criticalPath.criticalTaskIds;
        }
      } catch (err) {
        // Cyclic graph (possible if a caller used DependencyStore.link(..., {allowCycle: true})
        // directly, bypassing linkTasks) — the reactive render effect must NEVER throw. Swallow,
        // render without a critical path, warn once per revision.
        console.warn(
          '@fluxgantt/core: computeCriticalPath failed during reactive render — rendering without a critical path.',
          err,
        );
      }
    }
    memo.rollup = rollupFor(internal, tasks);
  }
  return {
    tasks,
    dependencies,
    calendar: internal.calendar,
    selectedTaskIds: internal.sel.all(),
    collapsedIds: new Set(internal.fold.all()),
    ...(memo.criticalPath !== undefined ? { criticalPath: memo.criticalPath } : {}),
    ...(memo.rollup !== undefined ? { rollup: memo.rollup } : {}),
  };
}

/** The reactive render effect's body — re-runs on ANY task/dependency/selection/collapse
 *  mutation or a `zoomTo()` view-mode write. */
function renderNow(
  internal: GanttInternal,
  handle: SvgRendererHandle | CanvasRendererHandle,
  getFocusedTaskId: () => TaskId | undefined,
  memo: RenderMemo,
): void {
  const input = renderInput(internal, memo, true);
  const viewMode = internal.viewMode.value; // tracked — re-runs this effect on zoomTo()
  if (memo.emit) {
    const ids = memo.emit;
    memo.emit = undefined;
    internal.emit('critical-path:computed', ids);
  }
  // ONE repaint for input and options together. `timeRange` is the empty-state fallback for an
  // empty chart and explicitly cleared (back to "auto-derive") otherwise: the options merge
  // shallowly, so omitting the key would leave a stale fallback range in place. Both renderers
  // take the same `{ viewMode, timeRange }` merge, and `timeRange` is optional but not typed
  // `X | undefined`, so `exactOptionalPropertyTypes` forbids the literal without this cast.
  const options = {
    viewMode,
    timeRange: input.tasks.length === 0 ? emptyStateTimeRange(internal) : undefined,
  };
  handle.update(
    { ...input, focusedTaskId: getFocusedTaskId() },
    options as unknown as Partial<SvgRendererOptions & CanvasRendererOptions>,
  );
}

function emptyStateTimeRange(
  internal: GanttInternal,
): { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } {
  const now = getTemporal().Now.zonedDateTimeISO(internal.calendar.timezone);
  return {
    start: now.subtract({ days: EMPTY_STATE_WINDOW_DAYS }),
    end: now.add({ days: EMPTY_STATE_WINDOW_DAYS }),
  };
}

/**
 * The rollup map to paint with, or `undefined` when no `config.rollup` provider was supplied
 * or the aggregation failed (spec-summary-rollup.md Ticket B2).
 *
 * `undefined` rather than an empty map on the off path, so the renderers' `rollup?.get(...)`
 * short-circuits instead of probing an always-empty map once per bar per repaint.
 *
 * WHY THE HOST INJECTS THE FUNCTION rather than this module importing `computeRollup` behind a
 * boolean flag: measured, not guessed. A static `import { computeRollup } from
 * '../compute/rollup.js'` here costs ~400 B gzip in EVERY `@fluxgantt/core/render` bundle — it
 * pushed the `withRender + withInteraction` fixture 50 B past its 19.46 KiB budget (golden
 * rule 5), and spec-summary-rollup.md §0.1's gate says to change the shape rather than bump the
 * budget. Injection keeps `compute/rollup.js` out of the render graph entirely: a host that
 * wants rolled-up bars writes `rollup: computeRollup` and pays for those bytes in its own
 * graph; one that doesn't pays nothing. It also makes a custom aggregation (different
 * weighting, a baseline span) a supported case rather than a fork.
 *
 * NEVER THROWS — the same contract as the `computeCriticalPath` call in `renderNow`, and for
 * the same reason: this runs inside the reactive render effect, so a cyclic parent chain, an
 * over-deep hierarchy or one malformed `end < start` record must not wedge the whole chart.
 * Falling back to `undefined` renders authored dates, exactly like the no-provider path. The
 * provider is host code, which makes this guard load-bearing rather than merely defensive.
 *
 * `RollupResult` is structurally assignable to `RolledUpRow` (`start`/`end`/`progress`, plus a
 * `durationHours` the render layer ignores), so `computeRollup` satisfies `RollupProvider` as
 * written — no adapter, and no `compute/` type crossing into `render/`'s public input shape.
 */
function rollupFor(
  internal: GanttInternal,
  tasks: readonly Task[],
): ReadonlyMap<TaskId, RolledUpRow> | undefined {
  const provider = internal.config.rollup;
  if (provider === undefined || tasks.length === 0) return undefined;
  try {
    return provider(tasks, internal.calendar);
  } catch (err) {
    console.warn(
      '@fluxgantt/core: the config.rollup provider threw during reactive render — rendering authored dates instead.',
      err,
    );
    return undefined;
  }
}

/**
 * Single builder for BOTH renderers' option objects (was two ~90%-identical functions,
 * `rendererOptions()` + `canvasRendererOptions()`, merged in the i18n-scaffold change to pay
 * back part of that ticket's byte cost — golden rule 5 says change the shape, not the budget).
 *
 * It returns the intersection, so the SVG-only `showLinkHandles` and the Canvas-only
 * `viewportHeight` are both present on the one object. That is deliberate and safe: each
 * renderer reads only the keys it declares and ignores the other's, so there is nothing to
 * branch on — and a `kind` parameter would have cost more bytes than the two ignored keys.
 */
function rendererOptions(internal: GanttInternal): SvgRendererOptions & CanvasRendererOptions {
  const config = internal.config;
  // A density pushed at runtime (`withViewport`/`withResponsive`) wins over the construction
  // default, so a remount or the async Canvas mount paints at it on the first paint.
  const density = internal.density ?? config.density;
  // `exactOptionalPropertyTypes` — only include a key when the corresponding config value is
  // actually set; an explicit `undefined` value on an optional property that isn't typed
  // `X | undefined` is a compile error, not just redundant.
  const opts: SvgRendererOptions & CanvasRendererOptions = {
    // `.peek()`, not `.value` — this call site runs before the reactive effect exists (outside
    // any effect()/computed() callback), so there is no active subscriber to register against
    // regardless; `.peek()` makes that intent explicit.
    viewMode: internal.viewMode.peek(),
    ...(density !== undefined ? { density } : {}),
    ...(config.locale !== undefined ? { locale: config.locale } : {}),
    ...(config.ariaLabel !== undefined ? { ariaLabel: config.ariaLabel } : {}),
    ...(config.messages !== undefined ? { messages: config.messages } : {}),
    ...(config.canvasViewportHeight !== undefined
      ? { viewportHeight: config.canvasViewportHeight }
      : {}),
    // A readOnly chart must not render the connector handles — they are an interactive
    // affordance whose recognizer is NOT wired when readOnly, so rendering them would be a
    // misleading dead control. (SVG-only; Canvas has no connector-handle affordance in v1.)
    showLinkHandles: !config.readOnly && config.enableDependencyDrag !== false,
  };
  return internal.tasks.size === 0 ? { ...opts, timeRange: emptyStateTimeRange(internal) } : opts;
}
