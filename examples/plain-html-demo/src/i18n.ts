// i18n scaffold fixture — driven by `tests/a11y/i18n.spec.ts`. Mounts a chart with a
// Vietnamese `locale`, a host-supplied `ariaLabel`, and a `messages.taskLabel` that REORDERS the
// clauses rather than merely translating them in place. The reordering is the point: it is what
// the old suffix-append label shape could never express, so a fixture that only swapped words
// would not actually exercise the capability under test.
import { createGantt, toTaskId } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';

const gantt = withInteraction(
  withRender(
    createGantt({
      tasks: [
        {
          id: toTaskId('thiet-ke'),
          name: 'Thiết kế giao diện',
          start: '2026-08-03',
          end: '2026-08-07',
          progress: 0.5,
          type: 'task',
        },
        {
          id: toTaskId('trien-khai'),
          name: 'Triển khai',
          start: '2026-08-07',
          end: '2026-08-12',
          progress: 0.25,
          type: 'task',
        },
      ],
      dependencies: [{ from: toTaskId('thiet-ke'), to: toTaskId('trien-khai') }],
      locale: 'vi',
      ariaLabel: 'Kế hoạch dự án',
      messages: {
        // Clause order deliberately differs from the English default: the state flags come
        // FIRST, which no fragment table could produce.
        taskLabel: ({ name, startLabel, endLabel, progressPct, isCritical, isSelected }) => {
          const flags: string[] = [];
          if (isSelected) flags.push('đang chọn');
          if (isCritical) flags.push('đường găng');
          const prefix = flags.length > 0 ? `[${flags.join(', ')}] ` : '';
          return `${prefix}${name} — ${startLabel} đến ${endLabel}, hoàn thành ${progressPct}%`;
        },
      },
    }),
  ),
);

gantt.mount(document.querySelector<HTMLElement>('#gantt')!);

// Dev-only handle, matching the other harnesses — lets a spec read state without a data-attr.
(window as unknown as { __gantt: typeof gantt }).__gantt = gantt;
