// Facade-level fixture for the Canvas-mode exportSvg()/exportPng() specs (T2 canvas-export).
// Unlike the other canvas harnesses it composes the REAL public facade:
// withInteraction(withIo(withRender(createGantt()))) + withViewport, imported from the published
// `@fluxgantt/core` subpaths only.
//
// Query params:
//   ?tasks=N      flat 1-day tasks (default 2100 -> Canvas mode; <= 2000 -> SVG mode)
//   ?density=     compact | comfortable (default: library default)
//   ?group=1      task-0 becomes a summary and every other task its child, so
//                 `toggleCollapse('task-0')` drops the visible row count to 1
//   ?hostile=1    task-1 gets an HTML-injection name and a `url(javascript:...)` color
//   ?scale=S      scale passed by the "Export PNG" button (default 1)
//
// Dates are fixed (no dependence on the wall clock for layout); only the today line uses the
// clock. Buttons download through an object URL + `<a download>`. Outcome is mirrored on
// `#export-status` (`data-state`, `data-error`).
import { Temporal } from '@js-temporal/polyfill';
import { createGantt, toTaskId, type TaskInput } from '@fluxgantt/core';
import { withIo } from '@fluxgantt/core/io';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withViewport } from '@fluxgantt/core/viewport';

(globalThis as { Temporal?: typeof Temporal }).Temporal ??= Temporal;

const params = new URLSearchParams(window.location.search);
const count = Math.max(0, Number(params.get('tasks') ?? '2100'));
const group = params.get('group') === '1';
const hostile = params.get('hostile') === '1';
const pngScale = Number(params.get('scale') ?? '1');
const densityParam = params.get('density');

const tasks: TaskInput[] = Array.from({ length: count }, (_, i) => {
  const day = (i % 14) + 1;
  const base: TaskInput = {
    id: toTaskId(`task-${i}`),
    name: `Row ${i}`,
    start: `2026-09-${String(day).padStart(2, '0')}`,
    end: `2026-09-${String(day + 1).padStart(2, '0')}`,
    progress: (i % 5) / 4,
    type: group && i === 0 ? 'summary' : 'task',
    ...(group && i > 0 ? { parent: toTaskId('task-0') } : {}),
  };
  if (hostile && i === 1) {
    return {
      ...base,
      name: '<img src=x onerror=alert(1)><script>alert(2)</script>"&\'',
      color: 'url(javascript:alert(3))',
    };
  }
  return base;
});

const gantt = withViewport(
  withInteraction(
    withIo(
      withRender(
        createGantt({
          tasks,
          ...(densityParam === 'compact' || densityParam === 'comfortable' ? { density: densityParam } : {}),
        }),
      ),
    ),
  ),
);

const status = document.getElementById('export-status')!;

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function report(state: 'ok' | 'error', message = ''): void {
  status.dataset.state = state;
  status.dataset.error = message;
  status.textContent = state === 'ok' ? 'Export finished' : `Export failed: ${message}`;
}

document.getElementById('export-svg')!.addEventListener('click', () => {
  try {
    download(new Blob([gantt.exportSvg()], { type: 'image/svg+xml' }), 'gantt.svg');
    report('ok');
  } catch (e) {
    report('error', e instanceof Error ? e.message : String(e));
  }
});

document.getElementById('export-png')!.addEventListener('click', () => {
  gantt
    .exportPng({ scale: pngScale })
    .then((blob) => {
      download(blob, 'gantt.png');
      report('ok');
    })
    .catch((e: unknown) => report('error', e instanceof Error ? e.message : String(e)));
});

const container = document.getElementById('gantt')!;
const ready = new Promise<void>((resolve) => {
  gantt.on('renderer:selected', () => resolve());
});
gantt.mount(container);

// Always exposed (not DEV-gated is unnecessary: playwright runs the dev server) — the specs also
// need `__ready` to know the Canvas chunk resolved.
void ready.then(() => {
  const w = window as unknown as { __gantt?: typeof gantt; __ready?: boolean };
  w.__gantt = gantt;
  w.__ready = true;
});
