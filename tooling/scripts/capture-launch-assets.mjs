#!/usr/bin/env node
// Regenerates the launch media in apps/docs/launch/assets/ and syncs the bundle-size figures in
// the launch/docs copy (see the README next to the assets).
//
//   pnpm --filter @fluxgantt/core build        # the demo imports core's dist
//   pnpm capture:launch-assets                 # sizes + copy sync + all media
//   pnpm capture:launch-assets -- --copy-only  # only re-measure sizes and rewrite the copy
//   pnpm capture:launch-assets -- --no-copy    # media only (gallery-2 still measures sizes)
//
// Needs: Playwright's Chromium (`pnpm exec playwright install chromium`), ffmpeg on PATH, and
// Node >= 22.19 (size-limit). Env: LAUNCH_PORT (default 5187) — the script starts
// `plain-html-demo`'s Vite dev server on it unless something already answers there; OUT_DIR
// overrides the output folder.
//
// ONE SOURCE FOR THE NUMBERS: `measureSizes()` runs `size-limit --json` on the real fixtures in
// packages/core/size-limit/ (the same measurement CI enforces) and everything below derives from
// it: gallery-2's bars, and every `sz` marker in SYNC_FILES (rewritten in place by
// `syncCopy()`). The only literals are the two competitor figures, which come from
// tooling/scripts/measure-competitor-bundles.mjs (needs the npm registry, so not re-run here).
//
// Copy marker syntax, so prose can stay readable while the value is machine-owned:
//   Markdown:  <!--sz:editable.2-->19.02<!--/sz-->      (key.decimals; unit stays outside)
//   MDX:       {/*sz:editable.2*/}19.02{/*/sz*/}
// Keys: hello io render editable theme responsive viewport conflicts edithooks kitchen.
// Values are KiB (bytes / 1024); size-limit's own console output is decimal kB, which is why a
// 7.68 kB report reads 7.50 here. Lines ending "— N chars" are re-counted after substitution.
//
// How the GIFs are made: every gesture is REAL pointer input (`page.mouse`), but the video is not
// a screen recording. After each mouse step we take a 2x-DPR screenshot, then ffmpeg downscales
// to 1200x675 with a per-GIF palette: supersampled (crisp) text and deterministic frame timing
// independent of machine speed. Headless Chromium draws no OS cursor, so a fake arrow element
// follows the real mouse events. The chart is `examples/plain-html-demo/launch.html` (dev-only;
// `schedulingMode: 'auto'` so a dragged predecessor really cascades) — see src/launch.ts.
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.OUT_DIR ?? path.join(ROOT, 'apps/docs/launch/assets');
const PORT = Number(process.env.LAUNCH_PORT ?? 5187);
const BASE = `http://localhost:${PORT}`;
const args = new Set(process.argv.slice(2));
const COPY_ONLY = args.has('--copy-only');
const NO_COPY = args.has('--no-copy');

// Competitor figures (KiB gzip incl. required CSS): tooling/scripts/measure-competitor-bundles.mjs,
// as published on /docs/comparison. Not measured here.
const COMPETITORS = { dhtmlx: 226.18, frappe: 14.89 };

// Files whose `sz` markers are rewritten. Relative to the repo root.
const SYNC_FILES = [
  'apps/docs/pages/docs/comparison.mdx',
  'apps/docs/pages/index.mdx',
  'apps/docs/launch/product-hunt.md',
  'apps/docs/launch/show-hn.md',
  'README.md',
];

const sh = (cmd, a) => execFileSync(cmd, a, { stdio: ['ignore', 'ignore', 'inherit'] });

// ---------------------------------------------------------------------------------- sizes
const SIZE_KEYS = [
  ['hello', 'Hello world'], ['io', 'withIo'], ['render', '(static painted'], ['editable', '(editable chart'],
  ['kitchen', 'Kitchen sink'], ['theme', 'withTheme'], ['responsive', 'withResponsive'],
  ['viewport', 'withViewport'], ['conflicts', 'withConflicts'], ['edithooks', 'withEditHooks'],
];
/** KiB per key, from `size-limit --json` (gzip bytes / 1024). */
function measureSizes() {
  const raw = execFileSync('pnpm', ['--filter', '@fluxgantt/core', 'exec', 'size-limit', '--json'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  // esbuild prints warnings into the same stream; the report is the one `[ { ... } ]` block.
  const json = raw.match(/\[\s*\{[\s\S]*?\n\]/)?.[0];
  if (!json) throw new Error('could not find the size-limit JSON report in its output');
  const rows = JSON.parse(json);
  const out = {};
  for (const [key, needle] of SIZE_KEYS) {
    const row = rows.find((r) => r.name.includes(needle));
    if (!row) throw new Error(`no size-limit fixture matching "${needle}"`);
    out[key] = row.size / 1024;
  }
  return out;
}

const MARKER = /(<!--sz:(\w+)\.(\d)-->|\{\/\*sz:(\w+)\.(\d)\*\/\})([^<{]*?)(<!--\/sz-->|\{\/\*\/sz\*\/\})/g;
function syncCopy(sizes) {
  let total = 0;
  for (const rel of SYNC_FILES) {
    const file = path.join(ROOT, rel);
    const before = readFileSync(file, 'utf8');
    let n = 0;
    let after = before.replace(MARKER, (_m, open, k1, d1, k2, d2, _old, close) => {
      const key = k1 ?? k2;
      if (!(key in sizes)) throw new Error(`${rel}: unknown size key "${key}"`);
      n++;
      return `${open}${sizes[key].toFixed(Number(d1 ?? d2))}${close}`;
    });
    // "> text — 48 chars" candidate lines: recount against the substituted text.
    after = after.replace(/^(> )(.*?) — (\d+) chars$/gm, (_m, lead, text) => {
      const plain = text.replace(/<!--.*?-->/g, '').replace(/^`|`$/g, '');
      return `${lead}${text} — ${[...plain].length} chars`;
    });
    if (after !== before) writeFileSync(file, after);
    console.log(`copy: ${rel}  ${n} figures${after !== before ? '  (updated)' : ''}`);
    total += n;
  }
  if (total === 0) throw new Error('no sz markers found in any SYNC_FILES entry');
}

// ---------------------------------------------------------------------------- dev server
async function up() {
  try { return (await fetch(BASE)).ok; } catch { return false; }
}
let server;
async function ensureServer() {
  if (await up()) return;
  server = spawn('pnpm', ['--filter', 'plain-html-demo', 'dev', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: 'ignore',
  });
  for (let i = 0; i < 120 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up())) throw new Error(`dev server did not come up on ${BASE}`);
}

// Page chrome for a screen-recording look: full-width chart, no intro copy, no theme button.
const CHROME_CSS = `
  main{max-width:none!important;padding:28px 32px!important}
  main>p{display:none!important}
  h1{margin:0 0 16px!important}
  #gantt{height:var(--launch-h,430px)!important}
`;

async function openDemo(browser, { width, height, dark = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/launch.html');
  await page.waitForSelector('#gantt svg.fg-timeline');
  await page.addStyleTag({ content: CHROME_CSS });
  if (dark) await page.evaluate(() => { const b = document.getElementById('theme-toggle'); b.click(); b.click(); });
  await page.waitForTimeout(300);
  return { ctx, page };
}

// ------------------------------------------------------------------------------ fake cursor
async function installCursor(page) {
  await page.evaluate(() => {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;' +
      'transform:translate(-100px,-100px);transition:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(c);
    const at = (e) => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; };
    addEventListener('mousemove', at, true);
    addEventListener('mousedown', (e) => { at(e); c.firstChild.style.transform = 'scale(.88)'; }, true);
    addEventListener('mouseup', () => { c.firstChild.style.transform = ''; }, true);
  });
}

// ------------------------------------------------------------------------------ frame recorder
const TMP = mkdtempSync(path.join(tmpdir(), 'fluxgantt-launch-'));
class Recorder {
  constructor(page, name) { this.page = page; this.dir = path.join(TMP, name); mkdirSync(this.dir); this.frames = []; }
  async shot(ms) {
    const f = path.join(this.dir, String(this.frames.length).padStart(4, '0') + '.png');
    // Headless Chromium occasionally stalls one screenshot on a loaded machine; retry.
    for (let attempt = 1; ; attempt++) {
      try { await this.page.screenshot({ path: f, timeout: 60_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    this.frames.push([f, ms]);
  }
  async hold(ms, stepMs = 100) { for (let t = 0; t < ms; t += stepMs) await this.shot(stepMs); }
  /** Move the real mouse along an eased path, one screenshot per step. */
  async glide(from, to, steps, stepMs = 50) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      await this.page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
      await this.page.waitForTimeout(20);
      await this.shot(stepMs);
    }
  }
  concatList() {
    const lines = ['ffconcat version 1.0'];
    for (const [f, ms] of this.frames) lines.push(`file '${f}'`, `duration ${ms / 1000}`);
    lines.push(`file '${this.frames.at(-1)[0]}'`); // ffconcat drops the last duration otherwise
    return lines;
  }
  seconds() { return this.frames.reduce((s, [, ms]) => s + ms, 0) / 1000; }
}

// `edge: 'right'` grabs 6px inside the right edge: inside the 8px resize zone, clear of the 4px
// link-handle circle (see tests/e2e/drag-resize.spec.ts for the derivation).
const grabPoint = async (page, id, edge) => {
  const box = await page.locator(`[data-task-id="${id}"] .fg-task__bar`).boundingBox();
  return { x: edge === 'right' ? box.x + box.width - 6 : box.x + box.width / 2, y: box.y + box.height / 2 };
};
const PX_PER_DAY = 24; // week view, the demo default (tests/helpers/drag.ts)

async function drag(rec, id, days, { edge, steps = 22, post = 2200 } = {}) {
  const { page } = rec;
  const target = await grabPoint(page, id, edge);
  const start = { x: target.x - 260, y: target.y + 110 };
  await page.mouse.move(start.x, start.y);
  await rec.hold(450);
  await rec.glide(start, target, 12);
  await rec.hold(350);
  await page.mouse.down();
  await rec.hold(250);
  const end = { x: target.x + days * PX_PER_DAY, y: target.y };
  await rec.glide(target, end, steps);
  await rec.hold(350);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await rec.hold(700);
  // Click empty chart space so the selection ring (which hides the dashed critical outline on the
  // dragged bar) clears for the final hold.
  const box = await page.locator('#gantt').boundingBox();
  const empty = { x: box.x + box.width * 0.55, y: box.y + box.height - 24 };
  await rec.glide(end, empty, 8);
  await page.mouse.click(empty.x, empty.y);
  await page.waitForTimeout(100);
  await rec.hold(post - 700);
}

async function toGif(rec, name, { fps = 20, maxMB = 3 } = {}) {
  const out = path.join(OUT, name);
  const list = path.join(rec.dir, 'list.ffconcat');
  writeFileSync(list, rec.concatList().join('\n'));
  const palette = path.join(rec.dir, 'palette.png');
  for (const f of [fps, 15, 12, 10]) {
    const base = `fps=${f},scale=1200:675:flags=lanczos`;
    sh('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `${base},palettegen=stats_mode=diff:max_colors=128`, palette]);
    sh('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', palette, '-lavfi',
      `${base}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', out]);
    if (statSync(out).size <= maxMB * 1024 * 1024) break;
  }
  console.log(`${name}  ${(statSync(out).size / 1048576).toFixed(2)} MB  ${rec.seconds().toFixed(1)} s`);
}

function downscale(srcPng, outPng, w, h) {
  sh('ffmpeg', ['-y', '-v', 'error', '-i', srcPng, '-vf', `scale=${w}:${h}:flags=lanczos`, '-frames:v', '1', outPng]);
  console.log(`${path.basename(outPng)}  ${(statSync(outPng).size / 1024).toFixed(0)} KB`);
}

// --------------------------------------------------------------------------- composed pages
const FONT = "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',system-ui,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
async function composed(browser, html, w, h, outName) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><meta charset=utf-8><style>*{box-sizing:border-box}body{margin:0;width:${w}px;height:${h}px;font-family:${FONT};overflow:hidden}</style>${html}`);
  const raw = path.join(TMP, outName + '.raw.png');
  await page.screenshot({ path: raw });
  await ctx.close();
  downscale(raw, path.join(OUT, outName), w, h);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const K = (s) => `<span style="color:#c792ea">${s}</span>`;
const S = (s) => `<span style="color:#c3e88d">${esc(s)}</span>`;
const F = (s) => `<span style="color:#82aaff">${s}</span>`;
const V = (s) => `<span style="color:#f78c6c">${s}</span>`;

const sizeBars = (sz) => {
  const rows = [
    ['dhtmlx-gantt Community (JS + CSS)', COMPETITORS.dhtmlx, '#a1a1aa'],
    ['FluxGantt, everything composed', sz.kitchen, '#6366f1'],
    ['FluxGantt, editable chart (render + drag)', sz.editable, '#6366f1'],
    ['Frappe Gantt (JS + CSS)', COMPETITORS.frappe, '#a1a1aa'],
    ['FluxGantt, headless engine', sz.hello, '#6366f1'],
  ].sort((a, b) => b[1] - a[1]);
  const max = COMPETITORS.dhtmlx, W = 660;
  return `<div style="background:#fafafa;height:100%;padding:56px 70px;color:#18181b">
    <div style="font-size:38px;font-weight:700;letter-spacing:-.02em">You download only what you compose</div>
    <div style="font-size:19px;color:#6b6b73;margin:8px 0 40px">Gzip size in KiB, each library's required stylesheet included.</div>
    ${rows.map(([n, v, c]) => `<div style="display:flex;align-items:center;margin:22px 0">
      <div style="flex:none;width:400px;font-size:19px;font-weight:${c === '#6366f1' ? 600 : 500}">${n}</div>
      <div style="height:38px;width:${Math.max(3, (v / max) * W)}px;background:${c};border-radius:5px"></div>
      <div style="margin-left:14px;font-size:21px;font-weight:700;font-variant-numeric:tabular-nums">${v.toFixed(2)}</div></div>`).join('')}
    <div style="position:absolute;bottom:34px;left:70px;font-size:16px;color:#6b6b73">Frappe is smaller than an editable FluxGantt chart; it has no critical path, FS-only dependencies and no types. Source: /docs/comparison</div>
  </div>`;
};

const tsHtml = () => `<div style="background:linear-gradient(135deg,#312e81,#6366f1);height:100%;padding:70px 90px">
  <div style="background:#1e1e2e;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.45);overflow:hidden;height:100%">
    <div style="background:#181825;padding:12px 16px;display:flex;gap:8px;align-items:center">
      <i style="width:12px;height:12px;border-radius:6px;background:#ff5f57"></i><i style="width:12px;height:12px;border-radius:6px;background:#febc2e"></i><i style="width:12px;height:12px;border-radius:6px;background:#28c840"></i>
      <span style="margin-left:14px;color:#a6adc8;font:14px ${FONT}">link-tasks.ts</span></div>
    <div style="padding:26px 0;font:22px/1.7 ${MONO};color:#cdd6f4;white-space:pre">
${[
  `${K('import')} { ${F('createGantt')}, ${F('toTaskId')}, ${F('toResourceId')} } ${K('from')} ${S("'@fluxgantt/core'")};`,
  ``,
  `${K('const')} gantt = ${F('createGantt')}({ tasks: [], dependencies: [] });`,
  `${K('const')} task = ${F('toTaskId')}(${S("'design'")});`,
  `${K('const')} resource = ${F('toResourceId')}(${S("'alice'")});`,
  ``,
  `gantt.${F('linkTasks')}(task, <span style="text-decoration:underline wavy #f38ba8;text-decoration-thickness:2px;text-underline-offset:6px">resource</span>, ${S("'FS'")});`,
].map((l, i) => `<div style="display:flex"><span style="width:70px;text-align:right;padding-right:26px;color:#585b70">${i + 1}</span><span>${l}</span></div>`).join('')}</div>
    <div style="margin:6px 40px 0 96px;background:#2a2b3c;border:1px solid #45475a;border-radius:8px;padding:16px 20px;font:18px/1.55 ${MONO};color:#cdd6f4;white-space:pre-wrap"><span style="color:#f38ba8;font-weight:700">error TS2345:</span> Argument of type <span style="color:#89dceb">'ResourceId'</span> is not assignable to parameter of type <span style="color:#89dceb">'TaskId'</span>.
<span style="color:#a6adc8">  Type 'ResourceId' is not assignable to type '{ readonly __brand: "TaskId"; }'.
    Types of property '__brand' are incompatible.</span></div>
  </div></div>`;
// (the error text above is real `tsc` output for exactly that snippet)

const headlessHtml = (sz) => `<div style="background:#0f0f14;height:100%;padding:90px 70px">
  <div style="color:#a1a1aa;font-size:20px;margin-bottom:24px;font-family:${FONT}">Headless: no DOM, no renderer. <b style="color:#fafafa">${sz.hello.toFixed(2)} KiB gzip.</b> Runs in Node, Workers, Lambda.</div>
  <div style="background:#16161e;border:1px solid #27272a;border-radius:12px;padding:30px 36px;font:18.5px/1.8 ${MONO};color:#cdd6f4;white-space:pre">${[
  `${K('import')} { ${F('createGantt')}, ${F('toTaskId')} } ${K('from')} ${S("'@fluxgantt/core'")};`,
  ``,
  `${K('const')} gantt = ${F('createGantt')}({`,
  `  tasks: [`,
  `    { id: ${F('toTaskId')}(${S("'design'")}), name: ${S("'Design'")}, start: ${S("'2026-08-03'")}, end: ${S("'2026-08-05'")},`,
  `      progress: ${V('1')}, type: ${S("'task'")} },`,
  `    { id: ${F('toTaskId')}(${S("'build'")}), name: ${S("'Build'")}, start: ${S("'2026-08-05'")}, end: ${S("'2026-08-10'")},`,
  `      progress: ${V('0')}, type: ${S("'task'")} },`,
  `  ],`,
  `  dependencies: [{ from: ${F('toTaskId')}(${S("'design'")}), to: ${F('toTaskId')}(${S("'build'")}), type: ${S("'FS'")} }],`,
  `});`,
  ``,
  `${K('const')} { criticalTaskIds, projectEnd } = gantt.${F('computeCriticalPath')}();`,
].join('\n')}</div></div>`;

const thumbHtml = () => `<div style="background:#6366f1;width:240px;height:240px;position:relative">
  <div style="position:absolute;inset:34px;background:#fff;border-radius:26px"></div>
  ${[[58, 62, 74], [88, 108, 84], [118, 154, 70]].map(([l, t, w], i) =>
    `<div style="position:absolute;left:${l}px;top:${t}px;width:${w}px;height:32px;border-radius:9px;background:#6366f1;${i === 1 ? 'outline:5px dashed #ef4444;outline-offset:3px' : ''}"></div>`).join('')}
</div>`;

// ------------------------------------------------------------------------------------- main
async function main() {
  const sizes = measureSizes();
  console.log('sizes (KiB):', Object.entries(sizes).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' '));
  if (!NO_COPY) syncCopy(sizes);
  if (COPY_ONLY) return;

  mkdirSync(OUT, { recursive: true });
  await ensureServer();
  const browser = await chromium.launch();
  try {
    // --- demo GIFs (1200x675) ---
    const clips = [];
    for (const [name, id, days, opts] of [
      ['drag-task.gif', 'docs', 6, {}],                  // a leaf with no successors: pure move + snap
      ['dependency-cascade.gif', 'research', 4, {}],     // successors shift with it
      // RESIZE, not move: the critical path comes from durations + dependencies, so only a longer
      // duration makes the slack chain (API) the critical one.
      ['critical-path.gif', 'api', 8, { edge: 'right' }],
    ]) {
      const { ctx, page } = await openDemo(browser, { width: 1200, height: 675 });
      await installCursor(page);
      const rec = new Recorder(page, name.replace('.gif', ''));
      await drag(rec, id, days, opts);
      await toGif(rec, name);
      clips.push(rec);
      await ctx.close();
    }
    // --- short silent MP4 teaser: the three clips back to back ---
    const all = path.join(TMP, 'all.ffconcat');
    const frames = clips.flatMap((r) => r.frames);
    writeFileSync(all, clips.length ? ['ffconcat version 1.0',
      ...frames.flatMap(([f, ms]) => [`file '${f}'`, `duration ${ms / 1000}`]), `file '${frames.at(-1)[0]}'`].join('\n') : '');
    const mp4 = path.join(OUT, 'demo-teaser.mp4');
    sh('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', all, '-vf',
      'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', mp4]);
    console.log(`demo-teaser.mp4  ${(statSync(mp4).size / 1048576).toFixed(2)} MB`);

    // --- gallery 1 (light) + dark variant, 1270x760 ---
    for (const [dark, name] of [[false, 'gallery-1-chart.png'], [true, 'gallery-1b-chart-dark.png']]) {
      const { ctx, page } = await openDemo(browser, { width: 1270, height: 760, dark });
      await page.addStyleTag({ content: '#gantt{--launch-h:470px;height:470px!important}' });
      await page.waitForTimeout(200);
      const raw = path.join(TMP, name + '.raw.png');
      await page.screenshot({ path: raw });
      downscale(raw, path.join(OUT, name), 1270, 760);
      await ctx.close();
    }

    // --- gallery 2, 3, 5 and thumbnail ---
    await composed(browser, sizeBars(sizes), 1270, 760, 'gallery-2-bundle-size.png');
    await composed(browser, tsHtml(), 1270, 760, 'gallery-3-typescript.png');
    await composed(browser, headlessHtml(sizes), 1270, 760, 'gallery-5-headless.png');
    await composed(browser, thumbHtml(), 240, 240, 'thumbnail.png');

    // --- gallery 4: /responsive.html on Pixel 5 emulation, framed on a 1270x760 canvas ---
    const phone = await browser.newContext({
      viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
    });
    const pp = await phone.newPage();
    await pp.goto(BASE + '/responsive.html');
    await pp.waitForFunction(() => window.__gantt);
    await pp.addStyleTag({ content: 'main>p{display:none!important}h1{font-size:1.1rem}#gantt{height:48vh!important}' });
    // The dataset spans five months, far wider than 393px, and the label column scrolls WITH the
    // content (it is not sticky). So zoom out until three bars fit the visible plot area, then
    // pin scrollLeft to 0 (zoomTo recentres) so the narrowed label column stays on screen.
    await pp.evaluate(() => window.__gantt.zoomTo('quarter'));
    await pp.evaluate(() => { document.querySelector('#gantt').scrollLeft = 0; });
    await pp.waitForTimeout(500);
    const phonePng = path.join(TMP, 'phone.png');
    await pp.screenshot({ path: phonePng });
    await phone.close();
    const b64 = readFileSync(phonePng).toString('base64');
    await composed(browser, `<div style="background:linear-gradient(135deg,#312e81,#6366f1);height:100%;display:flex;align-items:center;padding:0 110px;gap:90px">
      <div style="height:690px;aspect-ratio:393/851;border-radius:44px;background:#111;padding:12px;box-shadow:0 30px 70px rgba(0,0,0,.5)"><img src="data:image/png;base64,${b64}" style="width:100%;height:100%;border-radius:34px;display:block"></div>
      <div style="color:#fff"><div style="font-size:46px;font-weight:700;letter-spacing:-.02em;line-height:1.1">Built for touch</div>
        <ul style="font-size:24px;line-height:1.7;margin-top:22px;padding-left:26px;opacity:.95"><li>Touch density with larger link handles</li><li>Label column narrows to fit the screen</li><li>A finger on a bar drags it, elsewhere it pans</li></ul>
        <div style="font-size:18px;opacity:.7;margin-top:26px">withResponsive() &middot; opt-in, 0 B for charts that skip it</div></div></div>`,
      1270, 760, 'gallery-4-responsive.png');
  } finally {
    await browser.close();
    server?.kill();
    rmSync(TMP, { recursive: true, force: true });
  }
  console.log('\nOutput:', OUT, readdirSync(OUT).join(', '));
}
main().catch((e) => { console.error(e); server?.kill(); process.exit(1); });
