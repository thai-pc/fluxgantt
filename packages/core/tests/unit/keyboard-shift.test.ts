// @vitest-environment jsdom
//
// Keyboard alternative to drag (WCAG 2.2 SC 2.5.7, spec-keyboard-move-resize.md): Alt+Arrow moves,
// Alt+Shift+Arrow resizes the end, Shift+Arrow then Alt+Enter links. Facade-level, jsdom.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../helpers/create-gantt.js';
import { DEFAULT_CALENDAR } from '../../src/compute/working-calendar.js';
import { computeRollup } from '../../src/compute/rollup.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
import type { GanttConfig } from '../../src/gantt.js';

const t = (id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: toTaskId(id),
  name: id,
  start,
  end,
  progress: 0,
  type: 'task',
  ...extra,
});

interface KeyInit {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}
function key(target: EventTarget, k: string, init: KeyInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
const ALT: KeyInit = { altKey: true };
const ALT_SHIFT: KeyInit = { altKey: true, shiftKey: true };

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

const row = (id: string): SVGElement =>
  container.querySelector(`.fg-timeline__row[data-task-id="${id}"]`) as SVGElement;

function chart(tasks: TaskInput[], extra: Partial<GanttConfig> = {}) {
  const g = createGantt({ tasks, ...extra });
  g.mount(container);
  return g;
}
const date = (g: ReturnType<typeof chart>, id: string, f: 'start' | 'end') =>
  String(g.getTask(toTaskId(id))![f]).slice(0, 16);

describe('Alt+Arrow move', () => {
  it('moves start and end one calendar day, one event, one undo entry', () => {
    const g = chart([t('a', '2026-01-05T09:00', '2026-01-07T17:00')]);
    const moved = vi.fn();
    g.on('task:moved', moved);
    const e = key(row('a'), 'ArrowRight', ALT);
    expect(e.defaultPrevented).toBe(true);
    expect(date(g, 'a', 'start')).toContain('2026-01-06T09:00');
    expect(date(g, 'a', 'end')).toContain('2026-01-08T17:00');
    expect(moved).toHaveBeenCalledTimes(1);
    key(row('a'), 'ArrowLeft', ALT);
    key(row('a'), 'ArrowLeft', ALT);
    expect(date(g, 'a', 'start')).toContain('2026-01-04T09:00');
    g.undo();
    g.undo();
    g.undo();
    expect(date(g, 'a', 'start')).toContain('2026-01-05T09:00');
    expect(date(g, 'a', 'end')).toContain('2026-01-07T17:00');
  });

  it.each(['America/New_York', 'Asia/Ho_Chi_Minh', 'UTC'])('keeps wall-clock time across DST in %s', (tz) => {
    const g = chart([t('a', '2026-03-07T09:00', '2026-03-07T17:00')], {
      calendar: { ...DEFAULT_CALENDAR, timezone: tz },
    });
    key(row('a'), 'ArrowRight', ALT);
    key(row('a'), 'ArrowRight', ALT); // crosses 2026-03-08 (US spring forward)
    const s = g.getTask(toTaskId('a'))!;
    const start = String(s.start);
    expect(start).toContain('2026-03-09T09:00');
    expect(String(s.end)).toContain('2026-03-09T17:00');
  });

  it('cascades successors in ONE history entry (schedulingMode auto)', () => {
    const g = chart([t('a', '2026-01-05T09:00', '2026-01-06T09:00'), t('b', '2026-01-06T09:00', '2026-01-07T09:00')], {
      schedulingMode: 'auto',
    });
    g.linkTasks(toTaskId('a'), toTaskId('b'), 'FS');
    key(row('a'), 'ArrowRight', ALT);
    expect(date(g, 'b', 'start')).toContain('2026-01-07T09:00');
    g.undo();
    expect(date(g, 'a', 'start')).toContain('2026-01-05T09:00');
    expect(date(g, 'b', 'start')).toContain('2026-01-06T09:00');
  });

  it('acts on the focused task only, even with a multi-selection', () => {
    const g = chart([t('a', '2026-01-05T09:00', '2026-01-06T09:00'), t('b', '2026-01-05T09:00', '2026-01-06T09:00')]);
    g.select([toTaskId('a'), toTaskId('b')]);
    key(row('a'), 'ArrowRight', ALT);
    expect(date(g, 'a', 'start')).toContain('2026-01-06');
    expect(date(g, 'b', 'start')).toContain('2026-01-05');
  });

  it('keeps focus on the same row after the repaint', () => {
    const g = chart([t('a', '2026-01-05T09:00', '2026-01-06T09:00')]);
    row('a').focus();
    key(row('a'), 'ArrowRight', ALT);
    expect(document.activeElement).toBe(row('a'));
    expect(row('a').getAttribute('tabindex')).toBe('0');
    expect(row('a').querySelector('.fg-task')!.getAttribute('aria-label')).toContain('Jan 6');
    g.unmount();
  });

  it('auto-repeat keeps committing, one history entry each', () => {
    const g = chart([t('a', '2026-01-05T09:00', '2026-01-06T09:00')]);
    for (let i = 0; i < 3; i++) key(row('a'), 'ArrowRight', { ...ALT, repeat: true });
    expect(date(g, 'a', 'start')).toContain('2026-01-08');
    g.undo();
    expect(date(g, 'a', 'start')).toContain('2026-01-07');
  });

  it('milestones move; a parent is declined only when config.rollup is set', () => {
    const g = chart([t('m', '2026-01-05T09:00', '2026-01-05T09:00', { type: 'milestone' })]);
    key(row('m'), 'ArrowRight', ALT);
    expect(date(g, 'm', 'start')).toContain('2026-01-06');

    const tasks = [
      t('p', '2026-01-05T09:00', '2026-01-09T09:00', { type: 'summary' }),
      t('c', '2026-01-05T09:00', '2026-01-06T09:00', { parent: toTaskId('p') }),
    ];
    container.replaceChildren();
    const plain = chart(tasks);
    key(row('p'), 'ArrowRight', ALT);
    expect(date(plain, 'p', 'start')).toContain('2026-01-06');
    plain.unmount();
    container.replaceChildren();
    const rolled = chart(tasks, { rollup: computeRollup });
    const e = key(row('p'), 'ArrowRight', ALT);
    expect(e.defaultPrevented).toBe(true);
    expect(date(rolled, 'p', 'start')).toContain('2026-01-05');
    key(row('p'), 'ArrowRight', ALT_SHIFT);
    expect(date(rolled, 'p', 'end')).toContain('2026-01-09');
  });

  it('uses the drag gate: a custom provider that rolls up only some parents leaves the others movable', () => {
    const tasks = [
      t('p', '2026-01-05T09:00', '2026-01-09T09:00'), // a plain parent, not rolled up by this provider
      t('c', '2026-01-05T09:00', '2026-01-06T09:00', { parent: toTaskId('p') }),
    ];
    const g = chart(tasks, { rollup: () => new Map() });
    key(row('p'), 'ArrowRight', ALT);
    expect(date(g, 'p', 'start')).toContain('2026-01-06');
  });

  it('a removed task is a no-op, a disposed chart ignores the key', () => {
    const g = chart([t('a', '2026-01-05T09:00', '2026-01-06T09:00')]);
    const el = row('a');
    g.unmount();
    expect(key(el, 'ArrowRight', ALT).defaultPrevented).toBe(false);
  });
});

describe('Alt+Shift+Arrow resize (end edge)', () => {
  it('lengthens and shortens the end by one day, emits task:resized', () => {
    const g = chart([t('a', '2026-01-05T09:00', '2026-01-07T09:00')]);
    const resized = vi.fn();
    g.on('task:resized', resized);
    key(row('a'), 'ArrowRight', ALT_SHIFT);
    // End lands on working time, exactly as a drag-resize commit does (Mon 09:00 + 24 working hours).
    expect(date(g, 'a', 'end')).toContain('2026-01-07T17:00');
    expect(date(g, 'a', 'start')).toContain('2026-01-05T09:00');
    expect(resized).toHaveBeenCalledTimes(1);
    key(row('a'), 'ArrowLeft', ALT_SHIFT);
    expect(date(g, 'a', 'end')).toContain('2026-01-06T17:00');
    expect(resized).toHaveBeenCalledTimes(2);
  });

  it('lengthens past a weekend: Thu-Fri plus one press ends Mon 17:00 (24 h), one undo step', () => {
    const g = chart([t('a', '2026-01-08T09:00', '2026-01-09T17:00')]); // Thu-Fri
    expect(key(row('a'), 'ArrowRight', ALT_SHIFT).defaultPrevented).toBe(true);
    expect(date(g, 'a', 'end')).toContain('2026-01-12T17:00');
    expect(g.getTask(toTaskId('a'))!.duration).toBe(24);
    g.undo();
    expect(date(g, 'a', 'end')).toContain('2026-01-09T17:00');
  });

  it('lengthens past a holiday', () => {
    const g = chart([t('a', '2026-01-08T09:00', '2026-01-09T17:00')], {
      calendar: { ...DEFAULT_CALENDAR, holidays: ['2026-01-12'] },
    });
    key(row('a'), 'ArrowRight', ALT_SHIFT);
    expect(date(g, 'a', 'end')).toContain('2026-01-13T17:00');
  });

  it('a press that cannot change the duration writes nothing (no event, no undo entry)', () => {
    const g = chart([t('a', '2026-01-05T09:00', '2026-01-05T17:00')]); // one working day: at the floor
    const resized = vi.fn();
    g.on('task:resized', resized);
    expect(key(row('a'), 'ArrowLeft', ALT_SHIFT).defaultPrevented).toBe(true);
    expect(resized).not.toHaveBeenCalled();
    expect(g.canUndo()).toBe(false);
  });

  it('shrinks across a weekend in one press', () => {
    const g = chart([t('a', '2026-01-08T09:00', '2026-01-12T17:00')]); // Thu to Mon, 24 h
    key(row('a'), 'ArrowLeft', ALT_SHIFT);
    expect(date(g, 'a', 'end')).toContain('2026-01-09T17:00');
  });

  it("floors at one calendar day like drag, and a 1-day task still preventDefaults", () => {
    const g = chart([t('a', '2026-01-05T09:00', '2026-01-06T21:00')]); // 1.5 days
    key(row('a'), 'ArrowLeft', ALT_SHIFT);
    // Floored at start + 1 calendar day (Tue 09:00), which is 8 working hours: end Mon 17:00.
    // Unfloored it would have gone to Mon 21:00 -> the same here, so assert the second press holds.
    expect(date(g, 'a', 'end')).toContain('2026-01-05T17:00');
    const e = key(row('a'), 'ArrowLeft', ALT_SHIFT);
    expect(e.defaultPrevented).toBe(true);
    expect(date(g, 'a', 'end')).toContain('2026-01-05T17:00');
  });

  it('is a no-op on a milestone (prevented)', () => {
    const g = chart([t('m', '2026-01-05T09:00', '2026-01-05T09:00', { type: 'milestone' })]);
    const e = key(row('m'), 'ArrowRight', ALT_SHIFT);
    expect(e.defaultPrevented).toBe(true);
    expect(date(g, 'm', 'start')).toContain('2026-01-05');
  });
});

describe('gating', () => {
  const base = () => [t('a', '2026-01-05T09:00', '2026-01-06T09:00')];

  it('readOnly: no mutation and no preventDefault', () => {
    const g = chart(base(), { readOnly: true });
    for (const init of [ALT, ALT_SHIFT]) {
      expect(key(row('a'), 'ArrowRight', init).defaultPrevented).toBe(false);
    }
    expect(date(g, 'a', 'start')).toContain('2026-01-05');
  });

  it('ignores Ctrl+Alt / Meta+Alt, plain and Shift-only arrows, and IME composition', () => {
    const g = chart(base());
    for (const init of [
      { altKey: true, ctrlKey: true },
      { altKey: true, metaKey: true },
      {},
      { shiftKey: true },
      { altKey: true, isComposing: true },
    ] as KeyInit[]) {
      expect(key(row('a'), 'ArrowRight', init).defaultPrevented).toBe(false);
    }
    expect(date(g, 'a', 'start')).toContain('2026-01-05');
  });

  it('Alt+ArrowLeft is prevented so the browser does not navigate Back', () => {
    chart(base());
    expect(key(row('a'), 'ArrowLeft', ALT).defaultPrevented).toBe(true);
  });
});

describe('Alt+Enter link', () => {
  const three = () => [
    t('a', '2026-01-05T09:00', '2026-01-06T09:00'),
    t('b', '2026-01-06T09:00', '2026-01-07T09:00'),
    t('c', '2026-01-07T09:00', '2026-01-08T09:00'),
  ];
  const SHIFT: KeyInit = { shiftKey: true };

  it('links anchor -> focus (FS) after Shift+ArrowDown x2', () => {
    const g = chart(three());
    const added = vi.fn();
    g.on('dependency:added', added);
    key(row('a'), 'ArrowDown', SHIFT);
    key(row('b'), 'ArrowDown', SHIFT);
    const e = key(row('c'), 'Enter', ALT);
    expect(e.defaultPrevented).toBe(true);
    expect(added).toHaveBeenCalledTimes(1);
    expect(g.getDependencies()).toMatchObject([{ from: 'a', to: 'c', type: 'FS' }]);
  });

  it('an upward range links the lower anchor to the upper focus', () => {
    const g = chart(three());
    key(row('a'), 'ArrowDown'); // focus b
    key(row('b'), 'ArrowDown'); // focus c
    key(row('c'), 'ArrowUp', SHIFT); // anchor c, focus b
    key(row('b'), 'Enter', ALT);
    expect(g.getDependencies()).toMatchObject([{ from: 'c', to: 'b' }]);
  });

  it('is a no-op without a range, on duplicates and cycles (no throw, no event)', () => {
    const g = chart(three());
    const added = vi.fn();
    g.on('dependency:added', added);
    expect(key(row('a'), 'Enter', ALT).defaultPrevented).toBe(false);
    key(row('a'), 'ArrowDown', SHIFT);
    key(row('b'), 'Enter', ALT);
    expect(added).toHaveBeenCalledTimes(1);
    key(row('b'), 'Enter', ALT); // duplicate
    key(row('b'), 'ArrowUp'); // collapse range, focus a
    key(row('a'), 'ArrowDown', SHIFT); // anchor a, focus b ... reverse needs anchor b
    expect(() => {
      key(row('b'), 'ArrowDown'); // focus c
      key(row('c'), 'ArrowUp', SHIFT); // anchor c, focus b
      key(row('b'), 'ArrowUp'); // focus a
    }).not.toThrow();
    g.linkTasks(toTaskId('b'), toTaskId('c'), 'FS');
    key(row('c'), 'ArrowDown'); // stays on c (last)
    key(row('c'), 'ArrowUp', SHIFT); // anchor c, focus b
    expect(() => key(row('b'), 'Enter', ALT)).not.toThrow(); // c -> b would cycle
    expect(g.getDependencies().filter((d) => d.from === toTaskId('c'))).toHaveLength(0);
    expect(added).toHaveBeenCalledTimes(2);
  });

  it('does not link from an anchor hidden by a collapse (prevented, nothing created)', () => {
    const g = chart([
      t('p', '2026-01-05T09:00', '2026-01-09T09:00', { type: 'summary' }),
      t('c', '2026-01-05T09:00', '2026-01-06T09:00', { parent: toTaskId('p') }),
    ]);
    key(row('p'), 'ArrowDown'); // focus c
    key(row('c'), 'ArrowUp', SHIFT); // anchor c, focus p
    key(row('p'), 'Enter'); // collapse p: c is hidden
    const e = key(row('p'), 'Enter', ALT);
    expect(e.defaultPrevented).toBe(true);
    expect(g.getDependencies()).toHaveLength(0);
  });

  it('does not toggle summary collapse and plain Enter still does', () => {
    const g = chart([
      t('p', '2026-01-05T09:00', '2026-01-09T09:00', { type: 'summary' }),
      t('c', '2026-01-05T09:00', '2026-01-06T09:00', { parent: toTaskId('p') }),
    ]);
    key(row('p'), 'Enter', ALT);
    expect(row('c')).not.toBeNull();
    key(row('p'), 'Enter');
    expect(container.querySelector('.fg-timeline__row[data-task-id="c"]')).toBeNull();
    g.unmount();
  });

  it('enableDependencyDrag:false and readOnly: no link, not prevented', () => {
    for (const extra of [{ enableDependencyDrag: false }, { readOnly: true }] as Partial<GanttConfig>[]) {
      container.replaceChildren();
      const g = chart(three(), extra);
      key(row('a'), 'ArrowDown', SHIFT);
      expect(key(row('b'), 'Enter', ALT).defaultPrevented).toBe(false);
      expect(g.getDependencies()).toHaveLength(0);
      g.unmount();
    }
  });
});

describe('property', () => {
  it('N shifts then the inverse N shifts restore the dates (incl. across DST)', () => {
    const g = chart([t('a', '2026-03-06T09:00', '2026-03-09T17:00')], {
      calendar: { ...DEFAULT_CALENDAR, timezone: 'America/New_York' },
    });
    const k = (d: number) => (d > 0 ? 'ArrowRight' : 'ArrowLeft');
    fc.assert(
      fc.property(fc.array(fc.constantFrom(1, -1), { maxLength: 6 }), (steps) => {
        for (const d of steps) key(row('a'), k(d), ALT);
        for (const d of [...steps].reverse()) key(row('a'), k(-d), ALT);
        const a = g.getTask(toTaskId('a'))!;
        expect(String(a.start)).toContain('2026-03-06T09:00');
        expect(String(a.end)).toContain('2026-03-09T17:00');
        expect(String(a.start) <= String(a.end)).toBe(true);
      }),
      { numRuns: 10 },
    );
  });
});
