#!/usr/bin/env node
// Asserts that every publishable package carries the metadata npmjs.com needs, so a first
// publish cannot go out as a blank page and a later refactor cannot silently strip it.
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

  // A repo-only build bound (size-limit 13 needs Node >= 22.18) must not be imposed on
  // consumers; see the root package.json.
  if (pkg.engines?.node !== undefined) {
    fail(
      '"engines.node" should not be published — it is a repo build requirement, not a consumer one',
    );
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
