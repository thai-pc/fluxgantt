// Interaction layer — mouse wheel + Ctrl zoom (spec §8.4 "Zoom" table, row 1). A single
// `wheel` listener on `handle.svg`, active ONLY when `event.ctrlKey` is set — a plain wheel
// event (the overwhelmingly common case: normal vertical/trackpad scroll over the chart) is
// completely untouched: no `preventDefault()`, no zoom call, so the container's own
// `overflow: auto` scrolling and the host page's own scroll behavior are never disturbed.
//
// `ctrlKey` only, deliberately NOT `ctrlKey || metaKey` (unlike selection.ts's click-modifier
// check and the keyboard Ctrl/Cmd+Plus/Minus binding) — see spec-wheel-zoom.md §1: a macOS
// trackpad pinch gesture is delivered to the page as a synthetic `wheel` event with
// `ctrlKey: true` by browser/OS convention, but there is no equivalent real "Cmd+wheel"
// physical gesture a user performs — `metaKey` on a wheel event has no zoom meaning on any
// platform and no browser-native collision to guard against.
//
// event.preventDefault() is called on every Ctrl+wheel match (regardless of deltaY's sign,
// including the deltaY === 0 no-direction case) — Ctrl+wheel is every major browser's own
// native page-zoom trigger AND (per the trackpad note above) how macOS delivers pinch-zoom;
// without it, the host page would zoom/pinch-zoom AND the chart would zoom simultaneously.
//
// No throttle/debounce/rAF batching (deliberate, not a shortcut — see plan §4 point 3):
// `zoomIn()`/`zoomOut()` step through a fixed 5-level `ZOOM_LEVELS` array and `zoomTo()`
// itself already no-ops (zero repaint) at either boundary, so even an unthrottled wheel burst
// triggers at most 4 real repaints before every further event in the same burst becomes a
// free no-op.
//
// TOUCHES THE DOM (native WheelEvent) — this is the interaction layer, explicitly permitted
// per architecture.md. Imports nothing outside `@fluxgantt/core`'s own tree (no react/vue/
// svelte).
import type { SvgRendererHandle } from '../render/svg-renderer.js';

export interface WheelZoomOptions {
  /** Ctrl+wheel with `deltaY < 0` (scroll "up"/away from the user — the conventional
   *  zoom-in direction, matching pinch-out-to-zoom-in and the Google-Maps/Figma
   *  convention). Call site: `gantt.zoomIn()` directly. */
  onZoomIn: () => void;
  /** Ctrl+wheel with `deltaY > 0` (scroll "down"/toward the user). Call site:
   *  `gantt.zoomOut()` directly. */
  onZoomOut: () => void;
}

/**
 * Attaches Ctrl+wheel zoom to a mounted `SvgRendererHandle`. Returns a disposer (bare
 * function, matching `enableDragMove`/`enableDragResize`/`enableDragCreateDep`/
 * `enableClickSelect`'s return shape — NOT the `{ dispose, getFocusedTaskId }` shape
 * `enableKeyboardNav` uses, since this module has no analogous focus state to expose).
 *
 * NOT gated by `readOnly` — `zoomIn()`/`zoomOut()` touch only the viewport signal and,
 * when mounted, `container.scrollLeft` (pure view/scroll state), never `TaskStore`/
 * `DependencyStore`/`SelectionStore` — same posture as the Ctrl/Cmd+Plus/Minus keyboard
 * zoom binding (spec-zoom-keybinding.md §4). Register unconditionally at the `mount()`
 * call site.
 */
export function enableWheelZoom(
  handle: SvgRendererHandle,
  options: WheelZoomOptions,
): () => void {
  let disposed = false;

  // `{ passive: false }` is required — browsers default `wheel` listeners to passive for
  // scroll-perf reasons, which silently makes `preventDefault()` a no-op. Without this,
  // Ctrl+wheel would still fire onZoomIn/onZoomOut but could NOT suppress the browser's own
  // native page-zoom/pinch-zoom, defeating the whole point of calling preventDefault() at
  // all (spec-wheel-zoom.md §5).
  handle.svg.addEventListener('wheel', onWheel, { passive: false });

  return dispose;

  function onWheel(event: WheelEvent): void {
    if (disposed) return;
    if (!event.ctrlKey) return; // plain wheel (or Cmd+wheel) — not this binding's concern, not prevented
    event.preventDefault();
    if (event.deltaY < 0) {
      options.onZoomIn();
    } else if (event.deltaY > 0) {
      options.onZoomOut();
    }
    // deltaY === 0: prevented (matches every browser's own Ctrl+wheel-is-always-a-zoom-
    // gesture treatment) but no direction to infer — no callback fires.
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    handle.svg.removeEventListener('wheel', onWheel);
  }
}
