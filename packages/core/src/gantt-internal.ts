// Internal "friend" surface shared between the base facade (`gantt.ts`) and the opt-in mixin
// modules (`io/mixin.ts`, `render/mixin.ts`, `interaction/mixin.ts`) — see
// spec-facade-split.md §2.1.
//
// WHY THIS EXISTS: `Gantt`'s state lives in `#private` fields, which are unreachable from a
// free function by design. Rather than widen those fields to public (which would put every
// internal onto the documented API surface forever), every instance carries ONE extra
// non-enumerable-by-convention property, keyed by the module-local `INTERNAL` symbol, holding
// the object below. A mixin reaches it through `getInternal()` — the single, narrow,
// documented cast in the whole split.
//
// NOT EXPORTED FROM `index.ts`. Mixin modules import this by relative path; they ship in the
// same package, so this is a compile-time-private/publish-time-shared boundary, not a public
// contract. Nothing here is covered by semver.
//
// HEADLESS-FIRST (architecture.md principle 1): nothing in this file touches a DOM global. The
// mount/interaction SLOTS declared below are plain storage — `gantt.ts` initializes them to
// `undefined` and never reads them; only `render/mixin.ts` (writer) and
// `io/mixin.ts`/`interaction/mixin.ts` (readers) give them meaning, and those modules are only
// ever loaded by a consumer who explicitly imported a DOM-facing subpath.
import type { Signal } from './signals.js';
import type {
  TaskStore,
  DependencyStore,
  SelectionStore,
  TaskInput,
  TaskPatch,
} from './store/index.js';
import type { CanvasRendererHandle } from './render/canvas-renderer.js';
import type { SvgRendererHandle } from './render/svg-renderer.js';
import type { DateInput, Dependency, Task, TaskId, ViewMode, WorkingCalendar } from './types.js';
// TYPE-ONLY import back into `gantt.ts` — erased at compile time, so this creates NO runtime
// module cycle (`gantt.ts` imports this file for real; this file imports nothing back).
// Keeps `emitEvent` exactly as type-safe for a mixin as `#emit` is inside the class.
import type {
  DependencyInput,
  GanttConfig,
  GanttEventMap,
  GanttEventName,
  ImportSummary,
} from './gantt.js';

export const INTERNAL: unique symbol = Symbol('fluxgantt.internal');

/** One reversible store write. Mirrors `gantt.ts`'s own `HistoryOp` — declared here so the
 *  interaction mixin's commit points can hand ops back to the base history without importing
 *  `gantt.ts` (which would re-create the very dependency edge this split removes). */
export type HistoryOp =
  | { readonly kind: 'task-add'; readonly task: Task }
  | { readonly kind: 'task-update'; readonly id: TaskId; readonly prev: Task; readonly next: Task }
  | { readonly kind: 'task-remove'; readonly task: Task }
  | { readonly kind: 'dependency-add'; readonly dependency: Dependency }
  | { readonly kind: 'dependency-remove'; readonly dependency: Dependency };

/** Which renderer a given mount is using. */
export type RendererKind = 'svg' | 'canvas';

/** Live mount bookkeeping. Written ONLY by `render/mixin.ts`; read by `io/mixin.ts`
 *  (`exportSvg`/`exportPng` need the live handle) and by the base facade's `zoomTo()`
 *  (which must re-apply renderer options on a live chart). */
export interface MountState {
  readonly renderer: RendererKind;
  readonly rendererHandle: SvgRendererHandle | CanvasRendererHandle;
  readonly disposeEffect: () => void;
  /** Interaction teardown, if `withInteraction` was applied before this mount; a no-op
   *  otherwise (and always a no-op in Canvas mode for the pointer-drag family). */
  readonly disposeInteractions: () => void;
  readonly getFocusedTaskId: () => TaskId | undefined;
  /**
   * Runs `mutate()` (a view-mode write, which synchronously repaints) between a capture and a
   * restore of the date currently centered in the viewport, so `zoomTo()` keeps the user's
   * anchor date on screen across a zoom.
   *
   * Lives on the mount state — i.e. is provided by `render/mixin.ts` — rather than in base
   * `zoomTo()`, because the math needs the renderer's `LABEL_COLUMN_WIDTH` and `TimeScale`;
   * importing those into `gantt.ts` would drag the SVG renderer back into the base bundle,
   * which is exactly what this split exists to prevent. Base `zoomTo()` therefore degrades to
   * state-only whenever no mount state exists (always, without `withRender`).
   */
  readonly withScrollAnchor: (mutate: () => void) => void;
}

/** Registered by `withInteraction`, consulted LAZILY by `withRender`'s `mount()` — this
 *  indirection is what makes mixin application order irrelevant (spec §3.3). */
export interface InteractionHooks {
  wireInto(
    handle: SvgRendererHandle | CanvasRendererHandle,
    renderer: RendererKind,
    internal: GanttInternal,
  ): InteractionDisposers;
}

export interface InteractionDisposers {
  readonly dispose: () => void;
  readonly getFocusedTaskId: () => TaskId | undefined;
}

export interface GanttInternal {
  readonly taskStore: TaskStore;
  readonly dependencyStore: DependencyStore;
  readonly selectionStore: SelectionStore;
  readonly calendar: WorkingCalendar;
  readonly viewMode: Signal<ViewMode>;

  /** The frozen-by-convention config the instance was constructed with. Read by
   *  `interaction/mixin.ts` (`density`, `readOnly`) — the base class reads its own
   *  `#config` field directly. */
  readonly config: GanttConfig;

  emitEvent<E extends GanttEventName>(event: E, ...args: GanttEventMap[E]): void;
  assertAlive(method: string): void;
  requireTask(id: TaskId, method: string): Task;

  // --- Mount slot (writer: render/mixin.ts) ---
  getMountState(): MountState | undefined;
  setMountState(state: MountState | undefined): void;
  /** Monotonic race-guard token (spec-canvas-auto-switch.md §5) — bumped by every
   *  mount/unmount/destroy so the async Canvas path can abandon a superseded mount. */
  bumpMountGeneration(): number;
  getMountGeneration(): number;
  isDestroyed(): boolean;
  /** Renderer-agnostic teardown of whatever `setMountState()` last stored: stop the reactive
   *  effect, dispose interactions, destroy the renderer handle, clear the slot. Lives in
   *  `gantt.ts` (not `render/mixin.ts`) because base `destroy()` must be able to tear a mount
   *  down without pulling the render layer into its graph. No-op when unmounted. */
  teardownMount(): void;

  // --- Interaction slot (writer: interaction/mixin.ts) ---
  getInteractionHooks(): InteractionHooks | undefined;
  setInteractionHooks(hooks: InteractionHooks): void;

  // --- Mutation commit primitives (shared with interaction's gesture commit points) ---
  commitScheduleChange(id: TaskId, patch: TaskPatch, cascade: boolean): Task;
  applyCascadeShift(id: TaskId, start: DateInput, end: DateInput): void;
  beginTransaction(): void;
  endTransaction(): void;
  recordOp(op: HistoryOp): void;
  recordOps(ops: readonly HistoryOp[]): void;
  applySelection(ids: readonly TaskId[]): void;
  expandWithDescendants(ids: readonly TaskId[]): TaskId[];

  // --- IO commit primitives (shared with io/mixin.ts) ---
  /** Staging + atomic swap behind `importJson()`/`importCsv()` — validates the whole
   *  replacement dataset against throwaway stores before touching anything live. */
  commitImport(
    tasks: readonly TaskInput[],
    dependencies: readonly DependencyInput[],
    format: 'json' | 'csv',
  ): ImportSummary;
  /** Guard for `exportSvg()`/`exportPng()` — throws when not mounted, and again when mounted
   *  in Canvas mode (no `handle.svg` to serialize). */
  assertMountedSvg(method: string): SvgRendererHandle;

  // --- Critical-path emit-on-change guard (shared with render/mixin.ts's render effect) ---
  /** Records `ids` as the last emitted critical set and reports whether it actually CHANGED —
   *  `true` means the caller should emit `critical-path:computed`. */
  noteCriticalIds(ids: readonly TaskId[]): boolean;
  /** Forgets the last emitted critical set, so the next non-empty compute always re-emits. */
  resetCriticalIds(): void;
}

export interface WithInternal {
  readonly [INTERNAL]: GanttInternal;
}

/**
 * The ONE narrow, documented cast in the whole split — every mixin funnels through this.
 * Throws an actionable error (rather than crashing three frames deeper on `undefined.taskStore`)
 * when handed anything that isn't a real `createGantt()` instance — e.g. a hand-rolled test mock.
 */
export function getInternal(instance: object): GanttInternal {
  const internal = (instance as Partial<WithInternal>)[INTERNAL];
  if (!internal) {
    throw new Error(
      '@fluxgantt/core: withIo/withRender/withInteraction can only be applied to an instance ' +
        'returned by createGantt() from @fluxgantt/core — this object has no internal state.',
    );
  }
  return internal;
}
