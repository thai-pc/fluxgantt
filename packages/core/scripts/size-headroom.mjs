// Non-fatal bundle-headroom report. The real gate is `pnpm size` (fails when a fixture is over
// its limit); this only NUDGES: it prints headroom (limit - measured, bytes) per fixture and emits
// a GitHub `::warning` for any fixture under WARN_BELOW_BYTES, so a budget sitting a few bytes
// from its limit is visible on the PR before the next small feature breaks it. Always exits 0.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const WARN_BELOW_BYTES = 150;

/** Parses `size-limit --json` stdout (pnpm/npm may prepend a banner) into headroom rows. */
export function parseHeadroom(stdout) {
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
  return parsed.map((r) => ({
    name: r.name,
    size: r.size,
    limit: r.sizeLimit,
    headroom: r.sizeLimit - r.size,
  }));
}

/** Renders the table and the warning lines; separated from `main` so it is testable. */
export function report(rows, summaryPath) {
  const lines = rows.map((r) => `| ${r.name} | ${r.size} | ${r.limit} | ${r.headroom} |`);
  const table = ['| Fixture | Bytes | Limit | Headroom |', '|---|---|---|---|', ...lines].join('\n');
  const warnings = rows
    .filter((r) => r.headroom < WARN_BELOW_BYTES)
    .map((r) => `::warning title=Bundle headroom::${r.name} has only ${r.headroom} B of headroom (< ${WARN_BELOW_BYTES} B)`);
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
  const rows = parseHeadroom(stdout);
  if (rows.length === 0) {
    console.log('::warning title=Bundle headroom::could not read size-limit --json output');
    return;
  }
  const { table, warnings } = report(rows, process.env.GITHUB_STEP_SUMMARY);
  console.log(table);
  for (const w of warnings) console.log(w);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
