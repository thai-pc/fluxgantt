#!/usr/bin/env node
// Clean-room check of the output of build-stackblitz-examples.mjs: copies each generated example
// into a fresh directory outside any workspace and runs what StackBlitz would, with npm (its
// installer is npm-compatible; pnpm would hide an undeclared or workspace-only dependency):
//
//   npm install --no-audit --no-fund
//   npm run typecheck --if-present
//   npm run build --if-present      then assert dist/<page>.html exists for every root HTML page
//   npm start                       only for examples without a build script (headless)
//
// Used by ci.yml (local-tarball mode, unreleased code) and stackblitz-examples.yml (registry mode,
// gates the push of the `stackblitz` branch). Proves the copies install, typecheck and build with
// Node; NOT that WebContainers can run them (see RELEASING.md, "StackBlitz examples").
//
// Usage: node tooling/scripts/verify-stackblitz-examples.mjs <generatedDir> --work <emptyDir> [--only <dir>]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { MANIFEST } from './build-stackblitz-examples.mjs';

function fail(message) {
  console.error(`\n✗ verify-stackblitz-examples: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--work') opts.work = argv[++i];
    else if (arg === '--only') opts.only = argv[++i];
    else if (!arg.startsWith('--') && !opts.generated) opts.generated = arg;
    else fail(`unknown argument ${JSON.stringify(arg)}`);
  }
  if (!opts.generated || !opts.work) fail('usage: <generatedDir> --work <emptyDir> [--only <dir>]');
  return { ...opts, generated: resolve(opts.generated), work: resolve(opts.work) };
}

/** npm walks up for a project root / workspace; any manifest above the work dir would capture it. */
function assertNoEnclosingProject(dir) {
  for (let d = dirname(dir); ; d = dirname(d)) {
    for (const marker of ['package.json', 'pnpm-workspace.yaml', 'package-lock.json']) {
      if (existsSync(join(d, marker))) fail(`${join(d, marker)} encloses ${dir}; use a work dir outside any project`);
    }
    if (dirname(d) === d) break;
  }
}

// Inherited `npm_config_*` (set when this runs under a pnpm/npm script) would leak the repo's
// settings, e.g. pnpm's `node-linker=hoisted`, into what must be a clean room.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^npm_(config|package|lifecycle)_/i.test(k)),
);

function run(cwd, args, { capture = false } = {}) {
  const started = Date.now();
  console.log(`\n$ (${cwd}) npm ${args.join(' ')}`);
  const res = spawnSync('npm', args, {
    cwd,
    env: cleanEnv,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (res.error) fail(`npm ${args.join(' ')}: ${res.error.message}`);
  if (capture) process.stdout.write(res.stdout);
  if (res.status !== 0) fail(`npm ${args.join(' ')} exited ${res.status} in ${cwd}`);
  console.log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  return res.stdout ?? '';
}

const opts = parseArgs(process.argv.slice(2));
if (!existsSync(join(opts.generated, '.stackblitz-stamp.json'))) {
  fail(`${opts.generated} is not a build-stackblitz-examples output (no .stackblitz-stamp.json)`);
}
if (existsSync(opts.work) && (await readdir(opts.work)).length > 0) fail(`--work ${opts.work} must be empty`);
await mkdir(opts.work, { recursive: true });
assertNoEnclosingProject(opts.work);

const results = [];
for (const example of MANIFEST) {
  if (opts.only && example.dir !== opts.only) continue;
  const dir = join(opts.work, example.dir);
  await cp(join(opts.generated, example.dir), dir, { recursive: true });
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const scripts = pkg.scripts ?? {};

  run(dir, ['install', '--no-audit', '--no-fund']);
  if (scripts.typecheck) run(dir, ['run', 'typecheck']);
  if (scripts.build) {
    run(dir, ['run', 'build']);
    const pages = (await readdir(dir)).filter((f) => f.endsWith('.html')).sort();
    const missing = pages.filter((p) => !existsSync(join(dir, 'dist', p)));
    if (pages.length === 0 || missing.length > 0) fail(`${example.dir}: dist is missing ${missing.join(', ') || 'every page'}`);
    results.push(`${example.dir}: install + ${scripts.typecheck ? 'typecheck + ' : ''}build ok (${pages.length} page(s))`);
  } else if (scripts.start) {
    const output = run(dir, ['start'], { capture: true });
    if (!/Critical path: \S/.test(output)) fail(`${example.dir}: \`npm start\` printed no critical path:\n${output}`);
    results.push(`${example.dir}: install + start ok`);
  } else {
    fail(`${example.dir}: has neither a build nor a start script`);
  }
}

if (results.length === 0) fail(`no example matched --only ${opts.only}`);
console.log('\n✓ verify-stackblitz-examples:');
for (const r of results) console.log(`  ${r}`);
