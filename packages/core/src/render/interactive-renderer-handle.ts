// Shared structural contract between `SvgRendererHandle` and `CanvasRendererHandle`
// (spec-canvas-renderer-ticket2.md §3.3). Pure type-only module — zero runtime bytes, no DOM
// API calls of its own, safe to import from both `svg-renderer.ts` and `canvas-renderer.ts`
// without violating either file's module-isolation rules.
import type { TaskId } from '../types.js';

/**
 * Minimal structural contract both `SvgRendererHandle` and `CanvasRendererHandle` satisfy.
 * `interactionRoot` (typed `Element` — the narrowest common ancestor of `SVGSVGElement` and
 * `HTMLElement` that both share) is where `enableClickSelect`/`enableKeyboardNav` query
 * `.fg-timeline__row` structure and where `enableKeyboardNav` attaches its `keydown` listener.
 * `pointerEventTarget` is where `enableClickSelect` attaches its `pointerdown` listener — for
 * SVG this is the SAME node as `interactionRoot` (the visible `<svg>` receives real pointer
 * events directly); for Canvas it is the visible `<canvas>`, a DIFFERENT node than
 * `interactionRoot` (the hidden ARIA layer never receives real pointer events). The optional
 * `hitTestRow` method is the Canvas-only pixel-space row-resolution path; its absence (SVG)
 * signals `enableClickSelect` to fall back to the existing DOM-`.closest()` path.
 *
 * NOT satisfied by `handle.svg`'s SVG-specific affordances (`viewBox`, `getBoundingClientRect`
 * pixel↔content-space conversion) — those stay on `SvgRendererHandle` only, consumed only by
 * `drag-move.ts`/`drag-resize.ts`/`drag-create-dep.ts`/`wheel-zoom.ts`, unchanged, out of this
 * ticket's scope.
 */
export interface InteractiveRendererHandle {
  readonly interactionRoot: Element;
  readonly pointerEventTarget: Element;
  hitTestRow?(clientX: number, clientY: number): { taskId: TaskId; rowIndex: number } | undefined;
}
