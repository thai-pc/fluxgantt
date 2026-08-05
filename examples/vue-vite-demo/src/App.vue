<script setup lang="ts">
// Keep the dataset in sync with examples/plain-html-demo/src/main.ts.
import { FluxGantt } from '@fluxgantt/vue';
import { toTaskId } from '@fluxgantt/core';
import type { Task, TaskInput, DependencyInput } from '@fluxgantt/vue';

const tasks: TaskInput[] = [
  { id: toTaskId('design'), name: 'Design', start: '2026-08-03', end: '2026-08-05', progress: 1, type: 'task' },
  { id: toTaskId('build'), name: 'Build', start: '2026-08-05', end: '2026-08-10', progress: 0.6, type: 'task' },
  { id: toTaskId('review'), name: 'Review', start: '2026-08-10', end: '2026-08-12', progress: 0, type: 'task' },
  { id: toTaskId('launch'), name: 'Launch', start: '2026-08-12', end: '2026-08-12', progress: 0, type: 'milestone' },
  { id: toTaskId('docs-task'), name: 'Write docs', start: '2026-08-06', end: '2026-08-11', progress: 0.2, type: 'task' },
];

const dependencies: DependencyInput[] = [
  { from: toTaskId('design'), to: toTaskId('build'), type: 'FS' },
  { from: toTaskId('build'), to: toTaskId('review'), type: 'FS' },
];

// The template emit `@task-moved` surfaces `prevStart` as `unknown` on the consumer side
// (Vue widens the emit payload type), so type it `unknown` here.
function onTaskMoved(task: Task, prevStart: unknown) {
  console.log(`${task.name} moved from ${prevStart}`);
}
</script>

<template>
  <main style="max-width: 960px; margin: 0 auto; padding: 2rem 1.5rem; font-family: Inter, system-ui, sans-serif">
    <h1 style="font-size: 1.25rem">
      FluxGantt — <code style="color: #6366f1">@fluxgantt/vue</code>
    </h1>
    <p style="color: #71717a; font-size: 0.9rem">
      Drag a task bar to move it, drag an edge to resize, drag a link handle to connect two
      tasks. The critical path is outlined in dashed red.
    </p>
    <FluxGantt
      :tasks="tasks"
      :dependencies="dependencies"
      style="height: 420px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff"
      @task-moved="onTaskMoved"
    />
  </main>
</template>
