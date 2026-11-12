#!/usr/bin/env node
// Runs @arethetypeswrong/cli against the packed tarball of every publishable package, so the
// `exports` / `.d.ts` / `.d.cts` mapping is verified the way a consumer gets it. Needs `pnpm build`.
// `--profile node16` ignores the legacy `node10` resolution (it cannot read `exports`, so every
// subpath fails there by construction; TypeScript 6 deprecates it).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = mkdtempSync(join(tmpdir(), 'fluxgantt-attw-'));
let failed = 0;
try {
  for (const dir of readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgDir = join(repoRoot, 'packages', dir.name);
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (pkg.private === true) continue;
    execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: pkgDir, stdio: 'ignore' });
  }
  for (const tgz of readdirSync(out).filter((f) => f.endsWith('.tgz'))) {
    try {
      execFileSync('pnpm', ['exec', 'attw', join(out, tgz), '--profile', 'node16'], { cwd: repoRoot, stdio: 'inherit' });
    } catch {
      failed++;
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed > 0) {
  console.error(`check-package-types: ${failed} package(s) have type-resolution problems`);
  process.exit(1);
}
