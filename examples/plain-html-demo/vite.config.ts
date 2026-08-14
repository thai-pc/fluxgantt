import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Entry pages: the main demo (draggable), a read-only variant, and a selection fixture. The
// read-only page exists specifically as the Playwright `read-only.spec.ts` fixture (drag must
// be inert when `readOnly: true`). The selection page exists for `tests/e2e/selection.spec.ts`
// and the `.fg-task--selected` visual-regression snapshots (2-level hierarchy + 3 flat
// siblings — see `src/selection.ts`). All are listed as rollup inputs so `vite build`
// type/asset-checks every one of them.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        readOnly: fileURLToPath(new URL('./read-only.html', import.meta.url)),
        selection: fileURLToPath(new URL('./selection.html', import.meta.url)),
      },
    },
  },
});
