// The identical 5-task / 2-dependency dataset shared by all three example apps.
// Keep in sync with examples/plain-html-demo/src/main.ts.
//
// IMPORTANT (React): these arrays are declared at MODULE scope, not inside the component.
// `@fluxgantt/react`'s `tasks`/`dependencies` are uncontrolled (read once at construction);
// a fresh array identity on every render triggers the wrapper's dev-only "changed identity
// after construction" warning. Module scope gives them a stable identity.
import { toTaskId } from '@fluxgantt/core';
import type { TaskInput, DependencyInput } from '@fluxgantt/core';

export const tasks: TaskInput[] = [
  { id: toTaskId('design'), name: 'Design', start: '2026-08-03', end: '2026-08-05', progress: 1, type: 'task' },
  { id: toTaskId('build'), name: 'Build', start: '2026-08-05', end: '2026-08-10', progress: 0.6, type: 'task' },
  { id: toTaskId('review'), name: 'Review', start: '2026-08-10', end: '2026-08-12', progress: 0, type: 'task' },
  { id: toTaskId('launch'), name: 'Launch', start: '2026-08-12', end: '2026-08-12', progress: 0, type: 'milestone' },
  { id: toTaskId('docs-task'), name: 'Write docs', start: '2026-08-06', end: '2026-08-11', progress: 0.2, type: 'task' },
];

export const dependencies: DependencyInput[] = [
  { from: toTaskId('design'), to: toTaskId('build'), type: 'FS' },
  { from: toTaskId('build'), to: toTaskId('review'), type: 'FS' },
];
