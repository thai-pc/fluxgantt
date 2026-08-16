// Headless facade tests — zoomTo()/zoomIn()/zoomOut()/getViewMode() (spec-zoom-runtime.md
// §13.1). Runs under vitest's default `node` environment — the programmatic zoom API needs
// no DOM (mirrors gantt-selection.test.ts's structure/env choice). DOM/scroll-anchor/
// mounted-repaint tests live in gantt-dom.test.ts (jsdom).
import { describe, it, expect, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import type { ViewMode } from '../../src/types.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

describe('Gantt#zoomTo — pre-mount (headless) behavior', () => {
  it('zoomTo() before mount() only updates state (getViewMode() reflects it), no throw', () => {
    const gantt = createGantt({ viewMode: 'month' });
    expect(gantt.getViewMode()).toBe('month');
    expect(() => gantt.zoomTo('week')).not.toThrow();
    expect(gantt.getViewMode()).toBe('week');
  });

  it('a headless zoomTo() still fires viewport:changed even though nothing is mounted', () => {
    const gantt = createGantt({});
    const onChanged = vi.fn();
    gantt.on('viewport:changed', onChanged);
    gantt.zoomTo('day');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith({ viewMode: 'day' });
  });

  it('defaults to \'week\' when config.viewMode is unset', () => {
    const gantt = createGantt({});
    expect(gantt.getViewMode()).toBe('week');
  });
});

describe('Gantt#getViewMode', () => {
  it('reflects config.viewMode at construction', () => {
    const gantt = createGantt({ viewMode: 'quarter' });
    expect(gantt.getViewMode()).toBe('quarter');
  });

  it('reflects the most recent zoomTo()/zoomIn()/zoomOut() call', () => {
    const gantt = createGantt({ viewMode: 'week' });
    gantt.zoomIn();
    expect(gantt.getViewMode()).toBe('day');
    gantt.zoomOut();
    gantt.zoomOut();
    expect(gantt.getViewMode()).toBe('month');
  });

  it('remains readable (does not throw) after destroy(), returning the last value', () => {
    const gantt = createGantt({ viewMode: 'day' });
    gantt.destroy();
    expect(() => gantt.getViewMode()).not.toThrow();
    expect(gantt.getViewMode()).toBe('day');
  });
});

describe('Gantt#zoomTo — no-op discipline', () => {
  it('calling zoomTo() with the already-current mode fires no viewport:changed', () => {
    const gantt = createGantt({ viewMode: 'week' });
    const onChanged = vi.fn();
    gantt.on('viewport:changed', onChanged);
    gantt.zoomTo('week');
    expect(onChanged).not.toHaveBeenCalled();
    expect(gantt.getViewMode()).toBe('week');
  });
});

describe('Gantt#zoomTo — invalid input', () => {
  it('throws on a non-ViewMode string (defensive runtime validation)', () => {
    const gantt = createGantt({});
    expect(() => gantt.zoomTo('fortnight' as ViewMode)).toThrow();
  });

  it('does not fire viewport:changed on a rejected call', () => {
    const gantt = createGantt({});
    const onChanged = vi.fn();
    gantt.on('viewport:changed', onChanged);
    expect(() => gantt.zoomTo('fortnight' as ViewMode)).toThrow();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('Gantt#zoomIn / #zoomOut — stepping + boundary clamping', () => {
  it('zoomIn() steps toward \'day\' through the fixed order', () => {
    const gantt = createGantt({ viewMode: 'year' });
    const seen: ViewMode[] = [];
    gantt.on('viewport:changed', (state) => seen.push(state.viewMode));

    gantt.zoomIn(); // year -> quarter
    gantt.zoomIn(); // quarter -> month
    gantt.zoomIn(); // month -> week
    gantt.zoomIn(); // week -> day

    expect(seen).toEqual(['quarter', 'month', 'week', 'day']);
    expect(gantt.getViewMode()).toBe('day');
  });

  it('zoomOut() steps toward \'year\' through the fixed order', () => {
    const gantt = createGantt({ viewMode: 'day' });
    const seen: ViewMode[] = [];
    gantt.on('viewport:changed', (state) => seen.push(state.viewMode));

    gantt.zoomOut(); // day -> week
    gantt.zoomOut(); // week -> month
    gantt.zoomOut(); // month -> quarter
    gantt.zoomOut(); // quarter -> year

    expect(seen).toEqual(['week', 'month', 'quarter', 'year']);
    expect(gantt.getViewMode()).toBe('year');
  });

  it('zoomIn() at the \'day\' boundary is a safe no-op — no throw, no second viewport:changed', () => {
    const gantt = createGantt({ viewMode: 'day' });
    const onChanged = vi.fn();
    gantt.on('viewport:changed', onChanged);
    expect(() => gantt.zoomIn()).not.toThrow();
    expect(onChanged).not.toHaveBeenCalled();
    expect(gantt.getViewMode()).toBe('day');
  });

  it('zoomOut() at the \'year\' boundary is a safe no-op — no throw, no second viewport:changed', () => {
    const gantt = createGantt({ viewMode: 'year' });
    const onChanged = vi.fn();
    gantt.on('viewport:changed', onChanged);
    expect(() => gantt.zoomOut()).not.toThrow();
    expect(onChanged).not.toHaveBeenCalled();
    expect(gantt.getViewMode()).toBe('year');
  });

  it('zoomTo(\'day\') then zoomIn() again — no throw, viewport:changed fires only for the zoomTo() call', () => {
    const gantt = createGantt({ viewMode: 'week' });
    const onChanged = vi.fn();
    gantt.zoomTo('day');
    gantt.on('viewport:changed', onChanged); // attach AFTER the zoomTo() above
    expect(() => gantt.zoomIn()).not.toThrow();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('zoomTo(\'year\') then zoomOut() again — no throw, no additional emission', () => {
    const gantt = createGantt({ viewMode: 'week' });
    gantt.zoomTo('year');
    const onChanged = vi.fn();
    gantt.on('viewport:changed', onChanged);
    expect(() => gantt.zoomOut()).not.toThrow();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('Gantt#zoomTo/#zoomIn/#zoomOut — readOnly / destroy posture', () => {
  it('readOnly: true — zoomTo()/zoomIn()/zoomOut() all still work (unaffected by readOnly)', () => {
    const gantt = createGantt({ readOnly: true, viewMode: 'week' });
    expect(() => gantt.zoomTo('month')).not.toThrow();
    expect(gantt.getViewMode()).toBe('month');
    expect(() => gantt.zoomIn()).not.toThrow();
    expect(gantt.getViewMode()).toBe('week');
    expect(() => gantt.zoomOut()).not.toThrow();
    expect(gantt.getViewMode()).toBe('month');
  });

  it('after destroy(): zoomTo()/zoomIn()/zoomOut() throw; getViewMode() returns the last value without throwing', () => {
    const gantt = createGantt({ viewMode: 'week' });
    gantt.destroy();

    expect(() => gantt.zoomTo('day')).toThrow();
    expect(() => gantt.zoomIn()).toThrow();
    expect(() => gantt.zoomOut()).toThrow();
    expect(gantt.getViewMode()).toBe('week');
  });
});

describe('Gantt#zoomTo — undo/redo independence', () => {
  it('a zoomTo() between two data mutations is not itself an undo step and does not affect canUndo()/canRedo()', () => {
    const gantt = createGantt({ viewMode: 'week' });
    gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'));
    const canUndoBefore = gantt.canUndo();
    const canRedoBefore = gantt.canRedo();

    gantt.zoomTo('day');

    expect(gantt.canUndo()).toBe(canUndoBefore);
    expect(gantt.canRedo()).toBe(canRedoBefore);

    // undo() undoes the addTask, not the zoom — the zoom is not recorded as a history entry.
    expect(gantt.undo()).toBe(true);
    expect(gantt.getTasks()).toEqual([]);
    expect(gantt.getViewMode()).toBe('day'); // zoom state survives the undo of an unrelated op
  });

  it('history:changed is not fired by zoomTo() itself', () => {
    const gantt = createGantt({ viewMode: 'week' });
    const onHistoryChanged = vi.fn();
    gantt.on('history:changed', onHistoryChanged);
    gantt.zoomTo('day');
    expect(onHistoryChanged).not.toHaveBeenCalled();
  });
});

describe('viewport:changed — payload shape', () => {
  it('fires with exactly { viewMode: <newMode> }', () => {
    const gantt = createGantt({ viewMode: 'week' });
    const onChanged = vi.fn();
    gantt.on('viewport:changed', onChanged);
    gantt.zoomTo('month');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith({ viewMode: 'month' });
    // Shape check — exactly one key.
    expect(Object.keys(onChanged.mock.calls[0]![0] as object)).toEqual(['viewMode']);
  });
});
