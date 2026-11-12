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
import { layoutRows, MAX_ARIA_TASK_NAME_LENGTH } from '../render/renderer-base.js';
import type { SvgRendererHandle } from '../render/svg-renderer.js';
import type { CanvasRendererHandle } from '../render/canvas-renderer.js';
import { enableDragMove } from './drag-move.js';
import { getPointerDragController } from './pointer-drag.js';
import { enableDragResize } from './drag-resize.js';
import { enableDragCreateDep } from './drag-create-dep.js';
import { enableClickSelect } from './selection.js';
import { enableKeyboardNav } from './keyboard-nav.js';
import { enableCollapseToggle } from './collapse-toggle.js';
import { enableWheelZoom } from './wheel-zoom.js';
import { batch } from '../signals.js';
// TYPE-ONLY import back into the base facade — erased at compile time, so no runtime cycle.
import type { GanttInstance } from '../gantt.js';
import type { GanttAnnouncement, Task, TaskId } from '../types.js';

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
  internal.setHooks({
    wire: (handle, renderer) => wireInto(instance, internal, handle, renderer),
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
  // One visually hidden polite live region per mount, created here so no other capability pays for it.
  // Text goes in via `textContent` only. Keyboard commits announce; pointer drags do not.
  const live = document.createElement('div');
  live.setAttribute('aria-live', 'polite');
  live.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
  handle.container.append(live);
  const say = (a: GanttAnnouncement) => {
    let text: string | undefined;
    try {
      text = config.messages?.announce?.(a);
    } catch {
      text = undefined;
    }
    live.textContent = (typeof text === 'string' ? text : english(a)).slice(0, 400);
  };

  // Selection is NOT gated by readOnly (confirmed): readOnly disables drag-move/drag-resize/
  // drag-create-dep, not click-select (spec-selection.md §5.5).
  const clickSelectDispose = enableClickSelect(handle, () => internal.tasks.all(), {
    // A click also moves the keyboard-nav roving focus (set BEFORE the commit so the repaint that
    // the selection change triggers already carries the new roving row). `keyboardNav` is
    // assigned below; these only run on a later pointer event.
    onSelect: (taskId) => {
      keyboardNav.focusTask(taskId);
      commitSelect(internal, taskId);
    },
    onToggle: (taskId) => {
      keyboardNav.focusTask(taskId);
      commitToggleSelect(internal, taskId);
    },
    onRangeSelect: (ids) => commitRangeSelect(internal, ids),
    onClear: () => commitClearSelection(internal),
    density,
    getCollapsedIds: () => new Set(internal.fold.all()),
  });

  // One callbacks object for both renderers: SVG hands each recognizer its own slice, Canvas passes
  // the lot to `attachDrag`. Registration order never sets priority (explicit numbers do).
  const callbacks = {
    onTaskResized: (taskId: TaskId, newEnd: Temporal.ZonedDateTime) => commitResize(instance, internal, taskId, newEnd),
    onTaskMoved: (taskId: TaskId, newStart: Temporal.ZonedDateTime, newEnd: Temporal.ZonedDateTime) =>
      commitDrag(internal, taskId, newStart, newEnd),
    onDependencyCreated:
      config.enableDependencyDrag !== false
        ? (fromTaskId: TaskId, toTaskId: TaskId) => commitCreateDep(instance, internal, fromTaskId, toTaskId)
        : undefined,
  };
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
    // Read at keypress time so composition order is irrelevant; inert without `withViewport`.
    // Keyboard alternative to drag (SC 2.5.7): same commit points as the pointer path, gated by readOnly
    // inside keyboard-nav and by enableDependencyDrag here.
    onShift: (id, days, edge) => {
      if (commitShift(instance, internal, id, days, edge)) {
        const t = internal.tasks.get(id);
        if (t) say({ kind: edge ? 'resized' : 'moved', name: nameOf(t), ...span(internal, t), locale: config.locale ?? 'en' });
      }
    },
    onLink: callbacks.onDependencyCreated && ((from, to) => {
      const [a, b] = [internal.tasks.get(from), internal.tasks.get(to)];
      if (a && b) say({ kind: callbacks.onDependencyCreated!(from, to) ? 'linked' : 'link-failed', from: nameOf(a), to: nameOf(b), locale: config.locale ?? 'en' });
    }),
    onReveal: (id) => (instance as { scrollToTask?: (id: TaskId) => boolean }).scrollToTask?.(id),
    getTasks: () => internal.tasks.all(),
    // Live, not the construction-time constant: `setDensity()` and `withResponsive` change the
    // painted density after mount, and the keyboard reveal scrolls by row geometry.
    get density() {
      return internal.density ?? config.density ?? 'default';
    },
    isReadOnly: () => config.readOnly === true,
    getSelection: () => internal.sel.all(),
    getCollapsedIds: () => new Set(internal.fold.all()),
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
  // call bumps `fold.revision` and the render effect repaints IMMEDIATELY, before
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
  const collapseToggleDispose = enableCollapseToggle(handle, () => internal.tasks.all(), {
    onToggleCollapse: (taskId) => {
      batch(() => {
        instance.toggleCollapse(taskId); // reuses the public method in full
        keyboardNav.syncFocusToRows();
      });
    },
  });

  // Disposers of every module wired below, in wiring order (the ones that are SVG-only simply
  // never get pushed in Canvas mode).
  const disposers = [clickSelectDispose, collapseToggleDispose, keyboardNav.dispose];

  if (renderer === 'svg') {
    // Cast, not a narrow: `renderer`/`handle` are separate parameters, so TypeScript cannot
    // correlate them; renderer === 'svg' implies an SVG handle by construction in `render/mixin.ts`.
    const svgHandle = handle as SvgRendererHandle;
    if (!config.readOnly) {
      const getTasks = () => internal.tasks.all();
      disposers.push(enableDragResize(svgHandle, getTasks, callbacks), enableDragMove(svgHandle, getTasks, callbacks));
      if (callbacks.onDependencyCreated) {
        disposers.push(enableDragCreateDep(svgHandle, getTasks, { onDependencyCreated: callbacks.onDependencyCreated }));
      }
    }
    // Registered UNCONDITIONALLY, same posture as enableKeyboardNav's zoom case arms — Ctrl+wheel
    // mutates no store state, so readOnly has nothing to protect against here (spec-wheel-zoom.md §4).
    // Canvas: wheel-zoom stays SVG-only.
    disposers.push(enableWheelZoom(svgHandle, {
      onZoomIn: () => instance.zoomIn(),
      onZoomOut: () => instance.zoomOut(),
    }));
  } else if (!config.readOnly) {
    const canvasHandle = handle as CanvasRendererHandle;
    disposers.push(canvasHandle.attachDrag(getPointerDragController(canvasHandle), callbacks));
  }

  return {
    focusedId: keyboardNav.getFocusedTaskId,
    // Order among the disposers is irrelevant: the shared pointer-drag coordinator is refcounted
    // (see pointer-drag.ts) and click-select/keyboard-nav own independent listeners. The reactive
    // render effect is stopped by the caller BEFORE this runs, and `handle.destroy()`
    // AFTER it (see `gantt.ts`'s `unmount`).
    dispose: () => {
      disposers.forEach((d) => d());
      live.remove();
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
  const task = internal.tasks.get(taskId);
  if (!task) return; // task removed mid-drag (race) - nothing to commit
  // A drag that snapped to a zero-day delta changed nothing: writing it back would re-store the
  // start as a ZonedDateTime (same instant) with no task:moved and a phantom history entry.
  // End shifts by the same calendar delta, so comparing the start is enough.
  if (normalizeDate(task.start, internal.calendar.timezone).epochNanoseconds === newStart.epochNanoseconds) return;
  // Reuses the SAME commitScheduleChange pipeline as moveTask/updateTask — guarantees the exact
  // same task:moved(task, prevStart) contract, not a separate ad hoc emit, AND groups the direct
  // move + any cascade shifts into ONE history entry. start+end always shift by the identical
  // instant delta (drag-move's own contract), so the instant span (end − start) is preserved →
  // the diff/emit step never fires task:resized from a drag.
  internal.reschedule(taskId, { start: newStart, end: newEnd }, true);
}

const nameOf = (t: Task): string => t.name.slice(0, MAX_ARIA_TASK_NAME_LENGTH);

/** Localized start / end WITH times: a keyboard resize or move can change only the time of day. */
function span(internal: GanttInternal, t: Task, locale = internal.config.locale ?? 'en') {
  const f = (d: Task['start']) => {
    try {
      return normalizeDate(d, internal.calendar.timezone).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return String(d);
    }
  };
  return { startLabel: f(t.start), endLabel: f(t.end) };
}

function english(a: GanttAnnouncement): string {
  return 'from' in a
    ? a.kind === 'linked'
      ? `Linked ${a.from} to ${a.to}`
      : `Link not created from ${a.from} to ${a.to}`
    : `${a.name} ${a.kind}: ${a.startLabel} to ${a.endLabel}`;
}

/** The drag gate: a bar is rolled up exactly when the renderer's own provider call has an entry for it
 *  (a provider that throws paints authored dates, so the bar is draggable and so is this). */
function isRolledUp(internal: GanttInternal, id: TaskId): boolean {
  try {
    return internal.config.rollup?.(internal.tasks.all(), internal.calendar).has(id) === true;
  } catch {
    return false;
  }
}

/**
 * Alt+Arrow / Alt+Shift+Arrow (keyboard alternative to drag-move / drag-resize). Same calendar-day
 * arithmetic as drag (`.add({ days })`, wall-clock and DST safe) and the same one-day resize floor,
 * then the shared commit points. Declines what drag declines: a rolled-up summary (fail-closed:
 * any parent when `config.rollup` is set) and, for resize, a milestone.
 */
function commitShift(
  instance: GanttInstance,
  internal: GanttInternal,
  id: TaskId,
  days: number,
  edge?: 'end',
): boolean {
  const task = internal.tasks.get(id);
  if (!task || (task.type !== 'milestone' && isRolledUp(internal, id))) return false;
  const tz = internal.calendar.timezone;
  const end = normalizeDate(task.end, tz);
  if (!edge) {
    commitDrag(internal, id, normalizeDate(task.start, tz).add({ days }), end.add({ days }));
  } else if (task.type === 'milestone') {
    return false;
  } else {
    // Floor: the EARLIER of start + 1 day and the current end, as `computeClampedResizedEnd`.
    const floor = normalizeDate(task.start, tz).add({ days: 1 });
    const min = floor.epochNanoseconds < end.epochNanoseconds ? floor : end;
    // A press must change the working-hours duration (a drag computes from its origin and so crosses a
    // weekend or holiday; a relative step would stick on it): keep stepping, bounded, until it does.
    const cur = task.duration ?? differenceInWorkingHours(task.start, end, internal.calendar);
    for (let n = 1; n <= 31; n++) {
      const t = end.add({ days: n * days });
      const next = t.epochNanoseconds < min.epochNanoseconds ? min : t;
      if (differenceInWorkingHours(task.start, next, internal.calendar) !== cur || next === min) {
        commitResize(instance, internal, id, next);
        break;
      }
    }
  }
  return true;
}

function commitResize(
  instance: GanttInstance,
  internal: GanttInternal,
  taskId: TaskId,
  newEnd: Temporal.ZonedDateTime,
): void {
  const task = internal.tasks.get(taskId);
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
  // The requested end can resolve to the same working time (a weekend or holiday): no event, no undo entry.
  if (newDuration === (task.duration ?? differenceInWorkingHours(task.start, task.end, internal.calendar))) return;
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
): boolean {
  if (!internal.tasks.has(fromTaskId) || !internal.tasks.has(toTaskId)) return false; // race: a task removed mid-drag
  try {
    instance.linkTasks(fromTaskId, toTaskId, 'FS'); // emits dependency:added on success
    return true;
  } catch (err) {
    // Swallow ONLY the expected validation rejections — self-link (defense-in-depth; the
    // recognizer already filters this out) / duplicate-pair / cycle, all raised as
    // DependencyLinkError. Silent revert (decision 2): no event, no rethrow. A NON-validation
    // throw (a real bug) is rethrown rather than hidden — a bare `catch {}` here would mask
    // genuine defects as ordinary rejected drops.
    if (err instanceof DependencyLinkError) return false;
    throw err;
  }
}

function commitSelect(internal: GanttInternal, taskId: TaskId): void {
  internal.applySel(internal.withKids([taskId]));
}

function commitToggleSelect(internal: GanttInternal, taskId: TaskId): void {
  if (!internal.tasks.has(taskId)) return; // race: task removed mid-click
  const group = new Set(internal.withKids([taskId]));
  const current = new Set(internal.sel.all());
  const isSelected = current.has(taskId); // the group's own representative id
  if (isSelected) for (const g of group) current.delete(g);
  else for (const g of group) current.add(g);
  internal.applySel([...current]);
}

function commitRangeSelect(internal: GanttInternal, rawIds: readonly TaskId[]): void {
  internal.applySel(internal.withKids(rawIds));
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
    internal.tasks.all(),
    internal.config.density ?? 'default',
    new Set(internal.fold.all()),
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
  const ids = internal.sel.all();
  if (ids.length === 0) return;
  internal.run(() => {
    for (const id of ids) instance.removeTask(id);
  }, true);
}

function commitClearSelection(internal: GanttInternal): void {
  internal.applySel([]);
}
