// Structural checks on the HARD size gates (CLAUDE.md golden rule 5): the default size-limit config
// holds exactly four, each has a re-base baseline keyed by its name, and the "everything" gate
// composes every public mixin subpath so it cannot silently under-measure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHeadroom } from '../../../packages/core/scripts/size-headroom.mjs';

const core = (p) => new URL(`../../../packages/core/${p}`, import.meta.url);
const json = (p) => JSON.parse(readFileSync(core(p), 'utf8'));
const KIB = 1024;
const toBytes = (limit) => {
  const m = /^([\d.]+) KiB$/.exec(limit);
  assert.ok(m, `limit "${limit}" must be written in KiB`);
  return Number(m[1]) * KIB;
};

const hard = json('.size-limit.json');
const soft = json('.size-limit.soft.json');
const baselines = json('size-limit/baselines.json');
const EVERYTHING = 'Everything composed (all mixins incl. grid + grid editing, gzip)';

test('the default config holds four hard gates, the soft config the rest, and names never collide', () => {
  assert.equal(hard.length, 4);
  assert.equal(soft.length, 10);
  const names = [...hard, ...soft].map((r) => r.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(hard.some((r) => r.name === EVERYTHING));
});

test('every hard gate has a baseline keyed by its name and a limit above it on a 0.25 KiB step', () => {
  for (const r of hard) {
    const base = baselines.hard[r.name];
    assert.equal(typeof base, 'number', `no hard baseline for "${r.name}"`);
    assert.ok(toBytes(r.limit) > base, `${r.name}: limit must exceed its re-base size`);
    assert.equal(toBytes(r.limit) % 256, 0, `${r.name}: limit is not a multiple of 0.25 KiB`);
  }
  assert.deepEqual(Object.keys(baselines.hard).sort(), hard.map((r) => r.name).sort());
});

test('the everything gate limit is its baseline x 1.10 rounded up to the next 0.25 KiB (G0 formula)', () => {
  const gate = hard.find((r) => r.name === EVERYTHING);
  const base = baselines.hard[EVERYTHING];
  assert.equal(toBytes(gate.limit), Math.ceil((base * 1.1) / 256) * 256);
});

test('size-headroom reports all four hard gates', () => {
  const out = JSON.stringify(hard.map((r) => ({ name: r.name, size: baselines.hard[r.name], sizeLimit: toBytes(r.limit) })));
  const rows = parseHeadroom(out, baselines.hard);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.allotted > 0 && r.low === false));
});

test('everything.js imports every public mixin subpath (each is also referenced, or it is shaken away)', () => {
  const src = readFileSync(core('size-limit/everything.js'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  const subpaths = Object.keys(json('package.json').exports).filter((k) => k !== '.');
  for (const sub of subpaths) {
    assert.ok(code.includes(`from '@fluxgantt/core/${sub.slice(2)}'`), `everything.js does not import ${sub}`);
  }
  // Names come from the fixture's own import lines, per subpath, so a new mixin cannot be imported
  // and left uncalled (it would be tree-shaken away and the gate would under-measure).
  const imported = [...code.matchAll(/import \{([^}]+)\} from '@fluxgantt\/core\/([\w-]+)'/g)].flatMap((m) =>
    m[1].split(',').map((n) => n.trim()).filter(Boolean),
  );
  const mixins = imported.filter((n) => /^with[A-Z]/.test(n));
  assert.equal(mixins.length, subpaths.length, 'one with* mixin per exported subpath');
  for (const name of mixins) assert.ok(new RegExp(`\\b${name}\\(`).test(code), `${name} is imported but never called`);
});

test('every fixture file named in either config exists and has its esbuild config', () => {
  for (const r of [...hard, ...soft]) {
    assert.doesNotThrow(() => readFileSync(core(r.path)), r.path);
    assert.doesNotThrow(() => readFileSync(core(r.config)), r.config);
  }
});
