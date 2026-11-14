# @fluxgantt/vue

The Vue 3 wrapper for [FluxGantt](https://github.com/thai-pc/fluxgantt) — a TypeScript-first,
MIT-licensed Gantt chart library. Provides a `<FluxGantt>` component and a `useFluxGantt`
composable over the headless [`@fluxgantt/core`](https://www.npmjs.com/package/@fluxgantt/core)
engine.

- **Docs:** https://fluxgantt.thai-pc.com/docs/frameworks/vue
- **Repository:** https://github.com/thai-pc/fluxgantt

## Install

```bash
pnpm add @fluxgantt/vue @fluxgantt/core
```

Peer dependency: `vue` `^3.4.0`.

## Usage

```vue
<script setup lang="ts">
import { FluxGantt } from '@fluxgantt/vue';
import { toTaskId } from '@fluxgantt/core';
import type { Task, TaskInput, DependencyInput } from '@fluxgantt/vue';

const tasks: TaskInput[] = [
  { id: toTaskId('design'), name: 'Design', start: '2026-08-03', end: '2026-08-05', progress: 1, type: 'task' },
  { id: toTaskId('build'), name: 'Build', start: '2026-08-05', end: '2026-08-10', progress: 0.6, type: 'task' },
  { id: toTaskId('review'), name: 'Review', start: '2026-08-10', end: '2026-08-12', progress: 0, type: 'task' },
];

const dependencies: DependencyInput[] = [
  { from: toTaskId('design'), to: toTaskId('build'), type: 'FS' },
  { from: toTaskId('build'), to: toTaskId('review'), type: 'FS' },
];

// The template emit surfaces `prevStart` as `unknown` (Vue widens emit payload types).
function onTaskMoved(task: Task, prevStart: unknown) {
  console.log(`${task.name} moved from ${prevStart}`);
}
</script>

<template>
  <FluxGantt
    :tasks="tasks"
    :dependencies="dependencies"
    style="height: 420px"
    @task-moved="onTaskMoved"
  />
</template>
```

## Uncontrolled data

Every config prop (`tasks`, `dependencies`, `calendar`, `viewMode`, `density`, `locale`, `ariaLabel`, `messages`,
`canvasViewportHeight`, `readOnly`, `enableDependencyDrag`, `schedulingMode`, `historyLimit`, `initialCollapsed`,
`rollup`, e.g. `:rollup="computeRollup"` with `computeRollup` from `@fluxgantt/core`) is **read once**, when the underlying `GanttInstance` is created. The instance is the
source of truth afterward — there is no prop→store diffing. Mutate through the instance, which
`useFluxGantt()` exposes as a ref.

`theme` and `onTaskChange` are the reactive props; changing `theme` calls `setTheme()` on the instance. It defaults to
`'light'` (not core's `'auto'`, so existing charts do not flip on a dark-mode OS); pass
`theme="auto"` to follow the OS.

Behavior change: a native `aria-label="..."` attribute used to fall through to the root `<div>`; it now
binds to the `ariaLabel` prop and names the chart's `<svg>` instead.

Full prop and emit tables, plus the composable:
[the Vue docs page](https://fluxgantt.thai-pc.com/docs/frameworks/vue).

## Grid columns (beta)

`@fluxgantt/vue/grid` exports `FluxGanttGrid`: `<FluxGantt>` with the pinned grid columns of
`@fluxgantt/core/grid`. `@fluxgantt/vue/grid-editing` exports `FluxGanttGridEditing`, which adds inline
cell editing. A chart that imports neither ships no grid code.

```vue
<script setup lang="ts">
import { FluxGanttGridEditing } from '@fluxgantt/vue/grid-editing';

// Define column functions once, outside the template expression: a new function identity on every
// change re-applies the columns and logs a dev warning.
const columns = [
  { id: 'name' },
  { id: 'start' },
  { id: 'owner', header: 'Owner', value: (t) => String(t.meta?.owner ?? '') },
];
</script>

<template>
  <FluxGanttGridEditing
    :tasks="tasks"
    :grid-columns="columns"
    @column-resized="({ widths }) => save(widths)"
    @cell-edit-requested="(e) => e.preventDefault()"
  />
</template>
```

`gridColumns` changes are applied with `setGridColumns` (no remount). The exposed instance also carries
`getGridColumns`, `setGridColumns`, `resizeGridColumn`, `exportGridCsv` and, with editing, `startCellEdit`,
`cancelCellEdit`, `isEditingCell`. The core grid is `@beta`, so these entries are too.

## License

MIT
