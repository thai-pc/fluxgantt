---
'@fluxgantt/core': minor
---

The SVG renderer now pins the date axis to the top of the scroll container (Canvas already did). The header is replicated in a `position: sticky`, `aria-hidden` `<svg class="fg-timeline__sticky-header">` placed after the chart `<svg>`, so `container.querySelector('svg')`, the ARIA grid, the exported SVG/PNG and drag/hit-testing are unchanged.

Observable changes:

- The container gains one sibling `<svg>` (`.fg-timeline__sticky-header`), and the chart `<svg>` gets `style="display:block"` (no inline descender gap under the chart; the exported SVG root carries it too).
- The label-column corner of the header is now painted with the header colour (`--fg-bg-subtle`) in SVG mode, so scrolled row labels do not show through the date axis.
- `scrollToTask` and `setDensity` use the same coordinates for SVG and Canvas: `align: 'start'` now puts the row directly under the 32px header (`scrollTop = row.y`), and the usable row band is `clientHeight - 32`. SVG `scrollTop` values shift by 32px compared with 0.3.x.
- Pointer events over the pinned header no longer reach the chart `<svg>`: clicking the header no longer clears the selection, and a dependency drag released over it links nothing.
- Ctrl+wheel zoom is now bound to the chart container, so it also works over the pinned header (and over blank container area).
- While mounted, the container's inline `scroll-padding-top` is `32px` so natively focus-scrolled rows stop below the header. A host-set inline value is overwritten while mounted and restored on unmount.
- The container must be laid out as a block or grid, not a flex container: a float is ignored on a flex item, so a flex row places the pinned header beside the chart and a flex column with an auto height collapses to about 32px (a flex column with a fixed height is fine). Give the scroll container no `padding-top` (a sticky box pins at the padding edge, so rows would show through the strip above it). The label column still scrolls away horizontally.
- Hosts where the page scrolls instead of the container (no `overflow`) now get the header pinned to the browser viewport top while the page scrolls through the chart; a fixed host navbar will cover it. Layout is unchanged.
- Right-to-left hosts: the header follows the chart's inline-start edge (`float: inline-start`), so the date labels stay aligned with the day columns.
- Firefox ignores `scroll-padding-top` when focusing an SVG row (it scrolls the container to the top); this predates the change.
