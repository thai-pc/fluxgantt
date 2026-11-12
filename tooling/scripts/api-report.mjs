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
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';
import { listEntries } from '../api-report/entries.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = JSON.parse(readFileSync(join(repoRoot, 'tooling/api-report/api-extractor.base.json'), 'utf8'));

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
        // Warnings are baseline noise (forgotten exports are recorded inside the reports).
        if (m.logLevel === 'warning') m.handled = true;
      },
    });
    const stale = result.apiReportChanged;
    const label = `${e.name}.api.md`;
    if (result.errorCount > 0 || (!local && stale)) {
      failed++;
      console.error(`api-report: ${label} is ${existsSync(join(e.pkgDir, 'etc', label)) ? 'stale' : 'missing'}`);
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
  const mode = process.argv.includes('--update') ? 'update' : process.argv.includes('--check') ? 'check' : null;
  if (!mode) {
    console.error('usage: api-report.mjs --check | --update');
    process.exit(2);
  }
  run(mode);
}
