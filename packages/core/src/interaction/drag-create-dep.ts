// Interaction layer — drag-create-dependency (spec-drag-create-dependency.md §4.2). Drag from
// a task bar's connector handle (`.fg-task__link-handle`, rendered by `svg-renderer.ts`) to
// another task's bar to create an FS dependency, committing once on drop via the
// `onDependencyCreated` callback. Does NOT import TaskStore — takes `getTasks()` duck-typed,
// mirrors `drag-move.ts`/`drag-resize.ts` (spec §1).
//
// TOUCHES THE DOM (raw Pointer Events) — this is the only layer in core allowed to, per
// architecture.md "Interaction". `@fluxgantt/core` still does NOT import react/vue/svelte.
//
// Grab affordance & priority (decision 1, locked): ONLY a pointerdown squarely on
// `.fg-task__link-handle` claims this gesture — `LINK_PRIORITY` is lower than both
// `RESIZE_PRIORITY` (0) and `MOVE_PRIORITY` (10), so a handle claim always wins over either,
// even when the handle sits inside resize's own edge hit-zone (spec §4.3).
//
// Invalid drop = silent revert (decision 2, locked): self-link/empty-space is filtered inside
// this recognizer (never reaches `onDependencyCreated`); a store-level rejection
// (duplicate-pair/cycle) is the facade's (`gantt.ts#commitCreateDep`) responsibility to catch —
// this module has zero knowledge of `DependencyStore`.
//
// No Temporal / date arithmetic anywhere in this file (spec §1) — this feature only maps a
// pointerdown/pointerup to a `TaskId` pair and calls a callback with `lag`/`type` left to the
// caller's own default.
import type { SvgRendererHandle } from '../render/index.js';
import { ARROWHEAD_MARKER_ID } from '../render/index.js';
import type { Task, TaskId } from '../types.js';
import { toTaskId } from '../types.js';
import {
  getPointerDragController,
  DEFAULT_DRAG_THRESHOLD_PX,
  findGroupTask,
  readClientScale,
} from './pointer-drag.js';
import type { PointerGestureRecognizer } from './pointer-drag.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface DragCreateDepOptions {
  /**
   * Called EXACTLY ONCE on a past-threshold `pointerup` whose drop point resolved (via
   * `event.target.closest('.fg-task[data-task-id]')`) to a task DIFFERENT from the one the
   * grabbed handle belongs to. Always creates type `'FS'`, lag `0` — v1 does not choose
   * SS/FF/SF or lag during the drag. `enableDragCreateDep` NEVER writes to a store itself —
   * this is the only commit signal. The caller is responsible for catching a store-level
   * rejection (self-link/duplicate-pair/cycle) — this callback does not know whether the
   * eventual `linkTasks()` call will succeed.
   *
   * NOT called when the drop point is empty space or resolves back to the SAME task (self) —
   * those are handled inside the recognizer as a silent no-op (decision 2), exactly like an
   * invalid drop, so a caller never has to special-case a "from === to" pair here.
   */
  onDependencyCreated(fromTaskId: TaskId, toTaskId: TaskId): void;

  /** Movement threshold (px, client coords) before a pointerdown-on-a-handle is treated as a
   *  link-drag rather than a click. Default 4 (same default as drag-move/drag-resize). */
  dragThresholdPx?: number;

  /** Called on each valid `pointermove` after the threshold, with the CURRENT drop candidate
   *  under the pointer (`undefined` if the pointer isn't over any OTHER `.fg-task`, including
   *  while it's over the origin task itself) — optional, for live UI (e.g. highlighting the
   *  candidate target). Mirrors `DragMoveOptions.onDragging`. Never used to commit. */
  onLinking?(fromTaskId: TaskId, candidateTaskId: TaskId | undefined): void;
}

const LINK_PRIORITY = -10; // lower than RESIZE_PRIORITY (0) and MOVE_PRIORITY (10) — decision 1
const LINKING_CLASS = 'fg-task--linking';

/** Client-px → SVG user-space transform, captured ONCE at gesture start (the `<svg>` box and
 *  its viewBox don't change during a drag; jsdom has no layout engine, so the scale falls back to
 *  1:1). Both axes are needed since the preview line's endpoint can land in any row. */
type ClientToUserTransform = ReturnType<typeof readClientScale>;

interface LinkState {
  readonly from: TaskId;
  /** Which handle was grabbed — DETERMINES THE EDGE DIRECTION at commit (FS = predecessor's
   *  finish → successor's start): grabbing the owner's END/finish handle makes the owner the
   *  predecessor (owner → drop); grabbing its START handle makes the owner the successor
   *  (drop → owner). Not a display concern — it flips the argument order of `linkTasks`. */
  readonly edge: 'start' | 'end';
  /** SVG user-space coordinates of the grabbed handle — read directly off its own `cx`/`cy`
   *  attributes at `claim()` time (no geometry re-derivation, same "read the
   *  already-rendered DOM" posture as `drag-resize.ts`'s `barX`/`barWidth`). */
  readonly ox: number;
  readonly oy: number;
  /** Assigned exactly once, in `start` — `null` before the gesture passes the
   *  threshold. */
  line: SVGPathElement | null;
  /** Captured once in `start` so `onMove` doesn't force a layout reflow
   *  (`getBoundingClientRect`) + reparse the viewBox on every `pointermove`. */
  xf: ClientToUserTransform | null;
}

/**
 * Attaches drag-create-dependency to a mounted `SvgRendererHandle` — via the shared
 * `pointer-drag.ts` coordinator (`getPointerDragController(handle).register(...)`), so it can
 * coexist with `enableDragMove`/`enableDragResize` registered on the same handle.
 *
 * Returns a disposer — unregisters this recognizer. Calling the disposer mid-drag cancels that
 * gesture (no commit, preview removed), equivalent to Escape. Calling the disposer multiple
 * times is a safe no-op.
 */
export function enableDragCreateDep(
  handle: SvgRendererHandle,
  getTasks: () => readonly Task[],
  options: DragCreateDepOptions,
): () => void {
  const dragThresholdPx = options.dragThresholdPx ?? DEFAULT_DRAG_THRESHOLD_PX;

  const recognizer: PointerGestureRecognizer<LinkState> = {
    cls: LINKING_CLASS,
    cursor: 'crosshair',
    priority: LINK_PRIORITY,
    slop: dragThresholdPx,

    claim(event, groupEl) {
      if (!(event.target instanceof Element)) return null;
      const handleEl = event.target.closest('.fg-task__link-handle');
      // Decision 1's core constraint: ONLY a pointerdown squarely on a handle claims this
      // gesture — a pointerdown anywhere else inside `.fg-task` (bar body, resize edge) must
      // decline so move/resize get a chance.
      if (!handleEl || !groupEl.contains(handleEl)) return null;

      // Race between the rendered DOM and the latest `tasks` — skip, don't throw (mirrors
      // drag-move/drag-resize's own posture).
      const fromTaskId = findGroupTask(groupEl, getTasks)?.id;
      if (fromTaskId === undefined) return null;

      const handleEnd = handleEl.getAttribute('data-handle-end') === 'start' ? 'start' : 'end';
      const cx = Number(handleEl.getAttribute('cx'));
      const cy = Number(handleEl.getAttribute('cy'));
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

      return { from: fromTaskId, edge: handleEnd, ox: cx, oy: cy, line: null, xf: null };
    },

    start(ctx) {
      // CRITICAL, non-obvious (spec §4.2): the shared coordinator (`pointer-drag.ts`'s
      // `onPointerDown`) unconditionally calls `captureEl.setPointerCapture(pointerId)` for
      // whatever recognizer claimed the gesture — `cap` here is the handle circle
      // itself. Per the Pointer Events spec, once an element has pointer capture, EVERY
      // subsequent event for that pointerId (including the final `pointerup`) is RETARGETED
      // to the capturing element — `event.target` would stay pinned to the origin handle for
      // the rest of the gesture, which would make `resolveDropTarget()`'s
      // `event.target.closest('.fg-task[data-task-id]')` always resolve back to the ORIGIN
      // task (self), i.e. every drop would silently revert as if it were a self-drop. Fix:
      // release capture here, right after start — restores normal (un-retargeted)
      // hit-testing for the rest of THIS gesture's pointermove/pointerup. Safe: the
      // coordinator's own `window`-level pointermove/pointerup listeners do not depend on
      // capture to keep receiving events (capture only affects hit-test targeting, not
      // whether `window` listeners fire), and the coordinator's own `teardownListeners()`
      // already calls `releasePointerCapture` again defensively (idempotent, try/catch).
      try {
        ctx.cap.releasePointerCapture?.(ctx.pointerId);
      } catch {
        // Best-effort — mirrors pointer-drag.ts's own posture for this exact call.
      }

      const path = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
      path.setAttribute('class', 'fg-dependency-preview');
      path.setAttribute(
        'd',
        `M ${ctx.state.ox} ${ctx.state.oy} L ${ctx.state.ox} ${ctx.state.oy}`,
      );
      path.setAttribute('marker-end', `url(#${ARROWHEAD_MARKER_ID})`);
      path.style.setProperty('fill', 'none');
      path.style.setProperty('stroke', 'var(--fg-dep-line, #64748b)');
      path.style.setProperty('stroke-dasharray', 'var(--fg-dep-preview-dash, 4 3)');
      // Let hit-testing see THROUGH the thin preview line to whatever's actually underneath
      // it (a task bar, the grid, ...) — otherwise a pointer hovering exactly over the
      // rubber-band line would resolve `event.target` to the preview path itself, which has
      // no `.fg-task` ancestor, spuriously reading as "no drop target".
      path.style.setProperty('pointer-events', 'none');
      handle.svg.appendChild(path);
      ctx.state.line = path;
      ctx.state.xf = readClientScale(handle.svg);
    },

    move(ctx, _dxPixels, event) {
      const path = ctx.state.line;
      if (!path || !ctx.state.xf) return; // defensive; onDragStart always runs first
      const { x, y } = applyTransform(ctx.state.xf, event.clientX, event.clientY);
      path.setAttribute('d', `M ${ctx.state.ox} ${ctx.state.oy} L ${x} ${y}`);
      if (options.onLinking) {
        options.onLinking(ctx.state.from, resolveDropTarget(event, ctx.state.from));
      }
    },

    commit(ctx, _dxPixels, event) {
      ctx.state.line?.remove();
      const dropId = resolveDropTarget(event, ctx.state.from);
      // Empty space OR self — decision 2's silent revert, resolved right here so the
      // facade's commit handler only ever has to deal with STORE-level rejections
      // (duplicate-pair / cycle), never a self-pair.
      if (dropId === undefined) return;
      // Edge direction depends on WHICH handle was grabbed (FS = predecessor.finish →
      // successor.start). Grabbing the owner's END handle → owner is the predecessor
      // (owner → drop); grabbing its START handle → owner is the successor (drop → owner).
      // Without this, a drag started from a start-handle produced the REVERSED dependency.
      const [from, to] =
        ctx.state.edge === 'start' ? [dropId, ctx.state.from] : [ctx.state.from, dropId];
      options.onDependencyCreated(from, to);
    },

    cancel(ctx) {
      ctx.state.line?.remove();
    },
  };

  return getPointerDragController(handle).register(recognizer);
}

/** Resolves the task under the drop point, or `undefined` for empty space / self (never a
 *  valid target). Pure given a DOM event + the gesture's own `fromTaskId` — the SAME
 *  resolution rule is reused for both the live `onLinking` candidate and the final commit, so
 *  "what you see hovering is what you get on drop". */
function resolveDropTarget(event: PointerEvent, fromTaskId: TaskId): TaskId | undefined {
  if (!(event.target instanceof Element)) return undefined;
  const targetGroupEl = event.target.closest('.fg-task[data-task-id]');
  if (!targetGroupEl) return undefined;
  const idAttr = targetGroupEl.getAttribute('data-task-id');
  if (idAttr === null) return undefined;
  const candidate = toTaskId(idAttr);
  if (candidate === fromTaskId) return undefined;
  return candidate;
}

function applyTransform(t: ClientToUserTransform, clientX: number, clientY: number): { x: number; y: number } {
  return { x: (clientX - t.left) / t.scaleX, y: (clientY - t.top) / t.scaleY };
}
