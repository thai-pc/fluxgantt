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
//
// 3. `basePath` on the outputs Vocs does not prefix. `basePath: '/fluxgantt'` reaches every
//    asset URL and every router link, but three classes of output are assembled without it and
//    so emit links that 404 on the live sub-path deploy:
//      - the WCAG skip link (`href="/docs/x#vocs-content"`), which is the FIRST thing a
//        keyboard or screen-reader user hits on every page;
//      - `llms.txt` / `llms-full.txt`, built in `vocs/dist/internal/llms.js` from raw `page.path`
//        (`nav.push(\`- [${title}](${path})\`)`) — the same file computes a basePath for the MCP
//        URL a few lines below, so the omission is specific to these link lists, not a config
//        mistake on our side;
//      - `assets/md/**.md`, the per-page Markdown, which carries the authored root-relative
//        links through verbatim.
//    Rewriting here rather than in the sources is deliberate: the sources must keep working
//    under `vocs dev`, which serves at `/`. Prefixing is done with an anchored pattern and
//    skips anything already prefixed, so it is idempotent.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicDir = resolve(repoRoot, 'apps/docs/dist/public');

// Read straight from the config so the two can never drift apart.
const configSource = readFileSync(resolve(repoRoot, 'apps/docs/vocs.config.ts'), 'utf8');
const basePathMatch = configSource.match(/^\s*basePath:\s*'([^']*)'/m);
if (!basePathMatch) {
  console.error(
    '\n\u2717 finalize-pages-build: could not read `basePath` from apps/docs/vocs.config.ts.\n' +
      '  It is needed to prefix the skip links and llms.txt. Refusing to emit a half-prefixed\n' +
      '  build that would 404 for keyboard users.\n',
  );
  process.exit(1);
}
const basePath = (basePathMatch[1] ?? '').replace(/\/+$/, '');

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

// --- basePath the outputs Vocs leaves unprefixed ------------------------------------------
// One regex per output kind. Each requires a `/` that is NOT already followed by the basePath
// segment, so re-running over a finished build changes nothing.
const prefixed = (pattern, text) =>
  basePath === '' ? text : text.replace(pattern, (_m, lead, path) => `${lead}${basePath}${path}`);

const escaped = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// `href="/docs/x#vocs-content"` and `href="/#vocs-content"` — the skip link only. Every other
// internal href in the HTML is router-generated and already carries the prefix.
const skipLink = new RegExp(`(href=")(?!${escaped}/)(/[^"]*#vocs-content)`, 'g');
// `](/docs/x)` in Markdown and the llms lists. An absolute URL starts with a scheme and a
// fragment-only link starts with `#`, so neither matches.
const mdLink = new RegExp(`(\\]\\()(?!${escaped}/)(/[^)]*)`, 'g');

let rewritten = 0;
const rewriteTree = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      rewriteTree(full);
      continue;
    }
    const isHtml = entry.endsWith('.html');
    const isMarkdownish = entry.endsWith('.md') || entry === 'llms.txt' || entry === 'llms-full.txt';
    if (!isHtml && !isMarkdownish) continue;
    const before = readFileSync(full, 'utf8');
    const after = isHtml ? prefixed(skipLink, before) : prefixed(mdLink, before);
    if (after !== before) {
      writeFileSync(full, after);
      rewritten += 1;
    }
  }
};
rewriteTree(publicDir);

// A static build always has skip links, so zero rewrites means the pattern stopped matching —
// most likely because Vocs started prefixing them itself (good) or renamed the anchor (bad).
// Say so rather than silently shipping whatever we produced.
if (basePath !== '' && rewritten === 0) {
  console.log(
    `ℹ finalize-pages-build: nothing needed the "${basePath}" prefix. Either Vocs now\n` +
      '  applies basePath to skip links and llms.txt itself, or the markup changed — verify a\n' +
      "  page's skip link and llms.txt before trusting this.",
  );
}

writeFileSync(join(publicDir, '.nojekyll'), '');
console.log(
  `✓ finalize-pages-build: ${htmlCount} HTML files, ${rewritten} basePath-prefixed, ` +
    '.nojekyll written',
);
