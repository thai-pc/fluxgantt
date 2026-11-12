#!/usr/bin/env node
// Validates the Vocs static build that Cloudflare Pages serves from the root of
// https://fluxgantt.thai-pc.com. Runs as part of `pnpm --filter docs build`; it only reads
// `apps/docs/dist/public` and fails the build when that output would deploy broken.
//
// 1. The site is laid out for the domain root: `vocs.config.ts` must not set a `basePath`.
//    The site used to target a GitHub Pages sub-path (`/fluxgantt`), and Vocs leaves three
//    kinds of output without the prefix even when one is set (the WCAG skip link, `llms.txt` /
//    `llms-full.txt`, and `assets/md/**.md`), so a sub-path deploy needs a rewrite pass this
//    script no longer has (see its git history). Refuse the combination instead of shipping
//    links that 404.
//
// 2. The build actually produced HTML. `renderStrategy` defaults to 'dynamic', which emits a
//    Node server and zero HTML — a silent, deploy-a-blank-site failure. If a future config
//    change flips it back, fail here instead. `index.html` must exist too: it is the home page.
//
// 3. No HTML file carries an absolute `<base href>` (see `head.base` in vocs.config.ts).
//
// 4. Every root-relative `/assets/...` URL the HTML references exists in the output. That is
//    the class of breakage a wrong base path produces (scripts and styles 404, the page renders
//    unstyled and never hydrates), so check it directly rather than trusting the config.
//
// No `.nojekyll` any more: it only existed because GitHub Pages runs Jekyll, which drops waku's
// `_`-prefixed RSC paths. Cloudflare Pages serves the directory as-is.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicDir = resolve(repoRoot, 'apps/docs/dist/public');

const fail = (message) => {
  console.error(`\n✗ finalize-pages-build: ${message}\n`);
  process.exit(1);
};

// --- 1. no basePath ---------------------------------------------------------------------------
const configSource = readFileSync(resolve(repoRoot, 'apps/docs/vocs.config.ts'), 'utf8');
const basePathMatch = configSource.match(/^\s*basePath:\s*'([^']*)'/m);
if (basePathMatch && basePathMatch[1].replace(/\/+$/, '') !== '') {
  fail(
    `apps/docs/vocs.config.ts sets basePath '${basePathMatch[1]}', but the site is served from\n` +
      '  the domain root. Remove it, or restore the sub-path rewrite pass from git history.',
  );
}

// --- 2. HTML exists ---------------------------------------------------------------------------
const htmlFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.html')) htmlFiles.push(full);
  }
};
try {
  walk(publicDir);
} catch {
  fail(
    `${publicDir} does not exist.\n` +
      '  Expected a static build. Check `renderStrategy` in apps/docs/vocs.config.ts.',
  );
}
if (htmlFiles.length === 0) {
  fail(
    'the build emitted zero HTML files.\n' +
      "  This happens when `renderStrategy` is not 'full-static' — the site would deploy blank.\n" +
      '  Fix apps/docs/vocs.config.ts.',
  );
}
if (!existsSync(join(publicDir, 'index.html'))) fail('the build has no index.html (home page).');

// --- 3. no absolute <base href> ----------------------------------------------------------------
// Vocs emits `<base href="${baseUrl}">` unless `head.base: false`. It points every root-relative
// URL at production, so preview deploys and local serves silently run production's assets.
const baseTag = /<base\s[^>]*href="[a-z][a-z0-9+.-]*:/i;
const withBase = htmlFiles.filter((file) => baseTag.test(readFileSync(file, 'utf8')));
if (withBase.length > 0) {
  fail(
    `${withBase.length} HTML file(s) carry an absolute <base href>, which loads assets from\n` +
      "  production on every preview. Keep `head.base: false` in apps/docs/vocs.config.ts.",
  );
}

// --- 4. every referenced /assets/ file exists -------------------------------------------------
// `src="/assets/x.js"`, `href="/assets/x.css"`, and the `"/assets/x"` strings in inline module
// preload / RSC payloads. Query strings and fragments are not part of the file name.
const assetRef = /["'(](\/assets\/[^"')?#\s\\]+)/g;
const missing = new Map();
let refs = 0;
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  for (const [, url] of html.matchAll(assetRef)) {
    refs += 1;
    let path = url;
    try {
      path = decodeURIComponent(url);
    } catch {
      // A malformed escape cannot name a real file; check it verbatim and let it fail.
    }
    if (!existsSync(join(publicDir, path))) missing.set(url, file.slice(publicDir.length + 1));
  }
}
if (refs === 0) {
  fail(
    'no HTML file references /assets/. Either Vocs changed its output layout or the assets\n' +
      '  are prefixed with a path the site is not served from — check a built page.',
  );
}
if (missing.size > 0) {
  const list = [...missing].slice(0, 10).map(([url, from]) => `    ${url}  (in ${from})`);
  fail(`${missing.size} referenced asset(s) are missing from the build:\n${list.join('\n')}`);
}

console.log(
  `✓ finalize-pages-build: ${htmlFiles.length} HTML files, ${refs} /assets/ references, all present`,
);
