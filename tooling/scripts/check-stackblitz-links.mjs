#!/usr/bin/env node
// Keeps the StackBlitz links in the docs and README consistent with what
// build-stackblitz-examples.mjs actually generates. Offline: it checks the links against the
// generator's manifest, not against stackblitz.com.
//
// For every `https://stackblitz.com/github/thai-pc/fluxgantt/tree/<ref>/<dir>[?query]` URL in the
// files below, asserts that <ref> is `stackblitz` (the generated branch; `master` holds
// `workspace:*` examples that cannot install there), <dir> is a manifest folder, and the `?file=`
// path is a file the generator writes for that folder. The docs examples page must link every
// manifest folder at least once.
//
// Run: node tooling/scripts/check-stackblitz-links.mjs  (exits non-zero on a broken link; used in CI)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MANIFEST, listOutputFiles } from './build-stackblitz-examples.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DOCS_PAGE = 'apps/docs/pages/docs/examples.mdx';
export const FILES = [DOCS_PAGE, 'README.md'];
const BRANCH = 'stackblitz';
const URL_RE = /https:\/\/stackblitz\.com\/github\/([\w.-]+\/[\w.-]+)\/tree\/([^/\s)"'<>]+)\/([^?#\s)"'<>]+)(\?[^#\s)"'<>]*)?/g;

/** Returns `{ problems, links }` for the given `{ path: content }` map. */
export async function checkLinks(contents, sourceRoot = repoRoot) {
  const outputs = new Map();
  for (const example of MANIFEST) outputs.set(example.dir, new Set(await listOutputFiles(example, sourceRoot)));

  const problems = [];
  const links = [];
  for (const [path, text] of Object.entries(contents)) {
    for (const m of text.matchAll(URL_RE)) {
      const [url, repo, ref, dir, query] = m;
      links.push({ path, url, dir });
      const where = `${path}: ${url}`;
      if (repo !== 'thai-pc/fluxgantt') problems.push(`${where}\n    repo must be thai-pc/fluxgantt`);
      if (ref !== BRANCH) problems.push(`${where}\n    ref must be "${BRANCH}" (got "${ref}")`);
      const files = outputs.get(dir);
      if (!files) {
        problems.push(`${where}\n    "${dir}" is not a generated folder (${[...outputs.keys()].join(', ')})`);
        continue;
      }
      const file = new URLSearchParams((query ?? '').slice(1)).get('file');
      if (file === null) problems.push(`${where}\n    missing ?file= (the file StackBlitz opens first)`);
      else if (!files.has(file)) problems.push(`${where}\n    ?file=${file} is not generated for ${dir}/`);
    }
  }

  const docsDirs = new Set(links.filter((l) => l.path === DOCS_PAGE).map((l) => l.dir));
  for (const example of MANIFEST) {
    if (DOCS_PAGE in contents && !docsDirs.has(example.dir)) {
      problems.push(`${DOCS_PAGE}: no StackBlitz link for the "${example.dir}" example`);
    }
  }
  return { problems, links };
}

async function main() {
  const contents = {};
  for (const f of FILES) contents[f] = await readFile(resolve(repoRoot, f), 'utf8');
  const { problems, links } = await checkLinks(contents);
  if (problems.length > 0) {
    console.error(`\n✗ check-stackblitz-links:\n  ${problems.join('\n  ')}\n`);
    process.exit(1);
  }
  console.log(`✓ check-stackblitz-links: ${links.length} StackBlitz links in ${FILES.join(', ')} match the generator manifest`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
