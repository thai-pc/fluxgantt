import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parseChangeset } from '../check-api-changeset.mjs';

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
