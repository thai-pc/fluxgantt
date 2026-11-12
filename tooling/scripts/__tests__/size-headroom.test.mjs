import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHeadroom, parseSizes, report, WARN_BELOW_FRACTION } from '../../../packages/core/scripts/size-headroom.mjs';
import { softWarnings, SOFT_GROWTH_PCT } from '../../../packages/core/scripts/size.mjs';

test('parseHeadroom skips a pnpm banner, computes headroom and flags < 25% of the allotted headroom', () => {
  const out = '\n> @fluxgantt/core size\n> size-limit --json\n\n' +
    JSON.stringify([
      { name: 'a', passed: true, size: 9000, sizeLimit: 9216 },
      { name: 'b', passed: true, size: 7600, sizeLimit: 8448 },
      { name: 'c', passed: true, size: 7000, sizeLimit: 8448 },
    ]);
  // allotted = limit - baseline; none of these is under 25% of it. Tighter cases follow.
  const rows = parseHeadroom(out, { a: 9000, b: 7500, c: 7500 });
  assert.deepEqual(rows.map((r) => [r.headroom, r.allotted, r.low]), [[216, 216, false], [848, 948, false], [1448, 948, false]]);
  const tight = parseHeadroom(JSON.stringify([{ name: 't', size: 8300, sizeLimit: 8448 }]), { t: 7526 });
  assert.deepEqual([tight[0].headroom, tight[0].allotted, tight[0].low], [148, 922, true]);
  const edge = parseHeadroom(JSON.stringify([{ name: 't', size: 8200, sizeLimit: 8448 }]), { t: 7526 });
  assert.equal(edge[0].headroom, 248); // 248 >= 0.25 * 922 = 230.5
  assert.equal(edge[0].low, false);
});

test('parseSizes / parseHeadroom return [] when there is no JSON or it is malformed', () => {
  assert.deepEqual(parseSizes('boom'), []);
  assert.deepEqual(parseHeadroom('{"error":"at run [as runMain] (x)"}'), []);
  assert.deepEqual(parseSizes('[1,'), []);
  assert.equal(WARN_BELOW_FRACTION, 0.25);
});

test('report warns only for low rows and writes the step summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'headroom-'));
  const summary = join(dir, 'summary.md');
  const rows = [
    { name: 'tight', size: 100, limit: 150, headroom: 50, allotted: 400, low: true },
    { name: 'fine', size: 100, limit: 600, headroom: 500, allotted: 600, low: false },
  ];
  const { table, warnings } = report(rows, summary);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^::warning title=Bundle headroom::tight has 50 B of headroom left/);
  assert.equal(readFileSync(summary, 'utf8'), `${table}\n`);
  assert.match(table, /\| fine \| 100 \| 600 \| 500 \|/);
});

test('report without a summary path writes no file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'headroom-'));
  report([], undefined);
  assert.equal(existsSync(join(dir, 'x')), false);
});

test('softWarnings flags fixtures over their reference limit or grown > 5% vs the baseline', () => {
  assert.equal(SOFT_GROWTH_PCT, 5);
  const rows = [
    { name: 'over', size: 1100, limit: 1000 },
    { name: 'grew', size: 1060, limit: 2000 },
    { name: 'ok', size: 1050, limit: 2000 },
    { name: 'new', size: 5000, limit: 9000 },
  ];
  const w = softWarnings(rows, { over: 1090, grew: 1000, ok: 1000 });
  assert.equal(w.length, 2);
  assert.match(w[0], /over is 1100 B, over its reference budget of 1000 B/);
  assert.match(w[1], /grew grew 6\.0% vs master/);
  assert.ok(w.every((x) => x.startsWith('::warning')));
});
