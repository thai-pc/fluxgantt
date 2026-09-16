// Canonical FluxGantt quick-start. This is the single source of truth for the identical
// snippet shown in the root README and in apps/docs `/docs/quick-start` — the region between
// the `#region quickstart` / `#endregion quickstart` markers below is compared byte-for-byte
// against those two copies by tooling/scripts/check-snippet-sync.mjs (run in CI). Edit the
// snippet HERE; the check fails the build if the copies drift.
// (The `withIo` import below sits outside the region on purpose — it is dev-only plumbing for
// the e2e specs, not part of the quick-start.)
import { withIo } from '@fluxgantt/core/io';

// #region quickstart
import { createGantt, toTaskId } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';

// Rendering and interaction are opt-in mixins — a headless consumer (server-side
// scheduling, tests) never downloads them. Compose both for a live, editable chart.
const gantt = withInteraction(
  withRender(
    createGantt({
      tasks: [
        { id: toTaskId('design'), name: 'Design', start: '2026-08-03', end: '2026-08-05', progress: 1, type: 'task' },
        { id: toTaskId('build'), name: 'Build', start: '2026-08-05', end: '2026-08-10', progress: 0.6, type: 'task' },
        { id: toTaskId('review'), name: 'Review', start: '2026-08-10', end: '2026-08-12', progress: 0, type: 'task' },
        { id: toTaskId('launch'), name: 'Launch', start: '2026-08-12', end: '2026-08-12', progress: 0, type: 'milestone' },
        { id: toTaskId('docs-task'), name: 'Write docs', start: '2026-08-06', end: '2026-08-11', progress: 0.2, type: 'task' },
      ],
      dependencies: [
        { from: toTaskId('design'), to: toTaskId('build'), type: 'FS' },
        { from: toTaskId('build'), to: toTaskId('review'), type: 'FS' },
      ],
    }),
  ),
);

gantt.on('task:moved', (task, prevStart) => {
  console.log(`${task.name} moved from ${prevStart}`);
});

gantt.mount(document.getElementById('gantt')!);
// #endregion quickstart

// Dev-only: expose the instance so the Playwright e2e specs can drive/assert it
// (`window.__gantt`). Guarded by `import.meta.env.DEV`, so it is stripped from a production
// `vite build` and never ships in the example's dist output — which is also why composing
// `withIo` here is free: the export specs need `exportSvg`/`exportJson`/`exportPng`, but Vite
// folds `import.meta.env.DEV` to `false` in a production build, so the whole branch (and with
// it the IO layer) is dead code the bundler drops. The quick-start snippet above deliberately
// stays IO-free: a chart that never imports or exports should not download that code.
if (import.meta.env.DEV) {
  const devHandle = withIo(gantt);
  (window as unknown as { __gantt?: typeof devHandle }).__gantt = devHandle;
}
