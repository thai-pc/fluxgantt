import { defineConfig, devices } from '@playwright/test';

// Playwright config for FluxGantt UI tests. The `examples/plain-html-demo` Vite app is the host
// app the e2e specs drive: its dev build exposes the mounted instance on `window.__gantt`
// (dev-only) and serves a read-only variant at `/read-only.html`.
const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  webServer: {
    command: 'pnpm --filter plain-html-demo dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'visual',
      testDir: './tests/visual',
      // The new `canvas-renderer-webkit-dimension-guard.spec.ts` (spec-canvas-webkit-dimension-
      // limit.md §12.1/§13.2) asserts WebKit-only behavior (an `axis: 'area'` throw that never
      // fires on Chromium — a deliberate "must not regress" case, §7.1) and shares this same
      // `testDir` — without this `testIgnore`, this Chromium-targeted project would ALSO pick it
      // up (via `testDir` globbing) and its WebKit-only assertions would legitimately fail here.
      testIgnore: 'canvas-renderer-webkit-dimension-guard.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'a11y',
      testDir: './tests/a11y',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // spec-canvas-webkit-dimension-limit.md §12.1 — scoped via `testMatch` to ONE new,
      // non-visual-snapshot spec file, not a general WebKit re-run of `e2e`/`visual`/`a11y`
      // (those were baselined against Chromium specifically; see that spec file's own header
      // comment for the full rationale). `devices['Desktop Safari']` is Playwright's WebKit
      // device preset — note its `deviceScaleFactor` is 2, not 1 (confirmed while authoring
      // this project), which the new harness's own row-count boundary math accounts for.
      name: 'webkit-canvas-dimension-guard',
      testDir: './tests/visual',
      testMatch: 'canvas-renderer-webkit-dimension-guard.spec.ts',
      use: { ...devices['Desktop Safari'] },
    },
    {
      // spec-responsive-mobile.md §C — the ONLY project with `hasTouch`, driving
      // `examples/plain-html-demo/responsive.html` (the only fixture composing
      // `withResponsive()`). `devices['Pixel 5']` gives a 393x851 viewport and reports
      // `(pointer: coarse)`, which is what the mixin feature-detects on; a desktop project with a
      // small `viewport` override would report a FINE pointer and silently exercise nothing.
      //
      // Target-size assertions (WCAG 2.2 SC 2.5.8, 24x24 CSS px) live here rather than in
      // `tests/a11y/` because target size is pointer- and viewport-dependent: the same chart is
      // conformant on desktop at an 8px edge zone and is not on a phone. `tests/a11y/` stays
      // desktop-only.
      //
      // Chromium only for v1, matching the `performance` project's stated posture — a Mobile
      // Safari project needs its own baselining pass and is a follow-up.
      name: 'mobile',
      testDir: './tests/mobile',
      use: { ...devices['Pixel 5'] },
    },
    {
      // spec-canvas-auto-switch.md §9.1/§9.3 — real-browser mount-time budgets for the Canvas
      // auto-switch (`CANVAS_AUTO_SWITCH_THRESHOLD`). Deliberately Playwright, not vitest bench:
      // `packages/core/vitest.config.ts` runs in a Node/jsdom-less `environment: 'node'` with a
      // mocked `CanvasRenderingContext2D` (zero real paint cost) for its unit tests, which would
      // not measure the thing that actually matters here (real Chromium rasterization + Ticket 2's
      // hidden ARIA a11y layer's real per-task DOM node creation). `devices['Desktop Chrome']`
      // only for v1 — Firefox/WebKit perf baselines are a follow-up, not this ticket.
      name: 'performance',
      testDir: './tests/performance',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
