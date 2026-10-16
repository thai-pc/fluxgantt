---
'@fluxgantt/core': patch
---

`withTheme()` no longer wipes host-set inline `--fg-*` custom properties on the mount container.
Switching to light (or `destroy()`) used to remove all 13 dark tokens unconditionally, deleting any
inline override the host had put on the same element, even when the chart had never been dark. It now
records each property's prior inline value before writing the dark tokens and restores exactly that
on light / `destroy()`; applying light to a container it never darkened is a no-op. An unknown
`config.theme` now throws at construction (as `setTheme` already did) instead of being accepted silently.
