// Responsive/touch fixture — driven by the `mobile` Playwright project (`tests/mobile/`).
// Composes the full editable stack plus `withResponsive()`, which is the only page in this demo
// that does: every other fixture must keep rendering at the default 160px label column and
// `'default'` density, since they are what the visual-regression baselines were captured against.
//
// The dataset is deliberately WIDE (a ~5-month span at the default `'week'` view mode) so the
// chart overflows a 393px viewport by a large factor. That is what makes the pan specs meaningful:
// on a dataset that fits, `container.scrollLeft` cannot move and "a drag on the grid pans" would
// pass vacuously.
import { createGantt, toTaskId } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withResponsive } from '@fluxgantt/core/responsive';

const gantt = withResponsive(
  withInteraction(
    withRender(
      createGantt({
        tasks: [
          {
            id: toTaskId('design'),
            name: 'Design system',
            start: '2026-03-02',
            end: '2026-03-20',
            progress: 0.6,
            type: 'task',
          },
          {
            id: toTaskId('build'),
            name: 'Build the renderer',
            start: '2026-03-23',
            end: '2026-05-01',
            progress: 0.3,
            type: 'task',
          },
          {
            id: toTaskId('test'),
            name: 'Test on devices',
            start: '2026-05-04',
            end: '2026-06-05',
            progress: 0,
            type: 'task',
          },
          {
            id: toTaskId('launch'),
            name: 'Launch',
            start: '2026-07-01',
            end: '2026-07-01',
            progress: 0,
            type: 'milestone',
          },
        ],
        dependencies: [
          { from: toTaskId('design'), to: toTaskId('build'), type: 'FS' },
          { from: toTaskId('build'), to: toTaskId('test'), type: 'FS' },
          { from: toTaskId('test'), to: toTaskId('launch'), type: 'FS' },
        ],
        ariaLabel: 'Responsive demo project',
      }),
    ),
  ),
);

gantt.mount(document.querySelector<HTMLElement>('#gantt')!);

// Dev-only handle, matching the other harnesses — lets a spec read `isCoarsePointer()` and
// `getLabelColumnWidth()` without inventing a data attribute for either.
(window as unknown as { __gantt: typeof gantt }).__gantt = gantt;
