// Conflict-detection e2e + a11y fixture (T3 detect-conflicts). Composes the real public surface:
// withConflicts(withViewport(withInteraction(withRender(createGantt())))).
//
// Query params:
//   ?mode=manual|auto  `GanttConfig.schedulingMode` (default manual). Manual lets a drag create a
//                      dependency violation; auto cascades successors instead.
//   ?seed=conflict     `b` starts BEFORE `a` ends, so the chart already has one dependency
//                      violation at construction (exercises the silent-baseline rule).
//   ?listen=0          the page does not subscribe to `conflict:detected`; the list is rendered
//                      once from `detectConflicts()`. The spec subscribes itself afterwards.
//   ?pad=N             N flat filler rows (2100 => Canvas renderer).
//
// The status line is a polite live region carrying the COUNT in words, and the list repeats each
// conflict as text (kind + ids), so nothing is conveyed by color. All strings go through
// `textContent` (ids are user data).
import { Temporal } from '@js-temporal/polyfill';
import { createGantt, toTaskId, type Conflict, type TaskInput } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withViewport } from '@fluxgantt/core/viewport';
import { withConflicts } from '@fluxgantt/core/conflicts';

(globalThis as { Temporal?: typeof Temporal }).Temporal ??= Temporal;

const params = new URLSearchParams(window.location.search);
const schedulingMode = params.get('mode') === 'auto' ? 'auto' : 'manual';
const seeded = params.get('seed') === 'conflict';
const listen = params.get('listen') !== '0';
const pad = Math.max(0, Number(params.get('pad') ?? '0'));

const named: TaskInput[] = [
  { id: toTaskId('phase'), name: 'Phase', start: '2026-08-03', end: '2026-08-14', progress: 0, type: 'summary' },
  {
    id: toTaskId('a'),
    name: 'Task A',
    start: '2026-08-03',
    end: '2026-08-05',
    progress: 0,
    type: 'task',
    parent: toTaskId('phase'),
  },
  {
    id: toTaskId('b'),
    name: 'Task B',
    start: seeded ? '2026-08-04' : '2026-08-05',
    end: seeded ? '2026-08-07' : '2026-08-10',
    progress: 0,
    type: 'task',
    parent: toTaskId('phase'),
  },
  {
    id: toTaskId('c'),
    name: 'Task C',
    start: '2026-08-10',
    end: '2026-08-12',
    progress: 0,
    type: 'task',
    parent: toTaskId('phase'),
  },
];

const filler: TaskInput[] = Array.from({ length: pad }, (_, i) => ({
  id: toTaskId(`filler-${i}`),
  name: `Filler ${i}`,
  start: `2026-09-${String((i % 14) + 1).padStart(2, '0')}`,
  end: `2026-09-${String((i % 14) + 2).padStart(2, '0')}`,
  progress: 0,
  type: 'task' as const,
}));

const gantt = withConflicts(
  withViewport(
    withInteraction(
      withRender(
        createGantt({
          schedulingMode,
          tasks: [...named, ...filler],
          dependencies: [
            { from: toTaskId('a'), to: toTaskId('b'), type: 'FS' },
            { from: toTaskId('b'), to: toTaskId('c'), type: 'FS' },
          ],
        }),
      ),
    ),
  ),
);

const statusEl = document.getElementById('conflict-status')!;
const listEl = document.getElementById('conflict-list')!;

function describe(c: Conflict): string {
  switch (c.kind) {
    case 'dependency-violation':
      return `Dependency violation: ${c.to} starts before ${c.from} allows (${c.dependencyType})`;
    case 'outside-parent':
      return `Outside parent: ${c.taskId} leaves ${c.parentId} (${c.edge})`;
    case 'invalid-span':
      return `Invalid span: ${c.taskId} ends before it starts`;
    default:
      return 'Conflict';
  }
}

function render(conflicts: readonly Conflict[]): void {
  statusEl.textContent =
    conflicts.length === 0 ? 'No schedule conflicts' : `${conflicts.length} schedule conflict${conflicts.length === 1 ? '' : 's'}`;
  listEl.replaceChildren(
    ...conflicts.map((c) => {
      const li = document.createElement('li');
      li.textContent = describe(c);
      return li;
    }),
  );
}

render(gantt.detectConflicts());
if (listen) gantt.on('conflict:detected', render);

gantt.mount(document.getElementById('gantt')!);

if (import.meta.env.DEV) {
  (window as unknown as { __gantt?: typeof gantt }).__gantt = gantt;
}
