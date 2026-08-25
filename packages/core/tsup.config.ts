import { defineConfig } from 'tsup';

export default defineConfig({
  // `render/canvas-renderer` is a SECOND, named entry (not just a file esbuild might choose to
  // split out) so `gantt.ts`'s internal `await import('./render/canvas-renderer.js')` (spec-
  // canvas-auto-switch.md §3) resolves to a deterministic, separate compiled chunk instead of
  // relying on esbuild's own automatic splitting heuristics for what would otherwise be a
  // single-entry build. Keeps Canvas rendering code out of `dist/index.js` (and therefore out of
  // every `createGantt()`-only consumer's bundle) — verified empirically via
  // `pnpm --filter @fluxgantt/core size` and a `dist/index.js` grep, not just assumed.
  entry: {
    index: 'src/index.ts',
    'render/canvas-renderer': 'src/render/canvas-renderer.ts',
  },
  format: ['esm', 'cjs'],
  // Required for esbuild to point the ESM output's dynamic import at this same compiled
  // `render/canvas-renderer` entry rather than inlining/duplicating it into `index.js`. Note:
  // esbuild's `format: 'cjs'` output does not code-split a dynamic `import()` the same way ESM
  // does (a known esbuild limitation) — an acceptable, low-stakes rough edge for v1, since the
  // realistic CJS consumer is a headless Node/Workers host with no reason to call `mount()`
  // against a real `HTMLElement` in the first place (architecture.md principle 7).
  splitting: true,
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
});
