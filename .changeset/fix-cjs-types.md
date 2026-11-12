---
'@fluxgantt/core': patch
'@fluxgantt/react': patch
'@fluxgantt/vue': patch
---

Fix TypeScript types for CommonJS consumers. Every entry point shared one `.d.ts` for both the `import` and `require` conditions, so a `node16`/`nodenext` project compiling to CJS saw the ESM declarations of a CJS file ("masquerading as ESM"). The `exports` map now nests `types` per condition: `.d.ts` for `import`, the already-emitted `.d.cts` for `require`. No runtime change.
