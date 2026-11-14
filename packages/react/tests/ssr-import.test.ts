// @vitest-environment node
// The opt-in grid entries must be importable and renderable where there is no DOM (SSR, Next.js).
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

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
      const html = renderToString(createElement(C, { tasks: [], gridColumns: [{ id: 'name' }] }));
      expect(html).toContain('class="fg-gantt"');
    }
  });
});
