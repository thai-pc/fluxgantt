// Opt-in responsive/touch capability mixin (spec-responsive-mobile.md; spec §9.1 Wave 1 Week 7
// "Responsive mobile").
//
// WHY A MIXIN AND NOT A `GanttConfig` FLAG: unlike the i18n scaffold — whose message functions
// must be READ FROM INSIDE `renderer-base.ts` mid-render, which is exactly why that one had to
// become a config field and why it cost the `withRender + withInteraction` budget its one
// documented raise — everything this capability does is done from OUTSIDE the renderer: inject a
// `<style>`, set `touch-action` on an element, push `setOptions()` into the live handle, own a
// `ResizeObserver` and one `pointerdown` listener. That is `withTheme`'s shape exactly, and it is
// the only shape that keeps all six existing size fixtures at +0 B (golden rule 5: change the
// shape, not the budget).
//
//   import { createGantt } from '@fluxgantt/core';
//   import { withRender } from '@fluxgantt/core/render';
//   import { withInteraction } from '@fluxgantt/core/interaction';
//   import { withResponsive } from '@fluxgantt/core/responsive';
//   const gantt = withResponsive(withInteraction(withRender(createGantt({ tasks }))));
//   gantt.mount(el); // adapts itself — no further calls required
//
// THE TOUCH-ARBITRATION DESIGN (the substantive decision here). Naively the fix for "a finger on
// a task bar scrolls the container instead of dragging it" is `touch-action: none`. It is not,
// for two reasons that together rule out every reactive approach:
//
//   1. `touch-action` is NOT honoured on SVG child elements — they establish no CSS box — so
//      scoping it to `.fg-task__bar`, the intuitive move, silently does nothing in Chrome and
//      WebKit. It has to go on the root element that receives the pointer events.
//   2. The browser LATCHES the value at hit-test time, so flipping it inside the `pointerdown`
//      handler cannot affect the in-flight gesture.
//
// And a blanket `touch-action: none` on that root would kill container scrolling, which on a
// phone is the PRIMARY interaction (the chart is far wider than the screen). So this mixin takes
// over panning: it declares `touch-action: none` on the renderer root (inside a `(pointer: coarse)`
// media query, see `COARSE_STYLE_TEXT`) and installs its own recognizer on `pointerEventTarget`,
// where a `pointerdown` that did NOT land on a task bar pans by writing
// `container.scrollLeft/scrollTop`, and a `pointerdown` that DID is left entirely alone so
// `interaction/pointer-drag.ts`'s existing coordinator claims it. Consequences, both intended:
// drag-move/resize/create-dependency work with zero browser interference and no `pointercancel`
// race, `interaction/pointer-drag.ts` needs no change at all, and native page pinch-zoom is
// suppressed while the finger is on the chart — the right trade for a chart surface, and where
// the deferred chart-level pinch-to-zoom ticket will land.
import type { GanttInstance } from '../gantt.js';
import { getInternal } from '../gantt-internal.js';
import type { Density } from '../types.js';

const COARSE_QUERY = '(pointer: coarse)';

/** `LABEL_COLUMN_WIDTH` from `render/svg-renderer.ts`, as the CEILING this mixin never exceeds —
 *  duplicated rather than imported, deliberately: importing from `render/` would drag the whole
 *  renderer into this subpath's module graph and defeat the facade split (same module-isolation
 *  posture `render/canvas-renderer.ts` keeps toward `svg-renderer.ts`). It is a ceiling only, so
 *  a drift here narrows the column slightly — it can never paint wrong geometry. */
const DEFAULT_LABEL_COLUMN_WIDTH = 160;

/** Coarse-pointer overrides that are pure CSS. Injected as one `<style>` into the mount
 *  container rather than living in `svg-renderer.ts`'s own stylesheet literal, because every
 *  character of that literal is SHIPPED in `withRender`'s bundle whether or not a consumer cares
 *  about touch — this block measured ~480 B gzip there, against 307 B of headroom.
 *
 *  Redefining the TOKEN rather than the `r` attribute is what makes the handle rule work at all:
 *  `r` is written inline per circle as `var(--fg-link-handle-radius, 4px)`, and an inline
 *  declaration beats any stylesheet rule on `r` — but the custom property it reads INHERITS from
 *  here. 12px (a 24px target, WCAG 2.2 SC 2.5.8's minimum) and not larger, deliberately: the
 *  revealed handle sits ON the bar's end anchor at a higher gesture priority than drag-resize, so
 *  it shadows that recognizer's edge zone, and `COARSE_EDGE_HIT_ZONE_PX` (24, in
 *  `interaction/drag-resize.ts`) is strictly wider — which is what leaves a reachable band of
 *  edge-resize beside the handle instead of making touch resize unreachable. Change one and
 *  re-check the other.
 *
 *  Note the override order the `.fg-timeline` selector implies: a host (or `withTheme`) setting
 *  `--fg-link-handle-radius` on the MOUNT CONTAINER does NOT win over this, because the container
 *  is an ANCESTOR and custom-property resolution takes the nearest declaration, not the most
 *  specific selector. Opting out means setting the token on `.fg-timeline` itself — documented in
 *  docs/responsive.mdx.
 *
 *  `touch-action: none` lives HERE, in a media-gated rule, rather than being set inline on the
 *  renderer root: an inline declaration would apply on a desktop too (the mixin can only observe
 *  the pointer type through `matchMedia`, which a media query does natively and keeps in sync
 *  without a listener round-trip), and the media query is also what makes `destroy()`'s cleanup a
 *  single node removal instead of a per-element style unwind. Both renderer roots are named
 *  because `.fg-timeline-canvas` is deliberately a DIFFERENT block class, not a modifier of
 *  `.fg-timeline`. See the module header for WHY the root and not `.fg-task__bar` (SVG children
 *  establish no CSS box, so `touch-action` is not honoured on them).
 *
 *  Static, compile-time text: nothing here is derived from task or host data, and it is assigned
 *  via `.textContent`, never `innerHTML` (security.md §1). */
const COARSE_STYLE_TEXT = `
@media ${COARSE_QUERY} {
  .fg-timeline, .fg-timeline-canvas { touch-action: none; }
  .fg-timeline { --fg-link-handle-radius: 12px; }
}
`;

/** Marks the `<style>` this mixin owns, so `destroy()` removes exactly its own node and never a
 *  host's. */
const STYLE_MARKER = 'data-fg-responsive';

/** Tunables for `withResponsive()`. Passed as a SECOND ARGUMENT rather than added to
 *  `GanttConfig`: nothing here is read from inside a renderer, so there is no reason to widen the
 *  base type graph (and every field added there is billed to fixtures that never import this). */
export interface ResponsiveOptions {
  /** `Density` to switch to under a coarse pointer. Default `'touch'` (48px rows — see
   *  `ROW_HEIGHT` in `render/renderer-base.ts` for why 48 and not 44). Pass an existing level to
   *  keep desktop sizing while still getting the touch arbitration and the label-column clamp. */
  readonly touchDensity?: Density;
  /** Fraction of the container's width the label column may occupy. Default `0.4`. */
  readonly labelColumnRatio?: number;
  /** Floor (px) for the computed label column — below this the column stops being readable and
   *  a narrower one buys nothing. Default `96`. */
  readonly minLabelColumnWidth?: number;
}

/** The methods `withResponsive()` adds to a `GanttInstance`. Kept deliberately tiny — this
 *  capability is meant to need no calls at all. */
export interface ResponsiveCapability {
  /** Whether a coarse pointer is CURRENTLY reported. `false` in an environment with no
   *  `matchMedia` (a non-DOM runtime, jsdom without a stub) — the same degrade-quietly posture
   *  `withTheme` takes for `prefers-color-scheme`. */
  isCoarsePointer(): boolean;
  /** The label-column width (px) this mixin last pushed into the renderer, or the default while
   *  unmounted / before the first observed resize. */
  getLabelColumnWidth(): number;
}

export function withResponsive<T extends GanttInstance>(
  instance: T,
  options: ResponsiveOptions = {},
): T & ResponsiveCapability {
  const internal = getInternal(instance);

  const touchDensity: Density = options.touchDensity ?? 'touch';
  // Host-supplied numbers are untrusted input (security.md: validate, don't propagate) — a
  // `NaN`/Infinity ratio would make every computed width `NaN`, which `clamp()` below would
  // happily pass through into the renderer's geometry.
  const ratio =
    options.labelColumnRatio !== undefined && Number.isFinite(options.labelColumnRatio)
      ? Math.max(0, options.labelColumnRatio)
      : 0.4;
  const minWidth =
    options.minLabelColumnWidth !== undefined && Number.isFinite(options.minLabelColumnWidth)
      ? Math.max(0, options.minLabelColumnWidth)
      : 96;

  // Queried ONCE, mirroring `theme/mixin.ts`: `undefined` where the host has no `matchMedia`.
  const mql = typeof matchMedia === 'function' ? matchMedia(COARSE_QUERY) : undefined;

  let disposed = false;
  let labelColumnWidth = DEFAULT_LABEL_COLUMN_WIDTH;
  let styleEl: HTMLStyleElement | undefined;
  let observer: ResizeObserver | undefined;
  // The element the pan listeners were installed on. Remembered rather than re-derived at
  // teardown time, so an unmount that has already cleared the mount slot still detaches from the
  // right node.
  let panTarget: Element | undefined;
  // Live pan gesture: the pointer that started it plus the scroll offsets and client coords it
  // started at. Absolute-delta arithmetic (not incremental accumulation) — a dropped `pointermove`
  // then costs nothing, where accumulating would drift.
  let pan: { id: number; startX: number; startY: number; left: number; top: number } | undefined;

  const isCoarse = (): boolean => mql?.matches === true;

  const clampLabelWidth = (containerWidth: number): number => {
    if (!Number.isFinite(containerWidth) || containerWidth <= 0) return DEFAULT_LABEL_COLUMN_WIDTH;
    return Math.min(DEFAULT_LABEL_COLUMN_WIDTH, Math.max(minWidth, containerWidth * ratio));
  };

  const onPointerDown = (event: Event): void => {
    const pe = event as PointerEvent;
    const mount = internal.getMountState();
    if (disposed || !mount || pan !== undefined) return;
    // A pointerdown ON a task bar belongs to `interaction/pointer-drag.ts` — claiming it here
    // would break drag-move/resize/create-dependency, which is the whole point of NOT making
    // this a blanket gesture handler. `closest()` walks up through the bar/label/progress children
    // to the `<g class="fg-task">` group the recognizers key off.
    const target = pe.target;
    if (target instanceof Element && target.closest('.fg-task[data-task-id]') !== null) return;
    const { container } = mount.rendererHandle;
    pan = {
      id: pe.pointerId,
      startX: pe.clientX,
      startY: pe.clientY,
      left: container.scrollLeft,
      top: container.scrollTop,
    };
  };

  const onPointerMove = (event: Event): void => {
    const pe = event as PointerEvent;
    const mount = internal.getMountState();
    if (!pan || pe.pointerId !== pan.id || !mount) return;
    const { container } = mount.rendererHandle;
    // Inverted: dragging the content LEFT reveals content to the right, i.e. scrolls forward —
    // the direct-manipulation convention every native scroller uses. The browser self-clamps
    // `scrollLeft`/`scrollTop` to the valid range, so no manual clamp is needed.
    container.scrollLeft = pan.left - (pe.clientX - pan.startX);
    container.scrollTop = pan.top - (pe.clientY - pan.startY);
  };

  const onPointerEnd = (event: Event): void => {
    const pe = event as PointerEvent;
    // `pointercancel` is handled by the same path as `pointerup`: there is nothing to roll back
    // (the scroll offsets already written ARE the result), so both simply end the gesture.
    if (pan && pe.pointerId === pan.id) pan = undefined;
  };

  /** Installs or removes everything that is conditional on the pointer being coarse. Idempotent
   *  in both directions — re-entered on every mount and on every `matchMedia` change. */
  function applyCoarse(): void {
    const mount = internal.getMountState();
    if (!mount) return; // headless or unmounted — re-applied from `renderer:selected`
    const { container, pointerEventTarget } = mount.rendererHandle;

    if (isCoarse()) {
      if (!styleEl) {
        styleEl = container.ownerDocument.createElement('style');
        styleEl.setAttribute(STYLE_MARKER, '');
        styleEl.textContent = COARSE_STYLE_TEXT;
        container.appendChild(styleEl);
      }
      if (panTarget !== pointerEventTarget) {
        detachPan();
        panTarget = pointerEventTarget;
        panTarget.addEventListener('pointerdown', onPointerDown);
        panTarget.addEventListener('pointermove', onPointerMove);
        panTarget.addEventListener('pointerup', onPointerEnd);
        panTarget.addEventListener('pointercancel', onPointerEnd);
      }
      mount.rendererHandle.setOptions({ density: touchDensity });
    } else {
      teardownCoarse();
      // Hand density back to whatever the host configured, rather than leaving the chart on touch
      // sizing after a tablet is docked to a mouse. `undefined` is not usable here — `setOptions`
      // MERGES — so the config value (or the renderer default) is restored explicitly.
      mount.rendererHandle.setOptions({ density: internal.config.density ?? 'default' });
    }
  }

  /** Pushes a freshly measured label-column width into the live handle. Runs on every observed
   *  container resize, which is the WHOLE of "the chart reacts to container size": no
   *  `ResizeObserver` is added to the SVG renderer itself, because nothing else in its
   *  content-sized geometry depends on container width. */
  function applyLabelWidth(containerWidth: number): void {
    const mount = internal.getMountState();
    if (disposed || !mount) return;
    const next = clampLabelWidth(containerWidth);
    if (next === labelColumnWidth) return; // no repaint for a resize that changes nothing
    labelColumnWidth = next;
    mount.rendererHandle.setOptions({ labelColumnWidth: next });
  }

  function observeContainer(): void {
    const mount = internal.getMountState();
    if (!mount) return;
    observer?.disconnect();
    // Feature-detected and degrading quietly, the same posture (and for the same reason) as
    // `render/canvas-renderer.ts`'s own observer: a runtime without `ResizeObserver` keeps the
    // default 160px column rather than throwing.
    if (typeof ResizeObserver !== 'function') return;
    const { container } = mount.rendererHandle;
    observer = new ResizeObserver(() => {
      applyLabelWidth(container.clientWidth);
    });
    observer.observe(container);
    // Observers fire asynchronously; measure once now so the FIRST paint a host sees is already
    // adapted rather than flashing a 160px column on a 393px viewport.
    applyLabelWidth(container.clientWidth);
  }

  function detachPan(): void {
    if (!panTarget) return;
    panTarget.removeEventListener('pointerdown', onPointerDown);
    panTarget.removeEventListener('pointermove', onPointerMove);
    panTarget.removeEventListener('pointerup', onPointerEnd);
    panTarget.removeEventListener('pointercancel', onPointerEnd);
    panTarget = undefined;
    pan = undefined;
  }

  function teardownCoarse(): void {
    styleEl?.remove();
    styleEl = undefined;
    detachPan();
  }

  const onPreferenceChange = (): void => {
    if (!disposed) applyCoarse();
  };
  mql?.addEventListener('change', onPreferenceChange);

  // A container only exists after a successful mount, and `renderer:selected` is emitted exactly
  // once per mount (both the sync SVG path and the async Canvas one). Using the public event
  // rather than a new `GanttInternal` slot keeps mixin application order irrelevant and adds
  // nothing to the shared interface — `theme/mixin.ts`'s precedent verbatim.
  instance.on('renderer:selected', () => {
    if (disposed) return;
    // The previous mount's nodes are gone; forget them before re-installing on the new ones.
    teardownCoarse();
    applyCoarse();
    observeContainer();
  });

  const capability: ResponsiveCapability = {
    isCoarsePointer(): boolean {
      return isCoarse();
    },
    getLabelColumnWidth(): number {
      return labelColumnWidth;
    },
  };

  // Compose over the instance's own `destroy()` — no teardown hook is added to `GanttInternal`,
  // whose every byte is billed to fixtures that never import this module. Idempotent from both
  // directions: the inner `destroy()` already guards, and `disposed` guards this half.
  const destroy = instance.destroy.bind(instance);
  return Object.assign(instance, capability, {
    destroy(): void {
      if (!disposed) {
        disposed = true;
        mql?.removeEventListener('change', onPreferenceChange);
        observer?.disconnect();
        observer = undefined;
        // Hand the host its element back as we found it: the container belongs to the HOST (the
        // renderers only ever remove nodes they themselves appended), so an orphaned `<style>`
        // — which is document-global, not container-scoped — would keep suppressing
        // `touch-action` on whatever the host mounts there next. Same argument as
        // `theme/mixin.ts`.
        teardownCoarse();
      }
      destroy();
    },
  });
}
