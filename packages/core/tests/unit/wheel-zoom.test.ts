// @vitest-environment jsdom
//
// Interaction — mouse wheel + Ctrl zoom tests (spec-wheel-zoom.md §10.1). Runs under jsdom
// (per-file override; the rest of core stays `environment: 'node'`), mirroring
// `keyboard-nav.test.ts`'s setup style. Module-level only — no `Gantt` facade here (see
// `gantt-zoom.test.ts`'s `enableWheelZoom` facade-integration `describe` block for the
// real-`Gantt` wiring tests).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { enableWheelZoom, type WheelZoomOptions } from '../../src/interaction/wheel-zoom.js';
import { toTaskId, type Task } from '../../src/types.js';

function task(id: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: toTaskId(id),
    name: id,
    start,
    end,
    progress: 0.5,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function dispatchWheel(
  target: EventTarget,
  init: { deltaY: number; ctrlKey?: boolean; metaKey?: boolean },
): boolean {
  const event = new WheelEvent('wheel', {
    deltaY: init.deltaY,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('enableWheelZoom — DOM interaction', () => {
  let container: HTMLElement;
  let tasks: Task[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tasks = [task('t1', '2026-01-05T09:00', '2026-01-07T09:00')];
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function setup(options?: Partial<WheelZoomOptions>) {
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const dispose = enableWheelZoom(handle, { onZoomIn, onZoomOut, ...options });
    return { handle, onZoomIn, onZoomOut, dispose };
  }

  it('Ctrl+wheel with negative deltaY fires onZoomIn, prevents default, does not fire onZoomOut', () => {
    const { handle, onZoomIn, onZoomOut } = setup();
    const prevented = dispatchWheel(handle.svg, { deltaY: -100, ctrlKey: true });
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(prevented).toBe(true);
  });

  it('Ctrl+wheel with positive deltaY fires onZoomOut, prevents default, does not fire onZoomIn', () => {
    const { handle, onZoomIn, onZoomOut } = setup();
    const prevented = dispatchWheel(handle.svg, { deltaY: 100, ctrlKey: true });
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(prevented).toBe(true);
  });

  it('Ctrl+wheel with deltaY: 0 prevents default but fires neither callback', () => {
    const { handle, onZoomIn, onZoomOut } = setup();
    const prevented = dispatchWheel(handle.svg, { deltaY: 0, ctrlKey: true });
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(prevented).toBe(true);
  });

  it('plain wheel (no ctrlKey, no metaKey) is a complete no-op — no preventDefault, no callback', () => {
    const { handle, onZoomIn, onZoomOut } = setup();
    const prevented = dispatchWheel(handle.svg, { deltaY: -100 });
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it('metaKey alone (no ctrlKey) does NOT trigger zoom — deliberate divergence from ctrlKey || metaKey', () => {
    const { handle, onZoomIn, onZoomOut } = setup();
    const prevented = dispatchWheel(handle.svg, { deltaY: -100, metaKey: true });
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it('ctrlKey AND metaKey together still triggers zoom via the ctrlKey branch alone', () => {
    const { handle, onZoomIn } = setup();
    const prevented = dispatchWheel(handle.svg, { deltaY: -100, ctrlKey: true, metaKey: true });
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it('several consecutive Ctrl+wheel-up events in a row do not throw', () => {
    const { handle, onZoomIn } = setup();
    expect(() => {
      for (let i = 0; i < 5; i++) dispatchWheel(handle.svg, { deltaY: -100, ctrlKey: true });
    }).not.toThrow();
    expect(onZoomIn).toHaveBeenCalledTimes(5);
  });

  it('dispose() removes the listener cleanly — a post-dispose Ctrl+wheel fires neither callback', () => {
    const { handle, onZoomIn, onZoomOut, dispose } = setup();
    dispatchWheel(handle.svg, { deltaY: -100, ctrlKey: true });
    expect(onZoomIn).toHaveBeenCalledTimes(1);

    dispose();
    dispatchWheel(handle.svg, { deltaY: -100, ctrlKey: true });
    dispatchWheel(handle.svg, { deltaY: 100, ctrlKey: true });
    expect(onZoomIn).toHaveBeenCalledTimes(1); // unchanged since dispose()
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('dispose() is idempotent — calling it twice does not throw', () => {
    const { dispose } = setup();
    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
  });

  it('a rapid burst of alternating-sign wheel events does not throw and fires the expected counts', () => {
    const { handle, onZoomIn, onZoomOut } = setup();
    expect(() => {
      for (let i = 0; i < 20; i++) {
        dispatchWheel(handle.svg, { deltaY: i % 2 === 0 ? -50 : 50, ctrlKey: true });
      }
    }).not.toThrow();
    expect(onZoomIn).toHaveBeenCalledTimes(10);
    expect(onZoomOut).toHaveBeenCalledTimes(10);
  });

  it('registers the wheel listener with { passive: false }', () => {
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const addEventListenerSpy = vi.spyOn(handle.svg, 'addEventListener');
    enableWheelZoom(handle, { onZoomIn: vi.fn(), onZoomOut: vi.fn() });
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      expect.objectContaining({ passive: false }),
    );
  });
});
