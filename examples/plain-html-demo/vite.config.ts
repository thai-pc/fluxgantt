import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Two entry pages: the main demo (draggable) and a read-only variant. The read-only page
// exists specifically as the Playwright `read-only.spec.ts` fixture (drag must be inert when
// `readOnly: true`). Both are listed as rollup inputs so `vite build` type/asset-checks both.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        readOnly: fileURLToPath(new URL('./read-only.html', import.meta.url)),
      },
    },
  },
});
