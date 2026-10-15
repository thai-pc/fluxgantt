// FluxGantt headless: the scheduling engine with no DOM, no renderer and no framework.
// `npm start` (or `node index.mjs`) prints the critical path and the project end date.
import { Temporal } from '@js-temporal/polyfill';
import { createGantt, toTaskId } from '@fluxgantt/core';

// Core bundles no Temporal polyfill: it reads `globalThis.Temporal`. Node 22 and 24 do not ship
// Temporal natively, so install the polyfill when the runtime lacks it (a no-op where it is native).
globalThis.Temporal ??= Temporal;

const gantt = createGantt({
  tasks: [
    { id: toTaskId('design'), name: 'Design', start: '2026-08-03', end: '2026-08-05', progress: 1, type: 'task' },
    { id: toTaskId('build'), name: 'Build', start: '2026-08-05', end: '2026-08-10', progress: 0, type: 'task' },
  ],
  dependencies: [{ from: toTaskId('design'), to: toTaskId('build'), type: 'FS' }],
});

const { criticalTaskIds, projectEnd } = gantt.computeCriticalPath();

console.log('Critical path:', criticalTaskIds.join(' -> '));
console.log('Project end:  ', projectEnd.toString());
