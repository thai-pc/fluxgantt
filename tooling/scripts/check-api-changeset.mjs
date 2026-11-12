#!/usr/bin/env node
// PR-only gate: "an API report changed => a changeset says so".
//
// For every package whose committed `etc/*.api.md` differs from the PR base:
//   R-a. a changeset ADDED in this PR must name that package;
//   R-b. its bump must be at least `minor` (a patch release never changes a report);
//   R-c. if the report REMOVES or alters a declaration line, the changeset body must contain a
//        line starting `BREAKING:` or `Beta:`;
// and every report the `exports` maps require must exist.
//
// This is a TRIPWIRE, not a semver oracle. Reports are normalised first (see `normalizeReport`):
// `(undocumented)` markers and `// Warning:` lines are dropped, so adding a doc comment or
// exporting a previously forgotten type is no change. Even so the script cannot tell additive from
// breaking: adding a REQUIRED member to an input type such as `GanttConfig` only adds lines yet
// breaks every host, and widening a union rewrites a line yet breaks nobody. Reviewers decide.
// Known limitation: a renamed package directory has no reports at the base, so it is exempt as
// "bootstrap" for that one PR.
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

/**
 * Drops what API Extractor derives from doc comments / warnings rather than from the API:
 * `// (undocumented)` lines and suffixes, and `// Warning:` lines (forgotten exports).
 * Returns the remaining non-blank lines.
 */
export function normalizeReport(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*\/\/ Warning:/.test(raw)) continue;
    const line = raw.replace(/\s*\/\/ \(undocumented\)$/, '').replace(/^(\s*\/\/ @\w+) \(undocumented\)$/, '$1');
    if (line.trim() === '') continue;
    out.push(line);
  }
  return out;
}

/** Multiset line diff of two reports after normalisation: `{ added, removed }` line counts. */
export function diffReports(baseText, headText) {
  const count = new Map();
  for (const l of normalizeReport(baseText)) count.set(l, (count.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of normalizeReport(headText)) {
    const n = count.get(l) ?? 0;
    if (n > 0) count.set(l, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of count.values()) removed += n;
  return { added, removed };
}

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

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function tryGit(cwd, ...args) {
  try {
    return git(cwd, ...args);
  } catch {
    return undefined;
  }
}

/** Reads the PR's report and changeset changes from git and returns `evaluate()`'s input. */
export function gather(root, base) {
  const range = `${base}...HEAD`;
  const changedFiles = git(root, 'diff', '--name-only', range, '--', 'packages/*/etc/*.api.md').split('\n').filter(Boolean);
  const changedReports = [];
  for (const file of changedFiles) {
    const pkg = JSON.parse(readFileSync(join(root, dirname(dirname(file)), 'package.json'), 'utf8')).name;
    const baseText = tryGit(root, 'show', `${base}:${file}`);
    const headText = tryGit(root, 'show', `HEAD:${file}`) ?? '';
    // First reports of a package (no `etc/` at the base): the baseline PR itself.
    const bootstrap = git(root, 'ls-tree', '--name-only', base, `${dirname(file)}/`).trim() === '';
    const { added, removed } = diffReports(baseText ?? '', headText);
    if (!bootstrap && added === 0 && removed === 0) continue; // doc-comment / warning churn only
    changedReports.push({ pkg, file, removed, bootstrap });
  }

  // Added, modified or renamed: an unreleased changeset edited in this PR counts too.
  const touched = git(root, 'diff', '--name-only', '--diff-filter=AMR', range, '--', '.changeset/*.md')
    .split('\n')
    .filter((f) => f && !f.endsWith('README.md'));
  const changesets = touched.map((file) => ({ file, ...parseChangeset(readFileSync(join(root, file), 'utf8')) }));

  const missingReports = listEntries(root)
    .map((e) => join(e.pkgDir, 'etc', `${e.name}.api.md`))
    .filter((p) => !existsSync(p))
    .map((p) => p.slice(root.length + 1));
  return { changedReports, changesets, missingReports };
}

function main() {
  const i = process.argv.indexOf('--base');
  const base = i > 0 ? process.argv[i + 1] : process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/master';
  const input = gather(repoRoot, base);
  const errors = evaluate(input);
  if (errors.length > 0) {
    for (const e of errors) console.error(`check-api-changeset: ${e}`);
    process.exit(1);
  }
  console.log(
    input.changedReports.length === 0
      ? 'check-api-changeset: no API report changed'
      : `check-api-changeset: ${input.changedReports.length} report(s) changed, changeset(s) OK`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
