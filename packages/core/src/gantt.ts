// Public facade — `createGantt()` / `GanttInstance` (spec §7, spec-gantt-facade.md).
// Composes `TaskStore` + `DependencyStore` + `computeCriticalPath` + `createSvgRenderer` +
// `enableDragMove` + `effect()` (signals.ts) into the single front door of `@fluxgantt/core`.
//
// HEADLESS-FIRST (architecture.md principle 1/7): `createGantt(config)` never touches
// `document`/`window`/any DOM global — task/dependency mutation, `on()`, and
// `computeCriticalPath()` all work in Node/Workers with zero DOM. Only `mount()` (and its
// private helpers) reach into `render/`/`interaction/`.
//
// NO FRAMEWORK IMPORT — this file imports nothing outside `@fluxgantt/core`'s own tree.
//
// CASCADE (spec-cascade.md): `moveTask`/`resizeTask`/`updateTask` (when start/end/duration
// changes) and a drag-move commit optionally cascade dependent tasks along FS/SS/FF/SF (+lag)
// via `computeCascade` — opt-in via `GanttConfig.schedulingMode: 'auto'`. Default remains
// `'manual'` (= v1's original single-task-only behavior, unchanged) — see `#maybeCascade`.
import { batch, signal, type Signal } from './signals.js';
import { INTERNAL, type GanttInternal, type MountState, type InteractionHooks } from './gantt-internal.js';
import { TaskStore, DependencyStore, SelectionStore, CollapseStore } from './store/index.js';
import type { TaskInput, TaskPatch } from './store/index.js';
import {
  DEFAULT_CALENDAR,
  normalizeDate,
  differenceInWorkingHours,
  addWorkingHours,
} from './compute/working-calendar.js';
import { computeCriticalPath as computeCriticalPathFn } from './compute/critical-path.js';
import { computeCascade } from './compute/cascade.js';
import { getTemporal } from './internal/temporal.js';
import type { SvgRendererHandle } from './render/svg-renderer.js';
// TYPE-ONLY import — erased at compile time, so it creates no runtime edge into the Canvas
// renderer's module graph (which is reachable only through `render/mixin.ts`'s dynamic import).
import type { CanvasRendererHandle } from './render/canvas-renderer.js';
import type {
  CriticalPathResult,
  DateInput,
  Density,
  Dependency,
  DependencyId,
  DependencyType,
  RollupProvider,
  SchedulingMode,
  Task,
  TaskId,
  ViewMode,
  WorkingCalendar,
} from './types.js';

// --- Public config -------------------------------------------------------------------

export interface GanttConfig {
  /** Initial tasks. Routed through `TaskStore.add()` one at a time at construction (not
   *  the store's `initial` constructor array) so every task gets the same
   *  id-generation/defaulting behavior as a runtime `addTask()` call. Duplicate explicit
   *  `id`s across this array throw at construction — `TaskStore`'s `Map.set` would
   *  otherwise silently drop the earlier task. */
  readonly tasks?: readonly TaskInput[];

  /** Initial dependencies. Routed through `DependencyStore.link()` one at a time (not the
   *  store's `initial` constructor array) — reuses the store's existing cycle/self-link/
   *  duplicate-pair validation instead of duplicating it. A cyclic/invalid initial
   *  dependency set throws at construction (fail fast, security.md "reject instead of
   *  best-effort"). No custom `id` accepted (matches `link()`, which always generates
   *  one — same limitation as calling `linkTasks()` at runtime). */
  readonly dependencies?: readonly DependencyInput[];

  /** Default `DEFAULT_CALENDAR` (`compute/working-calendar.js`). Immutable for the life of
   *  the instance in v1 — no `setCalendar()`. */
  readonly calendar?: WorkingCalendar;

  /** Passed straight through to the renderer's `SvgRendererOptions.viewMode` on
   *  `mount()`. Default `'week'` (the renderer's own default — the facade does not
   *  duplicate the default value, just omits the option when unset). */
  readonly viewMode?: ViewMode;

  /** Passed straight through to `SvgRendererOptions.density`. Default `'default'`. */
  readonly density?: Density;

  /** Passed straight through to `SvgRendererOptions.locale`. Default `'en'`. */
  readonly locale?: string;

  /**
   * (fix #37, spec-canvas-row-virtualization.md §2). Passed straight through to
   * `CanvasRendererOptions.viewportHeight` — has NO effect in SVG mode (no equivalent
   * concept there). Bounds the Canvas `<canvas>` backing store's physical height and the
   * mounted `container`'s visible vertical scroll-viewport height. Default `600` (px) when
   * omitted — see `CanvasRendererOptions.viewportHeight`'s own doc comment for the full
   * clamping/fallback behavior.
   */
  readonly canvasViewportHeight?: number;

  /** Default `false`. When `true`, `mount()` does NOT call `enableDragMove` at all — the
   *  rendered chart is not draggable. Does NOT restrict the programmatic API
   *  (`addTask`/`updateTask`/... still work) — `readOnly` governs the rendered UI's
   *  interactivity, not the facade's method surface (a host may still want to push
   *  programmatic updates, e.g. from a server subscription, into a read-only view). */
  readonly readOnly?: boolean;

  /** Fired once per `addTask`/`updateTask`/`moveTask`/`resizeTask`/`setProgress` call that
   *  actually changed the task (same call site as the split `task:*` events). This is the
   *  "any field changed" catch-all — v1 does NOT add a bus-level `task:updated` (Q3).
   *  `onDependencyChange`/`onSelectionChange` are intentionally excluded from v1. */
  readonly onTaskChange?: (task: Task, prev: Task) => void;

  /** Default `'manual'` (= v1's current single-task-only behavior, unchanged). `'auto'`
   *  makes `moveTask`/`resizeTask`/`updateTask` (when start/end/duration changes) and a
   *  drag-move commit push dependent tasks later along FS/SS/FF/SF (+lag), per
   *  `computeCascade` (spec-cascade.md §4.1). Immutable for the life of the instance in
   *  v1 — no `setSchedulingMode()`, matching `calendar`'s own posture. */
  readonly schedulingMode?: SchedulingMode;

  /** Max number of undo entries retained. Default `100`. Once exceeded, the OLDEST entry is
   *  evicted (ring-buffer semantics) — a long editing session never grows the stack
   *  unboundedly. Immutable for the life of the instance (same posture as `calendar`/
   *  `schedulingMode` — no runtime setter in v1). Must be a non-negative integer; a
   *  non-integer or negative value throws at construction (fail-fast, matches the
   *  `config.tasks`/`config.dependencies` validation posture). `0` is a valid, if unusual,
   *  opt-out: undo/redo becomes permanently inert (`canUndo()`/`canRedo()` always `false`)
   *  without disabling any other facade behavior — every mutation still runs normally, its
   *  history entry is just immediately evicted. */
  readonly historyLimit?: number;

  /**
   * (spec-collapse-expand.md §3.3). Ids to collapse at construction time — applied AFTER
   * `tasks` is loaded, using the exact same "must currently have at least one child" filter
   * as `collapseAll()`/`toggleCollapse()`. An unknown id or a leaf (no children) id is
   * silently dropped — no throw, no `collapse:changed` event fires at construction. Default:
   * nothing collapsed.
   */
  readonly initialCollapsed?: readonly TaskId[];

  /**
   * (spec-summary-rollup.md Ticket B2). Aggregation used to draw every task that has children
   * at its ROLLED-UP span — earliest descendant start to latest descendant end, with
   * duration-weighted aggregate progress in its `aria-label` — instead of at its own authored
   * `start`/`end`. Omitted (the default) = every bar is drawn at its authored dates, exactly as
   * before. Only consulted by a MOUNTED chart; a headless instance ignores it.
   *
   * Pass the core implementation to opt in:
   *
   * ```ts
   * import { computeRollup } from '@fluxgantt/core';
   * withRender(createGantt({ tasks, rollup: computeRollup }));
   * ```
   *
   * **A function, not a boolean flag**, for a measured reason: making `render/mixin.ts` import
   * `computeRollup` itself costs ~400 B gzip in every `@fluxgantt/core/render` bundle — enough
   * to push the `withRender + withInteraction` fixture past its budget (golden rule 5) — and
   * bills it to consumers who never enable it. Injecting keeps those bytes in the graph of the
   * host that actually asked for them, and makes a custom aggregation (different weighting, a
   * baseline span) a supported case rather than a fork. The signature is `computeRollup`'s own,
   * so it can be passed by reference with no adapter.
   *
   * **Derived on read, never written back.** `getTasks()`, `exportJson()`, undo/redo and
   * `computeCriticalPath()` all keep seeing the AUTHORED dates — this changes what is painted,
   * nothing else (spec §4). The one behavioral consequence beyond pixels: a bar drawn at a
   * rolled-up span is not drag-movable or drag-resizable, because the geometry under the cursor
   * is not an authored value there is any well-defined way to commit (see `data-rolled-up` in
   * `svg-renderer.ts`).
   *
   * Re-run on every store mutation. It must be PURE and must not mutate `tasks`; if it throws,
   * the chart renders authored dates and warns rather than wedging the render effect.
   * Immutable for the life of the instance in v1 (same posture as `calendar`/`schedulingMode`).
   */
  readonly rollup?: RollupProvider;
}

/** Shape accepted for an initial dependency in `GanttConfig.dependencies` — mirrors what
 *  `DependencyStore.link()` accepts (discrete args), not the full stored `Dependency`
 *  (which requires `id`). */
export type DependencyInput = Omit<Dependency, 'id'>;

// --- Public event map ------------------------------------------------------------------

/** Present only on an event emitted as a DIRECT result of `gantt.undo()`/`gantt.redo()`
 *  replaying a history entry. Omitted (the 3rd callback argument is simply not passed) for a
 *  normal user/programmatic mutation — an ADDITIVE field: existing subscribers whose callback
 *  only declares the original 1–2 params are entirely unaffected (JS ignores extra args; TS's
 *  "fewer declared params is assignable" rule keeps old callback signatures type-checking). */
export interface EventMeta {
  readonly source: 'undo' | 'redo';
}

/** Returned by `importJson()`/`importCsv()` AND the payload of the `data:imported` event they
 *  emit — same value in both places (see computeCriticalPath()/critical-path:computed for the
 *  precedent of "method returns it, event echoes it"). */
/** Payload of `viewport:changed` (spec-zoom-runtime.md §2). v1 is intentionally minimal —
 *  just the new view mode, not a full scroll/visible-range snapshot (no `ViewportStore`,
 *  no `scrollToDate`/`scrollToTask` exist yet to make a `{start, end}` range meaningful as
 *  a side effect of this one method — see the spec's §4 for the full reasoning). Additive:
 *  can grow new readonly fields later without a breaking change to this event's shape. */
export interface ViewportChangedPayload {
  readonly viewMode: ViewMode;
}

/** Payload of `renderer:selected` (spec-canvas-auto-switch.md §4). */
export interface RendererSelectedPayload {
  readonly renderer: 'svg' | 'canvas';
  readonly taskCount: number;
  /** Present only when `renderer === 'svg'` AND a Canvas attempt was made first but failed —
   *  i.e. a true fallback, not the ordinary "task count was at/below the threshold" case
   *  (which never attempts Canvas at all and leaves this field absent). */
  readonly canvasFallbackReason?: 'dimension-exceeded' | 'load-failed' | 'construction-failed';
}

export interface ImportSummary {
  /** Which of the two import methods produced this summary. */
  readonly format: 'json' | 'csv';
  /** Number of tasks now in the live store — always equal to the imported task count (the
   *  wholesale replace never drops or merges an item; either every item loads, or the whole
   *  call throws and nothing loads). */
  readonly taskCount: number;
  /** Number of dependencies now in the live store. Always `0` for `importCsv()` (CSV has no
   *  dependency concept — see `importCsv()`'s doc comment). */
  readonly dependencyCount: number;
}

export interface GanttEventMap {
  'task:added': [task: Task, meta?: EventMeta];
  /** `prevStart` is `DateInput` (usually the same shape the task was last written with),
   *  NOT a plain `Date`. */
  'task:moved': [task: Task, prevStart: DateInput, meta?: EventMeta];
  /** Working hours, matches `Task.duration`'s unit. */
  'task:resized': [task: Task, prevDuration: number, meta?: EventMeta];
  'task:progressed': [task: Task, prevProgress: number, meta?: EventMeta];
  'task:removed': [taskId: TaskId, meta?: EventMeta];
  'dependency:added': [dependency: Dependency, meta?: EventMeta];
  'dependency:removed': [dependencyId: DependencyId, meta?: EventMeta];
  /** Task ids only, even though the facade's `computeCriticalPath()` method itself returns
   *  the full `CriticalPathResult`. */
  'critical-path:computed': [criticalTaskIds: readonly TaskId[]];
  /** Full flattened selection (explicit ids + auto-selected descendants), in Set-iteration
   *  (insertion) order — NOT necessarily row order. Fires once per `select`/`selectAll`/
   *  `deselect` call AND once per completed click-select interaction, but ONLY when the
   *  resulting set actually differs from the previous one (no-op reselect is suppressed —
   *  same discipline as `critical-path:computed`'s `#sameCriticalIds` guard). */
  'selection:changed': [taskIds: readonly TaskId[]];
  /** Full snapshot of currently-collapsed task ids (spec-collapse-expand.md §3.2) — fires once
   *  per `toggleCollapse`/`collapseAll`/`expandAll` call that actually changes the set (no-op
   *  suppressed, same discipline as `selection:changed`). Never fires from
   *  `GanttConfig.initialCollapsed` at construction. */
  'collapse:changed': [collapsedTaskIds: readonly TaskId[]];
  /** Fires exactly once per "logical gesture" that changes the undo/redo stack: after a new
   *  entry is committed (`#commitEntry` — one fire per top-level mutation call OR per grouped
   *  transaction, e.g. one fire for a whole cascade-grouped drag or a whole multi-select
   *  Delete, never once per internal op), after a successful `undo()`, after a successful
   *  `redo()`. NOT fired when `undo()`/`redo()` is a no-op (empty stack) or when a mutation
   *  produces zero ops. Payload mirrors `canUndo()`/`canRedo()` at the moment of the fire so a
   *  host's Undo/Redo buttons can wire `disabled` state directly off the event. */
  'history:changed': [state: { readonly canUndo: boolean; readonly canRedo: boolean }];
  /** Fires exactly once per `importJson()`/`importCsv()` call that COMMITS (never on a
   *  rejected/throwing import — see `#commitImport`'s atomicity guarantee), after the
   *  wholesale replace has fully landed: live stores updated, undo/redo history cleared,
   *  selection cleared. Never fires per-item (no `task:added`×N/`dependency:added`×N storm).
   *  A host that needs full post-import detail calls `getTasks()`/`getDependencies()` once,
   *  either from the listener or directly off this method's own return value (identical
   *  `ImportSummary`). */
  'data:imported': [summary: ImportSummary];
  /** Fires once per `zoomTo()`/`zoomIn()`/`zoomOut()` call that actually changes the view
   *  mode (never on a no-op — calling `zoomTo()` with the already-current mode, or
   *  `zoomIn()`/`zoomOut()` at a boundary, fires nothing). Fires whether or not the
   *  instance is currently mounted (a headless pre-mount `zoomTo()` still fires — mounting
   *  only affects whether a DOM repaint + scroll-anchor restoration also happens). */
  'viewport:changed': [state: ViewportChangedPayload];
  /** Fires exactly once per `mount()` call (including an implicit remount), after the chosen
   *  renderer has fully painted and all applicable interaction modules are wired — i.e. after
   *  the point at which the container is guaranteed to reflect `renderer`. For a sub-threshold
   *  project this fires synchronously, before `mount()` returns. For a project above
   *  the Canvas auto-switch threshold, `mount()` itself returns synchronously (unchanged
   *  signature) but this event fires later, once the internally lazy-loaded Canvas module has
   *  resolved and painted (or, on any Canvas-path failure, once the SVG fallback has painted
   *  instead) — this is the intended way for a host to know a large-project chart has become
   *  visible. Never fires on `unmount()`/`destroy()`. */
  'renderer:selected': [state: RendererSelectedPayload];
}

export type GanttEventName = keyof GanttEventMap;
export type UnsubscribeFn = () => void;

// --- Public instance shape ---------------------------------------------------------------

export interface GanttInstance {
  // --- Task operations (no cascade, see the module doc-comment above) ------------------
  addTask(input: TaskInput): Task;
  updateTask(id: TaskId, patch: TaskPatch): Task;
  removeTask(id: TaskId): void;
  moveTask(id: TaskId, newStart: DateInput): Task;
  resizeTask(id: TaskId, newDuration: number): Task;
  setProgress(id: TaskId, progress: number): Task;
  /**
   * Duplicates one task (`taskId` given) or the current selection (`taskId` omitted) by
   * constructing a fresh `TaskInput` per source task and calling `addTask()` once per copy —
   * reuses addTask's id-generation/createdAt+updatedAt-stamping/`task:added` emission/undo-
   * recording in full, no bypass. See spec-duplicate-task.md for the exact field-copy table.
   *
   * - Copy's `id` is always freshly minted (never derived from/equal to the source's).
   * - Copy's `parent` is copied as-is — becomes a new SIBLING under the same parent, if any.
   *   The source's own CHILDREN are never cloned (v1 does not duplicate subtrees).
   * - Copy starts with ZERO dependency edges (incoming or outgoing) — no rewiring in v1.
   * - Copy's `start` is set to the source's `end` (offset — starts immediately after the
   *   source finishes); `end` is `start + (the source's own working-hours duration)`, computed
   *   via the calendar's `addWorkingHours` — the copy's span visually mirrors the source's,
   *   just shifted later. Computed independently per source task when duplicating a
   *   multi-selection (each copy is offset from ITS OWN source, not a single shared anchor).
   * - Copy's `progress` always resets to `0` (a duplicate is new, not-yet-started work) —
   *   regardless of the source's progress value.
   * - Every other `Task` field (`name`, `priority`, `type`, `constraint`, `resources`,
   *   `notes`, `color`, `meta`, `duration`) is copied verbatim (shallow copy — matches
   *   `TaskStore.add()`'s own existing shallow-spread convention; see spec §5 for why this is
   *   safe). `name` gets NO suffix (e.g. no `"(copy)"`) — see spec §5 rationale.
   *
   * Multiple copies from one call collapse into ONE undo/redo history entry (mirrors
   * `#commitDeleteSelected`'s `#beginTransaction`/`#endTransaction` pattern) — `undo()` removes
   * every copy created by that one `duplicateTask()` call in a single step.
   *
   * Explicit `taskId` that does not resolve in the live store THROWS (matches
   * `moveTask`/`resizeTask`/`updateTask`/`setProgress`'s `#requireTask`-gated posture — an
   * invalid explicit id is treated as a caller error, not a silent no-op). Omitted `taskId`
   * with an EMPTY current selection is a safe no-op, returns `[]` (matches
   * `#commitDeleteSelected`'s own "nothing selected → do nothing" posture) — no history entry,
   * no events, no transaction opened.
   *
   * Does NOT auto-select the new copies — call `select(result.map(t => t.id))` if desired.
   *
   * NOT gated by `readOnly` (matches every other programmatic mutation method — `readOnly`
   * governs rendered interactivity, not the facade's method surface). Throws if the instance
   * is destroyed (`#assertAlive`, same posture as every other mutating method).
   */
  duplicateTask(taskId?: TaskId): Task[];
  getTask(id: TaskId): Task | undefined;
  getTasks(): Task[];
  findTasks(predicate: (task: Task) => boolean): Task[];

  // --- Dependency operations -------------------------------------------------------------
  linkTasks(from: TaskId, to: TaskId, type?: DependencyType, lag?: number): Dependency;
  unlinkTasks(from: TaskId, to: TaskId): void;
  getDependencies(): Dependency[];
  getDependenciesOf(taskId: TaskId): Dependency[];

  // --- Selection operations --------------------------------------------------------------
  /**
   * Replaces the current selection with `id` (or `id[]`), expanded to include every
   * descendant of any task among them (parent-implies-children). Ids that don't resolve in
   * the current TaskStore are silently dropped (same resilience posture as a dangling
   * dependency reference). Fires `selection:changed` iff the resulting flattened set differs
   * from the previous one.
   */
  select(id: TaskId | TaskId[]): void;

  /** Selects every current task (already the full set — hierarchy expansion is a no-op
   *  here). Fires `selection:changed` iff the set changed. */
  selectAll(): void;

  /** Clears the selection. Fires `selection:changed` iff the selection was non-empty. */
  deselect(): void;

  /** Snapshot array (not a live reference) of the CURRENT FLATTENED selection — includes
   *  every explicitly-selected id AND every auto-selected descendant. Same "snapshot, not
   *  reference" convention as `getTasks()`/`getDependencies()`. Returns `[]` post-`destroy()`. */
  getSelection(): TaskId[];

  // --- Hierarchy (collapse/expand, spec-collapse-expand.md §3) ---------------------------

  /**
   * Toggles the given task's collapsed state. A no-op (no event, no state change) if `id`
   * does not resolve in the store, or resolves to a task with zero children — only a task
   * that currently HAS children can be collapsed/expanded. Fires `collapse:changed` with the
   * full collapsed-id snapshot iff the collapsed set actually changed. Throws if the instance
   * is destroyed (`#assertAlive`, same posture as every other mutating method).
   */
  toggleCollapse(id: TaskId): void;

  /** `true` iff `id` is currently collapsed AND still has at least one child — a stale
   *  collapsed-id left over for a task whose last child was removed reports `false` here
   *  (harmless: `layoutRows()` never hides a row with no children regardless of this flag).
   *  Safe post-`destroy()` (returns `false`, does not throw), same posture as
   *  `getSelection()`. */
  isCollapsed(id: TaskId): boolean;

  /** Collapses every task that currently has at least one child. Fires `collapse:changed`
   *  iff the collapsed set actually changed (idempotent — a second call is a no-op). */
  collapseAll(): void;

  /** Expands every task. Fires `collapse:changed` iff the collapsed set was non-empty
   *  (idempotent — a second call is a no-op). */
  expandAll(): void;

  // --- History (undo/redo) --------------------------------------------------------------

  /**
   * Undoes the most recent undoable mutation (`addTask`/`updateTask`/`moveTask`/`resizeTask`/
   * `setProgress`/`removeTask`/`linkTasks`/`unlinkTasks`, including a cascade-grouped drag and
   * a multi-select Delete — each undoes as ONE step). Returns `true` if something was undone,
   * `false` if the undo stack was empty (a safe no-op, does not throw, does not emit
   * `history:changed` on the no-op case). Replays the recorded inverse ops directly against
   * the stores — never calls `#maybeCascade`, never goes back through `addTask`/`linkTasks`/
   * etc. NOT gated by `readOnly` (mirrors `readOnly`'s existing "governs rendered
   * interactivity, not the method surface" posture). Throws if the instance is destroyed (same
   * `#assertAlive` posture as every other mutating method).
   */
  undo(): boolean;

  /** Symmetric to `undo()` — replays the next entry off the redo stack, forward. Same
   *  no-throw-on-empty / `readOnly`-independent / `#assertAlive`-gated posture. */
  redo(): boolean;

  /** `true` iff `undo()` would currently do something. Safe post-`destroy()` (returns `false`,
   *  does not throw) — same posture as `getSelection()`/`getTasks()`. */
  canUndo(): boolean;

  /** Symmetric to `canUndo()`. */
  canRedo(): boolean;

  // --- Viewport (zoom / view-mode) --------------------------------------------------------

  /**
   * Switches the rendered view mode ('day'|'week'|'month'|'quarter'|'year'). Headless-safe
   * (works before `mount()` — state-only update, no DOM/scroll-anchor math attempted). When
   * mounted, preserves the visible date range: the date currently centered in the viewport
   * stays centered after the repaint. A no-op (no render, no `viewport:changed`) when `mode`
   * already equals the current view mode. NOT gated by `readOnly` (a view concern, not a
   * data mutation). Throws if `mode` is not one of the five known `ViewMode` values
   * (defensive — same posture as `resizeTask`/`setProgress` validating their primitive
   * inputs) or if the instance is destroyed (`#assertAlive`).
   */
  zoomTo(mode: ViewMode): void;

  /** Steps one level toward `'day'` (more detail) through the fixed order
   *  `['day','week','month','quarter','year']`. A safe no-op at the `'day'` boundary
   *  (mirrors `undo()`/`redo()`'s "safe no-op past the end" precedent) — delegates to
   *  `zoomTo()`, which already no-ops correctly when the target mode equals the current
   *  one. Same `readOnly`-independent / `#assertAlive`-gated posture as `zoomTo()`. */
  zoomIn(): void;

  /** Symmetric to `zoomIn()` — steps one level toward `'year'` (less detail). Safe no-op at
   *  the `'year'` boundary. */
  zoomOut(): void;

  /** Current view mode. Trivial state getter (same posture as `canUndo()`/`canRedo()`
   *  exposing internal signal state) — safe post-`destroy()` (returns the last value, does
   *  not throw), same posture as `getSelection()`/`getTasks()`. */
  getViewMode(): ViewMode;

  // --- Computation -------------------------------------------------------------------------
  computeCriticalPath(): CriticalPathResult;

  // --- IO ---------------------------------------------------------------------------------
  // exportJson/exportCsv/importJson/importCsv/exportSvg/exportPng now live on the opt-in
  // `IoCapability` mixin (spec-facade-split.md §3.2):
  //   import { withIo } from '@fluxgantt/core/io';
  //   const gantt = withIo(createGantt({ tasks }));
  // Keeping them on the base class would keep the whole `io/*` graph in every bundle, since
  // class prototype methods can never be tree-shaken.

  // --- Events --------------------------------------------------------------------------------
  on<E extends GanttEventName>(
    event: E,
    callback: (...args: GanttEventMap[E]) => void,
  ): UnsubscribeFn;

  // --- Lifecycle -------------------------------------------------------------------------------
  /**
   * Releases every resource this instance holds: tears down a live mount (if `withRender` was
   * applied and `mount()` was called), clears all event listeners, and marks the instance dead —
   * every subsequent mutating call throws. Idempotent.
   */
  destroy(): void;
}

// --- Internal ------------------------------------------------------------------------------

/** Default `GanttConfig.historyLimit` — see its doc-comment. */
const DEFAULT_HISTORY_LIMIT = 100;

/** Canonical zoom-step order (spec-zoom-runtime.md §2) — `'day'` = most detail/most zoomed
 *  in, `'year'` = least. Matches both the `ViewMode` union's own textual order AND
 *  `renderer-base.ts`'s `PIXELS_PER_DAY` map (strictly descending pixel density). Used only
 *  by `zoomIn()`/`zoomOut()` to step one position toward/away from `'day'`. */
const ZOOM_LEVELS: readonly ViewMode[] = ['day', 'week', 'month', 'quarter', 'year'];

/**
 * One reversible store write. A discriminated union covering both stores this facade touches.
 * Each variant carries a FULL snapshot (never a partial patch) so both directions (forward =
 * "redo", inverse = "undo") are a single, non-recomputed store write.
 */
type HistoryOp =
  | { readonly kind: 'task-add'; readonly task: Task }
  | { readonly kind: 'task-update'; readonly id: TaskId; readonly prev: Task; readonly next: Task }
  | { readonly kind: 'task-remove'; readonly task: Task }
  | { readonly kind: 'dependency-add'; readonly dependency: Dependency }
  | { readonly kind: 'dependency-remove'; readonly dependency: Dependency };

/**
 * One undo/redo step as presented to the user — "one gesture". `ops` is ordered so that
 * replaying it FORWARD, in array order, reproduces the original mutation's emitted-event order
 * exactly (this is `redo()`'s contract); replaying it in REVERSE array order, applying each
 * op's INVERSE, is `undo()`'s contract (LIFO within the entry).
 */
interface HistoryEntry {
  readonly ops: readonly HistoryOp[];
}

class Gantt implements GanttInstance {
  readonly #taskStore: TaskStore;
  readonly #dependencyStore: DependencyStore;
  readonly #selectionStore = new SelectionStore();
  readonly #collapseStore = new CollapseStore();
  readonly #calendar: WorkingCalendar;
  readonly #config: GanttConfig;
  readonly #listeners = new Map<GanttEventName, Set<(...args: never[]) => void>>();
  /** Reactive view-mode state (spec-zoom-runtime.md §7) — read (tracked, `.value`) inside
   *  `#renderNow` so a `zoomTo()` write triggers the same reactive-effect repaint path
   *  every other mutation uses; read (untracked, `.peek()`) in `#rendererOptions()`, which
   *  runs once at `mount()` time outside any active effect. */
  readonly #viewMode: Signal<ViewMode>;
  /** Written ONLY by `render/mixin.ts` (through `INTERNAL.setMountState`); `undefined` =
   *  headless, which is ALWAYS the case when `withRender` was never applied. */
  #mount: MountState | undefined;
  /** Monotonic race-guard token (spec-canvas-auto-switch.md §5). Incremented by every
   *  `mount()` call (both the sync-SVG and async-Canvas paths, for symmetry) AND by
   *  `unmount()`/`destroy()` — the async Canvas path re-checks this at every `await` boundary
   *  and abandons silently (no DOM touch, no `#mount` assignment, no event) if a later call
   *  already superseded it. */
  #mountGeneration = 0;
  #destroyed = false;
  /** Last `criticalTaskIds` emitted via `critical-path:computed`, so the reactive render
   *  effect emits only when the critical set actually changes (not on every mutation). */
  #lastCriticalIds: readonly TaskId[] | undefined = undefined;

  // --- History (undo/redo) fields ---------------------------------------------------------
  readonly #undoStack: HistoryEntry[] = [];
  readonly #redoStack: HistoryEntry[] = [];
  readonly #historyLimit: number;
  /** Non-`undefined` while inside a `#beginTransaction()`/`#endTransaction()` span — ops are
   *  buffered here instead of each committing its own entry. */
  #pendingOps: HistoryOp[] | undefined;
  /** Depth counter so `#beginTransaction`/`#endTransaction` calls compose safely if a
   *  transaction-wrapped method calls another transaction-wrapped method. */
  #transactionDepth = 0;

  /** Internal "friend" surface handed to the opt-in mixins (`withIo`/`withRender`/
   *  `withInteraction`) — see `gantt-internal.ts` and spec-facade-split.md §2.1. Present on
   *  every instance from construction, deliberately absent from the public `GanttInstance`
   *  type, so a consumer importing only `@fluxgantt/core` never sees it. */
  readonly [INTERNAL]: GanttInternal;

  /** Registered by `withInteraction`, consulted lazily by `withRender`'s `mount()`. */
  #interactionHooks: InteractionHooks | undefined;

  constructor(config: GanttConfig) {
    this.#config = config;
    this.#calendar = config.calendar ?? DEFAULT_CALENDAR;
    // 'week' matches the renderer's own DEFAULT_VIEW_MODE (svg-renderer.ts) — the facade
    // does not duplicate a different default.
    this.#viewMode = signal(config.viewMode ?? 'week');
    this.#taskStore = new TaskStore();
    this.#dependencyStore = new DependencyStore();

    if (
      config.historyLimit !== undefined &&
      (!Number.isInteger(config.historyLimit) || config.historyLimit < 0)
    ) {
      throw new Error(
        `createGantt: config.historyLimit must be a non-negative integer, got ${config.historyLimit}`,
      );
    }
    this.#historyLimit = config.historyLimit ?? DEFAULT_HISTORY_LIMIT;

    // May throw (duplicate id / self-link / duplicate pair / cycle) — construction fails
    // atomically; no partial state is observable (the whole `createGantt()` call throws, no
    // instance is ever returned).
    this.#loadDataset(config.tasks ?? [], config.dependencies ?? [], this.#taskStore, this.#dependencyStore, 'createGantt');

    // `initialCollapsed` (spec-collapse-expand.md §3.3) — applied AFTER `#taskStore` is
    // populated (needs `children()` to resolve), using the exact same "must currently have a
    // child" filter as `collapseAll()`. Does NOT emit `collapse:changed` — construction-time
    // state, not a runtime mutation.
    if (config.initialCollapsed && config.initialCollapsed.length > 0) {
      const withChildren = config.initialCollapsed.filter((id) => this.#taskStore.children(id).length > 0);
      this.#collapseStore.replace(withChildren);
    }

    // Built last, so every field it closes over is already initialized. Arrow functions (not
    // bound methods) so `#private` access stays lexical — no `this` rebinding hazard for a
    // mixin that destructures off this object.
    this[INTERNAL] = {
      taskStore: this.#taskStore,
      dependencyStore: this.#dependencyStore,
      selectionStore: this.#selectionStore,
      collapseStore: this.#collapseStore,
      calendar: this.#calendar,
      viewMode: this.#viewMode,
      config: this.#config,
      emitEvent: (event, ...args) => {
        this.#emit(event, ...args);
      },
      assertAlive: (method) => this.#assertAlive(method),
      requireTask: (id, method) => this.#requireTask(id, method),
      getMountState: () => this.#mount,
      setMountState: (state) => {
        this.#mount = state;
      },
      bumpMountGeneration: () => ++this.#mountGeneration,
      getMountGeneration: () => this.#mountGeneration,
      isDestroyed: () => this.#destroyed,
      teardownMount: () => {
        this.#teardownMount();
      },
      getInteractionHooks: () => this.#interactionHooks,
      setInteractionHooks: (hooks) => {
        this.#interactionHooks = hooks;
      },
      commitScheduleChange: (id, patch, cascade) => this.#commitScheduleChange(id, patch, cascade),
      applyCascadeShift: (id, start, end) => {
        this.#applyCascadeShift(id, start, end);
      },
      beginTransaction: () => this.#beginTransaction(),
      endTransaction: () => this.#endTransaction(),
      recordOp: (op) => this.#recordOp(op),
      recordOps: (ops) => this.#recordOps(ops),
      applySelection: (ids) => {
        this.#applySelection(ids);
      },
      expandWithDescendants: (ids) => this.#expandWithDescendants(ids),
      commitImport: (tasks, dependencies, format) => this.#commitImport(tasks, dependencies, format),
      assertMountedSvg: (method) => this.#assertMountedSvg(method),
      noteCriticalIds: (ids) => {
        if (this.#sameCriticalIds(ids)) return false;
        this.#lastCriticalIds = ids;
        return true;
      },
      resetCriticalIds: () => {
        this.#lastCriticalIds = undefined;
      },
    };
  }

  /**
   * Shared load pipeline: duplicate-id-check + `TaskStore.add()` loop +
   * `DependencyStore.link()` loop. The ONE validated path for "load a whole
   * `{tasks, dependencies}` set into a store pair" — used by the constructor (against the
   * live, freshly-constructed `#taskStore`/`#dependencyStore` — a throw here means
   * `createGantt()` itself throws, no instance is ever returned, atomic for free) AND by
   * `#commitImport` (against a pair of throwaway staging stores — see `#commitImport`, which
   * is what makes import atomic against an ALREADY-LIVE instance, a guarantee the constructor
   * gets for free but a runtime call does not).
   *
   * `context` only prefixes a thrown duplicate-id message (e.g. `'createGantt'` /
   * `'gantt.importJson'`) — cosmetic. In practice this loop's own duplicate-id branch is
   * unreachable from import: `importJson`/`importCsv` (the pure functions) already reject a
   * duplicate id WITHIN the imported batch via their own `seenIds` check before this helper
   * ever runs. It stays here anyway so there is exactly ONE validated load path, not two —
   * the constructor's own callers get the identical defense-in-depth check import-sourced
   * data merely never needs to exercise.
   */
  #loadDataset(
    tasks: readonly TaskInput[],
    dependencies: readonly DependencyInput[],
    taskStore: TaskStore,
    dependencyStore: DependencyStore,
    context: string,
  ): void {
    const seenIds = new Set<TaskId>();
    for (const t of tasks) {
      if (t.id !== undefined) {
        if (seenIds.has(t.id)) {
          throw new Error(
            `${context}: duplicate task id "${t.id}" — TaskStore would silently drop the earlier one`,
          );
        }
        seenIds.add(t.id);
      }
      taskStore.add(t); // stamps id (if absent)/createdAt/updatedAt, no event emitted
    }
    for (const d of dependencies) {
      // May throw (self-link / duplicate pair / cycle) — DependencyLinkError, propagated as-is.
      dependencyStore.link(d.from, d.to, d.type ?? 'FS', d.lag === undefined ? {} : { lag: d.lag });
    }
  }

  /**
   * Staging + atomic swap for `importJson()`/`importCsv()`. Builds the complete replacement
   * dataset against throwaway `TaskStore`/`DependencyStore` instances FIRST — a throw here
   * (defense-in-depth duplicate id / `DependencyLinkError` incl. cycle) propagates straight
   * out of `importJson()`/`importCsv()` with NOTHING live touched: `#taskStore`/
   * `#dependencyStore`/`#undoStack`/`#redoStack`/`#selectionStore` are left byte-for-byte as
   * they were before the call.
   */
  #commitImport(
    tasks: readonly TaskInput[],
    dependencies: readonly DependencyInput[],
    format: 'json' | 'csv',
  ): ImportSummary {
    const stagingTasks = new TaskStore();
    const stagingDependencies = new DependencyStore();
    this.#loadDataset(
      tasks,
      dependencies,
      stagingTasks,
      stagingDependencies,
      format === 'json' ? 'gantt.importJson' : 'gantt.importCsv',
    );

    // Staging succeeded — every item is guaranteed loadable. Now, and only now, touch the
    // live instance. `hadHistory` is read BEFORE clearing so #emitHistoryChanged can be
    // skipped when there was nothing to clear (no-op-suppression discipline, matching
    // undo()/redo()'s own "don't fire history:changed on an empty-stack no-op" posture).
    const hadHistory = this.#undoStack.length > 0 || this.#redoStack.length > 0;

    // Single batch(): the live-store swap below performs `clear()` + N×`restore()` per store
    // plus a selection clear — each an independent revision bump. Without batching, a
    // MOUNTED chart's reactive render effect (subscribed to all three revisions) would
    // re-run on EVERY one of those bumps. `batch()` coalesces every bump inside this block
    // into exactly ONE effect flush after the block exits.
    batch(() => {
      this.#taskStore.clear();
      for (const t of stagingTasks.all()) this.#taskStore.restore(t); // preserves the ids/
      // createdAt/updatedAt minted during staging — restore(), not add(), so nothing is
      // re-stamped a second time on the live commit.
      this.#dependencyStore.clear();
      for (const d of stagingDependencies.all()) this.#dependencyStore.restore(d);
      this.#applySelection([]); // explicit clear — emits selection:changed iff the selection
      // was non-empty; safe/no-op-suppressed inside batch() same as anywhere else.
    });

    this.#undoStack.length = 0;
    this.#redoStack.length = 0;
    if (hadHistory) this.#emitHistoryChanged(); // suppressed when both stacks were already empty

    const summary: ImportSummary = { format, taskCount: tasks.length, dependencyCount: dependencies.length };
    this.#emit('data:imported', summary);
    return summary;
  }

  // --- Task operations -----------------------------------------------------------------

  addTask(input: TaskInput): Task {
    this.#assertAlive('addTask');
    const task = this.#taskStore.add(input);
    this.#recordOp({ kind: 'task-add', task });
    this.#emit('task:added', task);
    return task;
  }

  updateTask(id: TaskId, patch: TaskPatch): Task {
    this.#assertAlive('updateTask');
    this.#requireTask(id, 'updateTask');
    const cascades = patch.start !== undefined || patch.end !== undefined || patch.duration !== undefined;
    return this.#commitScheduleChange(id, patch, cascades);
  }

  moveTask(id: TaskId, newStart: DateInput): Task {
    this.#assertAlive('moveTask');
    const prev = this.#requireTask(id, 'moveTask');
    const tz = this.#calendar.timezone;
    const oldStart = normalizeDate(prev.start, tz);
    const oldEnd = normalizeDate(prev.end, tz);
    const nextStart = normalizeDate(newStart, tz);
    const deltaNs = nextStart.epochNanoseconds - oldStart.epochNanoseconds;
    const nextEnd = getTemporal()
      .Instant.fromEpochNanoseconds(oldEnd.epochNanoseconds + deltaNs)
      .toZonedDateTimeISO(tz);
    // Shifts start AND end by the identical instant delta — preserves the task's exact
    // span, matches drag-move's own "same delta on both ends" contract, just using an
    // exact ns delta here instead of a snapped day count (moveTask is a direct API call,
    // not a pixel-drag — no day-snapping to do).
    return this.#commitScheduleChange(id, { start: nextStart, end: nextEnd }, true);
  }

  resizeTask(id: TaskId, newDuration: number): Task {
    this.#assertAlive('resizeTask');
    const prev = this.#requireTask(id, 'resizeTask');
    if (!Number.isFinite(newDuration) || newDuration < 0) {
      throw new Error(`gantt.resizeTask: invalid duration (${newDuration}) — must be a finite number >= 0`);
    }
    // Sets BOTH `end` (so the rendered bar — whose width comes from start/end, not
    // `duration` — actually resizes) AND explicit `duration` (authoritative for
    // computeCriticalPath's `resolveDuration()`), keeping the two consistent. `end` is
    // start + `newDuration` working hours per the calendar. Setting `duration` alone would
    // leave `end` stale → the bar wouldn't move and the schedule/visual would disagree.
    const tz = this.#calendar.timezone;
    const newEnd = addWorkingHours(normalizeDate(prev.start, tz), newDuration, this.#calendar);
    return this.#commitScheduleChange(id, { end: newEnd, duration: newDuration }, true);
  }

  setProgress(id: TaskId, progress: number): Task {
    this.#assertAlive('setProgress');
    this.#requireTask(id, 'setProgress');
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
      throw new Error(`gantt.setProgress: invalid progress (${progress}) — must be in [0, 1]`);
    }
    return this.#applyPatch(id, { progress });
  }

  duplicateTask(taskId?: TaskId): Task[] {
    this.#assertAlive('duplicateTask');

    const sourceIds =
      taskId !== undefined
        ? [this.#requireTask(taskId, 'duplicateTask').id] // throws if not found
        : this.#selectionStore.all(); // current selection, insertion order
    if (sourceIds.length === 0) return [];

    const tz = this.#calendar.timezone;
    const copies: Task[] = [];

    this.#beginTransaction();
    try {
      for (const id of sourceIds) {
        const source = this.#taskStore.get(id);
        if (!source) continue; // defensive: a task:added listener earlier in THIS loop could
        // synchronously have removed a not-yet-processed source (see #emit's synchronous
        // dispatch) — skip, mirrors the resilience #commitDeleteSelected relies on
        // removeTask() for.

        // Omit id/createdAt/updatedAt/start/end from the spread — id/timestamps are
        // store-owned (addTask mints/stamps them), start/end are explicitly recomputed below.
        const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, start: _start, end: _end, ...rest } = source;

        const sourceEnd = normalizeDate(source.end, tz);
        const durationHours =
          source.duration ?? differenceInWorkingHours(source.start, source.end, this.#calendar);
        const newEnd = addWorkingHours(sourceEnd, durationHours, this.#calendar);

        const input: TaskInput = {
          ...rest, // name, priority, parent, type, constraint, resources, notes, color, meta,
          // duration — all copied verbatim
          start: sourceEnd, // offset: begins exactly when the source ends
          end: newEnd, // preserves the source's working-hours span
          progress: 0, // always reset — overrides `rest.progress`
        };

        copies.push(this.addTask(input)); // fresh id, createdAt/updatedAt, task:added, undo op
      }
    } finally {
      this.#endTransaction(); // commits ONE history entry regardless of copies.length (0, 1, or N)
    }

    return copies;
  }

  removeTask(id: TaskId): void {
    this.#assertAlive('removeTask');
    if (!this.#taskStore.has(id)) return; // no-op, matches TaskStore.remove's own posture

    // 1. Compute the FULL set of tasks about to disappear (target + all hierarchy
    //    descendants) BEFORE mutating — TaskStore.remove() cascades internally, but
    //    doesn't report what it removed.
    const removedIds = this.#collectWithDescendants(id);

    // 1b. Snapshot the actual Task objects BEFORE mutating — needed for history (§4.1).
    const removedTasks = removedIds.map((tid) => this.#taskStore.get(tid)!);

    // 2. Snapshot every dependency link touching any of those tasks BEFORE mutating.
    const depsToRemove = new Map<DependencyId, Dependency>();
    for (const tid of removedIds) {
      for (const dep of this.#dependencyStore.of(tid)) depsToRemove.set(dep.id, dep);
    }

    // 3. Mutate.
    this.#taskStore.remove(id); // cascades descendants internally
    for (const tid of removedIds) this.#dependencyStore.removeForTask(tid);

    // 3b. Record — dependency ops before task ops (§5.2 ordering): redo() (forward) removes
    //     deps before tasks (matches this method's own emit order below); undo() (LIFO/
    //     reverse) re-adds tasks before the dependencies that reference them.
    this.#recordOps([
      ...[...depsToRemove.values()].map((dependency) => ({ kind: 'dependency-remove', dependency }) as const),
      ...removedTasks.map((task) => ({ kind: 'task-remove', task }) as const),
    ]);

    // 4. Emit — dependency:removed first (cleaning up "references" before announcing the
    //    referenced node is gone), then task:removed, deepest descendant first / target
    //    last (mirrors TaskStore.remove's own recursion order).
    for (const dep of depsToRemove.values()) this.#emit('dependency:removed', dep.id);
    for (const tid of removedIds) this.#emit('task:removed', tid);

    // 5. Prune the selection of any removed id — correctness: getSelection() must never
    //    reference a task that no longer exists (spec-selection.md §6).
    this.#pruneSelectionOfMissingTasks();

    // 6. Prune the collapse state of any removed id (spec-collapse-expand.md §0/§8) — scoped
    //    to removeTask() only (not undo()/redo()): a stale collapsed-id left dangling there is
    //    harmless since isCollapsed() re-checks children() live, but a hard prune here keeps
    //    CollapseStore.size() from growing unboundedly across add/remove churn.
    this.#pruneCollapseOfMissingTasks(removedIds);
  }

  getTask(id: TaskId): Task | undefined {
    if (this.#destroyed) return undefined;
    return this.#taskStore.get(id);
  }

  getTasks(): Task[] {
    if (this.#destroyed) return [];
    return this.#taskStore.all();
  }

  findTasks(predicate: (task: Task) => boolean): Task[] {
    if (this.#destroyed) return [];
    return this.#taskStore.find(predicate);
  }

  // --- Dependency operations --------------------------------------------------------------

  linkTasks(from: TaskId, to: TaskId, type: DependencyType = 'FS', lag?: number): Dependency {
    this.#assertAlive('linkTasks');
    // may throw — no event on throw
    const dep = this.#dependencyStore.link(from, to, type, lag === undefined ? {} : { lag });
    this.#recordOp({ kind: 'dependency-add', dependency: dep });
    this.#emit('dependency:added', dep);
    return dep;
  }

  unlinkTasks(from: TaskId, to: TaskId): void {
    this.#assertAlive('unlinkTasks');
    const matches = this.#dependencyStore.all().filter((d) => d.from === from && d.to === to);
    if (matches.length === 0) return;
    this.#dependencyStore.unlink(from, to);
    this.#recordOps(matches.map((dependency) => ({ kind: 'dependency-remove', dependency }) as const));
    for (const d of matches) this.#emit('dependency:removed', d.id);
  }

  getDependencies(): Dependency[] {
    if (this.#destroyed) return [];
    return this.#dependencyStore.all();
  }

  getDependenciesOf(taskId: TaskId): Dependency[] {
    if (this.#destroyed) return [];
    return this.#dependencyStore.of(taskId);
  }

  // --- Selection operations --------------------------------------------------------------

  select(id: TaskId | TaskId[]): void {
    this.#assertAlive('select');
    const ids = Array.isArray(id) ? id : [id];
    this.#applySelection(this.#expandWithDescendants(ids));
  }

  selectAll(): void {
    this.#assertAlive('selectAll');
    // Expansion is a no-op here (every task is already included) — deliberate
    // micro-optimization, not a semantic special case (spec-selection.md §3).
    this.#applySelection(this.#taskStore.all().map((t) => t.id));
  }

  deselect(): void {
    this.#assertAlive('deselect');
    this.#applySelection([]);
  }

  getSelection(): TaskId[] {
    if (this.#destroyed) return [];
    return this.#selectionStore.all();
  }

  // --- Hierarchy (collapse/expand) --------------------------------------------------------

  toggleCollapse(id: TaskId): void {
    this.#assertAlive('toggleCollapse');
    const task = this.#taskStore.get(id);
    if (!task || this.#taskStore.children(id).length === 0) return; // no-op: unknown id or a leaf
    const current = new Set(this.#collapseStore.all());
    if (current.has(id)) current.delete(id);
    else current.add(id);
    if (this.#collapseStore.replace([...current])) {
      this.#emit('collapse:changed', this.#collapseStore.all());
    }
  }

  isCollapsed(id: TaskId): boolean {
    // Non-throwing after `destroy()` (returns `false`), matching `getSelection()`/`canUndo()`/
    // `canRedo()` — a read-only query has nothing to corrupt, and a host app tearing down a
    // chart should not have to guard every such read.
    if (this.#destroyed) return false;
    return this.#collapseStore.has(id) && this.#taskStore.children(id).length > 0;
  }

  collapseAll(): void {
    this.#assertAlive('collapseAll');
    const withChildren = this.#taskStore
      .all()
      .filter((t) => this.#taskStore.children(t.id).length > 0)
      .map((t) => t.id);
    if (this.#collapseStore.replace(withChildren)) {
      this.#emit('collapse:changed', this.#collapseStore.all());
    }
  }

  expandAll(): void {
    this.#assertAlive('expandAll');
    if (this.#collapseStore.replace([])) {
      this.#emit('collapse:changed', this.#collapseStore.all());
    }
  }

  // --- History (undo/redo) ---------------------------------------------------------------

  undo(): boolean {
    this.#assertAlive('undo');
    const entry = this.#undoStack.pop();
    if (!entry) return false;
    for (let i = entry.ops.length - 1; i >= 0; i--) this.#undoOp(entry.ops[i]!);
    this.#redoStack.push(entry);
    if (this.#redoStack.length > this.#historyLimit) this.#redoStack.shift(); // defensive; see #commitEntry
    this.#pruneSelectionOfMissingTasks();
    this.#emitHistoryChanged();
    return true;
  }

  redo(): boolean {
    this.#assertAlive('redo');
    const entry = this.#redoStack.pop();
    if (!entry) return false;
    for (const op of entry.ops) this.#redoOp(op);
    this.#undoStack.push(entry);
    if (this.#undoStack.length > this.#historyLimit) this.#undoStack.shift(); // defensive; see #commitEntry
    this.#pruneSelectionOfMissingTasks();
    this.#emitHistoryChanged();
    return true;
  }

  canUndo(): boolean {
    if (this.#destroyed) return false;
    return this.#undoStack.length > 0;
  }

  canRedo(): boolean {
    if (this.#destroyed) return false;
    return this.#redoStack.length > 0;
  }

  // --- Viewport (zoom / view-mode) --------------------------------------------------------

  zoomTo(mode: ViewMode): void {
    this.#assertAlive('zoomTo');
    if (!ZOOM_LEVELS.includes(mode)) {
      throw new Error(
        `gantt.zoomTo: invalid view mode "${mode}" — must be one of ${ZOOM_LEVELS.join(', ')}`,
      );
    }
    if (mode === this.#viewMode.peek()) return; // no-op: no event, no render, no scroll math

    // Mutating `#viewMode` synchronously re-runs the render effect (signals.ts's push model
    // runs a subscribed EffectImpl's callback synchronously, not on a microtask), which repaints
    // at the new view mode. Single write → no batch() needed (batch() exists to coalesce
    // MULTIPLE store bumps into one flush; zoomTo() only ever performs ONE bump per call).
    const applyViewMode = (): void => {
      this.#viewMode.value = mode;
    };

    // Headless / pre-mount — ALWAYS the case when `withRender` was never applied: state only,
    // no repaint and no scroll anchoring to do. The next mount() picks the new mode up when the
    // render mixin builds its renderer options. Once mounted, the mount state supplies the
    // scroll-anchor wrapper (which needs the renderer's time scale — see `MountState`), so the
    // centered date is preserved across the zoom.
    if (this.#mount === undefined) applyViewMode();
    else this.#mount.withScrollAnchor(applyViewMode);

    this.#emit('viewport:changed', { viewMode: mode });
  }

  zoomIn(): void {
    this.#assertAlive('zoomIn');
    const idx = ZOOM_LEVELS.indexOf(this.#viewMode.peek());
    // Boundary (already 'day', idx === 0) → same index → zoomTo() itself no-ops; no
    // duplicate boundary-check logic here.
    this.zoomTo(ZOOM_LEVELS[Math.max(0, idx - 1)]!);
  }

  zoomOut(): void {
    this.#assertAlive('zoomOut');
    const idx = ZOOM_LEVELS.indexOf(this.#viewMode.peek());
    this.zoomTo(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, idx + 1)]!);
  }

  getViewMode(): ViewMode {
    return this.#viewMode.peek();
  }

  // --- Computation ---------------------------------------------------------------------------

  computeCriticalPath(): CriticalPathResult {
    this.#assertAlive('computeCriticalPath');
    const tasks = this.#taskStore.all();
    if (tasks.length === 0) {
      throw new Error('gantt.computeCriticalPath: no tasks — add at least one task first');
    }
    // May throw CyclicDependencyError — propagated, not swallowed.
    const result = computeCriticalPathFn(tasks, this.#dependencyStore.all(), this.#calendar);
    // Explicit call → always emit; also record so the render effect won't immediately
    // re-emit the identical set.
    this.#lastCriticalIds = result.criticalTaskIds;
    this.#emit('critical-path:computed', result.criticalTaskIds);
    return result;
  }

  // --- Events ----------------------------------------------------------------------------------

  on<E extends GanttEventName>(event: E, callback: (...args: GanttEventMap[E]) => void): UnsubscribeFn {
    if (this.#destroyed) return () => {}; // nothing will ever fire again — true no-op
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(callback as never);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return; // idempotent
      unsubscribed = true;
      set!.delete(callback as never);
    };
  }

  // --- Lifecycle ---------------------------------------------------------------------------------
  //
  // `mount()`/`unmount()`/`refresh()` are NOT here — they live on the opt-in `withRender` mixin
  // (`@fluxgantt/core/render`, spec-facade-split.md §3.3), so a headless consumer is never billed
  // for the renderer's bytes. `destroy()` stays on the base because an instance must be
  // releasable whether or not a render layer was ever attached; it tears down a live mount
  // through `#teardownMount()`, which is renderer-agnostic (it only calls disposers the render
  // mixin stored).

  destroy(): void {
    if (this.#destroyed) return; // idempotent
    this.#mountGeneration++; // invalidate any in-flight async Canvas attempt, same as unmount()
    this.#teardownMount();
    this.#listeners.clear();
    this.#destroyed = true;
  }


  // --- Private: mutation → split-event pipeline (Q3 + Q6) ---------------------------------

  #applyPatch(id: TaskId, patch: TaskPatch): Task {
    const prev = this.#taskStore.get(id)!; // caller already asserted existence
    const next = this.#taskStore.update(id, patch);
    this.#recordOp({ kind: 'task-update', id, prev, next });
    this.#diffAndEmit(prev, next);
    this.#config.onTaskChange?.(next, prev);
    return next;
  }

  /**
   * Shared commit path for every schedule-affecting mutation (direct write + its optional
   * cascade). The ONLY call site of #beginTransaction/#endTransaction for the "cascade-shift
   * grouping" half of the transaction primitive — moveTask/resizeTask/updateTask/#commitDrag
   * all route through this one helper instead of each opening their own transaction, so a
   * drag/API call that cascades N successors collapses into ONE history entry via ONE
   * begin/end pair, not four independent ones.
   */
  #commitScheduleChange(id: TaskId, patch: TaskPatch, cascade: boolean): Task {
    this.#beginTransaction();
    try {
      const next = this.#applyPatch(id, patch);
      if (cascade) this.#maybeCascade(id);
      return next;
    } finally {
      this.#endTransaction();
    }
  }

  /**
   * Apply one cascade shift. A cascade shift is DEFINITIONALLY a pure move — `computeCascade`
   * preserves the task's working-hours duration (`end = addWorkingHours(start, duration)`) and
   * never touches progress — so it must emit ONLY `task:moved`, never `task:resized`. It can't
   * go through `#diffAndEmit`, whose resize detection is INSTANT-span based (end − start ns):
   * a shift whose new position straddles a different number of weekends/holidays than the old
   * one changes the instant span while preserving the working-hours duration, which would make
   * `#diffAndEmit` fire a spurious `task:resized` on what is logically a move (review finding).
   * `onTaskChange` still fires (it is a change).
   */
  #applyCascadeShift(id: TaskId, start: DateInput, end: DateInput): void {
    const prev = this.#taskStore.get(id)!; // cascade only names tasks that exist
    const next = this.#taskStore.update(id, { start, end });
    this.#recordOp({ kind: 'task-update', id, prev, next });
    if (!this.#sameInstant(prev.start, next.start, this.#calendar.timezone)) {
      this.#emit('task:moved', next, prev.start);
    }
    this.#config.onTaskChange?.(next, prev);
  }

  #diffAndEmit(prev: Task, next: Task, source?: 'undo' | 'redo'): void {
    const tz = this.#calendar.timezone;
    const meta = source ? ([{ source }] as const) : ([] as const);
    if (!this.#sameInstant(prev.start, next.start, tz)) {
      this.#emit('task:moved', next, prev.start, ...meta);
    }
    // Detect a resize by the INSTANT span (end − start) changing — translation-invariant,
    // so a pure move (start+end shifted by the same delta) is never mistaken for a resize,
    // and it matches the rendered bar whose width is dateToX(end) − dateToX(start). (Using
    // working-hours effectiveDuration here would fire a spurious task:resized on a move that
    // shifts the span across weekends/holidays.) The payload still reports working-hours
    // duration via `effectiveDuration`.
    if (this.#spanNs(prev, tz) !== this.#spanNs(next, tz)) {
      this.#emit('task:resized', next, this.#effectiveDuration(prev), ...meta);
    }
    if (prev.progress !== next.progress) {
      this.#emit('task:progressed', next, prev.progress, ...meta);
    }
  }

  /** Working-hours duration — explicit `Task.duration` if set, else derived from the
   *  start/end span via the calendar. Used only for the `task:resized` payload, NOT to
   *  detect whether a resize happened (see `#diffAndEmit` / `#spanNs`). */
  #effectiveDuration(task: Task): number {
    return task.duration ?? differenceInWorkingHours(task.start, task.end, this.#calendar);
  }

  /** Instant span (end − start) in nanoseconds — translation-invariant, so a move (both
   *  ends shifted by the same delta) preserves it. */
  #spanNs(task: Task, timezone: string): bigint {
    return normalizeDate(task.end, timezone).epochNanoseconds - normalizeDate(task.start, timezone).epochNanoseconds;
  }

  #sameInstant(a: DateInput, b: DateInput, timezone: string): boolean {
    return normalizeDate(a, timezone).epochNanoseconds === normalizeDate(b, timezone).epochNanoseconds;
  }

  /** True when `next` equals the last-emitted critical set element-wise. `criticalTaskIds`
   *  order follows the (stable) input-task order, so an element-wise compare is valid. */
  #sameCriticalIds(next: readonly TaskId[]): boolean {
    const prev = this.#lastCriticalIds;
    if (prev === undefined || prev.length !== next.length) return false;
    for (let i = 0; i < next.length; i++) {
      if (prev[i] !== next[i]) return false;
    }
    return true;
  }

  // --- Private: history (undo/redo) --------------------------------------------------------

  /** Record a single op (single low-level write — `addTask`, `linkTasks`, one `#applyPatch`
   *  call, one `#applyCascadeShift` call). Convenience wrapper over `#recordOps`. */
  #recordOp(op: HistoryOp): void {
    this.#recordOps([op]);
  }

  /** Record a batch of ops that must land in ONE entry, atomically, even outside an explicit
   *  transaction (used by `removeTask`, which naturally produces N ops — one per removed
   *  dependency, one per removed hierarchy descendant — from a single call). If called while a
   *  transaction is open (`#pendingOps` set), appends to the pending buffer instead of
   *  committing its own entry. */
  #recordOps(ops: readonly HistoryOp[]): void {
    if (ops.length === 0) return;
    if (this.#pendingOps) {
      this.#pendingOps.push(...ops);
      return;
    }
    this.#commitEntry({ ops });
  }

  #commitEntry(entry: HistoryEntry): void {
    this.#undoStack.push(entry);
    if (this.#undoStack.length > this.#historyLimit) this.#undoStack.shift(); // ring-buffer eviction, oldest first
    if (this.#redoStack.length > 0) this.#redoStack.length = 0; // new mutation clears redo
    this.#emitHistoryChanged();
  }

  #emitHistoryChanged(): void {
    this.#emit('history:changed', { canUndo: this.#undoStack.length > 0, canRedo: this.#redoStack.length > 0 });
  }

  #beginTransaction(): void {
    if (this.#transactionDepth === 0) this.#pendingOps = [];
    this.#transactionDepth++;
  }

  #endTransaction(): void {
    this.#transactionDepth = Math.max(0, this.#transactionDepth - 1); // defensive floor, never throws on imbalance
    if (this.#transactionDepth === 0) {
      const ops = this.#pendingOps ?? [];
      this.#pendingOps = undefined;
      if (ops.length > 0) this.#commitEntry({ ops });
    }
  }

  #undoOp(op: HistoryOp): void {
    switch (op.kind) {
      case 'task-add':
        this.#taskStore.remove(op.task.id);
        this.#emit('task:removed', op.task.id, { source: 'undo' });
        break;
      case 'task-update':
        this.#taskStore.restore(op.prev);
        this.#diffAndEmit(op.next, op.prev, 'undo'); // "before" = current (op.next), "after" = target (op.prev)
        this.#config.onTaskChange?.(op.prev, op.next);
        break;
      case 'task-remove':
        this.#taskStore.restore(op.task);
        this.#emit('task:added', op.task, { source: 'undo' });
        break;
      case 'dependency-add':
        this.#dependencyStore.remove(op.dependency.id);
        this.#emit('dependency:removed', op.dependency.id, { source: 'undo' });
        break;
      case 'dependency-remove':
        this.#dependencyStore.restore(op.dependency);
        this.#emit('dependency:added', op.dependency, { source: 'undo' });
        break;
    }
  }

  #redoOp(op: HistoryOp): void {
    switch (op.kind) {
      case 'task-add':
        this.#taskStore.restore(op.task);
        this.#emit('task:added', op.task, { source: 'redo' });
        break;
      case 'task-update':
        this.#taskStore.restore(op.next);
        this.#diffAndEmit(op.prev, op.next, 'redo');
        this.#config.onTaskChange?.(op.next, op.prev);
        break;
      case 'task-remove':
        this.#taskStore.remove(op.task.id);
        this.#emit('task:removed', op.task.id, { source: 'redo' });
        break;
      case 'dependency-add':
        this.#dependencyStore.restore(op.dependency);
        this.#emit('dependency:added', op.dependency, { source: 'redo' });
        break;
      case 'dependency-remove':
        this.#dependencyStore.remove(op.dependency.id);
        this.#emit('dependency:removed', op.dependency.id, { source: 'redo' });
        break;
    }
  }

  /** Selection hygiene: `undo()`/`redo()` can remove a task from the store (undoing an
   *  `addTask`, or redoing a `removeTask`) WITHOUT going through the public `removeTask()`
   *  method, which is the only place that otherwise prunes `SelectionStore` of now-dangling
   *  ids. Shared by `removeTask` and `undo()`/`redo()` so the filter logic isn't duplicated. */
  #pruneSelectionOfMissingTasks(): void {
    const current = this.#selectionStore.all();
    const pruned = current.filter((id) => this.#taskStore.has(id));
    if (pruned.length !== current.length) this.#applySelection(pruned);
  }

  /** Collapse-state hygiene (spec-collapse-expand.md §0/§8): called by `removeTask()` with the
   *  full set of ids that just disappeared (target + cascaded descendants) so `CollapseStore`
   *  doesn't accumulate dangling ids across add/remove churn. Deliberately scoped to
   *  `removeTask()` only, NOT `undo()`/`redo()` — unlike selection, a stale collapsed-id is
   *  harmless (`isCollapsed()` re-checks `children()` live) so there is no correctness
   *  requirement to prune it on every store mutation path. */
  #pruneCollapseOfMissingTasks(removedIds: readonly TaskId[]): void {
    let changed = false;
    for (const id of removedIds) {
      if (this.#collapseStore.delete(id)) changed = true;
    }
    if (changed) this.#emit('collapse:changed', this.#collapseStore.all());
  }

  #collectWithDescendants(id: TaskId): TaskId[] {
    const out: TaskId[] = [];
    const visit = (tid: TaskId): void => {
      for (const child of this.#taskStore.children(tid)) visit(child.id);
      out.push(tid);
    };
    visit(id);
    return out;
  }

  /**
   * Expands explicitly-named ids to include every descendant (recursive, all levels) of any
   * task among them — parent-implies-children selection semantics (spec-selection.md §3).
   * Reuses `#collectWithDescendants` (already the single source of truth for "walk the
   * hierarchy down", currently used by `removeTask`'s cascade) rather than a second traversal.
   * Ids that don't resolve in `#taskStore` are silently dropped (resilience posture, §4).
   */
  #expandWithDescendants(ids: readonly TaskId[]): TaskId[] {
    const out = new Set<TaskId>();
    for (const id of ids) {
      if (!this.#taskStore.has(id)) continue;
      for (const t of this.#collectWithDescendants(id)) out.add(t);
    }
    return [...out];
  }

  // --- Private: event bus -----------------------------------------------------------------

  #emit<E extends GanttEventName>(event: E, ...args: GanttEventMap[E]): void {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return;
    // Snapshot before iterating: a listener added DURING this emit is not called until the
    // NEXT emit; a listener that unsubscribes itself mid-emit still finishes this pass.
    for (const cb of [...set]) {
      try {
        (cb as unknown as (...a: GanttEventMap[E]) => void)(...args);
      } catch (err) {
        // One throwing subscriber must not break the others OR the mutation that
        // triggered the emit — the mutation already fully committed to the store before
        // #emit was ever called.
        console.error(`@fluxgantt/core: on('${event}') listener threw`, err);
      }
    }
  }

  // --- Private: selection ------------------------------------------------------------------
  //
  // The gesture commit points (`commitDrag`/`commitResize`/`commitCreateDep`/`commitSelect`/...)
  // are NOT here — they moved to the opt-in `withInteraction` mixin
  // (`@fluxgantt/core/interaction`, spec-facade-split.md §3.3), which reaches the primitives
  // below through `GanttInternal`.

  #applySelection(ids: readonly TaskId[]): void {
    const changed = this.#selectionStore.replace(ids);
    if (changed) this.#emit('selection:changed', this.#selectionStore.all());
  }

  /**
   * No-op unless `schedulingMode: 'auto'` (default `'manual'` — see `GanttConfig`, spec-
   * cascade.md §4.1/§4.3). Recomputes `computeCascade` over the CURRENT store state (which
   * already reflects `changedId`'s new position, since the caller always applies the direct
   * mutation via `#applyPatch` BEFORE calling this) and applies each resulting shift through
   * `#applyCascadeShift`, which emits `task:moved(task, prevStart)` for every shifted task (in
   * the topological order `computeCascade` resolved) — but NOT `task:resized`, since a cascade
   * shift preserves the task's working-hours duration (a pure move; see `#applyCascadeShift`).
   * `computeCascade` already resolves the full transitive closure in one pass, so applying each
   * shift needs no re-entrancy guard.
   *
   * May throw `CyclicDependencyError` (only reachable via `DependencyStore.link(...,
   * { allowCycle: true })` used directly — `linkTasks` already rejects cycles at
   * edge-creation time) — propagated, not swallowed, same explicit-call posture as
   * `computeCriticalPath()`. The direct mutation that triggered this call has already
   * committed and emitted its own event by the time such a throw happens (partial
   * application — the mover is never rolled back).
   */
  #maybeCascade(changedId: TaskId): void {
    if (this.#config.schedulingMode !== 'auto') return;
    const result = computeCascade(this.#taskStore.all(), this.#dependencyStore.all(), this.#calendar, [changedId]);
    for (const shift of result.shifts) {
      // Cascade shifts are pure moves (duration preserved) → emit only `task:moved`, never a
      // spurious `task:resized` from an instant-span change across weekends (review finding).
      this.#applyCascadeShift(shift.taskId, shift.start, shift.end);
    }
  }

  /**
   * Renderer-agnostic mount teardown. Stays on the base class (rather than in `render/mixin.ts`)
   * so `destroy()` can release a live mount without the base bundle depending on the render
   * layer — every call here goes through a disposer the render mixin itself stored.
   *
   * Order matters (the shared pointer-drag coordinator wraps `handle.destroy`):
   *  1. Stop the reactive effect FIRST — no render call may start once teardown begins.
   *  2. Dispose the interaction modules (a no-op unless `withInteraction` was applied) — see
   *     `interaction/mixin.ts` for the ordering constraints among them.
   *  3. Remove the rendered DOM.
   */
  #teardownMount(): void {
    const m = this.#mount;
    if (!m) return; // never mounted / already unmounted / headless
    m.disposeEffect();
    m.disposeInteractions();
    m.rendererHandle.destroy();
    this.#mount = undefined;
  }

  // --- Private: guards ---------------------------------------------------------------------

  #requireTask(id: TaskId, method: string): Task {
    const task = this.#taskStore.get(id);
    if (!task) throw new Error(`gantt.${method}: task "${id}" not found`);
    return task;
  }

  #assertAlive(method: string): void {
    if (this.#destroyed) {
      throw new Error(`@fluxgantt/core: cannot call ${method} — this gantt instance destroyed`);
    }
  }

  /**
   * Guard for `exportSvg`/`exportPng` (spec-export-png-svg.md §1.1) — covers "never mounted",
   * "unmounted", AND "destroyed" with one check: `destroy()` always tears down `#mount` (via
   * `#teardownMount()`) before setting `#destroyed = true`, so `!this.#mount` is already the
   * correct single condition; no separate `#assertAlive` call is needed alongside it.
   */
  #assertMounted(method: string): SvgRendererHandle | CanvasRendererHandle {
    if (!this.#mount) {
      throw new Error(
        `@fluxgantt/core: cannot call ${method} — gantt instance is not mounted (call mount() first)`,
      );
    }
    return this.#mount.rendererHandle;
  }

  /**
   * SVG-only guard for `exportSvg()`/`exportPng()` (spec-canvas-auto-switch.md §7) — both
   * methods read `handle.svg`, which does not exist on `CanvasRendererHandle`. Reuses
   * `#assertMounted()`'s existing "not mounted" check, then additionally rejects a live
   * Canvas-mode mount with a clear, actionable error instead of a confusing
   * `undefined`/type error at the call site. Canvas-mode export is out of scope for v1 (see
   * `CanvasRendererHandle`'s own scope notes).
   */
  #assertMountedSvg(method: string): SvgRendererHandle {
    const handle = this.#assertMounted(method);
    if (this.#mount!.renderer !== 'svg') {
      throw new Error(
        `@fluxgantt/core: ${method} is not available while mounted in Canvas-rendering mode ` +
          `(task count ${this.#taskStore.size} exceeded the Canvas auto-switch threshold at ` +
          `mount() time). Canvas-mode export is not implemented yet.`,
      );
    }
    return handle as SvgRendererHandle;
  }
}

export function createGantt(config: GanttConfig): GanttInstance {
  return new Gantt(config);
}
