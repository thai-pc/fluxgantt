#!/usr/bin/env node
// Asserts that every publishable package (a) carries the metadata npmjs.com needs, so a first
// publish cannot go out as a blank page and a later refactor cannot silently strip it, and
// (b) is actually LOADABLE by a consumer — every `exports`/`main`/`module`/`types` target
// resolves to a file that exists, and `files` ships the directory they live in.
//
// (b) exists because (a) alone passed identically on a checkout with no build at all: `dist/` is
// gitignored, so a metadata-only gate cannot tell a publishable package from an empty one, and a
// broken `exports` map — the one defect a workspace can never surface, since it resolves by
// symlink rather than through `exports` — reached CI invisibly. This script does not replace the
// manual `pnpm pack` + install-the-tarball check in RELEASING.md (only that resolves the way a
// consumer's Node does); it catches the cheap half on every PR.
//
// "Publishable" = a workspace package under packages/ that is not `private` and is not in
// `.changeset/config.json`'s `ignore` list. Discovered rather than hardcoded, so a new package
// is covered the day it is added.
//
// Run: node tooling/scripts/check-publish-readiness.mjs  (exits non-zero on a gap; used in CI)
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_URL = 'https://github.com/thai-pc/fluxgantt';

const changesetConfig = JSON.parse(
  await readFile(resolve(repoRoot, '.changeset/config.json'), 'utf8'),
);
const ignored = new Set(changesetConfig.ignore ?? []);

const problems = [];
const checked = [];

for (const entry of await readdir(resolve(repoRoot, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join('packages', entry.name);

  let pkg;
  try {
    pkg = JSON.parse(await readFile(resolve(repoRoot, dir, 'package.json'), 'utf8'));
  } catch {
    continue; // not a package (no manifest)
  }

  if (pkg.private === true || ignored.has(pkg.name)) continue;

  const fail = (msg) => problems.push(`${pkg.name} (${dir}): ${msg}`);

  for (const field of ['description', 'license', 'homepage', 'author']) {
    if (typeof pkg[field] !== 'string' || pkg[field].trim() === '') fail(`missing "${field}"`);
  }

  if (!Array.isArray(pkg.keywords) || pkg.keywords.length < 3) {
    fail('"keywords" must list at least 3 terms (npm search relies on it)');
  }

  if (pkg.bugs?.url === undefined) fail('missing "bugs.url"');

  // `directory` is what makes GitHub deep-link to the package folder instead of the repo root.
  if (pkg.repository?.url === undefined) fail('missing "repository.url"');
  else if (!pkg.repository.url.includes(REPO_URL)) {
    fail(`"repository.url" does not point at ${REPO_URL}`);
  }
  if (pkg.repository?.directory !== dir) {
    fail(
      `"repository.directory" should be "${dir}", got ${JSON.stringify(pkg.repository?.directory)}`,
    );
  }

  // npm-packlist force-includes README.md regardless of `files`, but only if one exists.
  try {
    await access(resolve(repoRoot, dir, 'README.md'));
  } catch {
    fail('no README.md — the npmjs.com page would render empty');
  }

  // The changelog is NOT force-included; it ships only if `files` lists it.
  if (Array.isArray(pkg.files) && !pkg.files.includes('CHANGELOG.md')) {
    fail('"files" does not include "CHANGELOG.md" (it is not force-included by npm)');
  }

  if (pkg.publishConfig?.access !== 'public') {
    fail('"publishConfig.access" must be "public" for a scoped package');
  }

  // A repo-only build bound (size-limit 14 declares Node >= 22.19) must not be imposed on
  // consumers; see the root package.json.
  if (pkg.engines?.node !== undefined) {
    fail(
      '"engines.node" should not be published — it is a repo build requirement, not a consumer one',
    );
  }

  // --- Is the package actually loadable? ---------------------------------------------------
  // Collect every path the resolver can be sent to, then assert each one exists on disk.
  const targets = new Set();
  for (const field of ['main', 'module', 'types']) {
    if (typeof pkg[field] === 'string') targets.add(pkg[field]);
  }
  const walkExports = (node) => {
    if (typeof node === 'string') {
      // "./dist/x.js" is a file target; a bare "." or "./sub" key value cannot appear here.
      targets.add(node);
      return;
    }
    if (node && typeof node === 'object') for (const v of Object.values(node)) walkExports(v);
  };
  walkExports(pkg.exports);

  // An unbuilt package fails every one of these at once — eighteen identical lines that bury the
  // one fact worth reading. Say it once instead, and skip the per-target noise.
  let distMissing = false;
  try {
    await access(resolve(repoRoot, dir, 'dist'));
  } catch {
    distMissing = true;
  }

  if (distMissing) {
    fail(
      `no dist/ directory — run \`pnpm build\` before this check. Every exports target below ` +
        'would fail, which says nothing about whether the exports map is correct',
    );
  } else {
    for (const target of targets) {
      if (target.startsWith('#')) continue; // internal imports map, not a file
      try {
        await access(resolve(repoRoot, dir, target));
      } catch {
        fail(
          `"${target}" is referenced by exports/main/module/types but does not exist ` +
            '(the build ran, so this is a real exports-map or build-config defect)',
        );
      }
    }
  }

  // Every target must live under a directory that `files` actually ships, or it resolves
  // locally and 404s for the consumer.
  if (Array.isArray(pkg.files)) {
    for (const target of targets) {
      const top = target.replace(/^\.\//, '').split('/')[0];
      if (top === undefined || top === '') continue;
      if (!pkg.files.includes(top)) {
        fail(`"files" does not include "${top}", but "${target}" resolves into it`);
      }
    }
  }

  // The VERSION constant a consumer can read must match the version they installed. Nothing
  // else keeps these two in step — the changesets bump rewrites package.json only.
  const versionFile = resolve(repoRoot, dir, 'src/index.ts');
  try {
    const src = await readFile(versionFile, 'utf8');
    const m = src.match(/export const VERSION = '([^']*)'/);
    if (m && m[1] !== pkg.version) {
      fail(
        `src/index.ts exports VERSION '${m[1]}' but package.json says '${pkg.version}' — ` +
          'bump the constant with the release',
      );
    }
  } catch {
    // No src/index.ts, or unreadable: nothing to cross-check.
  }

  checked.push(pkg.name);
}

if (checked.length === 0) {
  console.error(
    '\n✗ check-publish-readiness: found no publishable packages — is the glob right?\n',
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error('\n✗ check-publish-readiness:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ check-publish-readiness: ${checked.length} packages ready (${checked.join(', ')})`);
