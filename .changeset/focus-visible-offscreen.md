---
'@fluxgantt/core': patch
---

Keyboard focus is now visible when the focused task's bar is off screen or under the pinned label column (WCAG 2.4.7, 2.4.11). The focused row gets a 2 px frame across the chart and the pinned label column, in both the SVG and Canvas renderers; exported SVG and PNG are unchanged. Visible colour change: the default `--fg-task-focus` is darker (`#0369a1`, was `#0ea5e9`, 2.8:1 on white) and the dark theme sets its own (`#38bdf8`) so the focus indicator reaches 3:1 on both grounds; hosts that override `--fg-task-focus` are unaffected. The frame needs CSS `:has()` (Chrome 105, Safari 15.4, Firefox 121); older browsers keep the bar ring only. Canvas mode under forced-colors keeps its token colors (the bitmap is not recoloured by the browser).
