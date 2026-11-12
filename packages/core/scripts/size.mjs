// Bundle-size runner. Two size-limit configs, two policies (see CLAUDE.md golden rule 5):
//   .size-limit.json       HARD gates (3 fixtures): over the limit fails the run.
//   .size-limit.soft.json  REPORT-ONLY (8 fixtures): printed, never fails; warns when a fixture is
//                          over its reference limit or grew > SOFT_GROWTH_PCT vs size-limit/baselines.json.
//
//   node scripts/size.mjs                    all eleven fixtures; exit 1 only if a hard gate fails
//   node scripts/size.mjs --soft             soft set only; always exit 0 (CI "report" step)
//   node scripts/size.mjs --json             combined JSON array (for tooling/scripts)
//   node scripts/size.mjs --update-baseline  rewrite the "soft" baselines from the current build
// The hard set alone is plain `size-limit` (the `size:hard` script).
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSizes } from './size-headroom.mjs';

export const SOFT_GROWTH_PCT = 5;
const PKG = fileURLToPath(new URL('..', import.meta.url));
const BASELINES = fileURLToPath(new URL('../size-limit/baselines.json', import.meta.url));

/** Warning lines for the soft set. Pure; `baselines` maps fixture name to bytes on master. */
export function softWarnings(rows, baselines) {
  const out = [];
  for (const r of rows) {
    if (r.size > r.limit) {
      out.push(`::warning title=Bundle size (soft)::${r.name} is ${r.size} B, over its reference budget of ${r.limit} B`);
    }
    const base = baselines[r.name];
    if (base && r.size > base * (1 + SOFT_GROWTH_PCT / 100)) {
      const pct = (((r.size - base) / base) * 100).toFixed(1);
      out.push(`::warning title=Bundle size (soft)::${r.name} grew ${pct}% vs master (${base} B -> ${r.size} B, threshold ${SOFT_GROWTH_PCT}%)`);
    }
  }
  return out;
}

export function table(rows, tier) {
  const head = ['| Tier | Fixture | Bytes | Limit | Headroom |', '|---|---|---|---|---|'];
  return [...head, ...rows.map((r) => `| ${tier} | ${r.name} | ${r.size} | ${r.limit} | ${r.limit - r.size} |`)].join('\n');
}

function measure(config) {
  let stdout;
  try {
    stdout = execFileSync('pnpm', ['exec', 'size-limit', '--json', '--config', config], {
      cwd: PKG, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    stdout = e.stdout?.toString() ?? ''; // size-limit exits non-zero over a limit but still prints JSON
  }
  const rows = parseSizes(stdout);
  if (rows.length === 0) throw new Error(`could not read size-limit --json output for ${config}`);
  return rows;
}

function main() {
  const flags = new Set(process.argv.slice(2));
  const baselines = JSON.parse(readFileSync(BASELINES, 'utf8'));
  const soft = measure('.size-limit.soft.json');
  if (flags.has('--update-baseline')) {
    baselines.soft = Object.fromEntries(soft.map((r) => [r.name, r.size]));
    writeFileSync(BASELINES, `${JSON.stringify(baselines, null, 2)}\n`);
    console.log('soft baselines updated');
    return;
  }
  const hard = flags.has('--soft') ? [] : measure('.size-limit.json');
  if (flags.has('--json')) {
    console.log(JSON.stringify([...hard, ...soft].map((r) => ({ name: r.name, size: r.size, sizeLimit: r.limit }))));
    return;
  }
  const parts = [];
  if (hard.length) parts.push(table(hard, 'hard'));
  parts.push(table(soft, 'soft'));
  const text = parts.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  for (const w of softWarnings(soft, baselines.soft)) console.log(w);
  const failed = hard.filter((r) => r.size > r.limit);
  for (const r of failed) console.error(`HARD GATE FAILED: ${r.name} is ${r.size} B, limit ${r.limit} B`);
  if (failed.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
