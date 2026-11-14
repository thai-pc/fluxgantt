#!/usr/bin/env node
// Generates / verifies the committed API reports (`packages/<pkg>/etc/<name>.api.md`) with
// API Extractor, one run per entry point of every publishable package.
//
//   node tooling/scripts/api-report.mjs --check    fail if any committed report is stale or missing
//   node tooling/scripts/api-report.mjs --update   regenerate the reports in place
//
// The entry list is DRIVEN BY each package's `exports` map (`import.types`), so a new subpath
// with no committed report fails `--check` instead of silently escaping the lock. Reports are
// built from `dist/**/*.d.ts`, so run `pnpm build` first (`pnpm api:update` does).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';
import { listEntries } from '../api-report/entries.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = JSON.parse(readFileSync(join(repoRoot, 'tooling/api-report/api-extractor.base.json'), 'utf8'));

/**
 * Sorts every run of consecutive Vue `"onX-y"?:` event-prop lines. A component's inferred props list its
 * emits in TypeScript's union order, which depends on type-interning order and was seen to differ between
 * identical builds (a flaky `--check`). The set of members is what the lock is about, not their order.
 * Only the COMPARISON is normalized; committed reports keep whatever order the extractor wrote.
 */
function normalize(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    if (!/^\s+"on[A-Z][^"]*"\?:/.test(lines[i])) {
      out.push(lines[i++]);
      continue;
    }
    const run = [];
    while (i < lines.length && /^\s+"on[A-Z][^"]*"\?:/.test(lines[i])) run.push(lines[i++]);
    out.push(...run.sort());
  }
  return out.join('\n');
}

function run(mode) {
  const local = mode === 'update';
  let failed = 0;
  for (const e of listEntries()) {
    if (!existsSync(e.dts)) {
      console.error(`api-report: ${e.dts} does not exist - run "pnpm build" first`);
      process.exit(1);
    }
    const tempFolder = join(repoRoot, 'node_modules/.cache/api-report', e.name);
    mkdirSync(tempFolder, { recursive: true });
    if (local) mkdirSync(join(e.pkgDir, 'etc'), { recursive: true });
    const config = ExtractorConfig.prepare({
      configObject: {
        ...base,
        projectFolder: e.pkgDir,
        mainEntryPointFilePath: e.dts,
        apiReport: {
          enabled: true,
          reportFileName: `${e.name}.api.md`,
          reportFolder: join(e.pkgDir, 'etc'),
          reportTempFolder: tempFolder,
        },
      },
      configObjectFullPath: join(e.pkgDir, 'api-extractor.json'),
      packageJsonFullPath: e.pkgPath,
    });
    const result = Extractor.invoke(config, {
      localBuild: local,
      showVerboseMessages: false,
      messageCallback: (m) => {
        // Extractor warnings (forgotten exports, undocumented members) are baseline noise: the
        // former are recorded inside the reports. TypeScript diagnostics and every error stay visible.
        if (m.logLevel === 'warning' && m.category === 'Extractor') m.handled = true;
      },
    });
    const label = `${e.name}.api.md`;
    const committedFile = join(e.pkgDir, 'etc', label);
    const generatedFile = join(tempFolder, label);
    let stale = result.apiReportChanged;
    if (!local && stale && existsSync(committedFile) && existsSync(generatedFile)) {
      stale =
        normalize(readFileSync(committedFile, 'utf8')) !==
        normalize(readFileSync(generatedFile, 'utf8'));
    }
    if (result.errorCount > 0 || (!local && stale)) {
      failed++;
      const committed = join(e.pkgDir, 'etc', label);
      if (result.errorCount > 0) {
        console.error(
          `api-report: ${label}: extractor reported ${result.errorCount} error(s), see above`,
        );
      } else if (!existsSync(committed)) {
        console.error(`api-report: ${label} is missing (not committed)`);
      } else {
        console.error(`api-report: ${label} is stale. Diff (committed -> generated):`);
        const generated = join(tempFolder, label);
        const d = spawnSync('diff', ['-u', committed, generated], { encoding: 'utf8' });
        if (d.stdout) console.error(d.stdout);
        else console.error(`  (no diff tool; compare ${committed} with ${generated})`);
      }
    } else {
      console.log(`api-report: ${label} ${local && stale ? 'updated' : 'ok'}`);
    }
  }
  if (failed > 0) {
    console.error(
      `\napi-report: ${failed} report(s) out of date. Run "pnpm api:update" and commit packages/*/etc/*.api.md ` +
        '(see CONTRIBUTING.md, "Changing the public API").',
    );
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.includes('--update')
    ? 'update'
    : process.argv.includes('--check')
      ? 'check'
      : null;
  if (!mode) {
    console.error('usage: api-report.mjs --check | --update');
    process.exit(2);
  }
  run(mode);
}
