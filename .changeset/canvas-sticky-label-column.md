---
'@fluxgantt/core': minor
---

In Canvas mode (>= 2000 tasks) the label column and the top-left corner now stay pinned on horizontal scroll, like SVG. Visible and structural changes:

- A new internal `canvas.fg-timeline-canvas-labels` element (`aria-hidden`, `pointer-events: none`, `position: sticky`) is added after the chart canvas, so `container > canvas` selectors match more than one element: use `.fg-timeline-canvas`. The chart canvas is now `display: block` (the inline descender gap under it is gone, so `scrollHeight` is a few px smaller). `pointerEventTarget` is still the chart canvas.
- A name wider than `labelColumnWidth` is cut at the column edge on screen instead of spilling over the grid and bars (exports keep the full name). The column ground is `var(--fg-bg, #fff)`: set `--fg-bg` on a non-white page.
- Pointer hits on the pinned column act on the label (`part: 'label'`, toggle, selection), never on a bar underneath, a drag cannot start there and a link cannot be dropped there (a bar moved or resized by a drag that ends over the column still commits by its delta, as in SVG). The zone is the label canvas's own box, so a padded container is handled. `getRowAnchor` (keyboard context-menu requests) anchors on the pinned column.
- Horizontal scrolling no longer repaints the chart: only vertical scroll, resize and option changes do. Cheaper per scroll frame.
- Horizontal `scrollToTask`/`scrollToDate` numerics for Canvas shift by the label width: the bar now parks right of the column, not under it (the same as SVG).
- In RTL the column pins to the visual right. WebKit does not pin sticky elements inside an RTL scroll container, so there it follows scroll about one frame late.
- No API, option or event change; exports are unchanged.
- A Canvas click on a row's collapse toggle now only collapses/expands: it no longer also fires `selection:changed` (SVG already behaved so).
