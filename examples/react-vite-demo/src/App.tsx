import { FluxGantt } from '@fluxgantt/react';
import { tasks, dependencies } from './data.js';

export function App() {
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.25rem' }}>
        FluxGantt — <code style={{ color: '#6366f1' }}>@fluxgantt/react</code>
      </h1>
      <p style={{ color: '#71717a', fontSize: '0.9rem' }}>
        Drag a task bar to move it, drag an edge to resize, drag a link handle to connect two
        tasks. The critical path is outlined in dashed red.
      </p>
      <FluxGantt
        tasks={tasks}
        dependencies={dependencies}
        style={{ height: 420, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
        onTaskMoved={(task, prevStart) => console.log(`${task.name} moved from ${prevStart}`)}
      />
    </main>
  );
}
