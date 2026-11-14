---
'@fluxgantt/react': patch
'@fluxgantt/vue': patch
---

The dev-only warnings (`tasks` / `dependencies` changed identity after construction) are now removed by a production build. They were guarded by `typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'`, which in a browser bundle (where `process` is undefined at runtime) evaluated to "development", so the warnings fired and their text shipped in production. They now use the bare `process.env.NODE_ENV !== 'production'` expression that bundlers replace (esbuild and Vite `define`, webpack `DefinePlugin`), inside a `try` for an unbundled load without a `process` global (no warnings there).
