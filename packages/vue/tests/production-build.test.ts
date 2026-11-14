// @vitest-environment node
// Dev warnings must be dropped by a production build. The bare `process.env.NODE_ENV !== 'production'`
// member expression is what bundlers replace; a `typeof process` guard would keep the warnings (and their
// text) in browser production bundles, where `process` is undefined at runtime.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const require_ = createRequire(import.meta.url);
// esbuild is tsup's own dependency (not ours): resolve it through tsup.
interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
}
const esbuild = createRequire(require_.resolve('tsup'))('esbuild') as Esbuild;
const entry = (name: string): string => fileURLToPath(new URL(`../src/${name}`, import.meta.url));

const WARNING_TEXT = [
  'changed identity', // gridColumns functions, and the tasks / dependencies warnings
  'construction-time only', // gridOptions and gridEditing
  'is only used as the initial value',
];

async function bundle(file: string, nodeEnv: string): Promise<string> {
  const out = await esbuild.build({
    entryPoints: [entry(file)],
    bundle: true,
    write: false,
    minify: true,
    format: 'esm',
    platform: 'browser',
    external: ['vue', '@fluxgantt/core', '@fluxgantt/core/*'],
    define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
  });
  return out.outputFiles[0]!.text;
}

describe('dev warnings in a production build', () => {
  it.each(['index.ts', 'grid.ts', 'grid-editing.ts'])(
    '%s: kept in development, absent in production',
    async (file) => {
      const dev = await bundle(file, 'development');
      expect(dev).toContain('changed identity');
      const prod = await bundle(file, 'production');
      for (const text of WARNING_TEXT) expect(prod).not.toContain(text);
      expect(prod).not.toContain('console.warn');
    },
  );
});
