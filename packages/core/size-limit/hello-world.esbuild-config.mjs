// Custom esbuild config for the "Hello world" size-limit check (spec-canvas-auto-switch.md §3,
// acceptance criterion 5). `@size-limit/esbuild`'s own default config (`get-config.js` in that
// package) bundles with `bundle: true` and no `external` list, so plain esbuild inlines EVERY
// module reachable from the entry file — including the module behind `gantt.ts`'s
// `await import('./render/canvas-renderer.js')` — into the one measured output. That defeats
// the whole point of the dynamic-import code-split this ticket introduces and regresses this
// budget even though the real, published `dist/index.js` stays clean (a real consumer's own
// bundler — webpack/Vite/esbuild/Rollup — code-splits a genuine `import()` into a separate
// chunk by default; only this particular measurement tool's default config doesn't).
//
// Marking the Canvas-renderer module `external` reproduces that real-world behavior: esbuild
// leaves the `import('./render/canvas-renderer.js')` call as-is (a few bytes of inert glue
// code) instead of inlining ~20 KB of Canvas rendering logic a `createGantt()`-only consumer
// never executes. The `entryPoints`/`outdir`/minify options below otherwise mirror
// `@size-limit/esbuild`'s own `get-config.js` defaults as closely as possible so this stays an
// apples-to-apples comparison with the "Full core" check and with prior measurements.
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default {
  entryPoints: [join(here, 'hello-world.js')],
  bundle: true,
  // Matches the specifier text `gantt.ts`'s dynamic `import()` resolves to inside the built
  // `dist/index.js` (`./render/canvas-renderer.js`, relative to that file) — a single `*`
  // wildcard suffix match, per esbuild's `external` pattern syntax.
  external: ['*canvas-renderer.js'],
  metafile: true,
  minifyIdentifiers: true,
  minifySyntax: true,
  minifyWhitespace: true,
  outdir: join(tmpdir(), 'fluxgantt-size-limit-hello-world'),
  treeShaking: true,
  write: true,
};
