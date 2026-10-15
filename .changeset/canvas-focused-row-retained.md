---
'@fluxgantt/core': patch
---

Canvas renderer: keep the roving-tabindex (focused) row in the hidden ARIA layer even when a far scroll moves it outside the virtualized row window. Previously it was dropped, which lost DOM focus, left zero `tabindex="0"` rows (no Tab stop) and tripped axe `scrollable-region-focusable`.
