// Opt-in RTL chart mirroring (spec-rtl-chart.md; spec section 7.6).
//
//   const gantt = withRtl(withRender(createGantt({ tasks, rtl: true })));
//
// Inert unless `config.rtl === true` (so wrappers can compose it unconditionally). Same shape as
// `theme/mixin.ts`: no instance methods, wired from the public `renderer:selected` event (so
// application order vs `withRender`/`withInteraction` is irrelevant), and it imports nothing from
// `render/` or `interaction/` — the live handle is reached through the mount slot.
//
// What it does on each mount: sets `dir="rtl"` on the container (restored when the handle is
// destroyed), exposes `handle.mirrorX` (the single "is mirrored" predicate the interaction and
// viewport layers consult), mirrors the painted svg through the renderer's `onPaint` seam (or
// flips the Canvas renderer natively), and swaps the zoom anchor for a logical-scroll variant.
//
// Scroll model: evergreen browsers count `scrollLeft` from 0 at the inline-start (right) edge down
// to negative values in a `dir=rtl` scroll container. The logical offset is `-scrollLeft`.
import type { GanttInstance } from '../gantt.js';
import { getInternal } from '../gantt-internal.js';
import { mirrorSvg } from './mirror-svg.js';

export function withRtl<T extends GanttInstance>(instance: T): T {
  const internal = getInternal(instance);
  if (internal.config.rtl !== true) return instance;

  instance.on('renderer:selected', () => {
    const mount = internal.mountOf();
    if (!mount) return; // a listener registered before this one may have unmounted during the emit
    const handle = mount.handle;
    const { container } = handle;
    const prior = container.getAttribute('dir');
    container.setAttribute('dir', 'rtl');

    const width = (): number => handle.getLabelColumnWidth() + handle.getTimeScale().totalWidth;
    handle.mirrorX = (x) => width() - x;

    // Every mount ends through the base class's teardown -> `handle.destroy()`, and there is no
    // unmount event, so wrap the handle's destroy (same pattern as `theme/mixin.ts`).
    const inner = handle.destroy;
    handle.destroy = (): void => {
      if (prior === null) container.removeAttribute('dir');
      else container.setAttribute('dir', prior);
      inner.call(handle);
    };

    // Logical-scroll zoom anchor: the base one assumes `scrollLeft >= 0`.
    mount.anchored = (mutate) => {
      const labelW = handle.getLabelColumnWidth();
      const anchorDate = handle
        .getTimeScale()
        .xToDate(-container.scrollLeft + container.clientWidth / 2 - labelW);
      mutate();
      container.scrollLeft = -(handle.getTimeScale().dateToX(anchorDate) + labelW - container.clientWidth / 2);
    };

    if ('canvas' in handle) {
      // Painted natively by the lazy Canvas chunk; only the throwaway export svg needs mirroring.
      const exportSvg = handle.createExportSvg;
      handle.createExportSvg = () => {
        const src = exportSvg.call(handle);
        mirrorSvg(src.svg, Number(src.svg.getAttribute('width')));
        return src;
      };
      handle.setOptions({ rtl: true });
    } else {
      handle.setOptions({
        onPaint: (...roots) => {
          for (const root of roots) mirrorSvg(root, width());
        },
      });
    }
  });

  return instance;
}
