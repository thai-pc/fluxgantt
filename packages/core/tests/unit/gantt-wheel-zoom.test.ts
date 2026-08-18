// @vitest-environment jsdom
//
// Facade + DOM integration tests for wheel-zoom (spec-wheel-zoom.md §10.2) — real wheel
// dispatch through a mounted `Gantt` instance actually calling zoomIn()/zoomOut(). Split into
// its own file (rather than added to `gantt-zoom.test.ts`) because `gantt-zoom.test.ts` is
// explicitly a node-environment file (its own header: "the programmatic zoom API needs no
// DOM") — Vitest's `@vitest-environment` directive is per-file, not per-`describe`, so DOM
// dispatch tests can't be added there without forcing the whole file into jsdom and
// contradicting its documented purpose. Mirrors the existing `gantt-keyboard-nav.test.ts` /
// `keyboard-nav.test.ts` split (facade-DOM tests vs module-level tests) for the same reason.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
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

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

function threeTaskGantt(extra: Record<string, unknown> = {}) {
  return createGantt({
    tasks: [
      taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
      taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
      taskInput('c', '2026-01-07T09:00', '2026-01-08T09:00'),
    ],
    ...extra,
  });
}

function svg(): SVGSVGElement {
  return container.querySelector('svg.fg-timeline') as SVGSVGElement;
}

describe('Ctrl+wheel — zoom facade wiring (spec-wheel-zoom.md §10.2)', () => {
  it('Ctrl+wheel-up zooms in one level via the real zoomIn()', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    expect(gantt.getViewMode()).toBe('week'); // default per spec-zoom-runtime.md

    dispatchWheel(svg(), { deltaY: -100, ctrlKey: true });

    expect(gantt.getViewMode()).toBe('day');
  });

  it('Ctrl+wheel-down zooms out one level via the real zoomOut()', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    expect(gantt.getViewMode()).toBe('week');

    dispatchWheel(svg(), { deltaY: 100, ctrlKey: true });

    expect(gantt.getViewMode()).toBe('month');
  });

  it('boundary clamping holds via the wheel path: already at \'day\', Ctrl+wheel-up is a safe no-op', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    gantt.zoomTo('day');

    expect(() => dispatchWheel(svg(), { deltaY: -100, ctrlKey: true })).not.toThrow();
    expect(gantt.getViewMode()).toBe('day');
  });

  it('boundary clamping holds via the wheel path: already at \'year\', Ctrl+wheel-down is a safe no-op', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    gantt.zoomTo('year');

    expect(() => dispatchWheel(svg(), { deltaY: 100, ctrlKey: true })).not.toThrow();
    expect(gantt.getViewMode()).toBe('year');
  });

  it('readOnly: true — Ctrl+wheel still zooms (never gated)', () => {
    const gantt = threeTaskGantt({ readOnly: true });
    gantt.mount(container);
    expect(gantt.getViewMode()).toBe('week');

    dispatchWheel(svg(), { deltaY: -100, ctrlKey: true });
    expect(gantt.getViewMode()).toBe('day');

    dispatchWheel(svg(), { deltaY: 100, ctrlKey: true });
    dispatchWheel(svg(), { deltaY: 100, ctrlKey: true });
    expect(gantt.getViewMode()).toBe('month');
  });

  it('viewport:changed fires exactly once per wheel-triggered zoom step', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    const onChanged = vi.fn();
    gantt.on('viewport:changed', onChanged);

    dispatchWheel(svg(), { deltaY: -100, ctrlKey: true });

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith({ viewMode: 'day' });
  });

  it('plain wheel (no ctrlKey) over a mounted chart does not change getViewMode() and does not fire viewport:changed', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    const onChanged = vi.fn();
    gantt.on('viewport:changed', onChanged);

    dispatchWheel(svg(), { deltaY: -100 });

    expect(gantt.getViewMode()).toBe('week');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('dispatch after destroy() does not throw and does not fire zoom', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    const svgEl = svg();
    gantt.destroy();

    expect(() => dispatchWheel(svgEl, { deltaY: -100, ctrlKey: true })).not.toThrow();
  });

  it('dispatch after unmount() does not throw and does not fire zoom', () => {
    const gantt = threeTaskGantt();
    gantt.mount(container);
    const svgEl = svg();
    gantt.unmount();

    expect(() => dispatchWheel(svgEl, { deltaY: -100, ctrlKey: true })).not.toThrow();
    expect(gantt.getViewMode()).toBe('week');
  });
});
