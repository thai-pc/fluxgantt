// Canvas renderer visual-regression fixture (spec-canvas-renderer-ticket1.md §9.2).
//
// TEMPORARY FILE — Ticket 1 of `.claude/work/plan-canvas-renderer.md` only. `canvas-renderer.ts`
// is not yet re-exported from `@fluxgantt/core`'s public barrel (it is deliberately inert and
// unwired — see that file's own header comment), so a real npm consumer cannot reach
// `createCanvasRenderer()` today. This harness therefore imports it via a RELATIVE PATH
// directly into workspace SOURCE, bypassing the published package surface — an intentional,
// temporary exception to every other example page in this directory (which import only from
// '@fluxgantt/core'). Expected to be DELETED or REWRITTEN once Ticket 3 lands and wires Canvas
// mode into `createGantt().mount()`'s automatic renderer-selection logic. `toTaskId`/
// `toDependencyId`/`Task`/`Dependency` are still imported from the public package below, since
// those ARE public.
import { Temporal } from '@js-temporal/polyfill';
import { createCanvasRenderer } from '../../../packages/core/src/render/canvas-renderer.js';
import { computeCriticalPath, toTaskId, toDependencyId, type Task, type Dependency } from '@fluxgantt/core';

// `@fluxgantt/core` treats Temporal as an optional peerDependency and reads `globalThis.Temporal`
// (spec-canvas-webkit-dimension-limit.md §13.2 finding, `packages/core/src/internal/temporal.ts`)
// — it is the HOST APP's job to install it. Guarded (`??=`) so this is a no-op wherever the
// runtime already has native `Temporal` (e.g. this repo's Playwright-bundled Chromium build, at
// the time of writing) and only actually installs the polyfill where it's missing (e.g.
// Playwright's bundled WebKit build, which does not yet ship native `Temporal`) — required for
// this harness to run under the new `webkit-canvas-dimension-guard` Playwright project (this
// fixture is reused there for the safe-shape smoke test, per that spec's §13.2).
(globalThis as { Temporal?: typeof Temporal }).Temporal ??= Temporal;

// Reuses the same hierarchy + siblings shape as `selection.ts`'s fixture (2-level hierarchy +
// flat siblings), plus one milestone and one dependency of each FS/SS/FF/SF type, to exercise
// every shape/arrow type in one screenshot. `createCanvasRenderer` is called directly (not via
// `createGantt()`), so `Task.createdAt`/`updatedAt` (normally filled in by the facade) are set
// explicitly here to a fixed instant — this harness never mutates tasks, so the exact value is
// irrelevant to what's screenshotted.
const now = new Date('2026-08-01T00:00:00Z');
const tasks: Task[] = [
  {
    id: toTaskId('phase-1'),
    name: 'Phase 1',
    start: '2026-08-03',
    end: '2026-08-07',
    progress: 0.5,
    type: 'summary',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: toTaskId('phase-1-task-a'),
    name: 'Phase 1 · Task A',
    start: '2026-08-03',
    end: '2026-08-05',
    progress: 1,
    type: 'task',
    parent: toTaskId('phase-1'),
    createdAt: now,
    updatedAt: now,
  },
  {
    id: toTaskId('phase-1-task-b'),
    name: 'Phase 1 · Task B',
    start: '2026-08-05',
    end: '2026-08-07',
    progress: 0,
    type: 'task',
    parent: toTaskId('phase-1'),
    createdAt: now,
    updatedAt: now,
  },
  {
    id: toTaskId('sibling-a'),
    name: 'Sibling A',
    start: '2026-08-08',
    end: '2026-08-10',
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: toTaskId('sibling-b'),
    name: 'Sibling B',
    start: '2026-08-10',
    end: '2026-08-12',
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: toTaskId('sibling-c'),
    name: 'Sibling C',
    start: '2026-08-12',
    end: '2026-08-16',
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: toTaskId('sibling-d'),
    name: 'Sibling D',
    start: '2026-08-16',
    end: '2026-08-18',
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: toTaskId('launch'),
    name: 'Launch',
    start: '2026-08-18',
    end: '2026-08-18',
    progress: 0,
    type: 'milestone',
    createdAt: now,
    updatedAt: now,
  },
];

// One of each FS/SS/FF/SF dependency type.
const dependencies: Dependency[] = [
  { id: toDependencyId('d-ss'), from: toTaskId('phase-1'), to: toTaskId('phase-1-task-a'), type: 'SS' },
  { id: toDependencyId('d-fs'), from: toTaskId('phase-1'), to: toTaskId('sibling-a'), type: 'FS' },
  { id: toDependencyId('d-ff'), from: toTaskId('sibling-b'), to: toTaskId('sibling-c'), type: 'FF' },
  { id: toDependencyId('d-sf'), from: toTaskId('sibling-c'), to: toTaskId('sibling-d'), type: 'SF' },
  { id: toDependencyId('d-launch'), from: toTaskId('sibling-d'), to: toTaskId('launch'), type: 'FS' },
];

const criticalPath = computeCriticalPath(tasks, dependencies, {
  workingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  workingHours: [{ start: '00:00', end: '23:59' }],
  holidays: [],
  timezone: 'UTC',
});

const container = document.getElementById('gantt')!;
const handle = createCanvasRenderer(container, {
  tasks,
  dependencies,
  criticalPath,
  // At least one task with criticalPath/selectedTaskIds both populated → the composed-
  // signals case (critical + selected on the same bar) is covered visually too.
  selectedTaskIds: [toTaskId('sibling-c')],
});

if (import.meta.env.DEV) {
  (window as unknown as { __canvasHandle?: typeof handle }).__canvasHandle = handle;
}
