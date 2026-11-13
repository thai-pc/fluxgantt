// @vitest-environment jsdom
//
// The lazy Canvas painter chunk resolves AFTER the mount that asked for it. These tests pin the races that
// `grid/mixin.ts` guards: unmount, remount, `setGridColumns` and `destroy()` while the chunk is pending, and a
// render error in the async apply. The import is controlled by a deferred, so each test decides when it lands.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let release!: () => void;
let gate: Promise<void>;

async function fresh() {
  vi.resetModules();
  gate = new Promise<void>((r) => (release = r));
  vi.doMock('../../src/grid/canvas-grid.js', async () => {
    await gate;
    return vi.importActual('../../src/grid/canvas-grid.js');
  });
  const { createGantt } = await import('../../src/gantt.js');
  const { withRender } = await import('../../src/render/mixin.js');
  const { withGrid } = await import('../../src/grid/mixin.js');
  const { getInternal } = await import('../../src/gantt-internal.js');
  const { createCanvasRenderer } = await import('../../src/render/canvas-renderer.js');
  const g = withGrid(withRender(createGantt({ tasks: [{ id: 'a' as never, name: 'a', start: '2026-01-05', end: '2026-01-09', progress: 0, type: 'task' }] })));
  const internal = getInternal(g);
  const mountCanvas = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = createCanvasRenderer(host, { tasks: internal.tasks.all(), dependencies: [] }, { viewportHeight: 600 });
    const spy = vi.spyOn(handle, 'setOptions');
    internal.setMount({ renderer: 'canvas', handle, fx: () => {}, ui: () => {}, focusedId: () => undefined, anchored: () => {}, refresh: () => {} } as never);
    internal.emit('renderer:selected', { renderer: 'canvas', taskCount: 0 });
    return { handle, spy };
  };
  const settle = async (): Promise<void> => {
    release();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
  };
  return { g, internal, mountCanvas, settle };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, { get: () => () => {}, set: () => true }) as never);
});
afterEach(() => {
  vi.doUnmock('../../src/grid/canvas-grid.js');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the Canvas painter chunk resolving late', () => {
  it('(a) unmount before it resolves: the dead handle is never touched', async () => {
    const { internal, mountCanvas, settle } = await fresh();
    const { handle, spy } = mountCanvas();
    internal.setMount(undefined);
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect(handle.fixedLabelWidth).toBeUndefined();
  });

  it('(b) unmount + remount before it resolves: only the new handle gets the grid, once', async () => {
    const { internal, mountCanvas, settle } = await fresh();
    const first = mountCanvas();
    internal.setMount(undefined);
    const second = mountCanvas();
    await settle();
    expect(first.spy).not.toHaveBeenCalled();
    const withGrid = second.spy.mock.calls.filter((c) => (c[0] as { grid?: unknown }).grid !== undefined);
    expect(withGrid).toHaveLength(1);
    expect(second.handle.getRenderState().options.grid).toBeDefined();
    expect(second.handle.fixedLabelWidth).toBe(true);
  });

  it('(c) setGridColumns while it loads: the painted width and colcount reflect the new columns', async () => {
    const { g, mountCanvas, settle } = await fresh();
    const { handle } = mountCanvas();
    g.setGridColumns([{ id: 'name', width: 200 }, { id: 'progress' }]);
    expect(handle.getRenderState().options.grid).toBeUndefined(); // still pending
    await settle();
    expect(handle.getLabelColumnWidth()).toBe(296);
    expect(handle.interactionRoot.getAttribute('aria-colcount')).toBe('2');
  });

  it('(d) destroy() before it resolves: nothing happens and nothing throws', async () => {
    const { g, mountCanvas, settle } = await fresh();
    const { handle, spy } = mountCanvas();
    g.destroy();
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect(handle.getRenderState().options.grid).toBeUndefined();
  });

  it('a render error in the async apply warns once and is not an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { g, mountCanvas, settle } = await fresh();
    const { handle } = mountCanvas();
    vi.spyOn(handle, 'setOptions').mockImplementation(() => {
      throw new Error('render failed');
    });
    await settle();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('could not paint its Canvas grid'))).toHaveLength(1);
  });
});
