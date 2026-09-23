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
 *
 * `hitTestRow`'s result carries `hitToggle` (spec-collapse-expand.md §6.3/§7.1) — `true` iff the
 * hit fell inside that row's collapse/expand toggle glyph gutter AND the row `hasChildren`. This
 * widened shape is declared here (not just on `CanvasRendererHandle`, its only implementor) so
 * `interaction/collapse-toggle.ts` can read `hit.hitToggle` through the shared structural type
 * without a defensive `'hitToggle' in hit` runtime check — the type itself is now the source of
 * truth, matching what the implementation actually returns.
 */
export interface InteractiveRendererHandle {
  readonly interactionRoot: Element;
  readonly pointerEventTarget: Element;
  /**
   * The label-column width (px) the most recent successful render actually painted with — the
   * live value, which `SvgRendererOptions`/`CanvasRendererOptions`'s `labelColumnWidth` may have
   * moved off the `LABEL_COLUMN_WIDTH` default (spec-responsive-mobile.md). Declared HERE, on the
   * shared contract, rather than on the two handles separately: consumers converting between the
   * renderer's painted coordinate space (which includes this offset) and `TimeScale`'s
   * content-only space (which does not) — `render/mixin.ts`'s scroll anchor today — must read it
   * from one place, because importing the constant is no longer correct once a mixin narrows the
   * column.
   */
  getLabelColumnWidth(): number;
  hitTestRow?(
    clientX: number,
    clientY: number,
  ): { taskId: TaskId; rowIndex: number; hitToggle: boolean } | undefined;
}
