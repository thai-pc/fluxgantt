import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Entry pages: the main demo (draggable), a read-only variant, a selection fixture, and a
// Canvas-renderer harness. The read-only page exists specifically as the Playwright
// `read-only.spec.ts` fixture (drag must be inert when `readOnly: true`). The selection page
// exists for `tests/e2e/selection.spec.ts` and the `.fg-task--selected` visual-regression
// snapshots (2-level hierarchy + 3 flat siblings — see `src/selection.ts`). The canvas-harness
// page exists for `tests/visual/canvas-renderer.spec.ts` — a TEMPORARY, Ticket-1-only fixture
// (spec-canvas-renderer-ticket1.md §9.2) that imports `createCanvasRenderer` via a relative
// path directly into workspace source, since that module isn't part of the published
// `@fluxgantt/core` surface yet (see `src/canvas-harness.ts`'s header comment). All are listed
// as rollup inputs so `vite build` type/asset-checks every one of them.
export default defineConfig({
  server: {
    fs: {
      // Needed so `src/canvas-harness.ts`'s relative import of
      // `../../../packages/core/src/render/canvas-renderer.ts` (workspace source, not the
      // published package — see that file's header comment) resolves under Vite's dev
      // server; the repo root covers the whole pnpm workspace.
      allow: [fileURLToPath(new URL('../../', import.meta.url))],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        readOnly: fileURLToPath(new URL('./read-only.html', import.meta.url)),
        selection: fileURLToPath(new URL('./selection.html', import.meta.url)),
        canvasHarness: fileURLToPath(new URL('./canvas-harness.html', import.meta.url)),
      },
    },
  },
});
