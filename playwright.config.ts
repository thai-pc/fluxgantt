import { defineConfig, devices } from '@playwright/test';

// Playwright config cho UI test của FluxGantt.
// Hiện chưa có app/renderer → chưa khai báo `webServer`. Khi `examples/plain-html-demo`
// hoặc SVG renderer của @fluxgantt/core có mount(), thêm:
//   webServer: { command: 'pnpm --filter plain-html-demo dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI }
// rồi điều hướng bằng page.goto thay cho page.setContent.
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
