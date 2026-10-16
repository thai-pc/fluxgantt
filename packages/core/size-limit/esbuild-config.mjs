// Shared esbuild config factory for every size-limit fixture in this folder.
//
// `@size-limit/esbuild`'s own default config (`get-config.js` in that package) bundles with
// `bundle: true` and no `external` list, so plain esbuild inlines EVERY module reachable from
// the entry file — including the module behind `render/mixin.ts`'s
// `await import('./canvas-renderer.js')` — into the one measured output. That defeats the
// dynamic-import code-split and regresses these budgets even though the real, published
// `dist/` stays clean (a real consumer's own bundler — webpack/Vite/esbuild/Rollup —
// code-splits a genuine `import()` into a separate chunk by default; only this particular
// measurement tool's default config doesn't).
//
// The same applies to `io/mixin.ts`'s `import('./export-canvas-png.js')` (Canvas-mode PNG export,
// loaded on first use). Marking the Canvas-renderer and Canvas-PNG modules `external` reproduces that real-world behavior: esbuild
// leaves the `import()` call as-is (a few bytes of inert glue) instead of inlining ~20 KB of
// Canvas rendering logic a consumer only pays for above the auto-switch threshold. Apart from
// `external` and `format` (below), every option mirrors `@size-limit/esbuild`'s own defaults so
// these stay apples-to-apples with each other.
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// `format: 'esm'` is deliberate and is the second deviation from size-limit's defaults. Without it
// esbuild emits an IIFE, and once a bundle holds an external dynamic `import()` it prepends its
// CJS-interop helpers (`__toESM`, the "Dynamic require" shim) that nothing calls and that no real
// ESM bundler ships: ~740 raw bytes counting the IIFE wrapper (736 B measured on the kitchen
// sink), worth ~250-320 B gzip on every fixture that reaches `withRender` or `withIo`.
// Verified (2026-10) that switching changes ONLY the wrapper and those dead helpers: the metafile
// shows the same inputs with identical per-input bytes either way. Fixtures therefore measure ESM
// output. Caveat: size-limit subtracts a fixed 32 B calibration (the gzip of an empty IIFE); an
// empty ESM output gzips to ~20 B, so the figures here read ~12 B lower than the true bundle.
/** @param {string} fixture bare fixture filename, e.g. `'hello-world.js'` */
export function fixtureConfig(fixture) {
  return {
    entryPoints: [join(here, fixture)],
    bundle: true,
    // Matches the specifier text `render/mixin.ts`'s dynamic `import()` resolves to inside the
    // built output — a single `*` wildcard suffix match, per esbuild's `external` syntax.
    external: ['*canvas-renderer.js', '*export-canvas-png.js'],
    metafile: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    outdir: join(tmpdir(), `fluxgantt-size-limit-${fixture.replace(/\.js$/, '')}`),
    format: 'esm',
    treeShaking: true,
    write: true,
  };
}
