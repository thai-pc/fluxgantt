#!/usr/bin/env node
// Decides whether `.github/workflows/stackblitz-examples.yml` should regenerate the `stackblitz`
// branch. Kept out of the workflow so it can be unit-tested
// (`tooling/scripts/__tests__/stackblitz-decide.test.mjs`).
//
// The rule is STATE-based, not commit-diff based, so a release that the workflow never saw (its
// Release run was cancelled while pending, a pending run of this workflow was replaced by a newer
// one, a multi-commit push whose tip is not the bump commit) is picked up by the next master push:
//
//   1. The stamp has a version NEWER than the source's (semver), for any package
//        -> no-op, unless `force`. Stops a re-run of an old failed run, or a dispatch of an old
//           ref, from force-pushing older versions over newer ones.
//   2. The stamp already has exactly the source's versions
//        -> no-op, unless `force` (dispatch only).
//   3. workflow_dispatch -> publish (the workflow then waits for the registry).
//   4. workflow_run:
//        the source commit itself changed a published version (the "Version Packages" merge)
//          -> publish; the workflow waits up to 20 minutes for the registry.
//        otherwise, every source version already resolves on the registry
//          -> publish (self-healing a missed release). If master has meanwhile started importing
//             API that is not on npm, `--check-registry` in the generator turns the run red, which
//             is the loud failure wanted: dispatch with source_ref = the release commit.
//        otherwise -> no-op (unreleased versions; Release published nothing).
//      Before the branch exists at all, only (4a) or a dispatch creates it: the self-healing path
//      would otherwise go red on every master push while master is ahead of npm.
//
// Usage (from the workflow):
//   node tooling/scripts/stackblitz-decide.mjs --event <workflow_run|workflow_dispatch>
//     --source <repoDir> --stamp <file|none> [--force]
// Writes `publish=true|false` to $GITHUB_OUTPUT and a one-line reason to $GITHUB_STEP_SUMMARY.
// The registry base URL can be overridden with FLUXGANTT_NPM_REGISTRY (tests use a local mock).
//
// Plain Node ESM, no dependencies.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PACKAGES = ['core', 'react', 'vue'];
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export class DecideError extends Error {}

/** Semver precedence (semver.org §11), no build metadata. Returns -1, 0 or 1; throws on a malformed version. */
export function compareSemver(a, b) {
  const pa = SEMVER_RE.exec(String(a));
  const pb = SEMVER_RE.exec(String(b));
  if (!pa || !pb) throw new DecideError(`malformed version ${JSON.stringify(pa ? b : a)}`);
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return Math.sign(d);
  }
  const [ra, rb] = [pa[4], pb[4]];
  if (ra === undefined || rb === undefined) return ra === rb ? 0 : ra === undefined ? 1 : -1;
  const ia = ra.split('.');
  const ib = rb.split('.');
  for (let i = 0; i < Math.max(ia.length, ib.length); i += 1) {
    if (ia[i] === undefined) return -1;
    if (ib[i] === undefined) return 1;
    const na = /^\d+$/.test(ia[i]);
    const nb = /^\d+$/.test(ib[i]);
    if (na && nb) {
      const d = Number(ia[i]) - Number(ib[i]);
      if (d !== 0) return Math.sign(d);
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (ia[i] !== ib[i]) {
      return ia[i] < ib[i] ? -1 : 1;
    }
  }
  return 0;
}

const fmt = (versions) => PACKAGES.map((p) => `@fluxgantt/${p}@${versions[p]}`).join(', ');

/**
 * Pure decision. `stamp` is the branch's parsed `.stackblitz-stamp.json`, `{}` when the branch
 * exists but the stamp is missing or unreadable, or `null` when the branch does not exist.
 * `isPublished(pkg, version)` is only called on the self-healing path.
 *
 * @param {{ event: 'workflow_run' | 'workflow_dispatch', force?: boolean,
 *           now: Record<string, string>, prev: Record<string, string | null> | null,
 *           stamp: Record<string, unknown> | null,
 *           isPublished: (pkg: string, version: string) => Promise<boolean> }} input
 * @returns {Promise<{ publish: boolean, reason: string }>}
 */
export async function decide({ event, force = false, now, prev, stamp, isPublished }) {
  if (event !== 'workflow_run' && event !== 'workflow_dispatch') throw new DecideError(`unknown event ${JSON.stringify(event)}`);
  for (const p of PACKAGES) compareSemver(now[p], now[p]); // validates
  const current = stamp ?? {};
  const stampValid = (p) => typeof current[p] === 'string' && SEMVER_RE.test(current[p]);
  const newer = PACKAGES.filter((p) => stampValid(p) && compareSemver(current[p], now[p]) > 0);
  const matches = PACKAGES.every((p) => current[p] === now[p]);
  const forced = event === 'workflow_dispatch' && force;

  if (newer.length > 0 && !forced) {
    return {
      publish: false,
      reason:
        `the stackblitz branch already has newer versions (${newer.map((p) => `@fluxgantt/${p}@${current[p]}`).join(', ')}) ` +
        `than the source (${fmt(now)}); refusing to overwrite them with older ones (dispatch with force to override)`,
    };
  }
  if (forced) return { publish: true, reason: 'forced by dispatch' };
  if (matches) return { publish: false, reason: 'the stackblitz branch already has these versions' };
  if (event === 'workflow_dispatch') return { publish: true, reason: 'the stamp differs from source_ref' };

  const bumped = PACKAGES.filter((p) => (prev?.[p] ?? null) !== now[p]);
  if (bumped.length > 0) {
    return { publish: true, reason: `release of ${bumped.map((p) => `@fluxgantt/${p}@${now[p]}`).join(', ')}` };
  }
  if (stamp === null) {
    return {
      publish: false,
      reason:
        'the stackblitz branch does not exist yet and this commit changed no published version; ' +
        'the next release (or a dispatch) creates it',
    };
  }
  const missing = [];
  for (const p of PACKAGES) if (!(await isPublished(p, now[p]))) missing.push(`@fluxgantt/${p}@${now[p]}`);
  if (missing.length > 0) {
    return { publish: false, reason: `not a release: ${missing.join(', ')} not on the registry` };
  }
  return { publish: true, reason: `the stamp is behind the published ${fmt(now)} (a missed release)` };
}

/** `fetch`-based registry probe: true on 200, false on 404, throws otherwise. */
export function registryProbe(registry = process.env.FLUXGANTT_NPM_REGISTRY ?? DEFAULT_REGISTRY) {
  return async (pkg, version) => {
    const url = `${registry.replace(/\/+$/, '')}/@fluxgantt/${pkg}/${version}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.status === 404) return false;
    if (!res.ok) throw new DecideError(`registry ${url}: HTTP ${res.status}`);
    const body = await res.json();
    return body?.version === version;
  };
}

/** Reads `packages/<pkg>/package.json` versions at a git revision; `null` per package if absent. */
export function versionsAt(sourceRoot, rev) {
  return Object.fromEntries(
    PACKAGES.map((p) => {
      try {
        const text = execFileSync('git', ['-C', sourceRoot, 'show', `${rev}:packages/${p}/package.json`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return [p, JSON.parse(text).version ?? null];
      } catch {
        return [p, null];
      }
    }),
  );
}

/** `none` = the branch does not exist (null); an unreadable or non-object stamp counts as `{}`. */
export function readStamp(file) {
  if (file === 'none') return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseArgs(argv) {
  const opts = { force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new DecideError(`${arg} needs a value`);
      i += 1;
      return v;
    };
    if (arg === '--event') opts.event = value();
    else if (arg === '--source') opts.source = value();
    else if (arg === '--stamp') opts.stamp = value();
    else if (arg === '--force') opts.force = true;
    else throw new DecideError(`unknown argument ${JSON.stringify(arg)}`);
  }
  for (const k of ['event', 'source', 'stamp']) if (!opts[k]) throw new DecideError(`--${k} is required`);
  return opts;
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const source = resolve(opts.source);
    const now = versionsAt(source, 'HEAD');
    const stamp = readStamp(opts.stamp);
    const { publish, reason } = await decide({
      event: opts.event,
      force: opts.force,
      now,
      prev: versionsAt(source, 'HEAD^'),
      stamp,
      isPublished: registryProbe(),
    });
    const line =
      `${publish ? 'Publishing' : 'Nothing to do'}: ${reason}. ` +
      `Source ${JSON.stringify(now)}, current stamp ${stamp === null ? '(no branch)' : JSON.stringify(stamp)}.`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
  } catch (err) {
    if (err instanceof DecideError) {
      console.error(`\n✗ stackblitz-decide: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
