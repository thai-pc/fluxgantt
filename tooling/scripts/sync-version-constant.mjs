#!/usr/bin/env node
// Rewrites `export const VERSION = '…'` in each publishable package's `src/index.ts` to match
// that package's `package.json` version.
//
// Runs as the second half of `pnpm version-packages`, i.e. inside the bot's "Version Packages"
// PR, so the bump and the constant land in the same commit and a reviewer sees both.
//
// Why this exists: `changeset version` rewrites `package.json` and nothing else. The constant is
// the one copy of the version a consumer can read at runtime, and for the whole of 0.1.0 it said
// `'0.0.0'` — nobody noticed, because nothing compared them. `check-publish-readiness.mjs` now
// does, which turned a silent lie into a red build on the version PR itself. Syncing here fixes
// the cause rather than the symptom.
//
// Deliberately a source rewrite, not a build-time `define`: the constant is imported directly by
// vitest from `src/`, so a bundler-only substitution would be correct in `dist/` and wrong in
// every test.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PATTERN = /(export const VERSION = ')([^']*)(')/;

const updated = [];

for (const entry of await readdir(resolve(repoRoot, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join('packages', entry.name);

  let pkg;
  try {
    pkg = JSON.parse(await readFile(resolve(repoRoot, dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  if (pkg.private === true) continue;

  const indexPath = resolve(repoRoot, dir, 'src/index.ts');
  let src;
  try {
    src = await readFile(indexPath, 'utf8');
  } catch {
    continue; // no src/index.ts — nothing to sync
  }

  const match = src.match(PATTERN);
  if (!match) continue; // package does not export a VERSION constant
  if (match[2] === pkg.version) continue;

  await writeFile(indexPath, src.replace(PATTERN, `$1${pkg.version}$3`));
  updated.push(`${pkg.name}: ${match[2]} → ${pkg.version}`);
}

if (updated.length === 0) console.log('✓ sync-version-constant: every VERSION already matches');
else for (const line of updated) console.log(`✓ sync-version-constant: ${line}`);
