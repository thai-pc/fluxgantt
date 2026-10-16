---
'@fluxgantt/core': patch
---

`withTheme` now restores the mount container's prior inline `--fg-*` values on `unmount()` (and stops following `prefers-color-scheme` while unmounted), so a host-owned container is no longer left dark after the chart is unmounted.
