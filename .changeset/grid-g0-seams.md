---
'@fluxgantt/core': minor
---

Seams for the upcoming grid-columns mixins; no visible change on its own.

Beta: `SvgRendererHandle.paintHooks` (a list of `PaintHook` consumers, called with a `PaintEvent`) replaces the single `SvgRendererOptions.onPaint` option, which is removed. After a full render a hook receives the chart svg and the three pinned layers; after a selection or focus row patch it receives the svg and the rows the patch rebuilt (`PaintEvent.rows`). `withRtl` now registers through it. If you passed `onPaint` to `createSvgRenderer` yourself, push a hook onto `handle.paintHooks` instead.

Beta: `InteractiveRendererHandle.fixedLabelWidth` (when set, `withResponsive` stops writing the label-column width) and an optional `columnId` on `hitTestRow` results. Types only: `TaskHitPart` gains `'cell'` and the `task:activated` / `task:context-requested` payloads gain an optional `columnId`; nothing reports them yet.

Bundle cost (gzip): hello world +0 B, `+ withRender + withInteraction` +80 B, kitchen sink +82 B. A fourth hard size gate (everything composed, 35.25 KiB) is added to CI.
