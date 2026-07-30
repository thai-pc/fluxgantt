import { defineConfig, devices } from '@playwright/test';

// Playwright config for FluxGantt UI tests.
// No app/renderer yet → no `webServer` declared. Once `examples/plain-html-demo`
// or @fluxgantt/core's SVG renderer has mount(), add:
//   webServer: { command: 'pnpm --filter plain-html-demo dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI }
// then navigate with page.goto instead of page.setContent.
export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
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
