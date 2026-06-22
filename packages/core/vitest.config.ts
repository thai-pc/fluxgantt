import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // headless: core không cần DOM
    setupFiles: ['./tests/setup/temporal.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
    },
  },
});
