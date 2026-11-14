// @vitest-environment node
// The opt-in grid entries must be importable where there is no DOM (Nuxt server render's module graph).
import { describe, it, expect } from 'vitest';

describe('SSR-safe import', () => {
  it('imports the grid entries without window or document', async () => {
    expect(typeof window).toBe('undefined');
    const grid = await import('../src/grid.js');
    const editing = await import('../src/grid-editing.js');
    expect(grid.FluxGanttGrid).toBeDefined();
    expect(editing.FluxGanttGridEditing).toBeDefined();
  });
});
