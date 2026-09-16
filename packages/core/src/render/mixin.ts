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
import { effect } from '../signals.js';
import {
  getInternal,
  type GanttInternal,
  type MountState,
  type RendererKind,
} from '../gantt-internal.js';
import { computeCriticalPath as computeCriticalPathFn } from '../compute/critical-path.js';
import { getTemporal } from '../internal/temporal.js';
import { createSvgRenderer, LABEL_COLUMN_WIDTH } from './svg-renderer.js';
import type { SvgRendererHandle, SvgRendererInput, SvgRendererOptions } from './svg-renderer.js';
// TYPE-ONLY imports — erased at compile time, so they create NO runtime dependency edge into
// `canvas-renderer.ts`'s module graph (see the dynamic `import()` in `mountCanvasAsync`).
import type { CanvasRendererHandle, CanvasRendererOptions } from './canvas-renderer.js';
import type * as CanvasRendererModule from './canvas-renderer.js';
// TYPE-ONLY import back into the base facade — erased at compile time, so no runtime cycle.
import type { GanttInstance } from '../gantt.js';
import type { CriticalPathResult, TaskId, ViewMode } from '../types.js';

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
   * Drag-move/drag-resize/drag-create-dependency and `exportSvg()`/`exportPng()` are SVG-only —
   * a Canvas-rendered chart supports click-select and keyboard navigation, but not those.
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
      if (internal.isDestroyed()) return; // safe no-op
      internal.teardownMount(); // implicit remount if already mounted (no-op otherwise)

      // Monotonic race-guard token (spec-canvas-auto-switch.md §5) — bumped on every mount()
      // call (both the sync-SVG and async-Canvas paths, for symmetry), and also by unmount()/
      // destroy() so those invalidate any in-flight Canvas attempt too.
      const generation = internal.bumpMountGeneration();
      // Read ONCE, at this instant — the auto-switch decision is made once, at mount() time
      // only; adding/removing tasks later does not re-evaluate it.
      const taskCount = internal.taskStore.size;

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
      if (internal.isDestroyed()) return;
      // Bumped BEFORE the mount-state check — an in-flight async Canvas attempt has no mount
      // state assigned yet, but must still be invalidated here (spec §5).
      internal.bumpMountGeneration();
      internal.teardownMount();
    },

    refresh(): void {
      const mount = internal.getMountState();
      if (internal.isDestroyed() || !mount) return; // nothing to refresh headless or post-destroy
      renderNow(internal, mount.rendererHandle, mount.renderer, mount.getFocusedTaskId);
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
  const superseded = (): boolean => generation !== internal.getMountGeneration() || internal.isDestroyed();

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
  try {
    handle = canvasModule.createCanvasRenderer(container, renderInput(internal), canvasRendererOptions(internal));
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
  finishMount(internal, 'canvas', handle, taskCount);
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
  if (generation !== internal.getMountGeneration() || internal.isDestroyed()) return;
  const handle = createSvgRenderer(container, renderInput(internal), rendererOptions(internal));
  finishMount(internal, 'svg', handle, taskCount, fallbackReason);
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
  fallbackReason?: FallbackReason,
): void {
  const interactions = internal.getInteractionHooks()?.wireInto(handle, renderer, internal);
  const getFocusedTaskId = interactions?.getFocusedTaskId ?? ((): TaskId | undefined => undefined);
  const disposeInteractions = interactions?.dispose ?? ((): void => {});

  // `getFocusedTaskId` is captured directly from this closure (NOT read back off the mount
  // state) because `effect()` runs its callback synchronously, immediately, on this very call —
  // BEFORE the mount state is stored below.
  const disposeEffect = effect(() => {
    renderNow(internal, handle, renderer, getFocusedTaskId);
  });

  const state: MountState = {
    renderer,
    rendererHandle: handle,
    disposeEffect,
    disposeInteractions,
    getFocusedTaskId,
    withScrollAnchor: (mutate) => {
      withScrollAnchor(handle, mutate);
    },
  };
  internal.setMountState(state);

  internal.emitEvent('renderer:selected', {
    renderer,
    taskCount,
    ...(fallbackReason ? { canvasFallbackReason: fallbackReason } : {}),
  });
}

/**
 * Runs `mutate()` — a view-mode write, which synchronously repaints — between a capture and a
 * restore of the date currently centered in the viewport, so a zoom keeps the user's anchor date
 * on screen (spec-zoom-runtime.md). Called by base `zoomTo()` through `MountState`, which is why
 * this math lives here and not in `gantt.ts`: it needs `LABEL_COLUMN_WIDTH` and the renderer's
 * `TimeScale`, neither of which the base bundle may depend on.
 */
function withScrollAnchor(
  handle: SvgRendererHandle | CanvasRendererHandle,
  mutate: () => void,
): void {
  const container = handle.container;

  // 1. Capture the date currently at the viewport's CENTER, in the OLD time scale.
  //    `container.scrollLeft`/`clientWidth` are measured in the renderer's PAINTED coordinate
  //    space (which includes the LABEL_COLUMN_WIDTH offset), while `TimeScale.dateToX`/`xToDate`
  //    operate in "content-only" space (x=0 = range.start, no label-column offset) — the offset
  //    must be subtracted before `xToDate()` and re-added after `dateToX()`.
  const beforeScale = handle.getTimeScale();
  // No clamping — xToDate extrapolates linearly; fine even if this is negative (e.g. all-zero
  // DOM geometry in an unstubbed jsdom test).
  const anchorDate = beforeScale.xToDate(
    container.scrollLeft + container.clientWidth / 2 - LABEL_COLUMN_WIDTH,
  );

  // 2. Mutate — repaints synchronously, so the new time scale is readable immediately below.
  mutate();

  // 3. Restore, in the NEW time scale, so the same date is centered again. The browser
  //    self-clamps scrollLeft to [0, scrollWidth - clientWidth] — no manual clamp needed.
  const newAnchorContentX = handle.getTimeScale().dateToX(anchorDate);
  container.scrollLeft = newAnchorContentX + LABEL_COLUMN_WIDTH - container.clientWidth / 2;
}

/** The reactive render effect's body — re-runs on ANY task/dependency/selection mutation or a
 *  `zoomTo()` view-mode write. */
function renderNow(
  internal: GanttInternal,
  handle: SvgRendererHandle | CanvasRendererHandle,
  renderer: RendererKind,
  getFocusedTaskId: () => TaskId | undefined,
): void {
  // Track all three stores' revisions — read .value unconditionally so this effect re-runs on
  // ANY task, dependency or selection mutation (coarse — no per-field granularity here).
  void internal.taskStore.revision.value;
  void internal.dependencyStore.revision.value;
  void internal.selectionStore.revision.value;
  const viewMode = internal.viewMode.value; // tracked — re-runs this effect on zoomTo()

  const tasks = internal.taskStore.all();
  const dependencies = internal.dependencyStore.all();
  const selectedTaskIds = internal.selectionStore.all();

  let criticalPath: CriticalPathResult | undefined;
  if (tasks.length === 0) {
    // No tasks → no critical path; reset so the next non-empty compute always re-emits.
    internal.resetCriticalIds();
  }
  if (tasks.length > 0) {
    try {
      criticalPath = computeCriticalPathFn(tasks, dependencies, internal.calendar);
      // Emit only when the critical set actually changed (not on every mutation / render).
      if (internal.noteCriticalIds(criticalPath.criticalTaskIds)) {
        internal.emitEvent('critical-path:computed', criticalPath.criticalTaskIds);
      }
    } catch (err) {
      // Cyclic graph (possible if a caller used DependencyStore.link(..., {allowCycle: true})
      // directly, bypassing linkTasks) — the reactive render effect must NEVER throw. Swallow,
      // render without a critical path, warn once per occurrence.
      criticalPath = undefined;
      console.warn(
        '@fluxgantt/core: computeCriticalPath failed during reactive render — rendering without a critical path.',
        err,
      );
    }
  }

  // `SvgRendererHandle.setOptions` merges shallowly over the previous options object, so once
  // real tasks exist we must explicitly overwrite a previously-set empty-state `timeRange` back
  // to "unset" (auto-derive) — a merge that simply omitted the key would leave the stale
  // fallback range in place. That goes through `applyViewportOptions`, which also carries
  // `viewMode` in the SAME `setOptions()` call (spec-zoom-runtime.md §8).
  //
  // ORDER MATTERS (bugfix): `handle.update()` and `handle.setOptions()` each trigger a full
  // synchronous `render()` independently — one using the freshly-passed argument, the other
  // still reading the renderer's OTHER, not-yet-updated internal field (`currentInput.tasks` vs
  // `currentOptions.timeRange`). `render()` throws (`deriveTimeRange: tasks must not be empty`)
  // iff BOTH `timeRange` is unset AND `tasks` is empty at the same instant — so the two calls
  // below are ordered to never expose that combination, in either transition direction:
  //  - Going TO empty (`tasks.length === 0`): set the fallback `timeRange` FIRST.
  //  - Going TO non-empty (`tasks.length > 0`): push the new `tasks` FIRST.
  // Reordering unconditionally (either direction, always) reintroduces the crash for the
  // opposite transition — this must stay tasks.length-conditional.
  const focusedTaskId = getFocusedTaskId();
  if (tasks.length === 0) {
    applyViewportOptionsFor(handle, renderer, viewMode, emptyStateTimeRange(internal));
    handle.update({ tasks, dependencies, calendar: internal.calendar, selectedTaskIds, focusedTaskId });
  } else {
    handle.update({
      tasks,
      dependencies,
      calendar: internal.calendar,
      selectedTaskIds,
      focusedTaskId,
      ...(criticalPath !== undefined ? { criticalPath } : {}),
    });
    applyViewportOptionsFor(handle, renderer, viewMode, undefined);
  }
}

/**
 * Renderer-kind-aware dispatch for the `setOptions()` half of `renderNow` (spec-canvas-auto-
 * switch.md §6.1) — the ONE call in `renderNow` that must branch explicitly rather than go
 * through a unified union call: `SvgRendererOptions` carries `showLinkHandles` (a
 * Canvas-irrelevant field), while `CanvasRendererOptions` does not. `handle.update(...)` needs
 * no equivalent branch — `SvgRendererInput`/`CanvasRendererInput` are structurally identical.
 */
function applyViewportOptionsFor(
  handle: SvgRendererHandle | CanvasRendererHandle,
  renderer: RendererKind,
  viewMode: ViewMode,
  timeRange: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } | undefined,
): void {
  if (renderer === 'canvas') {
    const clear: {
      viewMode: ViewMode;
      timeRange: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } | undefined;
    } = { viewMode, timeRange };
    (handle as CanvasRendererHandle).setOptions(clear as unknown as Partial<CanvasRendererOptions>);
    return;
  }
  applyViewportOptions(handle as SvgRendererHandle, viewMode, timeRange);
}

/**
 * Sets `viewMode` and — or explicitly clears — `SvgRendererOptions.timeRange` in a SINGLE
 * `setOptions()` call. `SvgRendererOptions.timeRange` is optional but not typed `X | undefined`,
 * so `exactOptionalPropertyTypes` forbids writing `undefined` directly into a
 * `Partial<SvgRendererOptions>`-typed object literal — this helper isolates that one narrow,
 * deliberate cast instead of fighting the check inline in `renderNow`.
 */
function applyViewportOptions(
  handle: SvgRendererHandle,
  viewMode: ViewMode,
  timeRange: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } | undefined,
): void {
  if (timeRange) {
    handle.setOptions({ viewMode, timeRange });
    return;
  }
  const clear: { viewMode: ViewMode; timeRange: undefined } = { viewMode, timeRange: undefined };
  handle.setOptions(clear as unknown as Partial<SvgRendererOptions>);
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

function renderInput(internal: GanttInternal): SvgRendererInput {
  return {
    tasks: internal.taskStore.all(),
    dependencies: internal.dependencyStore.all(),
    calendar: internal.calendar,
    selectedTaskIds: internal.selectionStore.all(),
  };
}

function rendererOptions(internal: GanttInternal): SvgRendererOptions {
  const config = internal.config;
  // `exactOptionalPropertyTypes` — only include a key when the corresponding config value is
  // actually set; an explicit `undefined` value on an optional property that isn't typed
  // `X | undefined` is a compile error, not just redundant.
  const opts: SvgRendererOptions = {
    // `.peek()`, not `.value` — this call site runs before the reactive effect exists (outside
    // any effect()/computed() callback), so there is no active subscriber to register against
    // regardless; `.peek()` makes that intent explicit.
    viewMode: internal.viewMode.peek(),
    ...(config.density !== undefined ? { density: config.density } : {}),
    ...(config.locale !== undefined ? { locale: config.locale } : {}),
    // A readOnly chart must not render the connector handles — they are an interactive
    // affordance whose recognizer is NOT wired when readOnly, so rendering them would be a
    // misleading dead control.
    showLinkHandles: !config.readOnly,
  };
  return internal.taskStore.size === 0 ? { ...opts, timeRange: emptyStateTimeRange(internal) } : opts;
}

/** Canvas sibling of `rendererOptions()` (spec-canvas-auto-switch.md §6.1) — same shape minus
 *  `showLinkHandles` (Canvas mode has no connector-handle affordance at all, v1). The
 *  `size === 0` branch can't actually co-occur with the Canvas mount path today (Canvas is only
 *  ever chosen above the threshold) — kept for shape-symmetry and defensiveness. */
function canvasRendererOptions(internal: GanttInternal): CanvasRendererOptions {
  const config = internal.config;
  const opts: CanvasRendererOptions = {
    viewMode: internal.viewMode.peek(),
    ...(config.density !== undefined ? { density: config.density } : {}),
    ...(config.locale !== undefined ? { locale: config.locale } : {}),
    ...(config.canvasViewportHeight !== undefined
      ? { viewportHeight: config.canvasViewportHeight }
      : {}),
  };
  return internal.taskStore.size === 0 ? { ...opts, timeRange: emptyStateTimeRange(internal) } : opts;
}
