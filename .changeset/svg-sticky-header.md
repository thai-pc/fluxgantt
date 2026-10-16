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
- The container must be laid out as a block (a flex-row container would place the pinned header beside the chart). The label column still scrolls away horizontally.
