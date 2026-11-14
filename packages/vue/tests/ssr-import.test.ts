// @vitest-environment node
// The opt-in grid entries must be importable and renderable where there is no DOM (Nuxt server render).
import { describe, it, expect } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';

describe('SSR', () => {
  it('imports the grid entries without window or document', async () => {
    expect(typeof window).toBe('undefined');
    const grid = await import('../src/grid.js');
    const editing = await import('../src/grid-editing.js');
    expect(grid.FluxGanttGrid).toBeDefined();
    expect(editing.FluxGanttGridEditing).toBeDefined();
  });

  it('renders both grid entries to a string without throwing', async () => {
    const { FluxGanttGrid } = await import('../src/grid.js');
    const { FluxGanttGridEditing } = await import('../src/grid-editing.js');
    for (const C of [FluxGanttGrid, FluxGanttGridEditing]) {
      const html = await renderToString(createSSRApp({ render: () => h(C, { tasks: [] }) }));
      expect(html).toContain('class="fg-gantt"');
    }
  });
});
