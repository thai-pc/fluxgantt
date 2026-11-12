import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_PATTERN } from '../version-constant.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = join(repo, 'tooling/scripts/check-publish-readiness.mjs');

test('VERSION_PATTERN matches both the literal and the `: string` spelling', () => {
  assert.equal("export const VERSION = '0.7.0';".match(VERSION_PATTERN)[2], '0.7.0');
  assert.equal("export const VERSION: string = '0.7.0';".match(VERSION_PATTERN)[2], '0.7.0');
});

// Scratch repo: real manifests + READMEs, symlinked dist, so only the version relation varies.
function scratch(coreVersion) {
  const root = mkdtempSync(join(tmpdir(), 'fg-ready-'));
  mkdirSync(join(root, '.changeset'));
  cpSync(join(repo, '.changeset/config.json'), join(root, '.changeset/config.json'));
  for (const p of ['core', 'react', 'vue']) {
    const dir = join(root, 'packages', p);
    mkdirSync(join(dir, 'src'), { recursive: true });
    const pkg = JSON.parse(readFileSync(join(repo, 'packages', p, 'package.json'), 'utf8'));
    if (p === 'core' && coreVersion) pkg.version = coreVersion;
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    cpSync(join(repo, 'packages', p, 'README.md'), join(dir, 'README.md'));
    cpSync(join(repo, 'packages', p, 'src/index.ts'), join(dir, 'src/index.ts'));
    symlinkSync(join(repo, 'packages', p, 'dist'), join(dir, 'dist'));
  }
  return root;
}

const run = (root) => spawnSync('node', [script], { env: { ...process.env, FLUXGANTT_REPO_ROOT: root }, encoding: 'utf8' });

test('readiness fails when VERSION is stale against package.json (annotated spelling)', { skip: !existsSync(join(repo, 'packages/core/dist')) }, () => {
  const ok = scratch();
  const stale = scratch('0.99.0');
  try {
    assert.match(readFileSync(join(stale, 'packages/core/src/index.ts'), 'utf8'), /VERSION: string = /);
    assert.equal(run(ok).status, 0, run(ok).stderr);
    const r = run(stale);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /exports VERSION/);
  } finally {
    rmSync(ok, { recursive: true, force: true });
    rmSync(stale, { recursive: true, force: true });
  }
});
