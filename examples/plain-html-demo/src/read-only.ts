// Read-only variant of the demo — the Playwright `read-only.spec.ts` fixture. Keep the dataset
// in sync with src/main.ts (the canonical quick-start). Only difference: `readOnly: true`.
import { createGantt, toTaskId } from '@fluxgantt/core';

const gantt = createGantt({
  readOnly: true,
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

gantt.mount(document.getElementById('gantt')!);

if (import.meta.env.DEV) {
  (window as unknown as { __gantt?: typeof gantt }).__gantt = gantt;
}
