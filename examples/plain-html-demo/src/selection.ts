// Selection e2e/visual fixture — the Playwright `selection.spec.ts` (tests/e2e) and the
// `.fg-task--selected` snapshots in `tests/visual/timeline.spec.ts` drive this page. Distinct
// dataset from `main.ts`'s quick-start on purpose: this one needs (a) a 2-level hierarchy
// (parent + 2 children) to exercise parent-implies-children selection expansion
// (spec-selection.md §3), and (b) 3+ top-level sibling rows with no hierarchy relationship so
// Shift-click range-select has an unambiguous contiguous row range to assert against.
import { createGantt, toTaskId } from '@fluxgantt/core';

const gantt = createGantt({
  tasks: [
    // Row 0 — parent (summary). Selecting this must also select rows 1 and 2 (its children).
    {
      id: toTaskId('phase-1'),
      name: 'Phase 1',
      start: '2026-08-03',
      end: '2026-08-07',
      progress: 0.5,
      type: 'summary',
    },
    // Row 1 — child of phase-1.
    {
      id: toTaskId('phase-1-task-a'),
      name: 'Phase 1 · Task A',
      start: '2026-08-03',
      end: '2026-08-05',
      progress: 1,
      type: 'task',
      parent: toTaskId('phase-1'),
    },
    // Row 2 — child of phase-1.
    {
      id: toTaskId('phase-1-task-b'),
      name: 'Phase 1 · Task B',
      start: '2026-08-05',
      end: '2026-08-07',
      progress: 0,
      type: 'task',
      parent: toTaskId('phase-1'),
    },
    // Rows 3-5 — three flat sibling tasks (no parent), for Shift-click range-select.
    {
      id: toTaskId('sibling-a'),
      name: 'Sibling A',
      start: '2026-08-08',
      end: '2026-08-10',
      progress: 0,
      type: 'task',
    },
    {
      id: toTaskId('sibling-b'),
      name: 'Sibling B',
      start: '2026-08-10',
      end: '2026-08-12',
      progress: 0,
      type: 'task',
    },
    {
      id: toTaskId('sibling-c'),
      name: 'Sibling C',
      start: '2026-08-12',
      end: '2026-08-14',
      progress: 0,
      type: 'task',
    },
  ],
});

gantt.mount(document.getElementById('gantt')!);

if (import.meta.env.DEV) {
  (window as unknown as { __gantt?: typeof gantt }).__gantt = gantt;
}
