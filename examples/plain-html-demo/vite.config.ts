import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Entry pages: the main demo (draggable), a read-only variant, a selection fixture, and two
// Canvas-renderer harnesses. The read-only page exists specifically as the Playwright
// `read-only.spec.ts` fixture (drag must be inert when `readOnly: true`). The selection page
// exists for `tests/e2e/selection.spec.ts` and the `.fg-task--selected` visual-regression
// snapshots (2-level hierarchy + 3 flat siblings — see `src/selection.ts`). The canvas-harness
// page exists for `tests/visual/canvas-renderer.spec.ts` — a TEMPORARY, Ticket-1-only fixture
// (spec-canvas-renderer-ticket1.md §9.2). The canvas-a11y-harness page exists for
// `tests/a11y/canvas-renderer.spec.ts` and `tests/visual/canvas-renderer-focus-ring.spec.ts` —
// a TEMPORARY, Ticket-2-only fixture (spec-canvas-renderer-ticket2.md §12.5) exercising the
// hidden ARIA grid layer + click-select/keyboard-nav parity against a 1,000-task dataset (see
// that file's header comment for why 1,000, not architecture.md's `>2000` figure). Both
// canvas harnesses import `createCanvasRenderer` via a relative path directly into workspace
// source, since that module isn't part of the published `@fluxgantt/core` surface yet (see each
// file's own header comment). All are listed as rollup inputs so `vite build` type/asset-checks
// every one of them.
export default defineConfig({
  server: {
    fs: {
      // Needed so `src/canvas-harness.ts`/`src/canvas-a11y-harness.ts`'s relative imports of
      // `../../../packages/core/src/render/canvas-renderer.ts` etc. (workspace source, not the
      // published package — see each file's header comment) resolve under Vite's dev
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
        canvasA11yHarness: fileURLToPath(new URL('./canvas-a11y-harness.html', import.meta.url)),
      },
    },
  },
});
