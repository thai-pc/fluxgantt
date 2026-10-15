// Unit tests for stackblitz-decide.mjs (the publish decision of stackblitz-examples.yml).
// Run: node --test 'tooling/scripts/__tests__/*.test.mjs'   (headless, no network: the registry is mocked)
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareSemver, decide, parseArgs, readStamp, versionsAt } from '../stackblitz-decide.mjs';

const SCRIPT = fileURLToPath(new URL('../stackblitz-decide.mjs', import.meta.url));

const tmpRoots = [];
async function tmp(prefix) {
  const dir = await mkdtemp(join(tmpdir(), `fg-sbd-${prefix}-`));
  tmpRoots.push(dir);
  return dir;
}
after(async () => {
  for (const d of tmpRoots) await rm(d, { recursive: true, force: true });
});

const V = (core, react = core, vue = core) => ({ core, react, vue });
const published = (set) => async (pkg, version) => set.has(`${pkg}@${version}`);
const never = async () => {
  throw new Error('isPublished must not be called on this path');
};

describe('compareSemver', () => {
  test('orders major/minor/patch numerically, not lexically', () => {
    assert.equal(compareSemver('0.10.0', '0.9.9'), 1);
    assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
    assert.equal(compareSemver('1.2.3', '1.2.10'), -1);
    assert.equal(compareSemver('2.0.0', '10.0.0'), -1);
  });

  test('pre-releases sort below the release and by identifier (semver §11)', () => {
    const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      assert.equal(compareSemver(ordered[i], ordered[i + 1]), -1, `${ordered[i]} < ${ordered[i + 1]}`);
      assert.equal(compareSemver(ordered[i + 1], ordered[i]), 1, `${ordered[i + 1]} > ${ordered[i]}`);
    }
  });

  test('throws on a malformed version', () => {
    assert.throws(() => compareSemver('1.2', '1.2.0'), /malformed version "1.2"/);
    assert.throws(() => compareSemver('1.2.0', 'latest'), /malformed version "latest"/);
  });
});

describe('decide()', () => {
  test('workflow_run, version-bump commit, stale stamp -> publish (registry not consulted)', async () => {
    const r = await decide({ event: 'workflow_run', now: V('0.3.0'), prev: V('0.2.1'), stamp: V('0.2.1'), isPublished: never });
    assert.equal(r.publish, true);
    assert.match(r.reason, /release of @fluxgantt\/core@0\.3\.0, @fluxgantt\/react@0\.3\.0, @fluxgantt\/vue@0\.3\.0/);
  });

  test('workflow_run, only one package bumped -> publish naming just that one', async () => {
    const r = await decide({ event: 'workflow_run', now: V('0.3.0', '0.1.2', '0.1.2'), prev: V('0.2.1', '0.1.2', '0.1.2'), stamp: V('0.2.1', '0.1.2', '0.1.2'), isPublished: never });
    assert.equal(r.publish, true);
    assert.match(r.reason, /release of @fluxgantt\/core@0\.3\.0$/);
  });

  test('workflow_run, bump commit, branch does not exist yet -> publish (bootstraps)', async () => {
    const r = await decide({ event: 'workflow_run', now: V('0.3.0'), prev: V('0.2.1'), stamp: null, isPublished: never });
    assert.equal(r.publish, true);
  });

  test('workflow_run, stamp already matches -> no-op, even on the bump commit (re-run after success)', async () => {
    const r = await decide({ event: 'workflow_run', now: V('0.3.0'), prev: V('0.2.1'), stamp: { sourceSha: 'x', ...V('0.3.0') }, isPublished: never });
    assert.equal(r.publish, false);
    assert.match(r.reason, /already has these versions/);
  });

  test('workflow_run, no bump, stamp matches -> no-op (an ordinary push)', async () => {
    const r = await decide({ event: 'workflow_run', now: V('0.3.0'), prev: V('0.3.0'), stamp: V('0.3.0'), isPublished: never });
    assert.equal(r.publish, false);
  });

  test('workflow_run, no bump, stamp behind and versions on the registry -> publish (missed release self-heals)', async () => {
    const r = await decide({
      event: 'workflow_run',
      now: V('0.3.0'),
      prev: V('0.3.0'),
      stamp: V('0.2.1'),
      isPublished: published(new Set(['core@0.3.0', 'react@0.3.0', 'vue@0.3.0'])),
    });
    assert.equal(r.publish, true);
    assert.match(r.reason, /a missed release/);
  });

  test('workflow_run, no bump, stamp behind but a version is not on the registry -> no-op naming it', async () => {
    const r = await decide({
      event: 'workflow_run',
      now: V('0.3.0'),
      prev: V('0.3.0'),
      stamp: V('0.2.1'),
      isPublished: published(new Set(['core@0.3.0', 'react@0.3.0'])),
    });
    assert.equal(r.publish, false);
    assert.match(r.reason, /@fluxgantt\/vue@0\.3\.0 not on the registry/);
  });

  test('workflow_run, no bump, branch does not exist -> no-op without asking the registry', async () => {
    const r = await decide({ event: 'workflow_run', now: V('0.2.1'), prev: V('0.2.1'), stamp: null, isPublished: never });
    assert.equal(r.publish, false);
    assert.match(r.reason, /does not exist yet/);
  });

  test('workflow_run, branch exists but the stamp is missing/unreadable ({}) -> treated as behind', async () => {
    const r = await decide({
      event: 'workflow_run',
      now: V('0.3.0'),
      prev: V('0.3.0'),
      stamp: {},
      isPublished: published(new Set(['core@0.3.0', 'react@0.3.0', 'vue@0.3.0'])),
    });
    assert.equal(r.publish, true);
  });

  test('workflow_run, missing parent commit (prev null) counts as a bump', async () => {
    const r = await decide({ event: 'workflow_run', now: V('0.3.0'), prev: null, stamp: V('0.2.1'), isPublished: never });
    assert.equal(r.publish, true);
  });

  test('stamp NEWER than the source -> no-op (re-run of an old failed run must not downgrade)', async () => {
    const r = await decide({ event: 'workflow_run', now: V('0.3.0'), prev: V('0.2.1'), stamp: V('0.4.0'), isPublished: never });
    assert.equal(r.publish, false);
    assert.match(r.reason, /newer versions \(@fluxgantt\/core@0\.4\.0, @fluxgantt\/react@0\.4\.0, @fluxgantt\/vue@0\.4\.0\)/);
  });

  test('stamp newer for ONE package is enough to refuse', async () => {
    const r = await decide({ event: 'workflow_dispatch', now: V('0.3.0', '0.2.0', '0.2.0'), prev: null, stamp: V('0.2.1', '0.2.1', '0.2.0'), isPublished: never });
    assert.equal(r.publish, false);
    assert.match(r.reason, /@fluxgantt\/react@0\.2\.1\)/);
  });

  test('a pre-release source never overwrites its own release in the stamp', async () => {
    const r = await decide({ event: 'workflow_dispatch', now: V('1.0.0-rc.1'), prev: null, stamp: V('1.0.0'), isPublished: never });
    assert.equal(r.publish, false);
  });

  test('a malformed version in the stamp is ignored by the newer-check (treated as behind)', async () => {
    const r = await decide({ event: 'workflow_dispatch', now: V('0.3.0'), prev: null, stamp: { core: '9; rm', react: 7, vue: null }, isPublished: never });
    assert.equal(r.publish, true);
  });

  test('dispatch: stamp differs -> publish; matches -> no-op; force -> publish either way', async () => {
    assert.equal((await decide({ event: 'workflow_dispatch', now: V('0.3.0'), prev: null, stamp: V('0.2.1'), isPublished: never })).publish, true);
    assert.equal((await decide({ event: 'workflow_dispatch', now: V('0.3.0'), prev: null, stamp: null, isPublished: never })).publish, true);
    const same = await decide({ event: 'workflow_dispatch', now: V('0.3.0'), prev: null, stamp: V('0.3.0'), isPublished: never });
    assert.equal(same.publish, false);
    assert.match(same.reason, /already has these versions/);
    assert.equal((await decide({ event: 'workflow_dispatch', force: true, now: V('0.3.0'), prev: null, stamp: V('0.3.0'), isPublished: never })).publish, true);
  });

  test('dispatch with force overrides the newer-stamp guard', async () => {
    const r = await decide({ event: 'workflow_dispatch', force: true, now: V('0.3.0'), prev: null, stamp: V('0.4.0'), isPublished: never });
    assert.deepEqual(r, { publish: true, reason: 'forced by dispatch' });
  });

  test('force is ignored on workflow_run', async () => {
    const r = await decide({ event: 'workflow_run', force: true, now: V('0.3.0'), prev: V('0.3.0'), stamp: V('0.3.0'), isPublished: never });
    assert.equal(r.publish, false);
  });

  test('rejects an unknown event and a malformed source version', async () => {
    await assert.rejects(decide({ event: 'push', now: V('0.3.0'), prev: null, stamp: null, isPublished: never }), /unknown event/);
    await assert.rejects(decide({ event: 'workflow_run', now: V('0.3'), prev: null, stamp: null, isPublished: never }), /malformed version/);
  });
});

describe('helpers', () => {
  test('readStamp: none -> null, unreadable/invalid/non-object -> {}', async () => {
    const dir = await tmp('stamp');
    assert.equal(readStamp('none'), null);
    assert.deepEqual(readStamp(join(dir, 'missing.json')), {});
    await writeFile(join(dir, 'bad.json'), '{oops');
    assert.deepEqual(readStamp(join(dir, 'bad.json')), {});
    await writeFile(join(dir, 'arr.json'), '[1]');
    assert.deepEqual(readStamp(join(dir, 'arr.json')), {});
    await writeFile(join(dir, 'ok.json'), JSON.stringify(V('0.2.1')));
    assert.deepEqual(readStamp(join(dir, 'ok.json')), V('0.2.1'));
  });

  test('parseArgs', () => {
    assert.deepEqual(parseArgs(['--event', 'workflow_run', '--source', 's', '--stamp', 'none']), {
      force: false,
      event: 'workflow_run',
      source: 's',
      stamp: 'none',
    });
    assert.equal(parseArgs(['--event', 'e', '--source', 's', '--stamp', 'f', '--force']).force, true);
    assert.throws(() => parseArgs(['--event', 'e', '--source', 's']), /--stamp is required/);
    assert.throws(() => parseArgs(['--event', '--source', 's']), /--event needs a value/);
    assert.throws(() => parseArgs(['--nope']), /unknown argument/);
  });
});

describe('CLI against a real git history and a mock registry', () => {
  let server;
  let base;
  let onRegistry = new Set();
  let repo;

  const git = (...args) =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgSign=false', ...args], { stdio: 'ignore' });
  async function commitVersions(versions, message) {
    for (const [pkg, version] of Object.entries(versions)) {
      await mkdir(join(repo, 'packages', pkg), { recursive: true });
      await writeFile(join(repo, 'packages', pkg, 'package.json'), JSON.stringify({ name: `@fluxgantt/${pkg}`, version }));
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
  }

  before(async () => {
    server = createServer((req, res) => {
      const m = req.url.match(/^\/@fluxgantt\/(core|react|vue)\/([^/]+)$/);
      if (!m || !onRegistry.has(`${m[1]}@${m[2]}`)) {
        res.writeHead(404).end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: `@fluxgantt/${m[1]}`, version: m[2] }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    repo = await tmp('repo');
    execFileSync('git', ['init', '-q', repo]);
    await commitVersions(V('0.2.1', '0.1.2', '0.1.2'), 'base');
    await commitVersions(V('0.3.0', '0.2.0', '0.2.0'), 'chore: version packages');
  });
  after(() => new Promise((r) => server.close(r)));

  async function run(args) {
    const dir = await tmp('out');
    const output = join(dir, 'output');
    const summary = join(dir, 'summary');
    await writeFile(output, '');
    await writeFile(summary, '');
    const code = await new Promise((done) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], {
        env: { ...process.env, FLUXGANTT_NPM_REGISTRY: base, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
        stdio: 'ignore',
      });
      child.on('close', done);
    });
    return { code, output: await readFile(output, 'utf8'), summary: await readFile(summary, 'utf8') };
  }

  test('versionsAt reads HEAD and HEAD^', () => {
    assert.deepEqual(versionsAt(repo, 'HEAD'), V('0.3.0', '0.2.0', '0.2.0'));
    assert.deepEqual(versionsAt(repo, 'HEAD^'), V('0.2.1', '0.1.2', '0.1.2'));
    assert.deepEqual(versionsAt(repo, 'HEAD~5'), { core: null, react: null, vue: null });
  });

  test('bump commit with no branch: publish=true, reason in the step summary', async () => {
    const r = await run(['--event', 'workflow_run', '--source', repo, '--stamp', 'none']);
    assert.equal(r.code, 0);
    assert.equal(r.output, 'publish=true\n');
    assert.match(r.summary, /^Publishing: release of @fluxgantt\/core@0\.3\.0/);
  });

  test('ordinary push after the bump: consults the registry via FLUXGANTT_NPM_REGISTRY', async () => {
    await writeFile(join(repo, 'NOTES.md'), 'unrelated\n');
    await commitVersions(V('0.3.0', '0.2.0', '0.2.0'), 'docs: unrelated'); // no version change
    const dir = await tmp('stamp');
    const stamp = join(dir, 'stamp.json');
    await writeFile(stamp, JSON.stringify({ sourceSha: 'x', ...V('0.2.1', '0.1.2', '0.1.2') }));

    onRegistry = new Set();
    let r = await run(['--event', 'workflow_run', '--source', repo, '--stamp', stamp]);
    assert.equal(r.output, 'publish=false\n');
    assert.match(r.summary, /not on the registry/);

    onRegistry = new Set(['core@0.3.0', 'react@0.2.0', 'vue@0.2.0']);
    r = await run(['--event', 'workflow_run', '--source', repo, '--stamp', stamp]);
    assert.equal(r.output, 'publish=true\n');
    assert.match(r.summary, /a missed release/);
  });

  test('bad arguments exit 1 and write no output', async () => {
    const r = await run(['--event', 'workflow_run']);
    assert.equal(r.code, 1);
    assert.equal(r.output, '');
  });
});
