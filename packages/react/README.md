# @fluxgantt/react

The React wrapper for [FluxGantt](https://github.com/thai-pc/fluxgantt) — a TypeScript-first,
MIT-licensed Gantt chart library. Provides a `<FluxGantt>` component and a `useFluxGantt` hook
over the headless [`@fluxgantt/core`](https://www.npmjs.com/package/@fluxgantt/core) engine.

- **Docs:** https://fluxgantt.thai-pc.com/docs/frameworks/react
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

Every config prop (`tasks`, `dependencies`, `calendar`, `viewMode`, `density`, `locale`, `ariaLabel`, `messages`,
`canvasViewportHeight`, `readOnly`, `enableDependencyDrag`, `schedulingMode`, `historyLimit`, `initialCollapsed`,
`rollup`, e.g. `rollup={computeRollup}` with `computeRollup` from `@fluxgantt/core`) is **read once**, when the underlying `GanttInstance` is created. The instance is the
source of truth afterward — there is no prop→store diffing. So declare `tasks`/`dependencies`
outside the component (module scope, `useMemo` or `useState`), and mutate through the instance —
`useFluxGantt()` returns a ref to it. Event callbacks stay reactive and may be fresh inline arrows
on every render.

`theme` is the other reactive prop: changing it calls `setTheme()` on the instance. It defaults to
`'light'` (not core's `'auto'`, so existing charts do not flip on a dark-mode OS); pass
`theme="auto"` to follow the OS.

Full prop table, the `useFluxGantt` hook, and the uncontrolled-data rationale:
[the React docs page](https://fluxgantt.thai-pc.com/docs/frameworks/react).

## Grid columns (beta)

`@fluxgantt/react/grid` exports `FluxGanttGrid`: `<FluxGantt>` with the pinned grid columns of
`@fluxgantt/core/grid`. `@fluxgantt/react/grid-editing` exports `FluxGanttGridEditing`, which adds inline
cell editing. A chart that imports neither ships no grid code.

```tsx
import { FluxGanttGridEditing, type GridColumnInput } from '@fluxgantt/react/grid-editing';

// Read the saved widths back: the library never persists them.
const saved: Record<string, number> = JSON.parse(localStorage.getItem('gantt-widths') ?? '{}');

// Define column functions outside the component (or `useCallback` them): a new function
// identity on every render re-applies the columns and logs a dev warning.
const columns: GridColumnInput[] = [
  { id: 'name', ...(saved['name'] ? { width: saved['name'] } : {}) },
  { id: 'start', ...(saved['start'] ? { width: saved['start'] } : {}) },
  {
    id: 'owner',
    header: 'Owner',
    value: (task) => String(task.meta?.['owner'] ?? ''),
    ...(saved['owner'] ? { width: saved['owner'] } : {}),
  },
];

export function Plan() {
  return (
    <FluxGanttGridEditing
      tasks={tasks}
      gridColumns={columns}
      onColumnResized={({ widths }) => localStorage.setItem('gantt-widths', JSON.stringify(widths))}
      onCellEditRequested={(e) => {
        // e.preventDefault() here opens YOUR editor instead of the built-in one
      }}
    />
  );
}
```

`gridColumns` changes are applied with `setGridColumns` (no remount). A re-apply keeps the width the user
dragged for every column whose declared `width` did not change, and waits while a cell is being edited.
So re-passing the same columns does not reset user widths: to reset, change the declared `width`s, call
`ref.current.setGridColumns(...)`, or change `key`. The ref also carries `getGridColumns`, `setGridColumns`,
`resizeGridColumn`, `exportGridCsv` and, with editing, `startCellEdit`, `cancelCellEdit`, `isEditingCell`.
The core grid is `@beta`, so these entries are too.

## License

MIT
