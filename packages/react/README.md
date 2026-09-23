# @fluxgantt/react

The React wrapper for [FluxGantt](https://github.com/thai-pc/fluxgantt) — a TypeScript-first,
MIT-licensed Gantt chart library. Provides a `<FluxGantt>` component and a `useFluxGantt` hook
over the headless [`@fluxgantt/core`](https://www.npmjs.com/package/@fluxgantt/core) engine.

- **Docs:** https://thai-pc.github.io/fluxgantt/docs/frameworks/react
- **Repository:** https://github.com/thai-pc/fluxgantt

## Install

```bash
pnpm add @fluxgantt/react @fluxgantt/core
```

Peer dependencies: `react` and `react-dom`, `^18.2.0 || ^19.0.0`.

## Usage

```tsx
import { FluxGantt } from '@fluxgantt/react';
import { toTaskId } from '@fluxgantt/core';
import type { TaskInput, DependencyInput } from '@fluxgantt/core';

// Declare data at MODULE scope — props are uncontrolled, see below.
const tasks: TaskInput[] = [
  { id: toTaskId('design'), name: 'Design', start: '2026-08-03', end: '2026-08-05', progress: 1, type: 'task' },
  { id: toTaskId('build'), name: 'Build', start: '2026-08-05', end: '2026-08-10', progress: 0.6, type: 'task' },
  { id: toTaskId('review'), name: 'Review', start: '2026-08-10', end: '2026-08-12', progress: 0, type: 'task' },
];

const dependencies: DependencyInput[] = [
  { from: toTaskId('design'), to: toTaskId('build'), type: 'FS' },
  { from: toTaskId('build'), to: toTaskId('review'), type: 'FS' },
];

export function App() {
  return (
    <FluxGantt
      tasks={tasks}
      dependencies={dependencies}
      style={{ height: 420 }}
      onTaskMoved={(task, prevStart) => console.log(`${task.name} moved from ${prevStart}`)}
    />
  );
}
```

## Uncontrolled data

`tasks`, `dependencies`, `calendar`, `viewMode`, `density`, `locale`, `ariaLabel`, `messages` and
`readOnly` are **read once**, when the underlying `GanttInstance` is created. The instance is the
source of truth afterward — there is no prop→store diffing. So declare `tasks`/`dependencies`
outside the component (module scope, `useMemo` or `useState`), and mutate through the instance —
`useFluxGantt()` returns a ref to it. Event callbacks stay reactive and may be fresh inline arrows
on every render.

Full prop table, the `useFluxGantt` hook, and the uncontrolled-data rationale:
[the React docs page](https://thai-pc.github.io/fluxgantt/docs/frameworks/react).

## License

MIT
