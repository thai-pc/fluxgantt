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
// Marking the Canvas-renderer module `external` reproduces that real-world behavior: esbuild
// leaves the `import()` call as-is (a few bytes of inert glue) instead of inlining ~20 KB of
// Canvas rendering logic a consumer only pays for above the auto-switch threshold. Every other
// option mirrors `@size-limit/esbuild`'s own defaults so these stay apples-to-apples with each
// other and with prior measurements.
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @param {string} fixture bare fixture filename, e.g. `'hello-world.js'` */
export function fixtureConfig(fixture) {
  return {
    entryPoints: [join(here, fixture)],
    bundle: true,
    // Matches the specifier text `render/mixin.ts`'s dynamic `import()` resolves to inside the
    // built output — a single `*` wildcard suffix match, per esbuild's `external` syntax.
    external: ['*canvas-renderer.js'],
    metafile: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    outdir: join(tmpdir(), `fluxgantt-size-limit-${fixture.replace(/\.js$/, '')}`),
    treeShaking: true,
    write: true,
  };
}
