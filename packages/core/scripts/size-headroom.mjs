// Non-fatal headroom report for the HARD gates only (the default `.size-limit.json`; the real gate
// is `pnpm size:hard`). It NUDGES: prints headroom per hard fixture and emits a GitHub `::warning`
// for any fixture with less than 25% of its allotted headroom left. Always exits 0.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Fraction of a hard gate's ALLOTTED headroom (limit - the size it was re-based from, recorded in
// size-limit/baselines.json) below which the report warns: < 25% left means the next feature will
// need an owner decision soon.
export const WARN_BELOW_FRACTION = 0.25;

/** Parses `size-limit --json` stdout (pnpm/npm may prepend a banner) into size rows. */
export function parseSizes(stdout) {
  const start = stdout.indexOf('[');
  if (start === -1) return [];
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    // e.g. size-limit's `{"error": stack}` output, whose stack frames can contain `[`.
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((r) => ({ name: r.name, size: r.size, limit: r.sizeLimit }));
}

/** Rows with `headroom`, the `allotted` headroom when a baseline is known, and the warn flag. */
export function parseHeadroom(stdout, baselines = {}) {
  return parseSizes(stdout).map((r) => {
    const base = baselines[r.name];
    const allotted = base === undefined ? undefined : r.limit - base;
    const headroom = r.limit - r.size;
    return { ...r, headroom, allotted, low: allotted !== undefined && headroom < allotted * WARN_BELOW_FRACTION };
  });
}

/** Renders the table and the warning lines; separated from `main` so it is testable. */
export function report(rows, summaryPath) {
  const lines = rows.map((r) => `| ${r.name} | ${r.size} | ${r.limit} | ${r.headroom} |`);
  const table = ['| Hard fixture | Bytes | Limit | Headroom |', '|---|---|---|---|', ...lines].join('\n');
  const warnings = rows
    .filter((r) => r.low)
    .map((r) => `::warning title=Bundle headroom::${r.name} has ${r.headroom} B of headroom left, under ${WARN_BELOW_FRACTION * 100}% of the ${r.allotted} B allotted when its limit was set`);
  if (summaryPath) appendFileSync(summaryPath, `${table}\n`);
  return { table, warnings };
}

function main() {
  let stdout;
  try {
    stdout = execFileSync('pnpm', ['exec', 'size-limit', '--json'], { encoding: 'utf8' });
  } catch (e) {
    // size-limit exits non-zero when a budget fails but still prints the JSON.
    stdout = e.stdout?.toString() ?? '';
  }
  const baselines = JSON.parse(readFileSync(new URL('../size-limit/baselines.json', import.meta.url), 'utf8')).hard;
  const rows = parseHeadroom(stdout, baselines);
  if (rows.length === 0) {
    console.log('::warning title=Bundle headroom::could not read size-limit --json output');
    return;
  }
  const { table, warnings } = report(rows, process.env.GITHUB_STEP_SUMMARY);
  console.log(table);
  for (const w of warnings) console.log(w);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
