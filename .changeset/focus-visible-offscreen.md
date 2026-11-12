---
'@fluxgantt/core': patch
---

Keyboard focus is now visible when the focused task's bar is off screen or under the pinned label column (WCAG 2.4.7, 2.4.11). The focused row gets a 2 px frame across the chart and the pinned label column, in both the SVG and Canvas renderers; exported SVG and PNG are unchanged. The SVG frame also follows DOM focus that moves without a render (a screen-reader cursor, a host `.focus()` call).

Visible colour change, an accessibility fix approved by the project lead (spec section 8.2 updated): the default `--fg-task-focus` is darker (`#0369a1`, was `#0ea5e9`, 2.8:1 on white) and the dark theme sets its own (`#38bdf8`) so the focus indicator reaches 3:1 on both grounds. A host stylesheet override of `--fg-task-focus` still wins in the light theme. Under `withTheme` dark or auto the theme writes `--fg-task-focus` inline on the container, as it does for the other dark tokens, so a host override is replaced while dark is active (inline values on the container are restored when light is applied again).

Notes: the frame needs CSS `:has()` (Chrome 105, Safari 15.4, Firefox 121); older browsers keep the bar ring only. In SVG the frame's stroke is capped at 2 px (a larger `--fg-task-focus-width` still widens the bar ring; the frame stays inside its row). In SVG under forced colors the ring and the frame use the system `Highlight` colour and the pinned column takes the forced `Canvas` ground. Canvas mode under forced colors keeps its token colors (the bitmap is not recoloured by the browser): a documented limitation.
