// Shared structural contract between `SvgRendererHandle` and `CanvasRendererHandle`
// (spec-canvas-renderer-ticket2.md §3.3). Pure type-only module — zero runtime bytes, no DOM
// API calls of its own, safe to import from both `svg-renderer.ts` and `canvas-renderer.ts`
// without violating either file's module-isolation rules.
import type { TaskId } from '../types.js';

/** Where a press on a Canvas bar lands: a link handle, the resizable end edge, or the movable body. */
export type BarZone = 'link-start' | 'link-end' | 'resize-end' | 'body';

/** The bar zone a drag recognizer would claim at a point (see `InteractiveRendererHandle.hitTestBar`). */
export interface BarHit {
  /** Resolved from the laid-out rows, never parsed from DOM. */
  readonly taskId: TaskId;
  readonly zone: BarZone;
}

/**
 * Minimal structural contract both `SvgRendererHandle` and `CanvasRendererHandle` satisfy.
 * `interactionRoot` (typed `Element` — the narrowest common ancestor of `SVGSVGElement` and
 * `HTMLElement` that both share) is where `enableClickSelect`/`enableKeyboardNav` query
 * `.fg-timeline__row` structure and where `enableKeyboardNav` attaches its `keydown` listener.
 * `pointerEventTarget` is where `enableClickSelect` attaches its `pointerdown` listener — for
 * SVG this is the `.fg-timeline__layer` wrapper (it contains `interactionRoot` AND the pinned
 * overlays, so their events bubble to it); for Canvas it is the visible `<canvas>`, a DIFFERENT node than
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
  /** The host container: the scroll viewport in both renderers (SVG: the parent of the layer wrapper). */
  readonly container: HTMLElement;
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
  /**
   * Canvas only. Client-space anchor (label column, vertical centre of the painted row, clamped
   * into the visible canvas) for the row at `rowIndex`. The hidden ARIA layer's own rects are
   * meaningless, so keyboard-driven host UI (edit hooks) anchors here instead.
   */
  getRowAnchor?(rowIndex: number): { readonly clientX: number; readonly clientY: number };
  /**
   * Canvas only. The bar zone a drag recognizer would CLAIM at this client point, or `undefined`
   * (header, outside any bar, rolled-up body, milestone edge, or no drag attached, e.g. `readOnly`).
   * Its presence also tells the pointer-drag coordinator there is no per-bar DOM. `pointerType`
   * gates the link-handle zones: on touch they only claim for a selected bar (the only bars whose
   * handles are revealed there).
   */
  hitTestBar?(clientX: number, clientY: number, pointerType?: string): BarHit | undefined;
  /** `onBar` (Canvas): the point is inside the bar rect / milestone diamond, so edit hooks can use
   *  the drag threshold as the long-press slop. */
  hitTestRow?(
    clientX: number,
    clientY: number,
  ): { taskId: TaskId; rowIndex: number; hitToggle: boolean; onBar?: boolean } | undefined;
  /**
   * Present ONLY when the chart is painted mirrored (set by `withRtl`; do not rely on it). An
   * involution `x -> W - x` on the painted width `W` (label column + `timeScale.totalWidth`)
   * mapping between LAYOUT space (what the renderers compute) and the visual left-origin space of
   * the painted box, in either direction. Consumers use `handle.mirrorX?.(x) ?? x`; its presence is
   * also the single "is mirrored" predicate (dx sign, scroll sign).
   */
  mirrorX?: (x: number) => number;
}
