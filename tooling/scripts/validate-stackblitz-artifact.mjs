#!/usr/bin/env node
// Validates a downloaded `stackblitz-examples` artifact before the `push` job of
// `.github/workflows/stackblitz-examples.yml` commits it with a `contents: write` token, and
// before the `generate` job uploads it.
//
// The artifact is produced by first-party code only (the zero-dependency generator), but the
// push job treats it as untrusted anyway (defense in depth, review finding 1): git must never see
// in-tree configuration, so the tree may contain nothing git would interpret.
//
//   - regular files and directories only: no symlink, FIFO, socket or device, anywhere
//   - no entry named `.git` (any case), and no hidden entry at all except the top-level stamp
//     (that also excludes `.gitattributes` / `.gitignore` / `.gitmodules`)
//   - the top level is exactly ALLOWED_TOP_LEVEL, each with the expected kind
//   - names are plain (letters, digits, `._@-`), so no control characters or odd encodings
//   - bounded: at most MAX_FILES files and MAX_BYTES bytes in total
//   - the stamp is a JSON object with exactly { sourceSha, core, react, vue }, well-formed, and,
//     when `--expect-*` is given, equal to what the generate job reported
//
// Deliberately self-contained (no imports from the generator) so the push job can sparse-check-out
// this one file from the trusted workflow commit. A unit test keeps ALLOWED_TOP_LEVEL in step with
// the generator's MANIFEST.
//
// Usage: node tooling/scripts/validate-stackblitz-artifact.mjs <dir>
//          [--expect-sha <sha>] [--expect-core <v>] [--expect-react <v>] [--expect-vue <v>]
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STAMP = '.stackblitz-stamp.json';
/** name -> 'dir' | 'file'. Mirrors build-stackblitz-examples.mjs MANIFEST dirs + root files. */
export const ALLOWED_TOP_LEVEL = {
  headless: 'dir',
  react: 'dir',
  vanilla: 'dir',
  vue: 'dir',
  'README.md': 'file',
  [STAMP]: 'file',
};
export const MAX_FILES = 500;
export const MAX_BYTES = 5 * 1024 * 1024;
const NAME_RE = /^[A-Za-z0-9._@-]+$/;
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const SHA_RE = /^[0-9a-f]{40}$/;

const kindOf = (st) =>
  st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'special file';

/**
 * @param {string} dir
 * @param {{ sha?: string, core?: string, react?: string, vue?: string }} [expect]
 * @returns {string[]} problems (empty = valid)
 */
export function validateArtifact(dir, expect = {}) {
  const problems = [];
  let root;
  try {
    root = lstatSync(dir);
  } catch (err) {
    return [`${dir}: ${err.code ?? err.message}`];
  }
  if (!root.isDirectory()) return [`${dir}: expected a directory, found a ${kindOf(root)}`];

  let files = 0;
  let bytes = 0;
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      const childRel = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(abs, name));
      const kind = kindOf(st);
      if (name.toLowerCase() === '.git') {
        problems.push(`${childRel}: a .git entry is never allowed`);
        continue;
      }
      if (!NAME_RE.test(name)) problems.push(`${JSON.stringify(childRel)}: unexpected characters in the name`);
      if (name.startsWith('.') && childRel !== STAMP) problems.push(`${childRel}: hidden entries are not allowed`);
      if (kind === 'dir') walk(join(abs, name), childRel);
      else if (kind === 'file') {
        files += 1;
        bytes += st.size;
      } else problems.push(`${childRel}: ${kind} (only regular files and directories are allowed)`);
    }
  };
  walk(dir, '');

  const top = readdirSync(dir);
  for (const name of top) {
    if (!Object.hasOwn(ALLOWED_TOP_LEVEL, name)) problems.push(`${name}: not an allowed top-level entry`);
  }
  for (const [name, kind] of Object.entries(ALLOWED_TOP_LEVEL)) {
    if (!top.includes(name)) {
      problems.push(`${name}: missing`);
      continue;
    }
    const actual = kindOf(lstatSync(join(dir, name)));
    if (actual !== kind) problems.push(`${name}: expected a ${kind}, found a ${actual}`);
  }
  if (files > MAX_FILES) problems.push(`${files} files (limit ${MAX_FILES})`);
  if (bytes > MAX_BYTES) problems.push(`${bytes} bytes (limit ${MAX_BYTES})`);

  if (top.includes(STAMP) && kindOf(lstatSync(join(dir, STAMP))) === 'file') problems.push(...checkStamp(join(dir, STAMP), expect));
  return problems;
}

function checkStamp(file, expect) {
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return [`${STAMP}: invalid JSON (${err.message})`];
  }
  if (stamp === null || typeof stamp !== 'object' || Array.isArray(stamp)) return [`${STAMP}: not a JSON object`];
  const problems = [];
  const keys = Object.keys(stamp).sort().join(',');
  if (keys !== 'core,react,sourceSha,vue') problems.push(`${STAMP}: keys must be exactly sourceSha, core, react, vue (got ${keys})`);
  if (typeof stamp.sourceSha !== 'string' || !SHA_RE.test(stamp.sourceSha)) problems.push(`${STAMP}: malformed sourceSha`);
  for (const p of ['core', 'react', 'vue']) {
    if (typeof stamp[p] !== 'string' || !VERSION_RE.test(stamp[p])) problems.push(`${STAMP}: malformed ${p} version`);
  }
  const expected = { sourceSha: expect.sha, core: expect.core, react: expect.react, vue: expect.vue };
  for (const [k, v] of Object.entries(expected)) {
    if (v !== undefined && stamp[k] !== v) problems.push(`${STAMP}: ${k} is ${JSON.stringify(stamp[k])}, expected ${JSON.stringify(v)}`);
  }
  return problems;
}

export function parseArgs(argv) {
  const opts = { expect: {} };
  const flags = { '--expect-sha': 'sha', '--expect-core': 'core', '--expect-react': 'react', '--expect-vue': 'vue' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (Object.hasOwn(flags, arg)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${arg} needs a value`);
      opts.expect[flags[arg]] = v;
      i += 1;
    } else if (!arg.startsWith('--') && opts.dir === undefined) {
      opts.dir = arg;
    } else {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  if (opts.dir === undefined) throw new Error('usage: <dir> [--expect-sha <sha>] [--expect-core|react|vue <version>]');
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`\n✗ validate-stackblitz-artifact: ${err.message}\n`);
    process.exit(1);
  }
  const problems = validateArtifact(resolve(opts.dir), opts.expect);
  if (problems.length > 0) {
    console.error(`\n✗ validate-stackblitz-artifact: ${opts.dir} is not a clean generator output:\n  ${problems.join('\n  ')}\n`);
    process.exit(1);
  }
  console.log(`✓ validate-stackblitz-artifact: ${opts.dir} contains only the expected generated files`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
