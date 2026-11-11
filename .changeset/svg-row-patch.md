---
'@fluxgantt/core': patch
---

SVG charts at 2000 tasks no longer repaint the whole chart when only the selection or the keyboard focus changes. `select()`, a click, Shift+Arrow and ArrowUp/ArrowDown now rebuild just the rows whose selection or roving-tabindex state changed (one to four rows) instead of ~16k SVG nodes plus the pinned header and label-column clones. Zoom, density, collapse, `updateTask` and data changes still repaint once; `selectAll()` / `deselect()` rebuild every row but skip the rest of the chart.

- `SvgRendererInput` gains an optional `rev` data-revision token. Equal tokens across two `update()` calls assert that tasks, dependencies, critical path, calendar, collapsed ids and rollup are unchanged, which allows the row patch. Omitted, every `update()` is a full render exactly as before. `withRender()` supplies it; `refresh()` still recomputes and repaints everything.
- `SvgRendererOptions.onPaint` is now also called after a row patch, with the chart svg only. It must be idempotent and cheap. `withRtl()` (the only in-repo user) re-mirrors the rebuilt rows; `mirrorSvg()` is now incrementally idempotent.
- Output is byte-identical to a full render (property-tested over random operation sequences, LTR and RTL). Not repeated on a patch: the clock read for the today wash (stale across local midnight until the next full render) and the "end before start" `console.warn`.
- Bytes were found elsewhere first (row builder as a closure, single-caller builders inlined, `append(string)` instead of `createTextNode`, shorter diagnostics); see the table in CLAUDE.md golden rule 5. No limit changed.

Timings (2000 SVG tasks, p50 of fresh pages to two rAFs, loaded dev machine, so only the ratios mean anything): PROVISIONAL, to be filled from the final calibration run.
