import { readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

const USE_CLIENT_DIRECTIVE = '"use client";\n';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@fluxgantt/core'],
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
    for (const file of ['dist/index.js', 'dist/index.cjs']) {
      const contents = await readFile(file, 'utf8');
      if (!contents.startsWith(USE_CLIENT_DIRECTIVE)) {
        await writeFile(file, USE_CLIENT_DIRECTIVE + contents);
      }
    }
  },
});
