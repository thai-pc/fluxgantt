// Collapse/expand e2e + a11y fixture (spec-collapse-expand.md §9.9/§9.10). Distinct dataset from
// `selection.ts`'s on purpose: collapse/expand needs a THREE-level hierarchy (grandparent →
// parent → leaf) so the specs can assert that collapsing an ancestor hides a whole subtree, not
// just direct children — the one case a 2-level fixture cannot distinguish from "hide my
// children".
//
// Query params:
//   ?pad=N   — append N flat, hierarchy-free filler tasks after the named rows. Its only purpose
//              is to push the total task count past `CANVAS_AUTO_SWITCH_THRESHOLD` (2000) so
//              `mount()` picks the Canvas renderer: there is deliberately no public
//              "force renderer" config (spec-canvas-auto-switch.md), and task count is the sole
//              switch input, so padding the dataset is the only way to exercise the Canvas path
//              through the REAL public `mount()` the specs are meant to test. The named rows stay
//              at the top in a fixed order either way, so both renderers run the same assertions.
//   ?collapsed=a,b — ids passed verbatim as `GanttConfig.initialCollapsed`, exercising the
//              construction-time headless path (§3.3) rather than a post-mount toggle.
import { Temporal } from '@js-temporal/polyfill';
import { createGantt, toTaskId, type TaskInput } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';

// `@fluxgantt/core` treats Temporal as an optional peerDependency and reads `globalThis.Temporal`
// — installing it is the HOST APP's job. Guarded (`??=`) so this is a no-op on runtimes that
// already ship native `Temporal` (this repo's Playwright Chromium), matching every other harness.
(globalThis as { Temporal?: typeof Temporal }).Temporal ??= Temporal;

const params = new URLSearchParams(window.location.search);
const pad = Number(params.get('pad') ?? '0');
const collapsedParam = params.get('collapsed');

// Rows 0-5, in layout order. `phase-1` (summary) → `group-a` (summary) → two leaves, then a
// second direct leaf child of `phase-1`, then one unrelated top-level leaf.
const named: TaskInput[] = [
  {
    id: toTaskId('phase-1'),
    name: 'Phase 1',
    start: '2026-08-03',
    end: '2026-08-14',
    progress: 0.4,
    type: 'summary',
  },
  {
    id: toTaskId('group-a'),
    name: 'Group A',
    start: '2026-08-03',
    end: '2026-08-07',
    progress: 0.5,
    type: 'summary',
    parent: toTaskId('phase-1'),
  },
  {
    id: toTaskId('leaf-a1'),
    name: 'Leaf A1',
    start: '2026-08-03',
    end: '2026-08-05',
    progress: 1,
    type: 'task',
    parent: toTaskId('group-a'),
  },
  {
    id: toTaskId('leaf-a2'),
    name: 'Leaf A2',
    start: '2026-08-05',
    end: '2026-08-07',
    progress: 0,
    type: 'task',
    parent: toTaskId('group-a'),
  },
  {
    id: toTaskId('leaf-b'),
    name: 'Leaf B',
    start: '2026-08-08',
    end: '2026-08-10',
    progress: 0,
    type: 'task',
    parent: toTaskId('phase-1'),
  },
  {
    id: toTaskId('standalone'),
    name: 'Standalone',
    start: '2026-08-11',
    end: '2026-08-14',
    progress: 0,
    type: 'task',
  },
];

// Filler stays flat and confined to a narrow date window so padding to >2000 rows does not blow
// up the canvas's WIDTH (the height is already row-band-virtualized, fix #37).
const filler: TaskInput[] = Array.from({ length: Math.max(0, pad) }, (_, i) => ({
  id: toTaskId(`filler-${i}`),
  name: `Filler ${i}`,
  start: `2026-09-${String((i % 14) + 1).padStart(2, '0')}`,
  end: `2026-09-${String((i % 14) + 2).padStart(2, '0')}`,
  progress: 0,
  type: 'task' as const,
}));

const initialCollapsed = (collapsedParam ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map(toTaskId);

const gantt = withInteraction(
  withRender(
    createGantt({
      tasks: [...named, ...filler],
      ...(initialCollapsed.length > 0 ? { initialCollapsed } : {}),
    }),
  ),
);

gantt.mount(document.getElementById('gantt')!);

if (import.meta.env.DEV) {
  (window as unknown as { __gantt?: typeof gantt }).__gantt = gantt;
}
