// Dev-only host page for `tooling/scripts/capture-launch-assets.mjs` (the Product Hunt / Show HN
// GIFs). NOT a rollup input in vite.config.ts, so it is served by `vite dev` and absent from
// `vite build`; no spec or visual baseline touches it.
//
// Why it exists instead of recording `/`: the quick-start page runs in the default `manual`
// scheduling mode, where dragging a predecessor over its successor leaves a dependency violation
// instead of pushing the successor. The "dependency cascade" GIF needs `schedulingMode: 'auto'`,
// and a 9-task project with two parallel chains (so the critical path can visibly re-route) reads
// better than the 5-task starter data. Everything else is the same stack as main.ts.
import './temporal.js';
import { createGantt, toTaskId, type TaskInput } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withTheme } from '@fluxgantt/core/theme';

const id = toTaskId;
const t = (taskId: string, name: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: id(taskId), name, start, end, progress: 0, type: 'task', ...extra,
});

const gantt = withTheme(
  withInteraction(
    withRender(
      createGantt({
        schedulingMode: 'auto',
        density: 'comfortable',
        tasks: [
          t('disc', 'Discovery', '2026-11-02', '2026-11-11', { type: 'summary' }),
          t('research', 'User research', '2026-11-02', '2026-11-06', { parent: id('disc'), progress: 1 }),
          t('wire', 'Wireframes', '2026-11-06', '2026-11-11', { parent: id('disc'), progress: 0.8 }),
          t('build', 'Build', '2026-11-11', '2026-11-24', { type: 'summary' }),
          t('frontend', 'Frontend build', '2026-11-11', '2026-11-20', { parent: id('build'), progress: 0.4 }),
          t('api', 'API integration', '2026-11-11', '2026-11-16', { parent: id('build'), progress: 0.3 }),
          t('docs', 'Write docs', '2026-11-11', '2026-11-16', { progress: 0.2 }),
          t('qa', 'QA & fixes', '2026-11-20', '2026-11-24'),
          t('launch', 'Launch', '2026-11-24', '2026-11-24', { type: 'milestone' }),
        ],
        dependencies: [
          { from: id('research'), to: id('wire'), type: 'FS' },
          { from: id('wire'), to: id('frontend'), type: 'FS' },
          { from: id('wire'), to: id('api'), type: 'FS' },
          { from: id('frontend'), to: id('qa'), type: 'FS' },
          { from: id('api'), to: id('qa'), type: 'FS' },
          { from: id('qa'), to: id('launch'), type: 'FS' },
        ],
      }),
    ),
  ),
);
gantt.mount(document.getElementById('gantt')!);

// The page chrome follows the resolved chart theme, same as main.ts (style.css keys off it).
const button = document.getElementById('theme-toggle') as HTMLButtonElement;
const sync = (): void => { document.documentElement.dataset['theme'] = gantt.getResolvedTheme(); };
button.addEventListener('click', () => {
  gantt.setTheme(({ auto: 'light', light: 'dark', dark: 'auto' } as const)[gantt.getTheme()]);
  sync();
});
sync();

// Dev-only handle (stripped from builds, like main.ts's) so the capture script can sanity-check
// the recorded state against the engine.
if (import.meta.env.DEV) (window as unknown as { __gantt?: typeof gantt }).__gantt = gantt;
