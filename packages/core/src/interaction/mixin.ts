// Opt-in INTERACTION capability (spec-facade-split.md §3.3) — `withInteraction(createGantt(cfg))`.
//
// WHY A MIXIN, NOT CLASS METHODS: prototype methods can never be tree-shaken, so while the six
// `enable*` call sites and their gesture commit points lived on the `Gantt` class, every
// consumer was billed for drag-move + drag-resize + drag-create-dep + click-select +
// keyboard-nav + wheel-zoom — even a headless one. Behind this subpath they enter a bundle only
// when `@fluxgantt/core/interaction` is actually imported.
//
// UNLIKE `withIo`/`withRender`, this mixin adds NO new public methods. It registers a hook that
// `withRender`'s `mount()` consults; the visible effect is that a mounted chart becomes
// interactive.
import type { Temporal } from '@js-temporal/polyfill';
import {
  getInternal,
  type GanttInternal,
  type InteractionDisposers,
  type RendererKind,
} from '../gantt-internal.js';
import { DependencyLinkError } from '../store/index.js';
import { normalizeDate, differenceInWorkingHours } from '../compute/working-calendar.js';
import { layoutRows } from '../render/renderer-base.js';
import type { SvgRendererHandle } from '../render/svg-renderer.js';
import type { CanvasRendererHandle } from '../render/canvas-renderer.js';
import { enableDragMove } from './drag-move.js';
import { enableDragResize } from './drag-resize.js';
import { enableDragCreateDep } from './drag-create-dep.js';
import { enableClickSelect } from './selection.js';
import { enableKeyboardNav } from './keyboard-nav.js';
import { enableCollapseToggle } from './collapse-toggle.js';
import { enableWheelZoom } from './wheel-zoom.js';
import { batch } from '../signals.js';
// TYPE-ONLY import back into the base facade — erased at compile time, so no runtime cycle.
import type { GanttInstance } from '../gantt.js';
import type { TaskId } from '../types.js';

/**
 * Makes a mounted chart interactive: drag-move, drag-resize, drag-create-dependency,
 * click-select, keyboard navigation and Ctrl+wheel zoom.
 *
 * ```ts
 * import { createGantt } from '@fluxgantt/core';
 * import { withRender } from '@fluxgantt/core/render';
 * import { withInteraction } from '@fluxgantt/core/interaction';
 *
 * const gantt = withInteraction(withRender(createGantt({ tasks })));
 * gantt.mount(document.getElementById('chart')!);
 * ```
 *
 * Adds no methods — the returned type is unchanged. `withRender` is required for this to do
 * anything (there is nothing to interact with until something is mounted).
 *
 * **v1 limitation, by design:** apply this BEFORE the first `mount()` call. Hooks are consulted
 * inside `mount()`, so applying `withInteraction` to an already-mounted instance has no effect
 * until the next `mount()`/remount. Application order relative to `withRender` itself is
 * irrelevant — the hook is read lazily, at mount time.
 */
export function withInteraction<T extends GanttInstance>(instance: T): T {
  const internal = getInternal(instance);
  internal.setInteractionHooks({
    wireInto: (handle, renderer) => wireInto(instance, internal, handle, renderer),
  });
  return instance;
}

/**
 * Wires the applicable interaction modules into a freshly-created render handle. Click-select +
 * keyboard-nav are wired identically for both renderer kinds (both work against the
 * `InteractiveRendererHandle`-typed structural contract) — drag-move/drag-resize/
 * drag-create-dep/wheel-zoom stay SVG-only (all four are typed strictly against
 * `SvgRendererHandle`).
 */
function wireInto(
  instance: GanttInstance,
  internal: GanttInternal,
  handle: SvgRendererHandle | CanvasRendererHandle,
  renderer: RendererKind,
): InteractionDisposers {
  const config = internal.config;
  const density = config.density ?? 'default';

  // Selection is NOT gated by readOnly (confirmed): readOnly disables drag-move/drag-resize/
  // drag-create-dep, not click-select (spec-selection.md §5.5).
  const clickSelectDispose = enableClickSelect(handle, () => internal.taskStore.all(), {
    onSelect: (taskId) => commitSelect(internal, taskId),
    onToggle: (taskId) => commitToggleSelect(internal, taskId),
    onRangeSelect: (ids) => commitRangeSelect(internal, ids),
    onClear: () => commitClearSelection(internal),
    density,
    getCollapsedIds: () => new Set(internal.collapseStore.all()),
  });

  // Registered UNCONDITIONALLY (spec-keyboard-nav.md §6.2), same group as enableClickSelect
  // above, NOT gated by readOnly — Arrow/Space/Shift+Arrow/Tab-entry and Ctrl/Cmd+Plus/Minus
  // (zoom) are all non-mutating and must stay active even in a readOnly chart; only the
  // Delete/Backspace action and the Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z undo/redo keybindings are
  // themselves gated (via `isReadOnly` below AND, for Delete, defense-in-depth inside
  // `commitDeleteSelected`).
  const keyboardNav = enableKeyboardNav(handle, {
    onSelect: (id) => commitSelect(internal, id),
    onToggle: (id) => commitToggleSelect(internal, id),
    onRangeSelect: (anchorId, focusId) => commitKeyboardRangeSelect(internal, anchorId, focusId),
    onDeleteSelected: () => commitDeleteSelected(instance, internal),
    onUndo: () => instance.undo(),
    onRedo: () => instance.redo(),
    // Re-selects the new copies (spec-duplicate-keybinding.md §2) — `duplicateTask()` itself
    // leaves selection on the ORIGINAL task(s) untouched (its own documented contract), so the
    // keyboard gesture opts into the interaction-appropriate behavior here rather than changing
    // the facade method's own contract.
    onDuplicateSelected: () => {
      const copies = instance.duplicateTask();
      if (copies.length > 0) instance.select(copies.map((c) => c.id));
    },
    onZoomIn: () => instance.zoomIn(),
    onZoomOut: () => instance.zoomOut(),
    getTasks: () => internal.taskStore.all(),
    density,
    isReadOnly: () => config.readOnly === true,
    getSelection: () => internal.selectionStore.all(),
    getCollapsedIds: () => new Set(internal.collapseStore.all()),
    onToggleCollapse: (id) => {
      instance.toggleCollapse(id); // reuses the public method in full — same emit contract as a programmatic call
    },
  });

  // Registered UNCONDITIONALLY, same group as clickSelectDispose/keyboardNav above, NOT gated
  // by readOnly (spec-collapse-expand.md §7.1/§7.3) — collapsing hides/reveals rows, it never
  // mutates task data, so there is no reason to disable it in a read-only chart.
  //
  // ORDERING: `signals.ts` runs effects SYNCHRONOUSLY outside `batch()` (`Effect._notify` ->
  // `_run` once `batchDepth` returns to 0) — so an unwrapped `instance.toggleCollapse(taskId)`
  // call bumps `collapseStore.revision` and the render effect repaints IMMEDIATELY, before
  // `keyboardNav.syncFocusToRows()` below ever runs. Since `focusedTaskId` lives in
  // `keyboard-nav.ts` as a plain local (not a signal), that repaint would already have painted
  // the stale, about-to-be-hidden roving-tabindex/focus-ring target, and the later clamp would
  // trigger no further repaint at all — leaving the painted focus referencing a row that no
  // longer exists in the DOM until some unrelated mutation forces the next render. `batch(...)`
  // defers the render effect until BOTH calls below have completed, so the clamp lands before
  // the single resulting repaint (`CollapseStore`'s own data mutation happens synchronously
  // inside `toggleCollapse()` regardless of `batch()` — only the render EFFECT's flush is
  // deferred — so `syncFocusToRows()`'s `getCollapsedIds()` read here already sees the toggled
  // state).
  const collapseToggleDispose = enableCollapseToggle(handle, () => internal.taskStore.all(), {
    onToggleCollapse: (taskId) => {
      batch(() => {
        instance.toggleCollapse(taskId); // reuses the public method in full
        keyboardNav.syncFocusToRows();
      });
    },
  });

  let dragMoveDispose: () => void = () => {};
  let dragResizeDispose: () => void = () => {};
  let dragCreateDepDispose: () => void = () => {};
  let wheelZoomDispose: () => void = () => {};

  if (renderer === 'svg') {
    // Cast, not a narrow: `renderer`/`handle` are two separate parameters, so TypeScript cannot
    // correlate a check on one to narrow the other — this invariant (renderer === 'svg' implies
    // the handle was produced by createSvgRenderer()) is guaranteed by construction in
    // `render/mixin.ts` and documented here.
    const svgHandle = handle as SvgRendererHandle;
    if (!config.readOnly) {
      // Registration order is irrelevant to priority (pointer-drag.ts uses an explicit numeric
      // priority, not call order) — all three wire through the SAME coordinator on `svgHandle`,
      // so a handle claim always wins over an edge-zone claim, which always wins over a
      // whole-bar claim.
      dragResizeDispose = enableDragResize(svgHandle, () => internal.taskStore.all(), {
        onTaskResized: (taskId, newEnd) => commitResize(instance, internal, taskId, newEnd),
      });
      dragMoveDispose = enableDragMove(svgHandle, () => internal.taskStore.all(), {
        onTaskMoved: (taskId, newStart, newEnd) => commitDrag(internal, taskId, newStart, newEnd),
      });
      dragCreateDepDispose = enableDragCreateDep(svgHandle, () => internal.taskStore.all(), {
        onDependencyCreated: (fromTaskId, toTaskId) => commitCreateDep(instance, internal, fromTaskId, toTaskId),
      });
    }
    // Registered UNCONDITIONALLY, same posture as enableKeyboardNav's zoom case arms — Ctrl+wheel
    // mutates no store state, so readOnly has nothing to protect against here (spec-wheel-zoom.md §4).
    wheelZoomDispose = enableWheelZoom(svgHandle, {
      onZoomIn: () => instance.zoomIn(),
      onZoomOut: () => instance.zoomOut(),
    });
  }
  // Canvas mode: drag-move/drag-resize/drag-create-dep/wheel-zoom stay SVG-only — their
  // disposers stay the no-op default above.

  return {
    getFocusedTaskId: keyboardNav.getFocusedTaskId,
    dispose: () => {
      // Order matters (the shared pointer-drag coordinator wraps handle.destroy): unregister ALL
      // THREE pointer-drag-coordinated recognizers via their returned disposers — order among
      // them doesn't matter; the coordinator only detaches its pointerdown listener + unwraps
      // handle.destroy once ALL have unregistered (refcounted, see pointer-drag.ts). click-select
      // never touched that coordinator (it owns its own independent listeners), so it has no
      // shared refcount to worry about — still disposed here, order-independent among the rest.
      // The reactive render effect is stopped by the caller BEFORE this runs, and
      // `rendererHandle.destroy()` AFTER it (see `gantt.ts`'s `teardownMount`).
      dragResizeDispose();
      dragMoveDispose();
      dragCreateDepDispose();
      clickSelectDispose();
      collapseToggleDispose();
      keyboardNav.dispose();
      wheelZoomDispose();
    },
  };
}

// --- Gesture commit points ------------------------------------------------------------------

function commitDrag(
  internal: GanttInternal,
  taskId: TaskId,
  newStart: Temporal.ZonedDateTime,
  newEnd: Temporal.ZonedDateTime,
): void {
  if (!internal.taskStore.has(taskId)) return; // task removed mid-drag (race) — nothing to commit
  // Reuses the SAME commitScheduleChange pipeline as moveTask/updateTask — guarantees the exact
  // same task:moved(task, prevStart) contract, not a separate ad hoc emit, AND groups the direct
  // move + any cascade shifts into ONE history entry. start+end always shift by the identical
  // instant delta (drag-move's own contract), so the instant span (end − start) is preserved →
  // the diff/emit step never fires task:resized from a drag.
  internal.commitScheduleChange(taskId, { start: newStart, end: newEnd }, true);
}

function commitResize(
  instance: GanttInstance,
  internal: GanttInternal,
  taskId: TaskId,
  newEnd: Temporal.ZonedDateTime,
): void {
  const task = internal.taskStore.get(taskId);
  if (!task) return; // task removed mid-resize (race) — nothing to commit, mirrors commitDrag
  const tz = internal.calendar.timezone;
  const startNs = normalizeDate(task.start, tz).epochNanoseconds;
  const endNs = normalizeDate(task.end, tz).epochNanoseconds;
  const newEndNs = newEnd.epochNanoseconds;
  // Guard the working-hours round-trip against a mid-gesture race and a no-op commit before
  // reaching resizeTask:
  //  - newEnd at/before the task's CURRENT start (its start advanced past the gesture's captured
  //    origin via a host/cascade mutation while the pointer was held) → differenceInWorkingHours
  //    would be negative and resizeTask would THROW, and onCommit runs inside the window
  //    `pointerup` handler with no catch. Skip.
  //  - newEnd equal to the current end (day-delta snapped to 0) → a true no-op; recomputing the
  //    duration would overwrite an explicit task.duration and emit a phantom task:resized for a
  //    gesture that changed nothing. Skip.
  if (newEndNs <= startNs || newEndNs === endNs) return;
  const newDuration = differenceInWorkingHours(task.start, newEnd, internal.calendar);
  // Reuses the EXISTING resizeTask() pipeline in full: validates newDuration >= 0/finite, writes
  // end+duration (→ task:resized, which correctly fires here because a real resize changes the
  // instant span — unlike drag-move's commitDrag), and cascades. No new facade method.
  instance.resizeTask(taskId, newDuration);
}

/**
 * Commit point for a drag-created dependency (spec-drag-create-dependency.md §2, decision 2 —
 * silent revert). Reuses the PUBLIC `linkTasks()` in full (same validation, same
 * `dependency:added` event on success) — no bypass of `DependencyStore.link`'s existing
 * self-link/duplicate-pair/cycle checks.
 *
 * MUST catch: `pointer-drag.ts`'s `onPointerUp` calls `recognizer.onCommit(...)` with NO
 * surrounding try/catch. A `linkTasks()` throw reaching this call site uncaught would escape into
 * the `window` `pointerup` listener, i.e. out of the whole gesture pipeline — visibly breaking
 * the page. This is the ONE place in the whole feature that MUST NOT let
 * `DependencyStore.link`'s throw propagate.
 */
function commitCreateDep(
  instance: GanttInstance,
  internal: GanttInternal,
  fromTaskId: TaskId,
  toTaskId: TaskId,
): void {
  if (!internal.taskStore.has(fromTaskId) || !internal.taskStore.has(toTaskId)) return; // race: a task removed mid-drag
  try {
    instance.linkTasks(fromTaskId, toTaskId, 'FS'); // emits dependency:added on success
  } catch (err) {
    // Swallow ONLY the expected validation rejections — self-link (defense-in-depth; the
    // recognizer already filters this out) / duplicate-pair / cycle, all raised as
    // DependencyLinkError. Silent revert (decision 2): no event, no rethrow. A NON-validation
    // throw (a real bug) is rethrown rather than hidden — a bare `catch {}` here would mask
    // genuine defects as ordinary rejected drops.
    if (err instanceof DependencyLinkError) return;
    throw err;
  }
}

function commitSelect(internal: GanttInternal, taskId: TaskId): void {
  internal.applySelection(internal.expandWithDescendants([taskId]));
}

function commitToggleSelect(internal: GanttInternal, taskId: TaskId): void {
  if (!internal.taskStore.has(taskId)) return; // race: task removed mid-click
  const group = new Set(internal.expandWithDescendants([taskId]));
  const current = new Set(internal.selectionStore.all());
  const isSelected = current.has(taskId); // the group's own representative id
  if (isSelected) for (const g of group) current.delete(g);
  else for (const g of group) current.add(g);
  internal.applySelection([...current]);
}

function commitRangeSelect(internal: GanttInternal, rawIds: readonly TaskId[]): void {
  internal.applySelection(internal.expandWithDescendants(rawIds));
}

/**
 * Shift+Arrow's range-select commit point (spec-keyboard-nav.md §4.4/§6.2). `commitRangeSelect`
 * (used by Shift+click via `selection.ts`) takes a raw ID ARRAY already computed by the caller
 * (`selection.ts`'s own `collectRowRange` walks the rendered DOM) — it does not compute a range
 * itself. Rather than change that signature (which would also change Shift+click's contract),
 * this small adapter computes the inclusive row range via `layoutRows()` (the same source of
 * truth `enableKeyboardNav` itself used to resolve `anchorId`/`focusId`) and delegates, giving
 * Shift+Arrow the exact same semantics as Shift+click.
 */
function commitKeyboardRangeSelect(internal: GanttInternal, anchorId: TaskId, focusId: TaskId): void {
  const rows = layoutRows(
    internal.taskStore.all(),
    internal.config.density ?? 'default',
    new Set(internal.collapseStore.all()),
  );
  const anchorIndex = rows.findIndex((r) => r.task.id === anchorId);
  const focusIndex = rows.findIndex((r) => r.task.id === focusId);
  if (anchorIndex === -1 || focusIndex === -1) return; // race: id no longer resolves
  const lo = Math.min(anchorIndex, focusIndex);
  const hi = Math.max(anchorIndex, focusIndex);
  commitRangeSelect(internal, rows.slice(lo, hi + 1).map((r) => r.task.id));
}

/**
 * Delete/Backspace commit point (spec-keyboard-nav.md §6.3). Reuses the existing public
 * `removeTask(id)` once per currently selected id (`removeTask` already handles
 * hierarchy-cascade removal, dependency cleanup, and selection-pruning internally per id).
 * `ids` is snapshotted BEFORE the loop starts, so the shrinking selection (pruned by
 * `removeTask` itself as it goes) never affects which ids this loop attempts — and `removeTask`
 * already no-ops gracefully on an id already removed by an earlier iteration's cascade. Wrapped
 * in a transaction so N selected tasks' removals collapse into ONE history entry for the whole
 * Delete keypress.
 */
function commitDeleteSelected(instance: GanttInstance, internal: GanttInternal): void {
  if (internal.config.readOnly) return; // defense in depth — enableKeyboardNav's own isReadOnly() gate already prevents this call
  const ids = internal.selectionStore.all();
  if (ids.length === 0) return;
  internal.beginTransaction();
  try {
    for (const id of ids) instance.removeTask(id);
  } finally {
    internal.endTransaction();
  }
}

function commitClearSelection(internal: GanttInternal): void {
  internal.applySelection([]);
}
