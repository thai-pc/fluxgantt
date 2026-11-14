import { defineConfig } from 'tsup';

export default defineConfig({
  // `grid` / `grid-editing` are opt-in entries (`@fluxgantt/vue/grid`, `/grid-editing`): the default entry
  // never imports them, so a chart without a grid ships no grid code. ESM code-splits the code they share
  // with `index` into a chunk; CJS stays one self-contained file per entry.
  entry: { index: 'src/index.ts', grid: 'src/grid.ts', 'grid-editing': 'src/grid-editing.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  external: ['vue', '@fluxgantt/core', /^@fluxgantt\/core\//],
});
