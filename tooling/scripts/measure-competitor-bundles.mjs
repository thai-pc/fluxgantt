#!/usr/bin/env node
// Measures the gzipped bundle size of the MIT Gantt libraries FluxGantt is compared against,
// so the numbers in `apps/docs/pages/docs/comparison.mdx` are reproducible rather than quoted
// from a vendor page or a blog post.
//
// Run: node tooling/scripts/measure-competitor-bundles.mjs
//      node tooling/scripts/measure-competitor-bundles.mjs --markdown
//
// Method, stated so the comparison page can be audited:
//   * `npm pack` the published tarball at an exact version — never a CDN URL, whose contents can
//     change under the same path.
//   * Measure the package's own advertised browser entry (`main`/`exports.require`), NOT a
//     bundler's tree-shaken output. These libraries are monoliths with side effects
//     (`sideEffects` is unset or `["*.css"]`), so a bundler cannot drop anything: the entry file
//     IS what a consumer ships. FluxGantt's own numbers come from `pnpm size`, which DOES
//     tree-shake, because FluxGantt is `"sideEffects": false` and its capabilities are separate
//     subpath exports — that asymmetry favours the competitor if anything, and is the honest
//     reading of "what lands in your app".
//   * Add the stylesheet, gzipped separately. A Gantt that does not paint is not a comparison:
//     dhtmlx and Frappe both require their CSS, FluxGantt requires none (every visual property
//     is written inline with a `--fg-*` token fallback). Reporting JS alone would hide that.
//   * gzip level 9, matching `size-limit`'s default.
//
// Bryntum is deliberately absent: `@bryntum/gantt` on npm is a 13 KB placeholder package and the
// real bundle sits behind a paid, login-gated download, so there is no version anyone can
// independently re-measure. The comparison page says that rather than inventing a number.
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Published entry points, taken from each package's own `package.json`. */
const TARGETS = [
  { pkg: 'dhtmlx-gantt', version: '10.0.3', js: 'codebase/dhtmlxgantt.js', css: 'codebase/dhtmlxgantt.css' },
  { pkg: 'frappe-gantt', version: '1.2.2', js: 'dist/frappe-gantt.umd.js', css: 'dist/frappe-gantt.css' },
];

const KIB = 1024;
const fmt = (bytes) => `${(bytes / KIB).toFixed(2)} KiB`;

function measure(target, workDir) {
  const spec = `${target.pkg}@${target.version}`;
  execFileSync('npm', ['pack', spec, '--pack-destination', workDir], { stdio: 'pipe' });
  const tarball = readdirSync(workDir).find((f) => f.startsWith(target.pkg) && f.endsWith('.tgz'));
  if (!tarball) throw new Error(`npm pack produced no tarball for ${spec}`);
  // Every npm tarball roots its contents at `package/`.
  execFileSync('tar', ['xzf', join(workDir, tarball), '-C', workDir], { stdio: 'pipe' });

  const sizeOf = (relative) => {
    const raw = readFileSync(join(workDir, 'package', relative));
    return { raw: raw.byteLength, gzip: gzipSync(raw, { level: 9 }).byteLength };
  };
  const js = sizeOf(target.js);
  const css = sizeOf(target.css);
  rmSync(join(workDir, 'package'), { recursive: true, force: true });
  rmSync(join(workDir, tarball), { force: true });
  return { ...target, js, css, totalGzip: js.gzip + css.gzip };
}

const workDir = mkdtempSync(join(tmpdir(), 'fluxgantt-competitor-size-'));
let results;
try {
  results = TARGETS.map((target) => measure(target, workDir));
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (process.argv.includes('--markdown')) {
  console.log('| Library | JS (gzip) | CSS (gzip) | Total (gzip) |');
  console.log('|---|---|---|---|');
  for (const r of results) {
    console.log(`| \`${r.pkg}@${r.version}\` | ${fmt(r.js.gzip)} | ${fmt(r.css.gzip)} | **${fmt(r.totalGzip)}** |`);
  }
} else {
  for (const r of results) {
    console.log(
      `${r.pkg}@${r.version}\n` +
        `  js    raw ${fmt(r.js.raw)}  gzip ${fmt(r.js.gzip)}\n` +
        `  css   raw ${fmt(r.css.raw)}  gzip ${fmt(r.css.gzip)}\n` +
        `  total gzip ${fmt(r.totalGzip)}\n`,
    );
  }
}
