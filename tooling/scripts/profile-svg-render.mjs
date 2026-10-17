// Phase-0 profiler for spec-svg-render-perf.md. Not part of CI.
//   pnpm --filter @fluxgantt/core build
//   (cd examples/plain-html-demo && npx vite --port 5182 --strictPort &)
//   node tooling/scripts/profile-svg-render.mjs <label> [cpu]
// Per scenario: cold mount, then each op as JS-only AND to-two-rAFs (style/layout/paint), plus the
// number of full SVG renders the op caused. `cpu` adds a CPU profile of one zoom (top self time).
import { chromium } from '@playwright/test';

const PORT = process.env.PW_PORT ?? '5182';
const label = process.argv[2] ?? 'run';
const scenarios = {
  'dense-30d': 'taskCount=2000&grouped=1',
  'long-520d': 'taskCount=2000&grouped=1&span=520&holidays=20',
};
const ops = ['zoom', 'zoom', 'density', 'density', 'collapse', 'collapse', 'select', 'select', 'selectAll', 'updateTask', 'updateTask'];
const browser = await chromium.launch();
for (const [name, qs] of Object.entries(scenarios)) {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/canvas-mount-perf-harness.html?${qs}`);
  await page.waitForFunction(() => typeof window.__mountAndTime === 'function');
  const mount = await page.evaluate(async () => {
    const t = performance.now();
    const r = await window.__mountAndTime();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    return { js: Math.round(r.ms), paint: Math.round(performance.now() - t), renderer: document.body.dataset.renderer };
  });
  console.log(`[${label}] ${name} mount`, JSON.stringify(mount));
  for (const op of ops) {
    const r = await page.evaluate((o) => window.__repaintAndTime(o), op);
    console.log(`[${label}] ${name} ${op.padEnd(10)} js ${r.jsMs.toFixed(0).padStart(6)} | paint ${r.paintMs.toFixed(0).padStart(6)} | renders ${r.renders}`);
  }
  if (process.argv[3] === 'cpu') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    await page.evaluate(() => window.__repaintAndTime('zoom'));
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map();
    profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + profile.timeDeltas[i]));
    const byFn = new Map();
    for (const n of profile.nodes) {
      const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
      byFn.set(k, (byFn.get(k) ?? 0) + (self.get(n.id) ?? 0));
    }
    [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, us]) => console.log((us / 1000).toFixed(0).padStart(6), 'ms', k));
  }
  await page.close();
}
await browser.close();
