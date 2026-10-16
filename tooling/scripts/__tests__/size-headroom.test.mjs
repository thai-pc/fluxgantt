import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHeadroom, report, WARN_BELOW_BYTES } from '../../../packages/core/scripts/size-headroom.mjs';

test('parseHeadroom skips a pnpm banner and computes limit - size', () => {
  const out = '\n> @fluxgantt/core size\n> size-limit --json\n\n' +
    JSON.stringify([
      { name: 'a', passed: true, size: 9000, sizeLimit: 9216 },
      { name: 'b', passed: false, size: 10300, sizeLimit: 10240 },
    ]);
  assert.deepEqual(parseHeadroom(out), [
    { name: 'a', size: 9000, limit: 9216, headroom: 216 },
    { name: 'b', size: 10300, limit: 10240, headroom: -60 },
  ]);
});

test('parseHeadroom returns [] when there is no JSON', () => {
  assert.deepEqual(parseHeadroom('boom'), []);
  assert.equal(WARN_BELOW_BYTES, 150);
});

test('parseHeadroom returns [] for malformed JSON (error stack containing "[")', () => {
  assert.deepEqual(parseHeadroom('{"error":"at run [as runMain] (x)"}'), []);
  assert.deepEqual(parseHeadroom('[1,'), []);
});

test('report warns only below the threshold and writes the step summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'headroom-'));
  const summary = join(dir, 'summary.md');
  const rows = [
    { name: 'tight', size: 100, limit: 100 + WARN_BELOW_BYTES - 1, headroom: WARN_BELOW_BYTES - 1 },
    { name: 'edge', size: 100, limit: 100 + WARN_BELOW_BYTES, headroom: WARN_BELOW_BYTES },
  ];
  const { table, warnings } = report(rows, summary);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^::warning title=Bundle headroom::tight has only 149 B/);
  assert.equal(readFileSync(summary, 'utf8'), `${table}\n`);
  assert.match(table, /\| edge \| 100 \| 250 \| 150 \|/);
});

test('report without a summary path writes no file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'headroom-'));
  report([], undefined);
  assert.equal(existsSync(join(dir, 'x')), false);
});
