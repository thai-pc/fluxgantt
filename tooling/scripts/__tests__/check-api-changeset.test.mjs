import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { diffReports, evaluate, gather, normalizeReport, parseChangeset } from '../check-api-changeset.mjs';

const core = '@fluxgantt/core';
const report = (removed = 0, pkg = core) => ({ pkg, file: `packages/x/etc/${pkg}.api.md`, removed });
const cs = (releases, body = 'Add a thing.') => ({ file: '.changeset/a.md', releases, body });

test('parseChangeset reads quoted package names, bumps and the body', () => {
  const p = parseChangeset("---\n'@fluxgantt/core': minor\n\"@fluxgantt/vue\": patch\n---\n\nBREAKING: gone\n");
  assert.deepEqual(p.releases, { '@fluxgantt/core': 'minor', '@fluxgantt/vue': 'patch' });
  assert.match(p.body, /^\s*BREAKING: gone/);
  assert.deepEqual(parseChangeset('no front matter').releases, {});
});

test('docs-only PR (no report changed) passes', () => {
  assert.deepEqual(evaluate({ changedReports: [], changesets: [] }), []);
});

test('report changed with no changeset fails', () => {
  assert.equal(evaluate({ changedReports: [report()], changesets: [] }).length, 1);
});

test('changeset for another package fails', () => {
  const errs = evaluate({ changedReports: [report()], changesets: [cs({ '@fluxgantt/vue': 'minor' })] });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /names @fluxgantt\/core/);
});

test('additive change with patch fails', () => {
  const errs = evaluate({ changedReports: [report()], changesets: [cs({ [core]: 'patch' })] });
  assert.match(errs[0], /at least minor/);
});

test('additive change with minor or major passes', () => {
  assert.deepEqual(evaluate({ changedReports: [report()], changesets: [cs({ [core]: 'minor' })] }), []);
  assert.deepEqual(evaluate({ changedReports: [report()], changesets: [cs({ [core]: 'major' })] }), []);
});

test('the highest bump across several changesets wins', () => {
  const errs = evaluate({ changedReports: [report()], changesets: [cs({ [core]: 'patch' }), cs({ [core]: 'minor' })] });
  assert.deepEqual(errs, []);
});

test('removal with minor but no BREAKING:/Beta: line fails', () => {
  const errs = evaluate({ changedReports: [report(2)], changesets: [cs({ [core]: 'minor' }, 'Mentions BREAKING: mid-line only.')] });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /BREAKING:/);
});

test('removal with a BREAKING: or Beta: line passes', () => {
  for (const body of ['BREAKING: removed x', 'Intro\n\nBeta: reshaped y']) {
    assert.deepEqual(evaluate({ changedReports: [report(1)], changesets: [cs({ [core]: 'minor' }, body)] }), []);
  }
});

test('each changed package is checked independently', () => {
  const errs = evaluate({
    changedReports: [report(0, core), report(0, '@fluxgantt/react')],
    changesets: [cs({ [core]: 'minor' })],
  });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /@fluxgantt\/react/);
});

test('a missing report for an exports entry fails', () => {
  const errs = evaluate({ changedReports: [], changesets: [], missingReports: ['packages/core/etc/core-new.api.md'] });
  assert.match(errs[0], /core-new/);
});

test('first-ever reports of a package (baseline PR) are not an API change', () => {
  assert.deepEqual(evaluate({ changedReports: [{ ...report(), bootstrap: true }], changesets: [] }), []);
});

test('normalizeReport drops (undocumented) markers, inline markers, warnings and blank lines', () => {
  const text = [
    '// Warning: (ae-forgotten-export) The symbol "X" needs to be exported by the entry point',
    '',
    '// @public (undocumented)',
    'export function f(): void;',
    'export interface B { // (undocumented)',
    '    // (undocumented)',
    '    n: number }',
  ].join('\n');
  assert.deepEqual(normalizeReport(text), ['// @public', 'export function f(): void;', 'export interface B {', '    n: number }']);
});

test('adding a doc comment or exporting a forgotten type is no report change', () => {
  const before = '// @public (undocumented)\nexport function f(): void;\n    // (undocumented)\n    a: 1;\n// Warning: (ae-forgotten-export) x\n';
  const after = '// @public\nexport function f(): void;\n    a: 1;\n';
  assert.deepEqual(diffReports(before, after), { added: 0, removed: 0 });
});

test('diffReports counts real declaration changes only', () => {
  assert.deepEqual(diffReports('export function f(): void;\n', 'export function f(): void;\nexport function g(): void;\n'), { added: 1, removed: 0 });
  assert.deepEqual(diffReports('export function f(): void;\n', 'export function f(a: number): void;\n'), { added: 1, removed: 1 });
  assert.deepEqual(diffReports('// @public\nexport const a: 1;\n', '// @beta\nexport const a: 1;\n'), { added: 1, removed: 1 });
});

// ---- gather(): the git plumbing, against a throwaway repository -------------------------------
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'fg-api-cs-'));
  const sh = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
  const put = (f, c) => {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), c);
  };
  sh('init', '-q', '-b', 'master');
  sh('config', 'user.email', 't@example.com');
  sh('config', 'user.name', 't');
  sh('config', 'commit.gpgsign', 'false');
  const commit = (m) => {
    sh('add', '-A');
    sh('commit', '-q', '-m', m);
  };
  return { root, sh, put, commit };
}
const pkgJson = (name) => JSON.stringify({ name, version: '1.0.0', exports: { '.': { import: { types: './dist/index.d.ts' } } } });

test('gather: doc-only churn is ignored; additions and removals are counted; edited changesets count', () => {
  const r = repo();
  try {
    r.put('packages/x/package.json', pkgJson('@t/x'));
    r.put('packages/x/etc/x.api.md', '// @public (undocumented)\nexport function f(): void;\n');
    r.put('.changeset/old.md', "---\n'@t/x': patch\n---\n\nold\n");
    r.commit('base');

    r.sh('checkout', '-q', '-b', 'pr');
    r.put('packages/x/etc/x.api.md', '// @public\nexport function f(): void;\n');
    r.commit('docs');
    let g = gather(r.root, 'master');
    assert.deepEqual(g.changedReports, []);

    r.put('packages/x/etc/x.api.md', '// @public\nexport function f(): void;\nexport function g(): void;\n');
    r.put('.changeset/old.md', "---\n'@t/x': minor\n---\n\nedited\n");
    r.commit('add');
    g = gather(r.root, 'master');
    assert.equal(g.changedReports.length, 1);
    assert.equal(g.changedReports[0].removed, 0);
    assert.equal(g.changedReports[0].bootstrap, false);
    assert.equal(g.changedReports[0].pkg, '@t/x');
    assert.deepEqual(g.changesets.map((c) => c.releases), [{ '@t/x': 'minor' }]);
    assert.deepEqual(evaluate(g), []);

    r.put('packages/x/etc/x.api.md', '// @public\nexport function g(a: number): void;\n');
    r.commit('remove');
    g = gather(r.root, 'master');
    assert.ok(g.changedReports[0].removed > 0);
    assert.equal(evaluate(g).length, 1); // minor but no BREAKING:/Beta:
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('gather: a package with no reports at the base is bootstrap; a missing report is listed', () => {
  const r = repo();
  try {
    r.put('README.md', 'x');
    r.commit('base');
    r.sh('checkout', '-q', '-b', 'pr');
    r.put('packages/y/package.json', pkgJson('@t/y'));
    r.put('packages/y/etc/y.api.md', 'export const a: 1;\n');
    r.put('packages/z/package.json', pkgJson('@t/z'));
    r.commit('new');
    const g = gather(r.root, 'master');
    assert.deepEqual(g.changedReports.map((c) => [c.pkg, c.bootstrap]), [['@t/y', true]]);
    assert.deepEqual(g.missingReports, ['packages/z/etc/z.api.md']);
    assert.equal(evaluate(g).length, 1);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});
