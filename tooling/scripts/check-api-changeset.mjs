#!/usr/bin/env node
// PR-only gate: "an API report changed => a changeset says so".
//
// For every package whose committed `etc/*.api.md` differs from the PR base:
//   R-a. a changeset ADDED in this PR must name that package;
//   R-b. its bump must be at least `minor` (a patch release never changes a report);
//   R-c. if the report diff REMOVES or alters a line, the changeset body must contain a line
//        starting `BREAKING:` or `Beta:` (the author must say it; a reviewer checks it is true
//        for the symbol's tier);
// and every report the `exports` maps require must exist.
//
// Usage: node tooling/scripts/check-api-changeset.mjs [--base origin/master]
// Base defaults to `origin/$GITHUB_BASE_REF`. Needs full history (`fetch-depth: 0`).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listEntries } from '../api-report/entries.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RANK = { patch: 1, minor: 2, major: 3 };

/** Parses a changeset file: `{ releases: { '@scope/pkg': 'minor' }, body }`. */
export function parseChangeset(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { releases: {}, body: text };
  const releases = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^\s*['"]?([^'":]+)['"]?\s*:\s*['"]?(patch|minor|major)['"]?\s*$/.exec(line);
    if (kv) releases[kv[1]] = kv[2];
  }
  return { releases, body: m[2] };
}

/**
 * Pure rule evaluation.
 * @param {{ changedReports: {pkg: string, file: string, removed: number, bootstrap?: boolean}[],
 *           changesets: {file: string, releases: Record<string,string>, body: string}[],
 *           missingReports?: string[] }} input
 * @returns {string[]} human-readable failures (empty = pass)
 */
export function evaluate({ changedReports, changesets, missingReports = [] }) {
  const errors = [];
  for (const f of missingReports) errors.push(`${f} is required by a package.json "exports" entry but is not committed. Run "pnpm api:update".`);

  const byPkg = new Map();
  for (const r of changedReports) {
    if (r.bootstrap) continue; // package had no reports at the base: this PR introduces the lock
    const e = byPkg.get(r.pkg) ?? { files: [], removed: 0 };
    e.files.push(r.file);
    e.removed += r.removed;
    byPkg.set(r.pkg, e);
  }
  for (const [pkg, { files, removed }] of byPkg) {
    const naming = changesets.filter((c) => pkg in c.releases);
    const list = files.join(', ');
    if (naming.length === 0) {
      errors.push(`${list} changed but no changeset added in this PR names ${pkg}. Run "pnpm changeset" and pick at least minor.`);
      continue;
    }
    const top = Math.max(...naming.map((c) => RANK[c.releases[pkg]]));
    if (top < RANK.minor) {
      errors.push(`${list} changed but the changeset bumps ${pkg} only as patch. An API report change needs at least minor.`);
    }
    if (removed > 0) {
      const flagged = naming.some((c) => c.body.split(/\r?\n/).some((l) => /^\s*(BREAKING|Beta):/.test(l)));
      if (!flagged) {
        errors.push(`${list} has ${removed} removed/changed line(s) but no changeset for ${pkg} has a line starting "BREAKING:" or "Beta:".`);
      }
    }
  }
  return errors;
}

function git(...args) {
  return execFileSync('/usr/bin/git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function main() {
  const i = process.argv.indexOf('--base');
  const base = i > 0 ? process.argv[i + 1] : process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/master';
  const range = `${base}...HEAD`;

  const changedFiles = git('diff', '--name-only', range, '--', 'packages/*/etc/*.api.md').split('\n').filter(Boolean);
  const changedReports = changedFiles.map((file) => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, dirname(dirname(file)), 'package.json'), 'utf8')).name;
    const removed = git('diff', '-U0', range, '--', file)
      .split('\n')
      .filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
    // First reports of a package (no `etc/` at the base): the baseline PR itself, nothing to compare.
    const bootstrap = git('ls-tree', '--name-only', base, `${dirname(file)}/`).trim() === '';
    return { pkg, file, removed, bootstrap };
  });

  const added = git('diff', '--name-only', '--diff-filter=A', range, '--', '.changeset/*.md')
    .split('\n')
    .filter((f) => f && !f.endsWith('README.md'));
  const changesets = added.map((file) => ({ file, ...parseChangeset(readFileSync(join(repoRoot, file), 'utf8')) }));

  const missingReports = listEntries(repoRoot)
    .map((e) => join(e.pkgDir, 'etc', `${e.name}.api.md`))
    .filter((p) => !existsSync(p))
    .map((p) => p.slice(repoRoot.length + 1));

  const errors = evaluate({ changedReports, changesets, missingReports });
  if (errors.length > 0) {
    for (const e of errors) console.error(`check-api-changeset: ${e}`);
    process.exit(1);
  }
  console.log(
    changedReports.length === 0
      ? 'check-api-changeset: no API report changed'
      : `check-api-changeset: ${changedReports.length} report(s) changed, changeset(s) OK`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
