---
'@fluxgantt/core': minor
---

Seams for the upcoming grid-columns mixins; no visible change on its own.

Beta: `SvgRendererHandle.paintHooks` (a list of `PaintHook` consumers, called with a `PaintEvent`) replaces the single `SvgRendererOptions.onPaint` option, which is removed. After a full render a hook receives the chart svg and the three pinned layers; after a selection or focus row patch it receives the svg and the rows the patch rebuilt (`PaintEvent.rows`). `withRtl` now registers through it. If you passed `onPaint` to `createSvgRenderer` yourself, push a hook onto `handle.paintHooks` instead.

Beta: `InteractiveRendererHandle.fixedLabelWidth` (when set, `withResponsive` stops writing the label-column width; `getLabelColumnWidth()` then reports the painted width), an optional `columnId` on `hitTestRow` results, and an optional `columnId` (`@beta`) on the `task:activated` / `task:context-requested` payloads.

Stable, additive: `'cell'` is a new member of the `@public` union `TaskHitPart`. It appears only in output positions (event payloads), which STABILITY.md allows in a minor; nothing reports it yet. Hosts with an exhaustive `switch` or `Record<TaskHitPart, ...>` need a `default` branch (STABILITY.md now lists `TaskHitPart` among the output unions to handle).

Fix: after `unmount()` and `mount()`, `withResponsive`'s `getLabelColumnWidth()` reports the width the new mount painted (it kept the previous mount's value).

Bundle cost (gzip): hello world +0 B, `+ withRender + withInteraction` +80 B, kitchen sink +82 B. A fourth hard size gate (everything composed, 35.25 KiB) is added to CI.
