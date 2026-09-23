#!/usr/bin/env node
// Post-processes the Vocs static build for GitHub Pages. Runs as part of `pnpm --filter docs
// build`; a no-op anywhere else.
//
// Two things Pages needs that `vocs build` does not emit:
//
// 1. `.nojekyll` — Pages runs Jekyll over the artifact by default, and Jekyll silently drops
//    every path whose name starts with `_`. Waku's `encodeRscPath()` emits exactly such paths
//    (`RSC/R/_root.txt`, `RSC/R/__root.d.txt`, and the `_root.d/` HTML directory), so without
//    this file client-side navigation 404s on a live deploy while working fine locally.
//
// 2. A hard assertion that the build actually produced HTML. `renderStrategy` defaults to
//    'dynamic', which emits a Node server and zero HTML — a silent, deploy-a-blank-site
//    failure. If a future config change flips it back, fail the build here instead.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicDir = resolve(repoRoot, 'apps/docs/dist/public');

function countHtml(dir) {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) n += countHtml(full);
    else if (entry.endsWith('.html')) n += 1;
  }
  return n;
}

let htmlCount = 0;
try {
  htmlCount = countHtml(publicDir);
} catch {
  console.error(
    `\n✗ finalize-pages-build: ${publicDir} does not exist.\n` +
      `  Expected a static build. Check \`renderStrategy\` in apps/docs/vocs.config.ts.\n`,
  );
  process.exit(1);
}

if (htmlCount === 0) {
  console.error(
    '\n✗ finalize-pages-build: the build emitted zero HTML files.\n' +
      "  This happens when `renderStrategy` is not 'full-static' — the site would deploy blank.\n" +
      '  Fix apps/docs/vocs.config.ts.\n',
  );
  process.exit(1);
}

writeFileSync(join(publicDir, '.nojekyll'), '');
console.log(`✓ finalize-pages-build: ${htmlCount} HTML files, .nojekyll written`);
