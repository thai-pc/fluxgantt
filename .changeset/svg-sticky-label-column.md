---
'@fluxgantt/core': minor
---

The SVG chart now pins its label column to the inline-start edge on horizontal scroll (Canvas still scrolls it), together with the date axis and a top-left corner, all inside one new wrapper `div.fg-timeline__layer` between the container and the chart `<svg>`. Visible and structural changes:

- Hosts that select `container > svg` break (the wrapper is in between); `container.querySelector('svg')` is still the chart. `SvgRendererHandle.pointerEventTarget` is now that wrapper (`HTMLElement`), and `InteractiveRendererHandle` gains `container`. New classes: `fg-timeline__layer`, `fg-timeline__sticky-column`, `fg-timeline__sticky-corner`.
- Any container `display` now works (flex and grid hosts, auto height); the old float and negative margin are gone. Container `padding` still shifts the pinned layers and `scrollToTask`/`scrollToDate` by its size.
- The pinned column is drawn by `aria-hidden` clones of each label and toggle; the real labels stay in the chart for assistive tech and export and are hidden on screen. A name wider than `labelColumnWidth` is cut at the column edge on screen (exports keep the full name). The column ground is `var(--fg-bg, #fff)`: set `--fg-bg` on a non-white page.
- Clicking a pinned label or toggle behaves like clicking the real one; clicking the blank column or the date band now clears the selection (the band used to swallow clicks). Tests that count `[data-task-id]`/`.fg-timeline__row-label` over the whole container also see the clones: scope to `svg.fg-timeline`.
- Dividers are pixel-snapped (header line at y 31.5, label line at x offset - 0.5): one crisp line instead of two half-covered rows, which also fixes the darker line at scrollTop 0. Exported SVG reflects the new coordinates.
- Horizontal `scrollToTask`/`scrollToDate` numerics for SVG shift by the label width: the bar now parks right of the column, not under it.
- `withResponsive()` also sets `touch-action: none` on the wrapper so a finger on the pinned layers pans.
