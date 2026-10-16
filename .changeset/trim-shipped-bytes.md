---
'@fluxgantt/core': patch
---

Trim shipped bytes: the injected `<style>` text is minified (same rules, no comments), PNG option validation is a single internal helper, and five diagnostic messages have shorter wording (the working-calendar iteration guard, the `with*` mixin "no internal state" error, the missing-Temporal error, and the hierarchy-depth / grid-column guards). The retained phrases are `exceeded max iteration guard`, `has no internal state`, `Temporal API is not available`, `exceeds max depth` and `exceeded max column guard`; only the explanatory second sentences were dropped. No API or behavior change; exported SVG output is byte-identical.
