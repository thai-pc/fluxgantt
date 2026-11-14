import { readdir, readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

const USE_CLIENT_DIRECTIVE = '"use client";\n';

export default defineConfig({
  // `grid` / `grid-editing` are opt-in entries (`@fluxgantt/react/grid`, `/grid-editing`): the default entry
  // never imports them, so a chart without a grid ships no grid code. ESM code-splits the code they share
  // with `index` into a chunk; CJS stays one self-contained file per entry.
  entry: { index: 'src/index.ts', grid: 'src/grid.tsx', 'grid-editing': 'src/grid-editing.tsx' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@fluxgantt/core',
    /^@fluxgantt\/core\//,
  ],
  // `"use client"` marks the Next.js App Router client boundary (see spec-react-wrapper.md
  // §1/§10 — additive, NOT SSR/RSC support). Kept as `banner` for self-documenting intent, but
  // esbuild's bundler treats a leading string-literal statement as a "module level directive"
  // and silently strips it once it's followed by hoisted `import`/`require` statements in a
  // BUNDLED output (a documented esbuild limitation, not specific to this config — see
  // https://github.com/evanw/esbuild/issues/1921). `onSuccess` prepends it to the emitted
  // files directly instead, which is what Next.js's own RSC boundary scan actually reads
  // (the final shipped file's first line), independent of tsup/esbuild's internal AST.
  banner: { js: USE_CLIENT_DIRECTIVE.trim() },
  async onSuccess() {
    // Every emitted entry AND shared chunk (a chunk of a "use client" module is client code too).
    const files = (await readdir('dist'))
      .filter((f) => f.endsWith('.js') || f.endsWith('.cjs'))
      .map((f) => `dist/${f}`);
    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      if (!contents.startsWith(USE_CLIENT_DIRECTIVE)) {
        await writeFile(file, USE_CLIENT_DIRECTIVE + contents);
      }
    }
  },
});
