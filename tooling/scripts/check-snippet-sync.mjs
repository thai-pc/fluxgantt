#!/usr/bin/env node
// Guards the single-sourced quick-start snippet against drift. The source of truth is the
// region between `// #region quickstart` and `// #endregion quickstart` in
// examples/plain-html-demo/src/main.ts. That exact block must also appear as a fenced ```ts
// code block in the root README.md and in apps/docs/pages/docs/quick-start.mdx.
//
// Run: node tooling/scripts/check-snippet-sync.mjs  (exits non-zero on drift; used in CI)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SOURCE = 'examples/plain-html-demo/src/main.ts';
const TARGETS = ['README.md', 'apps/docs/pages/docs/quick-start.mdx'];

function fail(msg) {
  console.error(`\n✗ check-snippet-sync: ${msg}\n`);
  process.exit(1);
}

function extractRegion(src) {
  const start = src.indexOf('// #region quickstart');
  const end = src.indexOf('// #endregion quickstart');
  if (start === -1 || end === -1) {
    fail(`could not find "#region quickstart" / "#endregion quickstart" markers in ${SOURCE}`);
  }
  const body = src.slice(src.indexOf('\n', start) + 1, end);
  return body.trim();
}

function tsCodeBlocks(md) {
  const blocks = [];
  const re = /```ts\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) blocks.push(m[1].trim());
  return blocks;
}

const canonical = extractRegion(await readFile(resolve(repoRoot, SOURCE), 'utf8'));

let ok = true;
for (const target of TARGETS) {
  const md = await readFile(resolve(repoRoot, target), 'utf8');
  const blocks = tsCodeBlocks(md);
  if (!blocks.includes(canonical)) {
    ok = false;
    console.error(`✗ ${target} does not contain a \`\`\`ts block matching ${SOURCE}'s quickstart region.`);
  } else {
    console.log(`✓ ${target} in sync with ${SOURCE}`);
  }
}

if (!ok) {
  fail(`the quick-start snippet has drifted. Update the copies to match ${SOURCE} exactly.`);
}
console.log('✓ all quick-start snippets in sync');
