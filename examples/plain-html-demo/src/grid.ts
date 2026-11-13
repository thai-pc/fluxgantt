// Grid columns fixture (spec-grid-columns.md) — driven by `tests/{e2e,visual,a11y,performance}/grid.spec.ts`.
// A small project plan composed with `withGrid()`.
//
// Query params:
//   ?rtl=1        mirror the chart (`withRtl`); the page is flipped to `dir=rtl` too
//   ?cols=N       how many columns: 1 (name only), 3, 5 (default), 6 (adds owner) or 10 (adds more custom ones)
//   ?rows=N       task count (default 7 named tasks; N > 7 pads with flat filler tasks, for the perf budgets)
//   ?long=1       long names and a long custom value (truncation)
//   ?collapse=N   `collapseBelow` (default 480; 0 disables)
//   ?locale=xx    `GanttConfig.locale`
//   ?hours=1      `durationUnit: 'hours'`
//   ?theme=dark   also compose `withTheme` and select the dark theme
//   ?responsive=1 also compose `withResponsive`
//   ?tz=Zone      calendar time zone (default UTC)
//   ?wide=1       spread the filler tasks over ~520 days and add 20 holidays (the PR #125 duration trap)
//   ?grid=0       do not compose withGrid (the baseline for the performance budgets)
import './temporal.js'; // must stay first: installs globalThis.Temporal where it is not native
import { createGantt, computeRollup, toTaskId, type TaskInput, type WorkingCalendar } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withViewport } from '@fluxgantt/core/viewport';
import { withIo } from '@fluxgantt/core/io';
import { withResponsive } from '@fluxgantt/core/responsive';
import { withTheme } from '@fluxgantt/core/theme';
import { withRtl } from '@fluxgantt/core/rtl';
import { withGrid, type GridColumnInput } from '@fluxgantt/core/grid';

const params = new URLSearchParams(window.location.search);
const rtl = params.get('rtl') === '1';
const long = params.get('long') === '1';
const cols = Number(params.get('cols') ?? '5');
const rows = Number(params.get('rows') ?? '0');
const collapse = Number(params.get('collapse') ?? '480');
if (rtl) document.documentElement.dir = 'rtl';

const wide = params.get('wide') === '1';
const isoDay = (offset: number): string => new Date(Date.UTC(2026, 1, 1) + offset * 86_400_000).toISOString().slice(0, 10);
const calendar: WorkingCalendar = {
  workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  workingHours: [{ start: '09:00', end: '17:00' }],
  holidays: wide ? Array.from({ length: 20 }, (_, i) => isoDay(10 + i * 25)) : ['2026-05-01'],
  timezone: params.get('tz') ?? 'UTC',
};

const task = (id: string, name: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: toTaskId(id),
  name: long ? `${name}: an unusually long task name that has to be cut with an ellipsis` : name,
  start,
  end,
  progress: 0.4,
  type: 'task',
  meta: { owner: ['Ana', 'Ben', 'Chi', 'Dee'][id.length % 4], status: 'open' },
  ...extra,
});

const named: TaskInput[] = [
  task('plan', 'Project plan', '2026-03-02', '2026-06-05', { type: 'summary' }),
  task('req', 'Requirements', '2026-03-02', '2026-03-13', { parent: toTaskId('plan'), progress: 1 }),
  task('design', 'Design', '2026-03-16', '2026-04-03', { parent: toTaskId('plan'), progress: 0.7 }),
  task('dev', 'Development', '2026-04-06', '2026-05-15', { parent: toTaskId('plan') }),
  task('docs', 'Documentation', '2026-04-13', '2026-05-29', { parent: toTaskId('plan'), progress: 0.1 }),
  task('test', 'Testing', '2026-05-18', '2026-06-05', { parent: toTaskId('plan'), progress: 0 }),
  task('launch', 'Launch', '2026-06-08', '2026-06-08', { type: 'milestone', progress: 0 }),
];
const filler: TaskInput[] = Array.from({ length: Math.max(0, rows - named.length) }, (_, i) => ({
  id: toTaskId(`filler-${i}`),
  name: `Filler task ${i}`,
  start: wide ? isoDay((i * 7) % 500) : `2026-${String((i % 8) + 3).padStart(2, '0')}-${String((i % 20) + 1).padStart(2, '0')}`,
  end: wide ? isoDay(((i * 7) % 500) + 3 + (i % 17)) : `2026-${String((i % 8) + 3).padStart(2, '0')}-${String((i % 20) + 6).padStart(2, '0')}`,
  progress: (i % 10) / 10,
  type: 'task' as const,
  meta: { owner: ['Ana', 'Ben', 'Chi', 'Dee'][i % 4], status: i % 3 ? 'open' : 'done' },
}));

const owner: GridColumnInput = {
  id: 'owner',
  header: long ? 'Owner of the work package' : 'Owner',
  width: 120,
  value: (t) => (long ? `${String(t.meta?.['owner'])} - a custom value that is far too long to fit` : String(t.meta?.['owner'])),
};
const extras: GridColumnInput[] = [
  owner,
  { id: 'status', header: 'Status', width: 90, value: (t) => String(t.meta?.['status']) },
  { id: 'c1', header: 'Col 1', width: 80, value: (t) => t.name.length },
  { id: 'c2', header: 'Col 2', width: 80, align: 'center', value: (t) => t.progress },
  { id: 'c3', header: 'Col 3', width: 80, value: (t) => t.id.length },
];
const NAMES = ['name', 'start', 'end', 'duration', 'progress'] as const;
const columns: GridColumnInput[] =
  cols <= 1
    ? [{ id: 'name' }]
    : cols === 3
      ? [{ id: 'name' }, { id: 'start' }, { id: 'progress' }]
      : cols === 5
        ? NAMES.map((id) => ({ id }))
        : [...NAMES.map((id) => ({ id })), ...extras].slice(0, cols);

const base = withIo(
  withViewport(
    withInteraction(
      withRender(
        createGantt({
          tasks: [...named, ...filler],
          dependencies:
            rows > 0
              ? []
              : [
                  { from: toTaskId('req'), to: toTaskId('design'), type: 'FS' },
                  { from: toTaskId('design'), to: toTaskId('dev'), type: 'FS' },
                  { from: toTaskId('dev'), to: toTaskId('test'), type: 'FS' },
                  { from: toTaskId('test'), to: toTaskId('launch'), type: 'FS' },
                ],
          calendar,
          rollup: computeRollup,
          rtl,
          ...(params.get('locale') ? { locale: params.get('locale')! } : {}),
        }),
      ),
    ),
  ),
);

const themeParam = params.get('theme');
const responsive = params.get('responsive') === '1' ? withResponsive(base) : base;
const themed = withTheme(responsive);
if (themeParam === 'dark' || themeParam === 'light') themed.setTheme(themeParam);
if (themeParam) document.documentElement.dataset['theme'] = themed.getResolvedTheme();
const composed = withRtl(themeParam ? themed : responsive);
const gantt = params.get('grid') === '0'
  ? Object.assign(composed, { exportGridCsv: () => '', setGridColumns: (_: GridColumnInput[]) => {} })
  : withGrid(composed, {
      columns,
      collapseBelow: collapse,
      durationUnit: params.get('hours') === '1' ? 'hours' : 'days',
    });

const t0 = performance.now();
gantt.mount(document.getElementById('gantt')!);
const mountMs = performance.now() - t0;

if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w['__gantt'] = gantt;
  w['__fx'] = { mountMs, pxPerDay: 24 };
}
