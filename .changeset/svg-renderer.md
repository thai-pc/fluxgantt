---
"@fluxgantt/core": minor
---

feat(core): basic SVG renderer (render layer)

Add `createSvgRenderer(container, input, options?)` — the first render-layer surface. It
paints tasks (bars by `TaskKind`, hierarchy indent, milestones), FS/SS/FF/SF dependency
lines, a day grid with weekend/holiday shading, and critical-path highlighting into an
`<svg class="fg-timeline">`. Returns a handle with `update()`/`setOptions()`/`destroy()`.

Pure layout math (time-scale, row/bar/dependency geometry, grid columns) lives in
`renderer-base.ts` — headless, testable without a DOM, and the shared seam a future Canvas
renderer reuses. All date math calls back into the working-calendar/CPM compute layer.

Security-hardened (this is the first time core renders untrusted host data to the DOM):
`task.name` only via `createTextNode`, `task.color` through a strict full-match whitelist,
`task.type`/`dependency.type` whitelisted before class interpolation, constant `<marker>`
ids, bounded grid columns and hierarchy depth (DoS guards), and an ESLint rule banning
HTML-string sinks (`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`DOMParser`)
in `render/`. Critical tasks are distinguished with a dashed stroke, not color alone (a11y).

Adds `ViewMode`, `Density`, `TaskSchedule`-adjacent render types to the public surface.
