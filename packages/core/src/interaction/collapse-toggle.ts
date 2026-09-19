// Interaction layer — collapse/expand toggle click (spec-collapse-expand.md §7.1). Mirrors
// `interaction/selection.ts`'s shape (an `enableX(handle, getTasks, options): () => void`
// factory returning a disposer), kept as its own module for the same single-responsibility
// reason drag-move/drag-resize/drag-create-dep are separate modules from each other.
//
// TOUCHES THE DOM (raw pointer/click events) — allowed here per architecture.md
// "Interaction". Still does NOT import react/vue/svelte.
import type { SvgRendererHandle } from '../render/svg-renderer.js';
import type { CanvasRendererHandle } from '../render/canvas-renderer.js';
import type { Task, TaskId } from '../types.js';
import { toTaskId } from '../types.js';

export interface CollapseToggleOptions {
  readonly onToggleCollapse: (taskId: TaskId) => void;
}

/**
 * Attaches collapse/expand toggle-click handling to a mounted renderer handle. Returns a
 * disposer. Registered UNCONDITIONALLY by `interaction/mixin.ts` — NOT gated by `readOnly`
 * (spec §7.1): collapsing hides/reveals rows, it never mutates task data, so there is no
 * reason to disable it in a read-only chart.
 *
 * - **SVG mode:** a delegated `click` listener targeting `.fg-timeline__row-toggle` via
 *   `event.target.closest(...)` (mirrors `resolveRowHitDom()`'s existing `.closest()` pattern
 *   in `selection.ts`).
 * - **Canvas mode:** uses `handle.hitTestRow(clientX, clientY)`'s extended `{ hitToggle }`
 *   result on `click` — the same event type SVG mode listens for, so both paths share one
 *   listener registration shape.
 *
 * Discriminates SVG vs Canvas via `handle.hitTestRow`'s presence (`if (handle.hitTestRow)`),
 * the exact same pattern `selection.ts`'s `resolveHit()` uses — no defensive `'hitTestRow' in
 * handle`/`typeof` check needed, since `InteractiveRendererHandle.hitTestRow` (and its
 * `{ hitToggle }` result shape) is now typed identically to what `CanvasRendererHandle` actually
 * implements.
 *
 * `getTasks` is accepted for API symmetry with the other `enableXxx` factories (same posture
 * `enableClickSelect` documents for its own unused-for-hit-testing `getTasks` parameter) — task
 * identity for a toggle comes straight from the DOM (`data-task-id`) or `hitTestRow()`'s
 * pixel-space lookup, matching exactly what's on screen.
 */
export function enableCollapseToggle(
  handle: SvgRendererHandle | CanvasRendererHandle,
  _getTasks: () => readonly Task[],
  options: CollapseToggleOptions,
): () => void {
  const listenerTarget = handle.pointerEventTarget as Element;
  let disposed = false;

  listenerTarget.addEventListener('click', onClick);

  return dispose;

  function onClick(rawEvent: Event): void {
    if (disposed) return;
    const event = rawEvent as MouseEvent;

    if (handle.hitTestRow) {
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      const hit = handle.hitTestRow(event.clientX, event.clientY);
      if (hit && hit.hitToggle) {
        options.onToggleCollapse(hit.taskId);
      }
      return;
    }

    if (!(event.target instanceof Element)) return;
    const toggleEl = event.target.closest('.fg-timeline__row-toggle');
    if (!toggleEl) return;
    const rowEl = toggleEl.closest('.fg-timeline__row');
    const idAttr = rowEl?.getAttribute('data-task-id');
    if (idAttr === null || idAttr === undefined) return;
    options.onToggleCollapse(toTaskId(idAttr));
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    listenerTarget.removeEventListener('click', onClick);
  }
}
