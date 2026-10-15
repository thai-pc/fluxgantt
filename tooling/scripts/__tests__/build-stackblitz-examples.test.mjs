// Unit tests for build-stackblitz-examples.mjs and check-stackblitz-links.mjs.
// Run: node --test 'tooling/scripts/__tests__/*.test.mjs'   (headless, no network: the registry is mocked)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST,
  VANILLA_PAGES,
  exportsHas,
  findHtmlRefs,
  findImports,
  generate,
  parseArgs,
  parseJsonc,
} from '../build-stackblitz-examples.mjs';
import { DOCS_PAGE, checkLinks } from '../check-stackblitz-links.mjs';

const SCRIPT = fileURLToPath(new URL('../build-stackblitz-examples.mjs', import.meta.url));
const REPO = resolve(dirname(SCRIPT), '..', '..');
const SHA = '0123456789abcdef0123456789abcdef01234567';

const tmpRoots = [];
async function tmp(prefix) {
  const dir = await mkdtemp(join(tmpdir(), `fg-sb-${prefix}-`));
  tmpRoots.push(dir);
  return dir;
}
after(async () => {
  for (const d of tmpRoots) await rm(d, { recursive: true, force: true });
});

async function readTree(root) {
  const out = {};
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else out[relative(root, abs).split('\\').join('/')] = await readFile(abs, 'utf8');
    }
  }
  await walk(root);
  return out;
}

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const repoVersion = async (pkg) => (await readJson(join(REPO, 'packages', pkg, 'package.json'))).version;

/** A minimal copy of the repo: what the generator reads, nothing else. Mutate it per test. */
async function fixtureRepo() {
  const root = await tmp('repo');
  const paths = [
    'tsconfig.base.json',
    'tooling/tsconfig',
    ...['core', 'react', 'vue'].map((p) => `packages/${p}/package.json`),
    ...MANIFEST.map((e) => e.source),
  ];
  for (const p of paths) {
    await mkdir(dirname(join(root, p)), { recursive: true });
    await cp(join(REPO, p), join(root, p), {
      recursive: true,
      filter: (src) => !/[/\\](node_modules|dist)([/\\]|$)/.test(src),
    });
  }
  return root;
}

async function editJson(file, fn) {
  const json = await readJson(file);
  fn(json);
  await writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------

describe('generate() against the real repo (workspace mode)', () => {
  let out;
  let tree;
  before(async () => {
    out = join(await tmp('out'), 'sb');
    await generate({ out, sourceSha: SHA });
    tree = await readTree(out);
  });

  test('workspace:* becomes ^<version>; tooling packages dropped; other deps byte-identical', async () => {
    const versions = { core: await repoVersion('core'), react: await repoVersion('react'), vue: await repoVersion('vue') };
    for (const example of MANIFEST) {
      const src = await readJson(join(REPO, example.source, 'package.json'));
      const gen = JSON.parse(tree[`${example.dir}/package.json`]);
      for (const field of ['dependencies', 'devDependencies']) {
        for (const [name, spec] of Object.entries(src[field] ?? {})) {
          if (name.startsWith('@fluxgantt/')) {
            const pkg = name.slice('@fluxgantt/'.length);
            if (pkg in versions) assert.equal(gen[field][name], `^${versions[pkg]}`, `${example.dir} ${name}`);
            else assert.equal(gen[field]?.[name], undefined, `${example.dir} must drop ${name}`);
          } else {
            assert.equal(gen[field][name], spec, `${example.dir} ${name} must be copied as-is`);
          }
        }
      }
      assert.equal(gen.private, true);
      assert.equal(gen.packageManager, undefined, 'no packageManager field (corepack routing unverified)');
      assert.equal(gen.overrides, undefined, 'overrides only exist in local-tarballs mode');
      assert.deepEqual(gen.scripts, src.scripts);
    }
  });

  test('no workspace:/file:/link: specifier and no pnpm/npm config survive anywhere', () => {
    for (const [path, content] of Object.entries(tree)) {
      if (path.endsWith('package.json')) assert.doesNotMatch(content, /"(workspace|file|link|portal):/, path);
      assert.doesNotMatch(path, /(^|\/)(pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|turbo\.json|package-lock\.json)$/);
    }
  });

  test('tsconfig is flattened: no extends, strict flags kept, build-only keys dropped', () => {
    for (const example of MANIFEST.filter((e) => e.tsconfig)) {
      const ts = JSON.parse(tree[`${example.dir}/tsconfig.json`]);
      assert.equal(ts.extends, undefined);
      const o = ts.compilerOptions;
      assert.equal(o.strict, true);
      assert.equal(o.exactOptionalPropertyTypes, true);
      assert.equal(o.verbatimModuleSyntax, true);
      assert.equal(o.noEmit, true);
      assert.deepEqual(o.types, ['vite/client']);
      for (const k of ['declaration', 'declarationMap', 'sourceMap', 'ignoreDeprecations']) assert.equal(o[k], undefined, `${example.dir}: ${k}`);
      assert.ok(o.lib.includes('DOM'), `${example.dir}: DOM lib from library.json`);
    }
    assert.equal(JSON.parse(tree['react/tsconfig.json']).compilerOptions.jsx, 'react-jsx');
    assert.equal(JSON.parse(tree['vanilla/tsconfig.json']).compilerOptions.jsx, undefined);
    assert.equal(JSON.parse(tree['vue/tsconfig.json']).compilerOptions.jsx, 'preserve');
    assert.deepEqual(JSON.parse(tree['vue/tsconfig.json']).include, ['src', 'env.d.ts']);
    assert.equal(tree['headless/tsconfig.json'], undefined);
  });

  test('manifest: no harness pages, no fixture-only pages, no stub folders', () => {
    const paths = Object.keys(tree);
    assert.ok(paths.every((p) => !/canvas-.*harness/.test(p)), 'canvas harnesses must not ship');
    assert.ok(paths.every((p) => !/(conflicts|edit-hooks)\./.test(p)), 'Playwright-only fixture pages must not ship');
    const top = new Set(paths.map((p) => p.split('/')[0]));
    assert.deepEqual([...top].sort(), ['.stackblitz-stamp.json', 'README.md', 'headless', 'react', 'vanilla', 'vue']);
  });

  test('vanilla vite.config.ts lists exactly the six pages and no fs.allow', () => {
    const config = tree['vanilla/vite.config.ts'];
    const inputs = [...config.matchAll(/new URL\('\.\/([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(inputs, VANILLA_PAGES.map(([, page]) => page));
    assert.equal(inputs.length, 6);
    assert.doesNotMatch(config.replace(/^\/\/.*$/gm, ''), /allow|harness|fs:|\.\.\//);
    for (const page of inputs) assert.ok(tree[`vanilla/${page}`] !== undefined, `${page} copied`);
  });

  test('sources are copied verbatim (snippet-sync contract)', async () => {
    assert.equal(tree['vanilla/src/main.ts'], await readFile(join(REPO, 'examples/plain-html-demo/src/main.ts'), 'utf8'));
    assert.equal(tree['react/src/App.tsx'], await readFile(join(REPO, 'examples/react-vite-demo/src/App.tsx'), 'utf8'));
    assert.equal(tree['vue/src/App.vue'], await readFile(join(REPO, 'examples/vue-vite-demo/src/App.vue'), 'utf8'));
    assert.equal(tree['headless/index.mjs'], await readFile(join(REPO, 'tooling/stackblitz-templates/headless/index.mjs'), 'utf8'));
  });

  test('stamp and branch README carry the source sha and versions', async () => {
    const stamp = JSON.parse(tree['.stackblitz-stamp.json']);
    assert.deepEqual(stamp, {
      sourceSha: SHA,
      core: await repoVersion('core'),
      react: await repoVersion('react'),
      vue: await repoVersion('vue'),
    });
    assert.match(tree['README.md'], new RegExp(SHA));
    assert.match(tree['README.md'], /do not edit/);
  });

  test('deterministic: a second run produces a byte-identical tree', async () => {
    await generate({ out, sourceSha: SHA });
    assert.deepEqual(await readTree(out), tree);
  });

  test('check-snippet-sync still passes, unchanged', () => {
    const res = spawnSync(process.execPath, [join(REPO, 'tooling/scripts/check-snippet-sync.mjs')], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
  });
});

describe('generate() in local-tarballs mode', () => {
  test('file: specifiers to the tarballs, and core pinned via overrides for the wrappers only', async () => {
    const tgz = await tmp('tgz');
    for (const pkg of ['core', 'react', 'vue']) await writeFile(join(tgz, `fluxgantt-${pkg}-${await repoVersion(pkg)}.tgz`), '');
    const out = join(await tmp('out'), 'sb');
    await generate({ out, sourceSha: SHA, versions: { kind: 'local-tarballs', dir: tgz } });
    const coreSpec = `file:${join(tgz, `fluxgantt-core-${await repoVersion('core')}.tgz`)}`;
    const react = await readJson(join(out, 'react/package.json'));
    assert.equal(react.dependencies['@fluxgantt/core'], coreSpec);
    assert.match(react.dependencies['@fluxgantt/react'], /^file:.*fluxgantt-react-.*\.tgz$/);
    assert.deepEqual(react.overrides, { '@fluxgantt/core': coreSpec });
    const vue = await readJson(join(out, 'vue/package.json'));
    assert.deepEqual(vue.overrides, { '@fluxgantt/core': coreSpec });
    assert.equal((await readJson(join(out, 'vanilla/package.json'))).overrides, undefined);
    assert.equal((await readJson(join(out, 'headless/package.json'))).overrides, undefined);
  });

  test('fails when a tarball is missing', async () => {
    const tgz = await tmp('tgz-empty');
    await assert.rejects(
      generate({ out: join(await tmp('out'), 'sb'), sourceSha: SHA, versions: { kind: 'local-tarballs', dir: tgz } }),
      /fluxgantt-core-.*\.tgz not found/,
    );
  });

  test('--check-registry is refused in local-tarballs mode', async () => {
    await assert.rejects(
      generate({ out: join(await tmp('out'), 'sb'), sourceSha: SHA, checkRegistry: true, versions: { kind: 'local-tarballs', dir: '/x' } }),
      /only makes sense with --versions workspace/,
    );
  });
});

describe('generate() failures on a fixture repo', () => {
  async function expectFailure(mutate, pattern) {
    const repo = await fixtureRepo();
    await mutate(repo);
    const out = join(await tmp('out'), 'sb');
    await assert.rejects(generate({ source: repo, out, sourceSha: SHA }), pattern);
    await assert.rejects(readdir(out), 'a failed run leaves no partial output');
  }

  test('leftover file: specifier on a third-party dependency', () =>
    expectFailure(
      (repo) => editJson(join(repo, 'examples/react-vite-demo/package.json'), (j) => (j.devDependencies.vite = 'file:../../vite')),
      /devDependencies\.vite = "file:\.\.\/\.\.\/vite" cannot be installed outside the repo/,
    ));

  test('leftover link: and workspace: specifiers on a third-party dependency', async () => {
    await expectFailure(
      (repo) => editJson(join(repo, 'examples/vue-vite-demo/package.json'), (j) => (j.dependencies.vue = 'link:../vue')),
      /dependencies\.vue = "link:\.\.\/vue"/,
    );
    await expectFailure(
      (repo) => editJson(join(repo, 'examples/plain-html-demo/package.json'), (j) => (j.devDependencies.typescript = 'workspace:*')),
      /devDependencies\.typescript = "workspace:\*"/,
    );
  });

  test('a published @fluxgantt package that is not workspace:* in the repo', () =>
    expectFailure(
      (repo) => editJson(join(repo, 'examples/react-vite-demo/package.json'), (j) => (j.dependencies['@fluxgantt/react'] = '^0.1.0')),
      /@fluxgantt\/react must be "workspace:\*"/,
    ));

  test('malformed package version', () =>
    expectFailure(
      (repo) => editJson(join(repo, 'packages/core/package.json'), (j) => (j.version = '1.0; rm -rf /')),
      /malformed version/,
    ));

  test('relative import escaping the example folder', () =>
    expectFailure(
      (repo) => writeFile(join(repo, 'examples/react-vite-demo/src/leak.ts'), "import { x } from '../../../packages/core/src/index.js';\n"),
      /react\/src\/leak\.ts: import "\.\.\/\.\.\/\.\.\/packages\/core\/src\/index\.js" escapes the example folder/,
    ));

  test('bare import not declared in package.json (hidden by the repo hoisting)', () =>
    expectFailure(
      (repo) => writeFile(join(repo, 'examples/vue-vite-demo/src/extra.ts'), "export { default } from 'lodash-es';\n"),
      /vue\/src\/extra\.ts: imports "lodash-es" but lodash-es is not in package\.json/,
    ));

  test('HTML page referencing a file that was not copied', () =>
    expectFailure(
      (repo) =>
        writeFile(
          join(repo, 'examples/plain-html-demo/i18n.html'),
          '<!doctype html><script type="module" src="/src/canvas-harness.ts"></script>\n',
        ),
      /vanilla\/i18n\.html: references \/src\/canvas-harness\.ts, which was not copied/,
    ));

  test('HTML link to an excluded page: single-quoted, relative or absolute', async () => {
    await expectFailure(
      (repo) =>
        writeFile(
          join(repo, 'examples/plain-html-demo/selection.html'),
          "<!doctype html><script type='module' src='/src/selection.ts'></script><a href='conflicts.html'>x</a>\n",
        ),
      /vanilla\/selection\.html: references conflicts\.html, which was not copied \(a page that does not ship here/,
    );
    await expectFailure(
      (repo) =>
        writeFile(
          join(repo, 'examples/plain-html-demo/selection.html'),
          '<!doctype html><script type="module" src="/src/selection.ts"></script><a href="/edit-hooks.html?x=1#top">x</a>\n',
        ),
      /references \/edit-hooks\.html, which was not copied/,
    );
  });

  test('HTML relative reference to a missing script, and one escaping the folder', async () => {
    await expectFailure(
      (repo) => writeFile(join(repo, 'examples/plain-html-demo/i18n.html'), '<script type=module src=./src/canvas-harness.ts></script>\n'),
      /vanilla\/i18n\.html: references \.\/src\/canvas-harness\.ts, which was not copied/,
    );
    await expectFailure(
      (repo) => writeFile(join(repo, 'examples/plain-html-demo/i18n.html'), '<link rel="stylesheet" href="../../packages/core/x.css">\n'),
      /references \.\.\/\.\.\/packages\/core\/x\.css, which is outside the example folder/,
    );
  });

  test('tsconfig extends a non-relative path', () =>
    expectFailure(
      (repo) => editJson(join(repo, 'examples/react-vite-demo/tsconfig.json'), (j) => (j.extends = '@tsconfig/strictest')),
      /only a relative string "extends" is supported/,
    ));

  test('--out that is not empty and not a previous output is refused', async () => {
    const out = await tmp('busy');
    await writeFile(join(out, 'precious.txt'), 'keep me');
    await assert.rejects(generate({ out, sourceSha: SHA }), /not a previous output/);
    assert.equal(await readFile(join(out, 'precious.txt'), 'utf8'), 'keep me');
  });

  test('--out that contains the source repo is refused', async () => {
    const repo = await fixtureRepo();
    await assert.rejects(generate({ source: repo, out: dirname(repo), sourceSha: SHA }), /contains the source repo/);
  });

  test('malformed --source-sha', async () => {
    await assert.rejects(generate({ out: join(await tmp('out'), 'sb'), sourceSha: 'HEAD; echo' }), /--source-sha: malformed/);
  });
});

describe('--check-registry against a mock registry', () => {
  let server;
  let base;
  const exportsFor = { core: ['.', './io', './render', './interaction', './theme', './responsive', './viewport'], react: ['.'], vue: ['.'] };
  let omit = null;
  let notFound = null;
  let wildcard = false;
  before(async () => {
    server = createServer((req, res) => {
      const m = req.url.match(/^\/@fluxgantt\/(core|react|vue)\/([^/]+)$/);
      if (!m || m[1] === notFound) {
        res.writeHead(404).end('{}');
        return;
      }
      const exportsMap = Object.fromEntries(exportsFor[m[1]].filter((s) => `${m[1]}${s}` !== omit).map((s) => [s, {}]));
      if (wildcard) exportsMap['./*'] = './dist/*.js';
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: `@fluxgantt/${m[1]}`, version: m[2], exports: exportsMap }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(r)));

  test('passes when every imported subpath is exported', async () => {
    omit = null;
    notFound = null;
    const res = await generate({ out: join(await tmp('out'), 'sb'), sourceSha: SHA, checkRegistry: true, registry: base });
    const specs = new Set(res.fluxImports.map((i) => i.spec));
    assert.ok(specs.has('@fluxgantt/core/viewport') && specs.has('@fluxgantt/react') && specs.has('@fluxgantt/vue'));
  });

  test('fails naming the file and the specifier when a subpath is not published', async () => {
    omit = 'core./viewport';
    notFound = null;
    await assert.rejects(
      generate({ out: join(await tmp('out'), 'sb'), sourceSha: SHA, checkRegistry: true, registry: base }),
      /vanilla\/src\/main\.ts: "@fluxgantt\/core\/viewport" is not exported by @fluxgantt\/core@/,
    );
  });

  test('fails when the version is not on the registry at all', async () => {
    omit = null;
    notFound = 'vue';
    await assert.rejects(
      generate({ out: join(await tmp('out'), 'sb'), sourceSha: SHA, checkRegistry: true, registry: base }),
      /@fluxgantt\/vue@.* is not on the registry/,
    );
  });

  test('a wildcard "./*" export satisfies any imported subpath', async () => {
    omit = 'core./viewport';
    notFound = null;
    wildcard = true;
    try {
      await generate({ out: join(await tmp('out'), 'sb'), sourceSha: SHA, checkRegistry: true, registry: base });
    } finally {
      wildcard = false;
    }
  });

  test('the registry URL is read from FLUXGANTT_NPM_REGISTRY by the CLI', async () => {
    omit = 'core./viewport';
    notFound = null;
    const outRoot = await tmp('out');
    // Async spawn: the mock lives in this process, so the event loop must keep running.
    const { code, stderr } = await new Promise((done) => {
      const child = spawn(process.execPath, [SCRIPT, '--out', join(outRoot, 'sb'), '--check-registry', '--source-sha', SHA], {
        env: { ...process.env, FLUXGANTT_NPM_REGISTRY: base },
      });
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (c) => done({ code: c, stderr: err }));
    });
    assert.equal(code, 1);
    assert.match(stderr, /"@fluxgantt\/core\/viewport" is not exported/);
  });
});

describe('helpers', () => {
  test('parseJsonc keeps // inside strings and tolerates comments and trailing commas', () => {
    const text = '{\n  // c\n  "$schema": "https://json.schemastore.org/tsconfig", /* b */\n  "a": [1, 2,],\n}';
    assert.deepEqual(parseJsonc(text), { $schema: 'https://json.schemastore.org/tsconfig', a: [1, 2] });
  });

  test('findImports sees static, re-export, side-effect and dynamic imports, not comments', () => {
    const code = [
      "import { a } from '@fluxgantt/core';",
      "import type { B } from '@fluxgantt/core/render';",
      "export { c } from './c.js';",
      "import './side.css';",
      "const m = await import('@fluxgantt/core/io');",
      "// import { x } from '@fluxgantt/core/commented';",
      "/* import { y } from 'block-commented'; */",
      "const url = 'https://example.com'; // import z from 'trailing-comment'",
    ].join('\n');
    assert.deepEqual(findImports(code), ['./c.js', './side.css', '@fluxgantt/core', '@fluxgantt/core/io', '@fluxgantt/core/render']);
  });

  test('findHtmlRefs: double, single and unquoted; absolute and relative; skips external, fragments and comments', () => {
    const html = [
      '<link rel="stylesheet" href="/src/style.css" />',
      "<script type='module' src='./src/main.ts?v=1'></script>",
      '<a href=read-only.html#top>r</a>',
      '<a HREF = "selection.html">s</a>',
      '<a href="https://example.com/x.html">e</a> <a href="//cdn.example.com/y.js">c</a>',
      '<a href="#section">f</a> <a href="mailto:a@b.c">m</a> <img src="data:image/png;base64,AA">',
      '<a href="">empty</a>',
      '<!-- <a href="/conflicts.html">commented</a> -->',
    ].join('\n');
    assert.deepEqual(findHtmlRefs(html), ['/src/style.css', './src/main.ts', 'read-only.html', 'selection.html']);
  });

  test('exportsHas: exact keys, wildcard patterns, null blocks, conditions-only and string exports', () => {
    const map = {
      '.': { import: './dist/index.js' },
      './render': './dist/render.js',
      './locales/*.js': './dist/locales/*.js',
      './internal/*': null,
      './*': './dist/*.js',
      './blocked': null,
    };
    assert.equal(exportsHas(map, '.'), true);
    assert.equal(exportsHas(map, './render'), true);
    assert.equal(exportsHas(map, './viewport'), true, './* covers any subpath');
    assert.equal(exportsHas(map, './locales/vi.js'), true);
    assert.equal(exportsHas(map, './internal/secret'), false, 'the longer null pattern wins over ./*');
    assert.equal(exportsHas(map, './blocked'), false);
    const noStar = { '.': './i.js', './render': './r.js' };
    assert.equal(exportsHas(noStar, './viewport'), false);
    assert.equal(exportsHas({ import: './i.mjs', require: './i.cjs' }, '.'), true);
    assert.equal(exportsHas({ import: './i.mjs', require: './i.cjs' }, './render'), false);
    assert.equal(exportsHas('./index.js', '.'), true);
    assert.equal(exportsHas('./index.js', './x'), false);
    assert.equal(exportsHas(undefined, '.'), true);
    assert.equal(exportsHas(null, './x'), false);
  });

  test('parseArgs', () => {
    assert.deepEqual(parseArgs(['--out', 'x']).versions, { kind: 'workspace' });
    assert.equal(parseArgs(['--out=x', '--versions', 'local-tarballs=/t']).versions.dir, '/t');
    assert.throws(() => parseArgs([]), /--out <dir> is required/);
    assert.throws(() => parseArgs(['--out', 'x', '--versions', 'registry']), /expected "workspace"/);
    assert.throws(() => parseArgs(['--out', 'x', '--nope']), /unknown argument/);
  });

  test('CLI exits non-zero with a message on a bad argument', () => {
    const res = spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /✗ build-stackblitz-examples: unknown argument/);
  });
});

describe('check-stackblitz-links', () => {
  const link = (dir, file, ref = 'stackblitz') =>
    `https://stackblitz.com/github/thai-pc/fluxgantt/tree/${ref}/${dir}?file=${encodeURIComponent(file)}&title=x`;
  const allDirs = () => MANIFEST.map((e) => `[x](${link(e.dir, e.startFile)})`).join('\n');

  test('the real docs page and README pass', async () => {
    const contents = {
      [DOCS_PAGE]: await readFile(join(REPO, DOCS_PAGE), 'utf8'),
      'README.md': await readFile(join(REPO, 'README.md'), 'utf8'),
    };
    const { problems, links } = await checkLinks(contents);
    assert.deepEqual(problems, []);
    assert.ok(links.length >= MANIFEST.length);
  });

  test('every manifest startFile is a generated file', async () => {
    const { problems } = await checkLinks({ [DOCS_PAGE]: allDirs() });
    assert.deepEqual(problems, []);
  });

  test('flags a master ref, an unknown folder, a missing file and a missing ?file=', async () => {
    const text = [
      allDirs(),
      link('react', 'src/App.tsx', 'master'),
      link('svelte', 'src/App.svelte'),
      link('vanilla', 'src/canvas-harness.ts'),
      'https://stackblitz.com/github/thai-pc/fluxgantt/tree/stackblitz/vue',
    ].join('\n');
    const { problems } = await checkLinks({ 'README.md': text });
    const joined = problems.join('\n');
    assert.match(joined, /ref must be "stackblitz" \(got "master"\)/);
    assert.match(joined, /"svelte" is not a generated folder/);
    assert.match(joined, /\?file=src\/canvas-harness\.ts is not generated for vanilla\//);
    assert.match(joined, /missing \?file=/);
  });

  test('the docs page must link every example', async () => {
    const { problems } = await checkLinks({ [DOCS_PAGE]: `[x](${link('react', 'src/App.tsx')})` });
    for (const dir of ['vanilla', 'vue', 'headless']) assert.ok(problems.some((p) => p.includes(`"${dir}" example`)), dir);
  });
});
