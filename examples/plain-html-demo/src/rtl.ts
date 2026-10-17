// Right-to-left fixture (spec-rtl-chart.md) — driven by `tests/{e2e,visual,a11y,mobile}/rtl.spec.ts`
// and the docs page "Right-to-left charts". An Arabic (or Hebrew) project plan composed with
// `withRtl()`. Translated built-in strings are NOT a core feature: the host supplies them through
// `messages.taskLabel`, exactly as `i18n.ts` does.
//
// Query params:
//   ?lang=he      Hebrew data + locale instead of Arabic
//   ?rtl=0        the LTR twin (same data, `rtl: false`) for side-by-side comparisons
//   ?pad=N        filler task count (default 0 -> SVG; pass 2100 for the Canvas renderer)
//   ?readonly=1   `readOnly: true`
//   ?responsive=1 also compose `withResponsive()`
//   ?theme=dark   also compose `withTheme()` and select the dark theme
import './temporal.js'; // must stay first: installs globalThis.Temporal where it is not native
import { createGantt, toTaskId, type TaskInput } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withViewport } from '@fluxgantt/core/viewport';
import { withIo } from '@fluxgantt/core/io';
import { withResponsive } from '@fluxgantt/core/responsive';
import { withTheme } from '@fluxgantt/core/theme';
import { withRtl } from '@fluxgantt/core/rtl';

const params = new URLSearchParams(window.location.search);
const hebrew = params.get('lang') === 'he';
const rtl = params.get('rtl') !== '0';
const pad = Number(params.get('pad') ?? '0');
// The LTR twin must not inherit the page's `dir="rtl"` (an LTR chart in an RTL host is a different,
// unsupported scroll model): flip the page too.
if (!rtl) document.documentElement.dir = 'ltr';

const names = hebrew
  ? ['תכנון הפרויקט', 'איסוף דרישות', 'עיצוב', 'פיתוח', 'בדיקות', 'תיעוד', 'השקה']
  : ['تخطيط المشروع', 'جمع المتطلبات', 'التصميم', 'التطوير', 'الاختبار', 'التوثيق', 'الإطلاق'];
const [plan, req, design, dev, test, docs, launch] = names as [string, string, string, string, string, string, string];

const task = (id: string, name: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: toTaskId(id),
  name,
  start,
  end,
  progress: 0.4,
  type: 'task',
  ...extra,
});

const filler: TaskInput[] = Array.from({ length: Math.max(0, pad) }, (_, i) => ({
  id: toTaskId(`filler-${i}`),
  name: `${hebrew ? 'משימה' : 'مهمة'} ${i}`,
  start: `2026-07-${String((i % 14) + 1).padStart(2, '0')}`,
  end: `2026-07-${String((i % 14) + 2).padStart(2, '0')}`,
  progress: 0,
  type: 'task' as const,
}));

const base = withViewport(
  withIo(
    withInteraction(
      withRender(
        createGantt({
          tasks: [
            task('plan', plan, '2026-03-02', '2026-06-05', { type: 'summary' }),
            task('req', req, '2026-03-02', '2026-03-13', { parent: toTaskId('plan'), progress: 1 }),
            task('design', design, '2026-03-16', '2026-04-03', { parent: toTaskId('plan'), progress: 0.7 }),
            task('dev', dev, '2026-04-06', '2026-05-15', { parent: toTaskId('plan') }),
            task('docs', docs, '2026-04-13', '2026-05-29', { parent: toTaskId('plan'), progress: 0.1 }),
            task('test', test, '2026-05-18', '2026-06-05', { parent: toTaskId('plan'), progress: 0 }),
            task('launch', launch, '2026-06-08', '2026-06-08', { type: 'milestone', progress: 0 }),
            ...filler,
          ],
          dependencies: [
            { from: toTaskId('req'), to: toTaskId('design'), type: 'FS' },
            { from: toTaskId('design'), to: toTaskId('dev'), type: 'FS' },
            { from: toTaskId('dev'), to: toTaskId('docs'), type: 'SS' },
            { from: toTaskId('dev'), to: toTaskId('test'), type: 'FS' },
            { from: toTaskId('test'), to: toTaskId('launch'), type: 'FS' },
          ],
          locale: hebrew ? 'he' : 'ar',
          rtl,
          ariaLabel: hebrew ? 'תוכנית הפרויקט' : 'خطة المشروع',
          ...(params.get('readonly') === '1' ? { readOnly: true } : {}),
          messages: {
            taskLabel: ({ name, startLabel, endLabel, progressPct }) =>
              hebrew
                ? `${name} — ${startLabel} עד ${endLabel}, הושלם ${progressPct}%`
                : `${name} — من ${startLabel} إلى ${endLabel}، مكتمل ${progressPct}%`,
          },
        }),
      ),
    ),
  ),
);

const themeParam = params.get('theme');
const responsive = params.get('responsive') === '1' ? withResponsive(base) : base;
const themed = withTheme(responsive);
if (themeParam === 'dark' || themeParam === 'light') themed.setTheme(themeParam);
const gantt = withRtl(themeParam ? themed : responsive);

interface LogEntry {
  readonly name: string;
  readonly payload: Record<string, unknown>;
}
const events: LogEntry[] = [];
const on = gantt.on.bind(gantt) as unknown as (name: string, cb: (p: unknown) => void) => void;
for (const name of ['task:moved', 'task:resized', 'dependency:added', 'selection:changed']) {
  on(name, (p) => {
    const payload: Record<string, unknown> = {};
    if (Array.isArray(p)) payload['ids'] = [...p];
    else if (name === 'dependency:added') {
      const d = p as { from: string; to: string };
      payload['from'] = d.from;
      payload['to'] = d.to;
    } else payload['taskId'] = (p as { id: string }).id;
    events.push({ name, payload });
  });
}

gantt.mount(document.getElementById('gantt')!);

if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w['__gantt'] = gantt;
  w['__events'] = events;
}
