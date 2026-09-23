---
'@fluxgantt/core': minor
---

Add responsive/touch adaptation via a `withResponsive()` mixin on the new
`@fluxgantt/core/responsive` subpath.

A chart already worked with a finger — every gesture is built on Pointer Events — but it did not
*adapt*: the label column stayed 160px on a 393px phone, rows stayed 32px, resize edges stayed 8px,
and the browser's own scroll gesture killed any drag that started on a task bar.

```ts
import { withResponsive } from '@fluxgantt/core/responsive';

const gantt = withResponsive(withInteraction(withRender(createGantt({ tasks }))));
gantt.mount(el); // adapts itself
```

Under `matchMedia('(pointer: coarse)')` — a real touchscreen, not a narrow window — it switches to
the new `'touch'` density (48px rows), clamps the label column to
`min(160, max(96, containerWidth * 0.4))` and re-clamps it on every container resize, widens the
resize edge zone to 24px and the link-handle radius to 12px (⌀24, meeting WCAG 2.2 SC 2.5.8's
24x24 minimum at Level AA), and takes over panning so a `pointerdown` on a task bar reaches the
drag recognizers untouched while one anywhere else scrolls the container. Native pinch-zoom is
suppressed while a finger is on the chart; chart-level pinch-to-zoom is a separate change.

Also public, usable without the mixin:

- `Density` gains `'touch'` (48px rows, `--fg-row-height-touch`).
- Both renderers accept a `labelColumnWidth` option and expose `getLabelColumnWidth()`.

Composing nothing new costs nothing: all six pre-existing bundle fixtures are byte-identical.
