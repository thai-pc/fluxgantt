---
'@fluxgantt/core': patch
---

`VERSION` is now typed `string` instead of the literal release type (for example `'0.7.0'`). The literal changed on every release and would have made the published type declarations churn; nothing can usefully depend on it.
