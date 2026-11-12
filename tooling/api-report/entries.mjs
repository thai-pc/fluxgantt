// Shared by api-report.mjs and check-api-changeset.mjs: which API reports must exist.
// Driven by each publishable package's `exports` map so a new subpath cannot escape the lock.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `.` -> `core`, `./edit-hooks` -> `core-edit-hooks`. `pkgName` is the unscoped package name. */
export function reportName(pkgName, exportKey) {
  return exportKey === '.' ? pkgName : `${pkgName}-${exportKey.slice(2).replaceAll('/', '-')}`;
}

/** The d.ts a consumer's `import` resolves to for an exports-map entry. */
function typesOf(condition) {
  if (typeof condition === 'string') return undefined;
  return condition.import?.types ?? condition.types;
}

export function listEntries(root = repoRoot) {
  const entries = [];
  for (const dir of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgDir = join(root, 'packages', dir.name);
    const pkgPath = join(pkgDir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.private === true || !pkg.exports) continue;
    for (const [key, condition] of Object.entries(pkg.exports)) {
      const types = typesOf(condition);
      if (!types) continue; // e.g. "./package.json"
      entries.push({
        pkgName: pkg.name,
        pkgDir,
        pkgPath,
        name: reportName(pkg.name.split('/').pop(), key),
        dts: resolve(pkgDir, types),
      });
    }
  }
  return entries;
}

