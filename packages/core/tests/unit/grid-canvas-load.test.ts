// @vitest-environment jsdom
//
// A failed fetch of the lazy Canvas grid chunk must not break the chart: it warns once (naming withGrid) and
// the Canvas chart keeps painting its plain label column.
import { describe, it, expect, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withGrid } from '../../src/grid/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import { createCanvasRenderer } from '../../src/render/canvas-renderer.js';
import { toTaskId } from '../../src/types.js';

vi.mock('../../src/grid/canvas-grid.js', () => {
  throw new Error('chunk failed to load');
});

describe('Canvas painter chunk failure', () => {
  it('warns once, leaves the chart plain, and retries on the next mount', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, { get: () => () => {}, set: () => true }) as never);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const g = withGrid(withRender(createGantt({ tasks: [{ id: toTaskId('a'), name: 'a', start: '2026-01-05', end: '2026-01-09', progress: 0, type: 'task' }] })));
    const internal = getInternal(g);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = createCanvasRenderer(host, { tasks: internal.tasks.all(), dependencies: [] }, { viewportHeight: 600 });
    internal.setMount({ renderer: 'canvas', handle, fx: () => {}, ui: () => {}, focusedId: () => undefined, anchored: () => {}, refresh: () => {} } as never);
    internal.emit('renderer:selected', { renderer: 'canvas', taskCount: 0 });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(String(warn.mock.calls[0]![0])).toContain('withGrid could not load its Canvas painter');
    expect(handle.getRenderState().options.grid).toBeUndefined();
    expect(handle.getLabelColumnWidth()).toBe(160); // the plain label column
    expect(handle.interactionRoot.hasAttribute('aria-colcount')).toBe(false);
    internal.emit('renderer:selected', { renderer: 'canvas', taskCount: 0 }); // a remount retries
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
