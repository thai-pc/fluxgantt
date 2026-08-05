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
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
