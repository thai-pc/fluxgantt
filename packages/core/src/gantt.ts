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
import type { Temporal } from '@js-temporal/polyfill';
import { effect, batch } from './signals.js';
import { TaskStore, DependencyStore, DependencyLinkError, SelectionStore } from './store/index.js';
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
import { createSvgRenderer } from './render/svg-renderer.js';
import type { SvgRendererHandle, SvgRendererInput, SvgRendererOptions } from './render/svg-renderer.js';
import { layoutRows } from './render/renderer-base.js';
import { enableDragMove } from './interaction/drag-move.js';
import { enableDragResize } from './interaction/drag-resize.js';
import { enableDragCreateDep } from './interaction/drag-create-dep.js';
import { enableClickSelect } from './interaction/selection.js';
import { enableKeyboardNav } from './interaction/keyboard-nav.js';
import {
  exportJson as exportJsonFn,
  exportCsv as exportCsvFn,
  exportSvg as exportSvgFn,
  exportPng as exportPngFn,
  importJson as importJsonFn,
  importCsv as importCsvFn,
} from './io/index.js';
import type {
  ExportBundle,
  ExportCsvOptions,
  ExportJsonOptions,
  ExportPngOptions,
  ExportSvgOptions,
  ImportJsonOptions,
  ImportCsvOptions,
} from './io/index.js';
import type {
  CriticalPathResult,
  DateInput,
  Density,
  Dependency,
  DependencyId,
  DependencyType,
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

  // --- Computation -------------------------------------------------------------------------
  computeCriticalPath(): CriticalPathResult;

  // --- IO (export + import, spec §7.8, security.md §2) -------------------------------------
  /** Thin delegation over `getTasks()`/`getDependencies()` + the pure `exportJson()`
   *  function — same post-`destroy()` posture as those two getters (returns an
   *  empty-but-valid bundle rather than throwing; see spec-io-json-csv.md §1.2). Defaults
   *  `options.timezone` to the instance's own calendar timezone, not `'UTC'`. */
  exportJson(options?: ExportJsonOptions): ExportBundle;
  /** Thin delegation over `getTasks()` + the pure `exportCsv()` function. Same posture as
   *  `exportJson()` above. */
  exportCsv(options?: ExportCsvOptions): string;

  /**
   * Validates `data` via the pure `importJson()` function, then wholesale-REPLACES the
   * entire live task/dependency set — equivalent to what `createGantt({ tasks, dependencies })`
   * would have produced from the same data (NOT a merge/append). Concretely, on success:
   *  1. Clears BOTH `#undoStack` and `#redoStack` — prior entries reference a pre-import state
   *     that may no longer exist post-replace. The import itself is NOT recorded as an
   *     undoable op — same precedent as construction-time `config.tasks`/`config.dependencies`
   *     seeding.
   *  2. Clears the current selection, equivalent to `deselect()`.
   *  3. Emits exactly ONE `data:imported` event — never per-item `task:added`/
   *     `dependency:added`.
   *  4. Triggers exactly one repaint of a mounted chart (batched), via the same
   *     store-`revision`-driven reactive effect every other mutation uses.
   *
   * NOT gated by `readOnly` (matches every other programmatic mutation method).
   *
   * ATOMIC against the live instance: the complete replacement dataset is validated and
   * staged BEFORE any live store is touched. A rejected import — an invalid schema (rejected
   * by the pure `importJson()` itself) OR a cyclic dependency set (which the pure
   * `importJson()` deliberately does NOT detect — see `io/json.ts`'s own note — and only
   * surfaces when the staged data is linked) — leaves the live instance's tasks,
   * dependencies, undo/redo history, and selection completely UNCHANGED, and does not fire
   * `data:imported`.
   *
   * Throws if the instance is destroyed (`#assertAlive`, same posture as every other
   * mutating method).
   *
   * `options` is passed straight through to the pure `importJson()` — no facade-level
   * default injected (unlike `exportJson`'s `timezone` default: `ImportJsonOptions` has no
   * `timezone` field to default, only `limits`).
   */
  importJson(data: string | object, options?: ImportJsonOptions): ImportSummary;

  /**
   * Same contract as `importJson()` above, for CSV. CSV has no dependency concept
   * (`io/csv.ts`'s own header comment: "Tasks-only, flat scalar columns... dependencies are
   * NOT representable in CSV at all") — `dependencyCount` is always `0` in the returned/
   * emitted summary, and any dependency the live instance held before the call is cleared
   * along with the task set (wholesale replace is dataset-wide, not tasks-only — importing a
   * tasks-only CSV still wipes pre-existing dependencies, matching what
   * `createGantt({ tasks })` with no `dependencies` key would produce).
   */
  importCsv(csv: string, options?: ImportCsvOptions): ImportSummary;

  /**
   * Serializes the currently-mounted SVG to a self-contained string (XML declaration,
   * explicit xmlns, resolved computed styles baked in, no interactive-only chrome).
   * Throws if the instance was never mounted, or has been unmounted/destroyed — unlike
   * exportJson/exportCsv, there is no sensible empty-but-valid result to fall back to.
   */
  exportSvg(options?: ExportSvgOptions): string;

  /**
   * Rasterizes the currently-mounted chart to a PNG. Internally calls exportSvg() to get a
   * baked/sanitized SVG string, then draws it onto a canvas. Async because it waits for the
   * browser to decode the SVG image before it can rasterize. Same throw-if-not-mounted
   * posture as exportSvg(), but delivered as a REJECTED promise, not a synchronous throw
   * (implemented as an `async function` specifically so this holds for every validation
   * error, not just the DOM-not-ready one).
   */
  exportPng(options?: ExportPngOptions): Promise<Blob>;

  // --- Events --------------------------------------------------------------------------------
  on<E extends GanttEventName>(
    event: E,
    callback: (...args: GanttEventMap[E]) => void,
  ): UnsubscribeFn;

  // --- Lifecycle -------------------------------------------------------------------------------
  mount(container: HTMLElement): void;
  unmount(): void;
  destroy(): void;
  refresh(): void;
}

// --- Internal ------------------------------------------------------------------------------

interface MountState {
  readonly rendererHandle: SvgRendererHandle;
  readonly dragMoveDispose: () => void;
  readonly dragResizeDispose: () => void;
  readonly dragCreateDepDispose: () => void;
  readonly clickSelectDispose: () => void;
  readonly keyboardNavDispose: () => void;
  readonly getFocusedTaskId: () => TaskId | undefined;
  readonly disposeEffect: () => void;
}

/** Fixed window used as the renderer's `timeRange` fallback whenever the task count is 0
 *  (item B) — otherwise `createSvgRenderer`'s internal `deriveTimeRange()` throws on an
 *  empty `tasks` array. Not exported — an internal `gantt.ts`-only concern; `render/` is
 *  not modified for this. */
const EMPTY_STATE_WINDOW_DAYS = 14;

/** Default `GanttConfig.historyLimit` — see its doc-comment. */
const DEFAULT_HISTORY_LIMIT = 100;

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
  readonly #calendar: WorkingCalendar;
  readonly #config: GanttConfig;
  readonly #listeners = new Map<GanttEventName, Set<(...args: never[]) => void>>();
  #mount: MountState | undefined; // undefined = headless
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

  constructor(config: GanttConfig) {
    this.#config = config;
    this.#calendar = config.calendar ?? DEFAULT_CALENDAR;
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

  // --- IO (read-only export) --------------------------------------------------------------

  exportJson(options?: ExportJsonOptions): ExportBundle {
    // No #assertAlive here — deliberately mirrors getTasks()/getDependencies()'s own
    // post-destroy() posture (returns an empty-but-valid result rather than throwing), since
    // this is a thin read-only delegation over exactly those two getters (spec §1.2).
    return exportJsonFn(this.getTasks(), this.getDependencies(), {
      timezone: this.#calendar.timezone,
      ...options,
    });
  }

  exportCsv(options?: ExportCsvOptions): string {
    return exportCsvFn(this.getTasks(), { timezone: this.#calendar.timezone, ...options });
  }

  importJson(data: string | object, options?: ImportJsonOptions): ImportSummary {
    this.#assertAlive('importJson');
    const { tasks, dependencies } = importJsonFn(data, options); // may throw IoValidationError
    return this.#commitImport(tasks, dependencies, 'json');
  }

  importCsv(csv: string, options?: ImportCsvOptions): ImportSummary {
    this.#assertAlive('importCsv');
    const { tasks } = importCsvFn(csv, options); // may throw IoValidationError
    return this.#commitImport(tasks, [], 'csv');
  }

  exportSvg(options?: ExportSvgOptions): string {
    const handle = this.#assertMounted('exportSvg');
    return exportSvgFn(handle.svg, options);
  }

  async exportPng(options?: ExportPngOptions): Promise<Blob> {
    const handle = this.#assertMounted('exportPng');
    return exportPngFn(handle.svg, options);
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

  mount(container: HTMLElement): void {
    if (this.#destroyed) return; // safe no-op
    if (this.#mount) this.#teardownMount(); // implicit remount if already mounted (item A)

    const rendererHandle = createSvgRenderer(container, this.#renderInput(), this.#rendererOptions());

    let dragMoveDispose: () => void = () => {};
    let dragResizeDispose: () => void = () => {};
    let dragCreateDepDispose: () => void = () => {};
    if (!this.#config.readOnly) {
      // Registration order is irrelevant to priority (pointer-drag.ts uses an explicit
      // numeric priority, not call order) — all three wire through the SAME coordinator on
      // `rendererHandle`, so a handle claim always wins over an edge-zone claim, which
      // always wins over a whole-bar claim.
      dragResizeDispose = enableDragResize(rendererHandle, () => this.#taskStore.all(), {
        onTaskResized: (taskId, newEnd) => this.#commitResize(taskId, newEnd),
      });
      dragMoveDispose = enableDragMove(rendererHandle, () => this.#taskStore.all(), {
        onTaskMoved: (taskId, newStart, newEnd) => this.#commitDrag(taskId, newStart, newEnd),
      });
      dragCreateDepDispose = enableDragCreateDep(rendererHandle, () => this.#taskStore.all(), {
        onDependencyCreated: (fromTaskId, toTaskId) => this.#commitCreateDep(fromTaskId, toTaskId),
      });
    }
    // Selection is NOT gated by readOnly (confirmed): readOnly disables drag-move/drag-resize/
    // drag-create-dep, not click-select (spec-selection.md §5.5).
    const clickSelectDispose = enableClickSelect(rendererHandle, () => this.#taskStore.all(), {
      onSelect: (taskId) => this.#commitSelect(taskId),
      onToggle: (taskId) => this.#commitToggleSelect(taskId),
      onRangeSelect: (ids) => this.#commitRangeSelect(ids),
      onClear: () => this.#commitClearSelection(),
    });
    // Registered UNCONDITIONALLY (spec-keyboard-nav.md §6.2), same group as
    // enableClickSelect above, NOT gated by readOnly — Arrow/Space/Shift+Arrow/Tab-entry are
    // all non-mutating and must stay active even in a readOnly chart; only the Delete/
    // Backspace action and the Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z undo/redo keybindings are
    // themselves gated (via `isReadOnly` below AND, for Delete, defense-in-depth inside
    // #commitDeleteSelected — undo()/redo() need no equivalent second gate, see
    // spec-undo-redo-keybinding.md §4).
    const keyboardNav = enableKeyboardNav(rendererHandle, {
      onSelect: (id) => this.#commitSelect(id),
      onToggle: (id) => this.#commitToggleSelect(id),
      onRangeSelect: (anchorId, focusId) => this.#commitKeyboardRangeSelect(anchorId, focusId),
      onDeleteSelected: () => this.#commitDeleteSelected(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      getTasks: () => this.#taskStore.all(),
      density: this.#config.density ?? 'default',
      isReadOnly: () => this.#config.readOnly === true,
      getSelection: () => this.#selectionStore.all(),
    });
    // `keyboardNav.getFocusedTaskId` is captured directly from this closure (NOT read via
    // `this.#mount.getFocusedTaskId`) because `effect()` runs its callback synchronously,
    // immediately, on this very call — BEFORE `this.#mount` is assigned below. Reading
    // through `this.#mount` here would throw/crash on this first synchronous run.
    const disposeEffect = effect(() => this.#renderNow(rendererHandle, keyboardNav.getFocusedTaskId));

    this.#mount = {
      rendererHandle,
      dragMoveDispose,
      dragResizeDispose,
      dragCreateDepDispose,
      clickSelectDispose,
      keyboardNavDispose: keyboardNav.dispose,
      getFocusedTaskId: keyboardNav.getFocusedTaskId,
      disposeEffect,
    };
  }

  unmount(): void {
    if (this.#destroyed) return;
    if (!this.#mount) return; // no-op if never mounted / already unmounted
    this.#teardownMount();
  }

  destroy(): void {
    if (this.#destroyed) return; // idempotent
    if (this.#mount) this.#teardownMount();
    this.#listeners.clear();
    this.#destroyed = true;
  }

  refresh(): void {
    if (this.#destroyed || !this.#mount) return; // nothing to refresh headless or post-destroy
    this.#renderNow(this.#mount.rendererHandle, this.#mount.getFocusedTaskId);
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

  // --- Private: mount/unmount/render -----------------------------------------------------

  #commitDrag(taskId: TaskId, newStart: Temporal.ZonedDateTime, newEnd: Temporal.ZonedDateTime): void {
    if (!this.#taskStore.has(taskId)) return; // task removed mid-drag (race) — nothing to commit
    // Reuses the SAME #commitScheduleChange pipeline as moveTask/updateTask — guarantees the
    // exact same task:moved(task, prevStart) contract, not a separate ad hoc emit, AND groups
    // the direct move + any cascade shifts into ONE history entry. start+end always shift by
    // the identical instant delta (drag-move's own contract), so the instant span (end −
    // start) is preserved → #diffAndEmit never fires task:resized from a drag.
    this.#commitScheduleChange(taskId, { start: newStart, end: newEnd }, true);
  }

  #commitResize(taskId: TaskId, newEnd: Temporal.ZonedDateTime): void {
    const task = this.#taskStore.get(taskId);
    if (!task) return; // task removed mid-resize (race) — nothing to commit, mirrors #commitDrag
    const tz = this.#calendar.timezone;
    const startNs = normalizeDate(task.start, tz).epochNanoseconds;
    const endNs = normalizeDate(task.end, tz).epochNanoseconds;
    const newEndNs = newEnd.epochNanoseconds;
    // Guard the working-hours round-trip against a mid-gesture race and a no-op commit before
    // reaching resizeTask (review A4/C3):
    //  - newEnd at/before the task's CURRENT start (its start advanced past the gesture's
    //    captured origin via a host/cascade mutation while the pointer was held) →
    //    differenceInWorkingHours would be negative and resizeTask would THROW, and onCommit
    //    runs inside the window `pointerup` handler with no catch. Skip.
    //  - newEnd equal to the current end (day-delta snapped to 0) → a true no-op; recomputing
    //    the duration would overwrite an explicit task.duration and emit a phantom
    //    task:resized for a gesture that changed nothing. Skip.
    if (newEndNs <= startNs || newEndNs === endNs) return;
    const newDuration = differenceInWorkingHours(task.start, newEnd, this.#calendar);
    // Reuses the EXISTING resizeTask() pipeline in full: validates newDuration >= 0/finite,
    // writes end+duration via #applyPatch (→ #diffAndEmit, which correctly fires
    // task:resized here because a real resize changes the instant span — unlike drag-move's
    // #commitDrag, no special same-span handling is needed), and calls #maybeCascade. No new
    // facade method (resolution #7).
    this.resizeTask(taskId, newDuration);
  }

  /**
   * Commit point for a drag-created dependency (spec-drag-create-dependency.md §2, decision
   * 2 — silent revert). Reuses the PUBLIC `linkTasks()` in full (same validation, same
   * `dependency:added` event on success) — no bypass of `DependencyStore.link`'s existing
   * self-link/duplicate-pair/cycle checks.
   *
   * MUST catch: `pointer-drag.ts`'s `onPointerUp` calls `recognizer.onCommit(...)` with NO
   * surrounding try/catch (unlike `#emit`, which wraps each listener). A `linkTasks()` throw
   * reaching this call site uncaught would escape into the `window` `pointerup` listener,
   * i.e. out of the whole gesture pipeline — visibly breaking the page. This is the ONE
   * place in the whole feature that MUST NOT let `DependencyStore.link`'s throw propagate.
   */
  #commitCreateDep(fromTaskId: TaskId, toTaskId: TaskId): void {
    if (!this.#taskStore.has(fromTaskId) || !this.#taskStore.has(toTaskId)) return; // race: a task removed mid-drag
    try {
      this.linkTasks(fromTaskId, toTaskId, 'FS'); // emits dependency:added on success
    } catch (err) {
      // Swallow ONLY the expected validation rejections — self-link (defense-in-depth; the
      // recognizer already filters this out) / duplicate-pair / cycle, all raised as
      // DependencyLinkError. Silent revert (decision 2): no event, no rethrow, no new
      // dependency:rejected event in v1. A NON-validation throw (a real bug, e.g. a
      // #assertAlive race or a future store regression) is rethrown rather than hidden — a
      // bare `catch {}` here would mask genuine defects as ordinary rejected drops.
      if (err instanceof DependencyLinkError) return;
      throw err;
    }
  }

  #commitSelect(taskId: TaskId): void {
    this.#applySelection(this.#expandWithDescendants([taskId]));
  }

  #commitToggleSelect(taskId: TaskId): void {
    if (!this.#taskStore.has(taskId)) return; // race: task removed mid-click
    const group = new Set(this.#expandWithDescendants([taskId]));
    const current = new Set(this.#selectionStore.all());
    const isSelected = current.has(taskId); // the group's own representative id
    if (isSelected) for (const g of group) current.delete(g);
    else for (const g of group) current.add(g);
    this.#applySelection([...current]);
  }

  #commitRangeSelect(rawIds: readonly TaskId[]): void {
    this.#applySelection(this.#expandWithDescendants(rawIds));
  }

  /**
   * Shift+Arrow's range-select commit point (spec-keyboard-nav.md §4.4/§6.2). NOTE — a
   * deviation from the spec's §6.2 prose, flagged explicitly: the spec claims
   * `#commitRangeSelect` "already exists ... and takes an (anchorId, focusId) pair, walking
   * layoutRows() between them", but the actual, pre-existing `#commitRangeSelect` (used by
   * Shift+click via `selection.ts`) takes a raw ID ARRAY already computed by the caller
   * (`selection.ts`'s own `collectRowRange` walks the rendered DOM) — it does not compute a
   * range itself. Rather than change that method's signature (which would also change
   * Shift+click's contract), this small adapter computes the inclusive row range via
   * `layoutRows()` (the same source of truth `enableKeyboardNav` itself used to resolve
   * `anchorId`/`focusId`) and delegates to the existing `#commitRangeSelect(ids)`, giving
   * Shift+Arrow the exact same semantics as Shift+click (resolution #1) without touching
   * `selection.ts` or its own commit path.
   */
  #commitKeyboardRangeSelect(anchorId: TaskId, focusId: TaskId): void {
    const rows = layoutRows(this.#taskStore.all(), this.#config.density ?? 'default');
    const anchorIndex = rows.findIndex((r) => r.task.id === anchorId);
    const focusIndex = rows.findIndex((r) => r.task.id === focusId);
    if (anchorIndex === -1 || focusIndex === -1) return; // race: id no longer resolves
    const lo = Math.min(anchorIndex, focusIndex);
    const hi = Math.max(anchorIndex, focusIndex);
    const ids = rows.slice(lo, hi + 1).map((r) => r.task.id);
    this.#commitRangeSelect(ids);
  }

  /**
   * Delete/Backspace commit point (spec-keyboard-nav.md §6.3). Reuses the existing public
   * `removeTask(id)` once per currently selected id (resolution #5: no confirmation dialog,
   * no batch-remove primitive needed — `removeTask` already handles hierarchy-cascade
   * removal, dependency cleanup, and selection-pruning internally per id). `ids` is
   * snapshotted via `.all()` BEFORE the loop starts, so the shrinking selection (pruned by
   * `removeTask` itself as it goes) never affects which ids this loop attempts — and
   * `removeTask` already no-ops gracefully (`if (!this.#taskStore.has(id)) return;`,
   * confirmed by inspection) on an id already removed by an earlier iteration's cascade, so
   * no extra guard is needed here (the spec flags this as a "check during implementation" —
   * confirmed NOT a pre-existing bug). Wrapped in a transaction (§5.3 call site 2) so N
   * selected tasks' removals collapse into ONE history entry for the whole Delete keypress.
   */
  #commitDeleteSelected(): void {
    if (this.#config.readOnly) return; // defense in depth — enableKeyboardNav's own isReadOnly() gate already prevents this call
    const ids = this.#selectionStore.all();
    if (ids.length === 0) return;
    this.#beginTransaction();
    try {
      for (const id of ids) this.removeTask(id);
    } finally {
      this.#endTransaction();
    }
  }

  #commitClearSelection(): void {
    this.#applySelection([]);
  }

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

  #teardownMount(): void {
    const m = this.#mount!;
    // Order matters (the shared pointer-drag coordinator wraps handle.destroy):
    // 1. Stop the reactive effect FIRST — no render call may start once teardown begins.
    m.disposeEffect();
    // 2. Unregister ALL THREE pointer-drag-coordinated recognizers via their returned
    //    disposers — order among them doesn't matter; the coordinator only detaches its
    //    pointerdown listener + unwraps handle.destroy once ALL have unregistered
    //    (refcounted, see pointer-drag.ts). click-select never touched that coordinator (it
    //    owns its own independent listeners), so it has no shared refcount to worry about —
    //    still disposed here, order-independent among the four.
    m.dragResizeDispose();
    m.dragMoveDispose();
    m.dragCreateDepDispose();
    m.clickSelectDispose();
    m.keyboardNavDispose();
    // 3. Remove the SVG.
    m.rendererHandle.destroy();
    this.#mount = undefined;
  }

  #renderNow(handle: SvgRendererHandle, getFocusedTaskId: () => TaskId | undefined): void {
    // Track both stores' revisions — read .value unconditionally so this effect re-runs on
    // ANY task or dependency mutation (coarse, per Q6 — no per-field granularity here). Also
    // tracks the selection store's revision so a `select`/`selectAll`/`deselect` call (or a
    // click-select commit) triggers a repaint (`.fg-task--selected` class).
    void this.#taskStore.revision.value;
    void this.#dependencyStore.revision.value;
    void this.#selectionStore.revision.value;

    const tasks = this.#taskStore.all();
    const dependencies = this.#dependencyStore.all();
    const selectedTaskIds = this.#selectionStore.all();

    let criticalPath: CriticalPathResult | undefined;
    if (tasks.length === 0) {
      // No tasks → no critical path; reset so the next non-empty compute always re-emits.
      this.#lastCriticalIds = undefined;
    }
    if (tasks.length > 0) {
      try {
        criticalPath = computeCriticalPathFn(tasks, dependencies, this.#calendar);
        // Emit only when the critical set actually changed (not on every mutation / render).
        if (!this.#sameCriticalIds(criticalPath.criticalTaskIds)) {
          this.#lastCriticalIds = criticalPath.criticalTaskIds;
          this.#emit('critical-path:computed', criticalPath.criticalTaskIds);
        }
      } catch (err) {
        // Cyclic graph (possible if a caller used DependencyStore.link(..., {allowCycle:
        // true}) directly, bypassing linkTasks) — the reactive render effect must NEVER
        // throw. Swallow, render without a critical path, warn once per occurrence.
        criticalPath = undefined;
        console.warn(
          '@fluxgantt/core: computeCriticalPath failed during reactive render — rendering without a critical path.',
          err,
        );
      }
    }

    // `SvgRendererHandle.setOptions` merges shallowly over the previous options object, so
    // once real tasks exist we must explicitly overwrite a previously-set empty-state
    // `timeRange` back to "unset" (auto-derive) — a merge that simply omitted the key would
    // leave the stale fallback range in place. `exactOptionalPropertyTypes` forbids writing
    // `undefined` to an optional property that isn't typed `X | undefined` directly on a
    // `Partial<SvgRendererOptions>`-typed literal, so this goes through `setTimeRange`,
    // typed against render/'s own `Partial<SvgRendererOptions>` via a narrow, explicit
    // helper type instead of fighting the literal-freshness check inline.
    //
    // ORDER MATTERS (bugfix): `handle.update()` and `handle.setOptions()` (which
    // `setTimeRange` calls) each trigger a full synchronous `render()` independently — one
    // using the freshly-passed argument, the other still reading the renderer's OTHER,
    // not-yet-updated internal field (`currentInput.tasks` vs `currentOptions.timeRange`).
    // `render()` throws (`deriveTimeRange: tasks must not be empty`) iff BOTH `timeRange` is
    // unset AND `tasks` is empty at the same instant — so the two calls below are ordered to
    // never expose that combination, regardless of which state (empty <-> non-empty) the
    // renderer is transitioning from:
    //  - Going TO empty (`tasks.length === 0`): set the fallback `timeRange` FIRST — its
    //    intermediate `render()` pass (still using the OLD, possibly non-empty task list) is
    //    always safe once `timeRange` is set; the following `update({tasks: []})` pass then
    //    also has a real `timeRange` already in place.
    //  - Going TO non-empty (`tasks.length > 0`): push the new `tasks` FIRST — its
    //    intermediate `render()` pass (still using the OLD `timeRange`, whatever it was) is
    //    always safe once `tasks` is non-empty; the following `setTimeRange(undefined)` pass
    //    then derives the range from the already-pushed, non-empty `tasks`.
    // Reordering unconditionally (either direction, always) reintroduces the crash for the
    // opposite transition — this must stay tasks.length-conditional.
    const focusedTaskId = getFocusedTaskId();
    if (tasks.length === 0) {
      setTimeRange(handle, this.#emptyStateTimeRange());
      handle.update({ tasks, dependencies, calendar: this.#calendar, selectedTaskIds, focusedTaskId });
    } else {
      handle.update({
        tasks,
        dependencies,
        calendar: this.#calendar,
        selectedTaskIds,
        focusedTaskId,
        ...(criticalPath !== undefined ? { criticalPath } : {}),
      });
      setTimeRange(handle, undefined);
    }
  }

  #emptyStateTimeRange(): { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } {
    const now = getTemporal().Now.zonedDateTimeISO(this.#calendar.timezone);
    return {
      start: now.subtract({ days: EMPTY_STATE_WINDOW_DAYS }),
      end: now.add({ days: EMPTY_STATE_WINDOW_DAYS }),
    };
  }

  #renderInput(): SvgRendererInput {
    return {
      tasks: this.#taskStore.all(),
      dependencies: this.#dependencyStore.all(),
      calendar: this.#calendar,
      selectedTaskIds: this.#selectionStore.all(),
    };
  }

  #rendererOptions(): SvgRendererOptions {
    // `exactOptionalPropertyTypes` — only include a key when the corresponding config
    // value is actually set; an explicit `undefined` value on an optional property that
    // isn't typed `X | undefined` is a compile error, not just redundant.
    const opts: SvgRendererOptions = {
      ...(this.#config.viewMode !== undefined ? { viewMode: this.#config.viewMode } : {}),
      ...(this.#config.density !== undefined ? { density: this.#config.density } : {}),
      ...(this.#config.locale !== undefined ? { locale: this.#config.locale } : {}),
      // A readOnly chart must not render the connector handles — they are an interactive
      // affordance (hover-revealed, always-on for touch) whose recognizer is NOT wired when
      // readOnly, so rendering them would be a misleading dead control.
      showLinkHandles: !this.#config.readOnly,
    };
    return this.#taskStore.size === 0 ? { ...opts, timeRange: this.#emptyStateTimeRange() } : opts;
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
  #assertMounted(method: string): SvgRendererHandle {
    if (!this.#mount) {
      throw new Error(
        `@fluxgantt/core: cannot call ${method} — gantt instance is not mounted (call mount() first)`,
      );
    }
    return this.#mount.rendererHandle;
  }
}

export function createGantt(config: GanttConfig): GanttInstance {
  return new Gantt(config);
}

/**
 * Sets — or explicitly clears — `SvgRendererOptions.timeRange` (item B). `setOptions`
 * merges shallowly over the previous options object, so once real tasks exist the
 * facade must be able to overwrite a previously-set empty-state fallback range back to
 * "unset" (auto-derive); simply omitting the key from a `Partial<SvgRendererOptions>`
 * literal would leave the stale fallback in place. `render/svg-renderer.ts`'s
 * `SvgRendererOptions.timeRange` is optional but not typed `X | undefined`, so
 * `exactOptionalPropertyTypes` forbids writing `undefined` directly into a
 * `Partial<SvgRendererOptions>`-typed object literal — this helper isolates that one
 * narrow, deliberate cast instead of fighting the check inline in `#renderNow`. Not a
 * `render/` change (per item B's instruction) — purely a `gantt.ts` call-site concern.
 */
function setTimeRange(
  handle: SvgRendererHandle,
  timeRange: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } | undefined,
): void {
  if (timeRange) {
    handle.setOptions({ timeRange });
    return;
  }
  const clear: { timeRange: undefined } = { timeRange: undefined };
  handle.setOptions(clear as unknown as Partial<SvgRendererOptions>);
}
