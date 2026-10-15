#!/usr/bin/env node
// Generates standalone, npm-installable copies of the example apps for StackBlitz.
//
// StackBlitz's GitHub import fetches ONLY the folder a URL points at and installs it with an
// npm-compatible resolver, so none of `examples/*` can be opened there as-is: they depend on
// `workspace:*`, their tsconfig `extends` a file two levels up, and plain-html-demo doubles as the
// Playwright host (harness pages that import workspace source by relative path). This script
// copies an explicit allow-list of files out of the repo, rewrites `workspace:*` to the released
// versions, flattens tsconfig, and refuses to emit anything that would not install or resolve on
// its own. The release workflow (`.github/workflows/stackblitz-examples.yml`) force-pushes the
// result to the `stackblitz` branch; the docs link `stackblitz.com/github/<repo>/tree/stackblitz/<dir>`.
// Spec: `.claude/work/spec-stackblitz-examples.md`.
//
// Usage:
//   node tooling/scripts/build-stackblitz-examples.mjs --out <dir>
//     [--source <repoRoot>]                 repo to read examples + package versions from (default: this repo)
//     [--versions workspace]                `workspace:*` -> `^<version of packages/<pkg>>` (default)
//     [--versions local-tarballs=<dir>]     `workspace:*` -> `file:<dir>/fluxgantt-<pkg>-<version>.tgz`
//                                           (PR-time CI: test the unreleased code, see `pnpm pack`)
//     [--check-registry]                    assert every `@fluxgantt/<pkg>/<subpath>` the copies import
//                                           exists in the npm registry's `exports` for that version
//     [--source-sha <sha>]                  recorded in the stamp (default: `git rev-parse HEAD`)
//
// The registry base URL can be overridden with FLUXGANTT_NPM_REGISTRY (tests use a local mock).
//
// Plain Node ESM, no dependencies (same style as check-snippet-sync.mjs). Output is deterministic:
// sorted keys where order is not meaningful, LF line endings, no timestamps.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/** The published packages an example may depend on. Anything else under `@fluxgantt/` is
 * workspace-only tooling (`@fluxgantt/tsconfig`, `@fluxgantt/eslint-config`) and is dropped. */
export const PUBLISHED_PACKAGES = ['core', 'react', 'vue'];

const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const SHA_RE = /^([0-9a-f]{7,40}|unknown)$/;

/**
 * THE list of what ships. Explicit on purpose: a glob of `examples/*` would pick up the
 * `.gitkeep`-only Pro/Cloud stubs, and a glob of `plain-html-demo` would pick up the
 * `canvas-*-harness` pages that import `../../../packages/core/src/...`.
 *
 * - `files`: copied verbatim (byte-identical; check-snippet-sync reads the repo copy of
 *   plain-html-demo's `src/main.ts`, and the StackBlitz copy must be that same file).
 * - `dirs`: copied recursively, verbatim (react/vue have no harness files to exclude).
 * - `generated`: written by this script instead of copied.
 * - `tsconfig`: resolve this file's `extends` chain into one self-contained tsconfig.json.
 * - `startFile`: the file the docs' `?file=` parameter opens; checked by check-stackblitz-links.
 *
 * plain-html-demo's `conflicts.html` / `edit-hooks.html` and every `canvas-*` page are Playwright
 * fixtures, not documented examples; add a page here (and to VANILLA_PAGES) to ship it.
 */
export const VANILLA_PAGES = [
  ['main', 'index.html'],
  ['readOnly', 'read-only.html'],
  ['selection', 'selection.html'],
  ['collapse', 'collapse.html'],
  ['i18n', 'i18n.html'],
  ['responsive', 'responsive.html'],
];

export const MANIFEST = [
  {
    dir: 'vanilla',
    source: 'examples/plain-html-demo',
    title: 'FluxGantt vanilla',
    startFile: 'src/main.ts',
    description: 'Vanilla TypeScript @fluxgantt/core demo pages (Vite). Generated from the FluxGantt repo.',
    files: [
      ...VANILLA_PAGES.map(([, page]) => page),
      'src/main.ts',
      'src/temporal.ts',
      'src/read-only.ts',
      'src/selection.ts',
      'src/collapse.ts',
      'src/i18n.ts',
      'src/responsive.ts',
      'src/style.css',
      'src/responsive.css',
    ],
    dirs: [],
    generated: { 'vite.config.ts': vanillaViteConfig },
    tsconfig: 'tsconfig.json',
  },
  {
    dir: 'react',
    source: 'examples/react-vite-demo',
    title: 'FluxGantt React',
    startFile: 'src/App.tsx',
    files: ['index.html', 'vite.config.ts'],
    dirs: ['src'],
    generated: {},
    tsconfig: 'tsconfig.json',
  },
  {
    dir: 'vue',
    source: 'examples/vue-vite-demo',
    title: 'FluxGantt Vue',
    startFile: 'src/App.vue',
    files: ['index.html', 'env.d.ts', 'vite.config.ts'],
    dirs: ['src'],
    generated: {},
    tsconfig: 'tsconfig.json',
  },
  {
    dir: 'headless',
    source: 'tooling/stackblitz-templates/headless',
    title: 'FluxGantt headless',
    startFile: 'index.mjs',
    files: ['index.mjs', 'README.md'],
    dirs: [],
    generated: {},
    tsconfig: null,
  },
];

/**
 * Third-party version pins applied ONLY to the generated copies; the repo keeps its own ranges.
 * Keyed by dependency name, applied wherever that dependency appears (deps or devDeps).
 *
 * Empty on purpose. The examples use Vite 8 (Rolldown + lightningcss, native addons) and
 * @vitejs/plugin-react 6 / plugin-vue 6, and whether WebContainers run Vite 8's wasm fallbacks is
 * unverified (spec Q1). If the one-time manual boot check in RELEASING.md fails, pin the Vite 7
 * line here, e.g.
 *   vite: '^7.1.0', '@vitejs/plugin-react': '^5.0.0',
 * after checking the plugins' `peerDependencies` against that Vite major (dependabot's vite-stack
 * group exists because a mismatched plugin major refuses to load).
 */
export const DEPENDENCY_OVERRIDES = {};

/** Files and keys that never appear in the output, whatever the source contains. */
const DROPPED_TSCONFIG_KEYS = ['declaration', 'declarationMap', 'sourceMap', 'ignoreDeprecations', 'composite'];
const PACKAGE_JSON_KEYS = ['name', 'version', 'private', 'type', 'description', 'scripts', 'dependencies', 'devDependencies'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.vue'];

export class GeneratorError extends Error {}

function fail(message) {
  throw new GeneratorError(message);
}

const toPosix = (p) => p.split(sep).join('/');

// ---------------------------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------------------------

export async function readPackageVersions(sourceRoot) {
  const versions = {};
  for (const pkg of PUBLISHED_PACKAGES) {
    const file = join(sourceRoot, 'packages', pkg, 'package.json');
    const json = JSON.parse(await readFile(file, 'utf8'));
    if (json.name !== `@fluxgantt/${pkg}`) fail(`${file}: expected name @fluxgantt/${pkg}, got ${json.name}`);
    assertVersion(json.version, `${file} version`);
    versions[pkg] = json.version;
  }
  return versions;
}

export function assertVersion(version, label) {
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    fail(`${label}: malformed version ${JSON.stringify(version)} (expected x.y.z[-pre])`);
  }
}

/** Maps each published package to the specifier written into the generated package.json. */
export function resolveSpecifiers(versions, mode) {
  const specs = {};
  for (const pkg of PUBLISHED_PACKAGES) {
    if (mode.kind === 'workspace') {
      specs[pkg] = `^${versions[pkg]}`;
    } else {
      const tgz = join(mode.dir, `fluxgantt-${pkg}-${versions[pkg]}.tgz`);
      if (!existsSync(tgz)) fail(`local-tarballs: ${tgz} not found (run \`pnpm pack\` for @fluxgantt/${pkg} first)`);
      specs[pkg] = `file:${toPosix(tgz)}`;
    }
  }
  return specs;
}

// ---------------------------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------------------------

function rewriteDeps(deps, specs, label) {
  if (!deps) return undefined;
  const out = {};
  for (const name of Object.keys(deps).sort()) {
    let spec = deps[name];
    if (name.startsWith('@fluxgantt/')) {
      const pkg = name.slice('@fluxgantt/'.length);
      if (!PUBLISHED_PACKAGES.includes(pkg)) continue; // workspace-only tooling package
      if (!String(spec).startsWith('workspace:')) {
        fail(`${label}: ${name} must be "workspace:*" in the repo (found ${JSON.stringify(spec)})`);
      }
      spec = specs[pkg];
    } else if (Object.hasOwn(DEPENDENCY_OVERRIDES, name)) {
      spec = DEPENDENCY_OVERRIDES[name];
    }
    out[name] = spec;
  }
  return out;
}

export function rewritePackageJson(source, specs, { label, mode, description }) {
  const out = {};
  for (const key of PACKAGE_JSON_KEYS) {
    if (source[key] === undefined) continue;
    out[key] = source[key];
  }
  if (description) out.description = description;
  out.private = true;
  const deps = rewriteDeps(source.dependencies, specs, label);
  const devDeps = rewriteDeps(source.devDependencies, specs, label);
  if (deps) out.dependencies = deps;
  else delete out.dependencies;
  if (devDeps && Object.keys(devDeps).length > 0) out.devDependencies = devDeps;
  else delete out.devDependencies;

  // In tarball mode the react/vue tarballs declare `@fluxgantt/core: x.y.z` (pnpm rewrote their
  // `workspace:*` at pack time), which npm would fetch from the REGISTRY. Force the transitive
  // core onto the local tarball too, or the check would test the PR's wrapper against released core.
  // npm requires an override of a direct dependency to equal that dependency's spec exactly.
  if (mode.kind === 'local-tarballs') {
    const all = { ...out.dependencies, ...out.devDependencies };
    if (Object.keys(all).some((n) => n === '@fluxgantt/react' || n === '@fluxgantt/vue')) {
      out.overrides = { '@fluxgantt/core': specs.core };
    }
  }

  assertNoLocalSpecifiers(out, label, mode.kind === 'local-tarballs' ? Object.values(specs) : []);
  return out;
}

/** Throws on any `workspace:`/`file:`/`link:`/`portal:` specifier not in `allowed` (the tarballs). */
export function assertNoLocalSpecifiers(pkg, label, allowedSpecs = []) {
  const allowed = new Set(allowedSpecs);
  for (const field of ['dependencies', 'devDependencies', 'overrides']) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (/^(workspace|file|link|portal):/.test(String(spec)) && !allowed.has(spec)) {
        fail(`${label}: ${field}.${name} = ${JSON.stringify(spec)} cannot be installed outside the repo`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// tsconfig
// ---------------------------------------------------------------------------------------------

/** Strips `//` and `/* *\/` comments and trailing commas from JSONC, respecting strings. */
export function parseJsonc(text, label = 'JSONC') {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
    } else if (c === '"') {
      inString = true;
      out += c;
      i += 1;
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i += 1;
    }
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch (err) {
    fail(`${label}: invalid JSON (${err.message})`);
  }
}

/**
 * Resolves a tsconfig's `extends` chain (relative paths only) into one object with no `extends`.
 * `compilerOptions` merge child-over-parent; `include`/`exclude`/`files` are replaced, matching
 * tsc. Every file in the chain must live inside `sourceRoot`.
 */
export async function flattenTsconfig(file, sourceRoot, seen = new Set()) {
  if (seen.has(file)) fail(`tsconfig extends cycle at ${file}`);
  seen.add(file);
  if (!isInside(file, sourceRoot)) fail(`tsconfig ${file} is outside ${sourceRoot}`);
  const json = parseJsonc(await readFile(file, 'utf8'), file);
  let base = { compilerOptions: {} };
  if (json.extends !== undefined) {
    if (typeof json.extends !== 'string' || !json.extends.startsWith('.')) {
      fail(`${file}: only a relative string "extends" is supported (got ${JSON.stringify(json.extends)})`);
    }
    let parent = resolve(dirname(file), json.extends);
    if (!parent.endsWith('.json')) parent += '.json';
    base = await flattenTsconfig(parent, sourceRoot, seen);
  }
  const merged = { compilerOptions: { ...base.compilerOptions, ...json.compilerOptions } };
  for (const key of ['files', 'include', 'exclude']) {
    const value = json[key] ?? base[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

export function finalizeTsconfig(flat) {
  const compilerOptions = { ...flat.compilerOptions };
  for (const key of DROPPED_TSCONFIG_KEYS) delete compilerOptions[key];
  const out = { compilerOptions };
  for (const key of ['files', 'include']) if (flat[key] !== undefined) out[key] = flat[key];
  // The repo-wide exclude lists `.turbo`, `build`, `coverage`; a standalone project has only these.
  out.exclude = ['node_modules', 'dist'];
  return out;
}

// ---------------------------------------------------------------------------------------------
// Generated files
// ---------------------------------------------------------------------------------------------

function vanillaViteConfig() {
  const inputs = VANILLA_PAGES.map(
    ([key, page]) => `        ${key}: fileURLToPath(new URL('./${page}', import.meta.url)),`,
  ).join('\n');
  return `// Generated by tooling/scripts/build-stackblitz-examples.mjs from the FluxGantt repo; do not
// edit this copy. The repo's own config also builds Playwright-only harness pages and allows the
// dev server to read workspace source, neither of which exists in this standalone project.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
${inputs}
      },
    },
  },
});
`;
}

function rootReadme(stamp) {
  const rows = MANIFEST.map((e) => `| \`${e.dir}/\` | \`${e.source}\` |`).join('\n');
  return `# FluxGantt StackBlitz examples (generated, do not edit)

This branch is written by \`tooling/scripts/build-stackblitz-examples.mjs\` and force-pushed by
\`.github/workflows/stackblitz-examples.yml\` after each release. Any manual change here is lost
on the next release; edit the source in the main branch instead.

Source commit: \`${stamp.sourceSha}\`
Packages: \`@fluxgantt/core@${stamp.core}\`, \`@fluxgantt/react@${stamp.react}\`, \`@fluxgantt/vue@${stamp.vue}\`

| Folder | Generated from |
|---|---|
${rows}

Open one on StackBlitz: \`https://stackblitz.com/github/thai-pc/fluxgantt/tree/stackblitz/<folder>\`.
`;
}

// ---------------------------------------------------------------------------------------------
// Source scanning (imports and HTML references)
// ---------------------------------------------------------------------------------------------

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** Every module specifier in static imports/exports, side-effect imports and dynamic `import()`. */
export function findImports(code) {
  const src = stripComments(code);
  const specs = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) specs.add(m[1]);
  return [...specs].sort();
}

/**
 * Local `src=` / `href=` references in HTML: double-quoted, single-quoted or unquoted, absolute
 * (`/src/main.ts`, resolved by Vite against the project root) or relative (`./read-only.html`).
 * External URLs (any `scheme:`, `//host`), fragments and empty values are skipped; `?query` and
 * `#hash` are stripped.
 */
export function findHtmlRefs(html) {
  const refs = [];
  const re = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const m of stripComments(html).matchAll(re)) {
    const raw = (m[1] ?? m[2] ?? m[3]).trim();
    if (raw === '' || raw.startsWith('#') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    const path = raw.replace(/[?#].*$/, '');
    if (path !== '') refs.push(path);
  }
  return refs;
}

function packageNameOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Asserts each generated example resolves on its own: every bare import is declared in its
 * package.json (the repo's hoisted node_modules would hide an undeclared one), no relative import
 * leaves the example folder, and every `/path` an HTML page references was copied.
 * Returns the `@fluxgantt/*` specifiers found, for the registry check.
 */
export async function checkSelfContained(exampleDir, files, pkg, label) {
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  const fluxImports = [];
  for (const rel of files) {
    const abs = join(exampleDir, rel);
    const ext = posix.extname(rel);
    if (ext === '.html') {
      for (const ref of findHtmlRefs(await readFile(abs, 'utf8'))) {
        let target = ref.startsWith('/') ? join(exampleDir, ref.slice(1)) : resolve(dirname(abs), ref);
        if (!isInside(target, exampleDir)) fail(`${label}/${rel}: references ${ref}, which is outside the example folder`);
        if (ref.endsWith('/')) target = join(target, 'index.html');
        if (!existsSync(target)) {
          const hint = ref.endsWith('.html') ? ' (a page that does not ship here: add it to VANILLA_PAGES, or drop the link)' : '';
          fail(`${label}/${rel}: references ${ref}, which was not copied${hint}`);
        }
      }
      continue;
    }
    if (!SOURCE_EXTENSIONS.includes(ext)) continue;
    for (const spec of findImports(await readFile(abs, 'utf8'))) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const target = resolve(dirname(abs), spec);
        if (!isInside(target, exampleDir)) fail(`${label}/${rel}: import "${spec}" escapes the example folder`);
        continue;
      }
      if (spec.startsWith('node:')) continue;
      const name = packageNameOf(spec);
      if (!declared.has(name)) fail(`${label}/${rel}: imports "${spec}" but ${name} is not in package.json`);
      if (name.startsWith('@fluxgantt/')) fluxImports.push({ file: `${label}/${rel}`, spec });
    }
  }
  return fluxImports;
}

/**
 * Whether a package.json `exports` field exposes `subpath` (`.` or `./x`). Handles a missing or
 * string `exports` (root only), a conditions-only object (no `.`-keys: root only), exact subpath
 * keys, and single-`*` patterns (`"./*"`, `"./locales/*.js"`) per the Node resolution rules. A
 * subpath whose target is `null` is explicitly blocked. Exact keys win over patterns.
 */
export function exportsHas(exportsMap, subpath) {
  if (exportsMap === undefined || exportsMap === null || typeof exportsMap === 'string' || Array.isArray(exportsMap)) {
    return subpath === '.';
  }
  const keys = Object.keys(exportsMap);
  if (!keys.some((k) => k.startsWith('.'))) return subpath === '.'; // { import, require, ... }
  if (Object.hasOwn(exportsMap, subpath)) return exportsMap[subpath] !== null;
  let best = null;
  for (const key of keys) {
    const star = key.indexOf('*');
    if (star === -1 || key.indexOf('*', star + 1) !== -1) continue;
    const [prefix, suffix] = [key.slice(0, star), key.slice(star + 1)];
    if (subpath.length >= key.length && subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
      // Node picks the longest prefix; ties are not possible for well-formed maps.
      if (best === null || prefix.length > best.prefix.length) best = { key, prefix };
    }
  }
  return best !== null && exportsMap[best.key] !== null;
}

/** Throws unless every imported `@fluxgantt/<pkg>[/subpath]` is in that version's registry `exports`. */
export async function checkRegistry(fluxImports, versions, registry = DEFAULT_REGISTRY) {
  const manifests = new Map();
  const problems = [];
  for (const { file, spec } of fluxImports) {
    const name = packageNameOf(spec);
    const pkg = name.slice('@fluxgantt/'.length);
    const version = versions[pkg];
    if (!manifests.has(pkg)) {
      const url = `${registry.replace(/\/+$/, '')}/@fluxgantt/${pkg}/${version}`;
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.status === 404) fail(`${name}@${version} is not on the registry (${url}); not published yet, or registry lag`);
      if (!res.ok) fail(`registry ${url}: HTTP ${res.status}`);
      manifests.set(pkg, await res.json());
    }
    const manifest = manifests.get(pkg);
    const subpath = spec === name ? '.' : `.${spec.slice(name.length)}`;
    const has = exportsHas(manifest.exports, subpath);
    if (!has) problems.push(`${file}: "${spec}" is not exported by ${name}@${version}`);
  }
  if (problems.length > 0) {
    fail(
      `the examples import API that is not on npm:\n  ${problems.join('\n  ')}\n` +
        'Release it first, or generate from the commit of the published versions.',
    );
  }
}

// ---------------------------------------------------------------------------------------------
// File listing
// ---------------------------------------------------------------------------------------------

async function walk(dir, base = dir) {
  const out = [];
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs, base)));
    else if (entry.isFile()) out.push(toPosix(relative(base, abs)));
  }
  return out;
}

/** Copied + generated files of one example, relative POSIX paths, sorted (excludes package.json/tsconfig). */
export async function listExampleFiles(example, sourceRoot = DEFAULT_SOURCE) {
  const root = join(sourceRoot, example.source);
  const files = new Set(example.files);
  for (const d of example.dirs) for (const f of await walk(join(root, d))) files.add(`${d}/${f}`);
  for (const f of Object.keys(example.generated)) files.add(f);
  return [...files].sort();
}

/** Every file the generator writes for an example (for link checks): the above + package.json/tsconfig. */
export async function listOutputFiles(example, sourceRoot = DEFAULT_SOURCE) {
  const files = await listExampleFiles(example, sourceRoot);
  files.push('package.json');
  if (example.tsconfig) files.push('tsconfig.json');
  return files.sort();
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function prepareOutDir(out, sourceRoot) {
  if (isInside(sourceRoot, out)) fail(`--out ${out} contains the source repo; refusing to clear it`);
  if (existsSync(out)) {
    const entries = await readdir(out);
    if (entries.length > 0 && !entries.includes('.stackblitz-stamp.json')) {
      fail(`--out ${out} exists, is not empty and is not a previous output (no .stackblitz-stamp.json)`);
    }
    await rm(out, { recursive: true, force: true });
  }
  await mkdir(out, { recursive: true });
}

async function writeOut(file, content) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function gitSha(sourceRoot) {
  try {
    return execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * @param {{ out: string, source?: string, versions?: { kind: 'workspace' } | { kind: 'local-tarballs', dir: string },
 *           checkRegistry?: boolean, sourceSha?: string, registry?: string, log?: (msg: string) => void }} options
 */
export async function generate(options) {
  const log = options.log ?? (() => {});
  const sourceRoot = resolve(options.source ?? DEFAULT_SOURCE);
  const out = resolve(options.out);
  const mode = options.versions ?? { kind: 'workspace' };
  const sourceSha = options.sourceSha ?? gitSha(sourceRoot);
  if (!SHA_RE.test(sourceSha)) fail(`--source-sha: malformed ${JSON.stringify(sourceSha)}`);

  if (options.checkRegistry && mode.kind !== 'workspace') {
    fail('--check-registry only makes sense with --versions workspace');
  }

  const versions = await readPackageVersions(sourceRoot);
  const specs = resolveSpecifiers(versions, mode);
  log(`versions: ${PUBLISHED_PACKAGES.map((p) => `@fluxgantt/${p} -> ${specs[p]}`).join(', ')}`);

  await prepareOutDir(out, sourceRoot);
  try {
    return await emit({ options, log, sourceRoot, out, mode, sourceSha, versions, specs });
  } catch (err) {
    // Never leave a half-written tree: it would lack the stamp, and the workflow must not be
    // able to upload or push a partial output.
    await rm(out, { recursive: true, force: true });
    throw err;
  }
}

async function emit({ options, log, sourceRoot, out, mode, sourceSha, versions, specs }) {
  const fluxImports = [];
  const written = [];

  for (const example of MANIFEST) {
    const srcDir = join(sourceRoot, example.source);
    const outDir = join(out, example.dir);
    const files = await listExampleFiles(example, sourceRoot);
    for (const rel of files) {
      const gen = example.generated[rel];
      const content = gen ? gen() : await readFile(join(srcDir, rel));
      await writeOut(join(outDir, rel), content);
    }

    const label = example.dir;
    const pkgSource = JSON.parse(await readFile(join(srcDir, 'package.json'), 'utf8'));
    const pkg = rewritePackageJson(pkgSource, specs, { label, mode, description: example.description });
    await writeOut(join(outDir, 'package.json'), json(pkg));

    if (example.tsconfig) {
      const flat = await flattenTsconfig(join(srcDir, example.tsconfig), sourceRoot);
      await writeOut(join(outDir, 'tsconfig.json'), json(finalizeTsconfig(flat)));
    }

    fluxImports.push(...(await checkSelfContained(outDir, files, pkg, label)));
    const outFiles = await listOutputFiles(example, sourceRoot);
    written.push(...outFiles.map((f) => `${example.dir}/${f}`));
    log(`${example.dir}/ <- ${example.source} (${outFiles.length} files)`);
  }

  if (options.checkRegistry) {
    await checkRegistry(fluxImports, versions, options.registry ?? process.env.FLUXGANTT_NPM_REGISTRY ?? DEFAULT_REGISTRY);
    log(`registry: all ${new Set(fluxImports.map((i) => i.spec)).size} @fluxgantt specifiers are published`);
  }

  const stamp = { sourceSha, core: versions.core, react: versions.react, vue: versions.vue };
  await writeOut(join(out, '.stackblitz-stamp.json'), json(stamp));
  await writeOut(join(out, 'README.md'), rootReadme(stamp));
  written.push('.stackblitz-stamp.json', 'README.md');
  return { out, versions, specs, stamp, files: written.sort(), fluxImports };
}

export function parseArgs(argv) {
  const opts = { versions: { kind: 'workspace' }, checkRegistry: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=') && arg.startsWith('--') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail(`${flag} needs a value`);
      i += 1;
      return v;
    };
    switch (flag) {
      case '--out':
        opts.out = value();
        break;
      case '--source':
        opts.source = value();
        break;
      case '--source-sha':
        opts.sourceSha = value();
        break;
      case '--check-registry':
        opts.checkRegistry = true;
        break;
      case '--versions': {
        const v = value();
        if (v === 'workspace') opts.versions = { kind: 'workspace' };
        else if (v.startsWith('local-tarballs=')) opts.versions = { kind: 'local-tarballs', dir: resolve(v.slice('local-tarballs='.length)) };
        else fail(`--versions: expected "workspace" or "local-tarballs=<dir>", got ${JSON.stringify(v)}`);
        break;
      }
      default:
        fail(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  if (!opts.out) fail('--out <dir> is required');
  return opts;
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = await generate({ ...opts, log: (m) => console.log(`  ${m}`) });
    console.log(`✓ build-stackblitz-examples: ${result.files.length} files written to ${result.out}`);
    for (const f of result.files) console.log(`    ${f}`);
  } catch (err) {
    if (err instanceof GeneratorError) {
      console.error(`\n✗ build-stackblitz-examples: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
