// Canonical FluxGantt quick-start. This is the single source of truth for the identical
// snippet shown in the root README and in apps/docs `/docs/quick-start` — the region between
// the `#region quickstart` / `#endregion quickstart` markers below is compared byte-for-byte
// against those two copies by tooling/scripts/check-snippet-sync.mjs (run in CI). Edit the
// snippet HERE; the check fails the build if the copies drift.
// #region quickstart
import { createGantt, toTaskId } from '@fluxgantt/core';

const gantt = createGantt({
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
});

gantt.on('task:moved', (task, prevStart) => {
  console.log(`${task.name} moved from ${prevStart}`);
});

gantt.mount(document.getElementById('gantt')!);
// #endregion quickstart

// Dev-only: expose the instance so the Playwright e2e specs can drive/assert it
// (`window.__gantt`). Guarded by `import.meta.env.DEV`, so it is stripped from a production
// `vite build` and never ships in the example's dist output.
if (import.meta.env.DEV) {
  (window as unknown as { __gantt?: typeof gantt }).__gantt = gantt;
}
