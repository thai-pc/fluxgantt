// Canvas-mode drag fixture (spec-canvas-drag.md §11) — driven by `tests/e2e/canvas-drag.spec.ts`,
// `tests/mobile/canvas-drag.spec.ts`, `tests/a11y/canvas-drag.spec.ts`,
// `tests/visual/canvas-drag-preview.spec.ts` and `tests/performance/canvas-drag.spec.ts`.
//
// Unlike the other fixtures this one defaults to the Canvas renderer (`pad=2100` crosses
// `CANVAS_AUTO_SWITCH_THRESHOLD`): there is deliberately no public "force renderer" config, and
// task count is the only switch input, so padding is the way through the real `mount()`.
//
// Query params:
//   ?pad=N        filler task count (default 2100 -> Canvas; pass 0 for the SVG twin)
//   ?readonly=1   `readOnly: true`
//   ?nodeplink=1  `enableDependencyDrag: false`
//   ?edithooks=1  also compose `withEditHooks()`
//   ?responsive=1 also compose `withResponsive()` (touch arbitration + coarse zones)
//   ?theme=dark   also compose `withTheme()` and select the dark theme (overlay colour checks)
//
// `window.__fx.barBox(id)` returns a bar's rectangle in VIEWPORT coordinates, computed with the
// renderer's own exported layout functions: a Canvas bar has no DOM node to measure.
import './temporal.js'; // must stay first: installs globalThis.Temporal where it is not native
import { createGantt, toTaskId, DEFAULT_CALENDAR, type TaskInput } from '@fluxgantt/core';
import {
  withRender,
  createTimeScale,
  deriveTimeRange,
  layoutRows,
  layoutTaskBar,
  ROW_HEIGHT,
} from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withViewport } from '@fluxgantt/core/viewport';
import { withEditHooks } from '@fluxgantt/core/edit-hooks';
import { withResponsive } from '@fluxgantt/core/responsive';
import { withTheme } from '@fluxgantt/core/theme';

const params = new URLSearchParams(window.location.search);
const pad = Number(params.get('pad') ?? '2100');
const HEADER_HEIGHT = 32;

const leaf = (id: string, name: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: toTaskId(id),
  name,
  start,
  end,
  progress: 0.4,
  type: 'task',
  ...extra,
});
const named: TaskInput[] = [
  leaf('a', 'Alpha', '2026-08-03', '2026-08-07'),
  leaf('b', 'Bravo', '2026-08-10', '2026-08-14'),
  leaf('c', 'Charlie', '2026-08-17', '2026-08-21'),
  leaf('d', 'Delta', '2026-08-24', '2026-08-28'),
  leaf('ms', 'Milestone', '2026-08-12', '2026-08-12', { type: 'milestone', progress: 0 }),
  leaf('sum', 'Summary', '2026-08-03', '2026-08-07', { type: 'summary' }),
  leaf('x', 'Child X', '2026-08-03', '2026-08-05', { parent: toTaskId('sum') }),
  leaf('y', 'Child Y', '2026-08-05', '2026-08-07', { parent: toTaskId('sum') }),
];
const filler: TaskInput[] = Array.from({ length: Math.max(0, pad) }, (_, i) => ({
  id: toTaskId(`filler-${i}`),
  name: `Filler ${i}`,
  start: `2026-09-${String((i % 14) + 1).padStart(2, '0')}`,
  end: `2026-09-${String((i % 14) + 2).padStart(2, '0')}`,
  progress: 0,
  type: 'task' as const,
}));

const responsive = params.get('responsive') === '1';
let gantt = withViewport(
  withInteraction(
    withRender(
      createGantt({
        tasks: [...named, ...filler],
        dependencies: [{ from: toTaskId('c'), to: toTaskId('d'), type: 'FS' }],
        ...(params.get('readonly') === '1' ? { readOnly: true } : {}),
        ...(params.get('nodeplink') === '1' ? { enableDependencyDrag: false } : {}),
        ariaLabel: 'Canvas drag demo project',
      }),
    ),
  ),
);
const withHooks = params.get('edithooks') === '1' ? withEditHooks(gantt) : gantt;
const responsiveInstance = responsive ? withResponsive(withHooks) : withHooks;
const themeParam = params.get('theme');
const themed = withTheme(responsiveInstance);
const instance = themeParam ? themed : responsiveInstance;
if (themeParam === 'dark' || themeParam === 'light') themed.setTheme(themeParam);
gantt = instance as unknown as typeof gantt;

interface LogEntry {
  readonly name: string;
  readonly payload: Record<string, unknown>;
}
const events: LogEntry[] = [];
const on = gantt.on.bind(gantt) as unknown as (name: string, cb: (p: unknown) => void) => void;
for (const name of ['task:moved', 'task:resized', 'dependency:added', 'task:context-requested', 'selection:changed']) {
  on(name, (p) => {
    const payload: Record<string, unknown> = {};
    if (Array.isArray(p)) payload['ids'] = [...p];
    else if (name === 'task:moved' || name === 'task:resized') payload['taskId'] = (p as { id: string }).id;
    else if (name === 'dependency:added') {
      const d = p as { from: string; to: string };
      payload['from'] = d.from;
      payload['to'] = d.to;
    } else {
      for (const [k, v] of Object.entries((p ?? {}) as Record<string, unknown>)) {
        if (typeof v !== 'function') payload[k] = v;
      }
    }
    events.push({ name, payload });
  });
}

gantt.mount(document.getElementById('gantt')!);

const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
function barBox(id: string): { x: number; y: number; w: number; h: number } | undefined {
  const tasks = gantt.getTasks();
  const viewMode = gantt.getViewMode();
  const scale = createTimeScale(deriveTimeRange(tasks, viewMode, DEFAULT_CALENDAR), viewMode, DEFAULT_CALENDAR);
  const density = responsive && coarse ? 'touch' : 'default';
  const rowHeight = ROW_HEIGHT[density];
  const row = layoutRows(tasks, density, new Set()).find((r) => r.task.id === id);
  const canvas = document.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas');
  const container = document.getElementById('gantt');
  if (!row || !canvas || !container) return undefined;
  const bar = layoutTaskBar(row.task, scale, row, rowHeight);
  const labelWidth = responsive ? (instance as unknown as { getLabelColumnWidth(): number }).getLabelColumnWidth() : 160;
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + labelWidth + bar.x,
    y: rect.top + HEADER_HEIGHT + bar.y - container.scrollTop,
    w: bar.width,
    h: bar.height,
  };
}

if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w['__gantt'] = gantt;
  w['__events'] = events;
  w['__fx'] = { barBox, pxPerDay: 24 };
}
