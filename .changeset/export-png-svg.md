---
"@fluxgantt/core": minor
---

feat(core): PNG/SVG export

Add `gantt.exportSvg(options?): string` and `gantt.exportPng(options?): Promise<Blob>` (and
the underlying `exportSvg`/`exportPng` functions taking an `SVGSVGElement`). Both serialize the
currently-mounted chart; they require a mounted renderer and throw (svg) / reject (png) with a
clear "not mounted" message otherwise.

`exportSvg` deep-clones the live SVG and, by default, bakes each element's `getComputedStyle`-
resolved paint values inline so the output matches the host's actual theme (WYSIWYG, including
any host override of `--fg-*` tokens) — accepting modern space-separated CSS Color 4
serializations, reusing `Task.color`'s whitelist for the legacy forms. It strips the
interaction-only link-handle circles and their hover `<style>`, promotes `aria-label` into a
`<title>`, emits an XML declaration + `xmlns`. Security (security.md §1): user text stays inert
(text nodes escaped by `XMLSerializer`), the `<title>` is set via `textContent`, and every
baked value passes a safety gate that blocks `javascript:`/`expression(`/external `url()`.

`exportPng` rasterizes the baked SVG onto a canvas (default solid-white background, overridable;
`scale` for HiDPI) and resolves a `Blob`. It validates `scale`/`background`/dimensions up front
(rejecting non-numeric SVG size, a degenerate sub-pixel scale, and outputs past the per-side or
total-area canvas limit) so a bad request is a clear rejection rather than a silent blank raster.

`exportPng` is a separate module importing `exportSvg` one-directionally, so importing only
`exportSvg` never pulls the canvas path into a consumer's bundle. PDF/branding remains Pro
(out of scope).
