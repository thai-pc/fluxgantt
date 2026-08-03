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
// KNOWN GAP vs spec §7.2 (tracked, prerequisite before 1.0): `moveTask`/`resizeTask`/
// `updateTask`/`removeTask` in this v1 facade affect ONLY the task(s) you named — dependent
// tasks along FS/SS/FF/SF links are NOT automatically shifted ("cascade"), unlike what spec
// §7.2 documents as the default. There is no `schedulingMode` config in v1 (plan Q2) — this
// is a real behavior gap, not a configurable choice, until `compute/cascade.ts` exists.
// Follow-up ticket: "compute cascade.ts + facade wiring." When it lands, it must ship
// **opt-in** first (e.g. `schedulingMode: 'auto'`), not flip v1's current single-task-only
// default silently.
import type { Temporal } from '@js-temporal/polyfill';
import { effect } from './signals.js';
import { TaskStore, DependencyStore } from './store/index.js';
import type { TaskInput, TaskPatch } from './store/index.js';
import {
  DEFAULT_CALENDAR,
  normalizeDate,
  differenceInWorkingHours,
  addWorkingHours,
} from './compute/working-calendar.js';
import { computeCriticalPath as computeCriticalPathFn } from './compute/critical-path.js';
import { getTemporal } from './internal/temporal.js';
import { createSvgRenderer } from './render/svg-renderer.js';
import type { SvgRendererHandle, SvgRendererInput, SvgRendererOptions } from './render/svg-renderer.js';
import { enableDragMove } from './interaction/drag-move.js';
import { exportJson as exportJsonFn, exportCsv as exportCsvFn } from './io/index.js';
import type { ExportBundle, ExportCsvOptions, ExportJsonOptions } from './io/index.js';
import type {
  CriticalPathResult,
  DateInput,
  Density,
  Dependency,
  DependencyId,
  DependencyType,
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
}

/** Shape accepted for an initial dependency in `GanttConfig.dependencies` — mirrors what
 *  `DependencyStore.link()` accepts (discrete args), not the full stored `Dependency`
 *  (which requires `id`). */
export type DependencyInput = Omit<Dependency, 'id'>;

// --- Public event map ------------------------------------------------------------------

export interface GanttEventMap {
  'task:added': [task: Task];
  /** `prevStart` is `DateInput` (usually the same shape the task was last written with),
   *  NOT a plain `Date`. */
  'task:moved': [task: Task, prevStart: DateInput];
  /** Working hours, matches `Task.duration`'s unit. */
  'task:resized': [task: Task, prevDuration: number];
  'task:progressed': [task: Task, prevProgress: number];
  'task:removed': [taskId: TaskId];
  'dependency:added': [dependency: Dependency];
  'dependency:removed': [dependencyId: DependencyId];
  /** Task ids only, even though the facade's `computeCriticalPath()` method itself returns
   *  the full `CriticalPathResult`. */
  'critical-path:computed': [criticalTaskIds: readonly TaskId[]];
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

  // --- Computation -------------------------------------------------------------------------
  computeCriticalPath(): CriticalPathResult;

  // --- IO (read-only export, spec §7.8, security.md §2) -----------------------------------
  /** Thin delegation over `getTasks()`/`getDependencies()` + the pure `exportJson()`
   *  function — same post-`destroy()` posture as those two getters (returns an
   *  empty-but-valid bundle rather than throwing; see spec-io-json-csv.md §1.2). Defaults
   *  `options.timezone` to the instance's own calendar timezone, not `'UTC'`. */
  exportJson(options?: ExportJsonOptions): ExportBundle;
  /** Thin delegation over `getTasks()` + the pure `exportCsv()` function. Same posture as
   *  `exportJson()` above. */
  exportCsv(options?: ExportCsvOptions): string;

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
  readonly dragDispose: () => void;
  readonly disposeEffect: () => void;
}

/** Fixed window used as the renderer's `timeRange` fallback whenever the task count is 0
 *  (item B) — otherwise `createSvgRenderer`'s internal `deriveTimeRange()` throws on an
 *  empty `tasks` array. Not exported — an internal `gantt.ts`-only concern; `render/` is
 *  not modified for this. */
const EMPTY_STATE_WINDOW_DAYS = 14;

class Gantt implements GanttInstance {
  readonly #taskStore: TaskStore;
  readonly #dependencyStore: DependencyStore;
  readonly #calendar: WorkingCalendar;
  readonly #config: GanttConfig;
  readonly #listeners = new Map<GanttEventName, Set<(...args: never[]) => void>>();
  #mount: MountState | undefined; // undefined = headless
  #destroyed = false;
  /** Last `criticalTaskIds` emitted via `critical-path:computed`, so the reactive render
   *  effect emits only when the critical set actually changes (not on every mutation). */
  #lastCriticalIds: readonly TaskId[] | undefined = undefined;

  constructor(config: GanttConfig) {
    this.#config = config;
    this.#calendar = config.calendar ?? DEFAULT_CALENDAR;
    this.#taskStore = new TaskStore();
    this.#dependencyStore = new DependencyStore();

    const seenIds = new Set<TaskId>();
    for (const t of config.tasks ?? []) {
      if (t.id !== undefined) {
        if (seenIds.has(t.id)) {
          throw new Error(
            `createGantt: duplicate task id "${t.id}" in config.tasks — TaskStore would silently drop the earlier one`,
          );
        }
        seenIds.add(t.id);
      }
      this.#taskStore.add(t); // stamps id (if absent)/createdAt/updatedAt, no event emitted
    }
    for (const d of config.dependencies ?? []) {
      // May throw (self-link / duplicate pair / cycle) — construction fails atomically; no
      // partial state is observable (the whole `createGantt()` call throws).
      this.#dependencyStore.link(d.from, d.to, d.type ?? 'FS', d.lag === undefined ? {} : { lag: d.lag });
    }
  }

  // --- Task operations -----------------------------------------------------------------

  addTask(input: TaskInput): Task {
    this.#assertAlive('addTask');
    const task = this.#taskStore.add(input);
    this.#emit('task:added', task);
    return task;
  }

  updateTask(id: TaskId, patch: TaskPatch): Task {
    this.#assertAlive('updateTask');
    this.#requireTask(id, 'updateTask');
    return this.#applyPatch(id, patch);
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
    return this.#applyPatch(id, { start: nextStart, end: nextEnd });
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
    return this.#applyPatch(id, { end: newEnd, duration: newDuration });
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

    // 2. Snapshot every dependency link touching any of those tasks BEFORE mutating.
    const depsToRemove = new Map<DependencyId, Dependency>();
    for (const tid of removedIds) {
      for (const dep of this.#dependencyStore.of(tid)) depsToRemove.set(dep.id, dep);
    }

    // 3. Mutate.
    this.#taskStore.remove(id); // cascades descendants internally
    for (const tid of removedIds) this.#dependencyStore.removeForTask(tid);

    // 4. Emit — dependency:removed first (cleaning up "references" before announcing the
    //    referenced node is gone), then task:removed, deepest descendant first / target
    //    last (mirrors TaskStore.remove's own recursion order).
    for (const dep of depsToRemove.values()) this.#emit('dependency:removed', dep.id);
    for (const tid of removedIds) this.#emit('task:removed', tid);
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
    this.#emit('dependency:added', dep);
    return dep;
  }

  unlinkTasks(from: TaskId, to: TaskId): void {
    this.#assertAlive('unlinkTasks');
    const matches = this.#dependencyStore.all().filter((d) => d.from === from && d.to === to);
    if (matches.length === 0) return;
    this.#dependencyStore.unlink(from, to);
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
    const dragDispose = this.#config.readOnly
      ? () => {}
      : enableDragMove(rendererHandle, () => this.#taskStore.all(), {
          onTaskMoved: (taskId, newStart, newEnd) => this.#commitDrag(taskId, newStart, newEnd),
        });
    const disposeEffect = effect(() => this.#renderNow(rendererHandle));

    this.#mount = { rendererHandle, dragDispose, disposeEffect };
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
    this.#renderNow(this.#mount.rendererHandle);
  }

  // --- Private: mutation → split-event pipeline (Q3 + Q6) ---------------------------------

  #applyPatch(id: TaskId, patch: TaskPatch): Task {
    const prev = this.#taskStore.get(id)!; // caller already asserted existence
    const next = this.#taskStore.update(id, patch);
    this.#diffAndEmit(prev, next);
    this.#config.onTaskChange?.(next, prev);
    return next;
  }

  #diffAndEmit(prev: Task, next: Task): void {
    const tz = this.#calendar.timezone;
    if (!this.#sameInstant(prev.start, next.start, tz)) {
      this.#emit('task:moved', next, prev.start);
    }
    // Detect a resize by the INSTANT span (end − start) changing — translation-invariant,
    // so a pure move (start+end shifted by the same delta) is never mistaken for a resize,
    // and it matches the rendered bar whose width is dateToX(end) − dateToX(start). (Using
    // working-hours effectiveDuration here would fire a spurious task:resized on a move that
    // shifts the span across weekends/holidays.) The payload still reports working-hours
    // duration via `effectiveDuration`.
    if (this.#spanNs(prev, tz) !== this.#spanNs(next, tz)) {
      this.#emit('task:resized', next, this.#effectiveDuration(prev));
    }
    if (prev.progress !== next.progress) {
      this.#emit('task:progressed', next, prev.progress);
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

  #collectWithDescendants(id: TaskId): TaskId[] {
    const out: TaskId[] = [];
    const visit = (tid: TaskId): void => {
      for (const child of this.#taskStore.children(tid)) visit(child.id);
      out.push(tid);
    };
    visit(id);
    return out;
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
    // Reuses the SAME #applyPatch pipeline as moveTask/updateTask — guarantees the exact
    // same task:moved(task, prevStart) contract, not a separate ad hoc emit. start+end
    // always shift by the identical instant delta (drag-move's own contract), so the instant
    // span (end − start) is preserved → #diffAndEmit never fires task:resized from a drag.
    this.#applyPatch(taskId, { start: newStart, end: newEnd });
  }

  #teardownMount(): void {
    const m = this.#mount!;
    // Order matters (drag-move wraps handle.destroy):
    // 1. Stop the reactive effect FIRST — no render call may start once teardown begins.
    m.disposeEffect();
    // 2. Dispose drag-move's own listeners explicitly via its returned disposer.
    m.dragDispose();
    // 3. Remove the SVG.
    m.rendererHandle.destroy();
    this.#mount = undefined;
  }

  #renderNow(handle: SvgRendererHandle): void {
    // Track both stores' revisions — read .value unconditionally so this effect re-runs on
    // ANY task or dependency mutation (coarse, per Q6 — no per-field granularity here).
    void this.#taskStore.revision.value;
    void this.#dependencyStore.revision.value;

    const tasks = this.#taskStore.all();
    const dependencies = this.#dependencyStore.all();

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
    if (tasks.length === 0) {
      setTimeRange(handle, this.#emptyStateTimeRange());
      handle.update({ tasks, dependencies, calendar: this.#calendar });
    } else {
      handle.update({
        tasks,
        dependencies,
        calendar: this.#calendar,
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
    return { tasks: this.#taskStore.all(), dependencies: this.#dependencyStore.all(), calendar: this.#calendar };
  }

  #rendererOptions(): SvgRendererOptions {
    // `exactOptionalPropertyTypes` — only include a key when the corresponding config
    // value is actually set; an explicit `undefined` value on an optional property that
    // isn't typed `X | undefined` is a compile error, not just redundant.
    const opts: SvgRendererOptions = {
      ...(this.#config.viewMode !== undefined ? { viewMode: this.#config.viewMode } : {}),
      ...(this.#config.density !== undefined ? { density: this.#config.density } : {}),
      ...(this.#config.locale !== undefined ? { locale: this.#config.locale } : {}),
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
