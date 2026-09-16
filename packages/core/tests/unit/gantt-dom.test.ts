// @vitest-environment jsdom
//
// DOM facade tests (spec-gantt-facade.md §8.2) — mount()/unmount()/destroy(), the reactive
// store->render effect, and the drag-move -> task:moved wiring. Runs under jsdom (per-file
// override; the rest of core stays `environment: 'node'`), matching svg-renderer.test.ts /
// drag-move.test.ts.
//
// The trailing `describe('renderer auto-switch', ...)` block (spec-canvas-auto-switch.md §11)
// lives HERE rather than in `gantt.test.ts` (the location named in the original ticket text) —
// a deliberate deviation, flagged for review: `gantt.test.ts`'s own header comment restricts it
// to the DOM-free `node` environment and explicitly says "DOM tests... live in
// gantt-dom.test.ts". mount()'s auto-switch behavior is fundamentally DOM-dependent (it
// creates/paints a real `<canvas>`/`<svg>` into a real `HTMLElement`), so this file's existing
// jsdom setup (and its `container`/`PointerEventPolyfill` conventions) is the correct home.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt as createGanttBase, CANVAS_AUTO_SWITCH_THRESHOLD } from '../../src/gantt.js';
import { withIo } from '../../src/io/mixin.js';
import type { GanttConfig } from '../../src/gantt.js';

// Post-facade-split (spec-facade-split.md §3.2): IO methods live on the opt-in `withIo`
// mixin, not on the base instance. These tests exercise the IO surface, so they compose it
// once here rather than at every call site.
const createGantt = (config: GanttConfig) => withIo(createGanttBase(config));
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { CanvasDimensionExceededError, createCanvasRenderer } from '../../src/render/canvas-renderer.js';
import { toTaskId, type Task } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';
// Type-only namespace import so `importOriginal`'s generic below can reference the module's
// shape without an inline `typeof import(...)` type query (forbidden by
// @typescript-eslint/consistent-type-imports — erased at compile time either way).
import type * as CanvasRendererModule from '../../src/render/canvas-renderer.js';

// `vi.fn(actual.createCanvasRenderer)` wraps the REAL implementation by default (success-path
// tests exercise the genuine Canvas renderer, not a stub) while letting individual tests swap
// in a one-shot failure via `mockImplementationOnce` (spec §11's dimension-exceeded/
// construction-failed scenarios). Hoisted/static for the whole file — harmless to every other
// describe block above, since none of them mount a project above
// `CANVAS_AUTO_SWITCH_THRESHOLD` (the only path that ever calls this).
vi.mock('../../src/render/canvas-renderer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CanvasRendererModule>();
  return { ...actual, createCanvasRenderer: vi.fn(actual.createCanvasRenderer) };
});

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

// --- Minimal PointerEvent polyfill — jsdom@25.0.1 doesn't ship one (see drag-move.test.ts §8.1). ----
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId: number }) {
    super(type, init);
    this.pointerId = init.pointerId;
  }
}
const PointerEventCtor: typeof PointerEvent =
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
  (PointerEventPolyfill as unknown as typeof PointerEvent);

function dispatchPointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { pointerId: number; clientX: number; clientY: number; bubbles?: boolean },
): void {
  target.dispatchEvent(
    new PointerEventCtor(type, {
      pointerId: init.pointerId,
      clientX: init.clientX,
      clientY: init.clientY,
      bubbles: init.bubbles ?? false,
      cancelable: true,
    }),
  );
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

describe('mount() — initial render', () => {
  it('renders into container (svg present, row/bar count matches config.tasks.length)', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'),
      ],
    });
    gantt.mount(container);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('.fg-task')).toHaveLength(2);
  });

  it('empty-config mount does not throw, renders an empty grid (item B)', () => {
    const gantt = createGantt({});
    expect(() => gantt.mount(container)).not.toThrow();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('.fg-task')).toHaveLength(0);
  });

  it('mounting with 0 tasks then adding the FIRST task does not throw (empty -> populated transition, regression)', () => {
    // Regression: `#renderNow` used to call `applyViewportOptions()` (whose `setOptions` triggers an
    // immediate `render()` against the renderer's STALE, still-empty internal task list)
    // BEFORE `handle.update()` had pushed the new task — `deriveTimeRange` throws when both
    // `timeRange` is unset AND `tasks` is empty. `#renderNow` must order the two calls so
    // the renderer's internal state is never observed with an unset `timeRange` and an
    // empty task list at the same time, in either transition direction.
    const gantt = createGantt({ tasks: [] });
    gantt.mount(container);
    expect(container.querySelectorAll('.fg-task')).toHaveLength(0);

    expect(() =>
      gantt.addTask(taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')),
    ).not.toThrow();
    expect(container.querySelectorAll('.fg-task')).toHaveLength(1);
  });

  it('removing the LAST task then adding a new one does not throw (populated -> empty -> populated, regression)', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);

    gantt.removeTask(toTaskId('a'));
    expect(container.querySelectorAll('.fg-task')).toHaveLength(0);

    expect(() =>
      gantt.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00')),
    ).not.toThrow();
    expect(container.querySelectorAll('.fg-task')).toHaveLength(1);
  });
});

describe('reactive re-render (the store -> render effect)', () => {
  it('a store mutation while mounted triggers a further render pass, without calling handle.update() directly', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    expect(container.querySelectorAll('.fg-task')).toHaveLength(1);

    gantt.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));

    expect(container.querySelectorAll('.fg-task')).toHaveLength(2);
  });

  it('removing every task down to zero does not throw and omits the critical path from that point on (0-task branch of §5.6)', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'), taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00')],
    });
    gantt.mount(container);
    expect(() => {
      gantt.removeTask(toTaskId('a'));
      gantt.removeTask(toTaskId('b'));
    }).not.toThrow();
    expect(container.querySelectorAll('.fg-task')).toHaveLength(0);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('drag commit -> facade event wiring', () => {
  function mountWithTask(options: Parameters<typeof createGantt>[0] = {}) {
    const gantt = createGantt({
      tasks: [taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00')],
      ...options,
    });
    gantt.mount(container);
    const groupEl = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    return { gantt, groupEl };
  }

  it('a drag gesture fires task:moved with the correct prevStart, and the store reflects the new start/end', () => {
    const { gantt, groupEl } = mountWithTask();
    const moved = vi.fn();
    gantt.on('task:moved', moved);
    const before = gantt.getTask(toTaskId('t1'))!;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    // pixelsPerDay(week) = 24 -> dx=48 => 2 days
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 148, clientY: 50 });

    expect(moved).toHaveBeenCalledTimes(1);
    const [task, prevStart] = moved.mock.calls[0] as [Task, unknown];
    expect(task.id).toBe('t1');
    expect(prevStart).toBe(before.start);

    const after = gantt.getTask(toTaskId('t1'))!;
    expect(after.start).not.toBe(before.start);
    expect(after.start.toString()).toContain('2026-01-07');
    expect(after.end.toString()).toContain('2026-01-09');
  });

  it("schedulingMode: 'auto' — a drag-move commit cascades: the dependent successor's task:moved fires (after the mover's own), and its stored start actually shifted (spec-cascade.md §9)", () => {
    const { gantt, groupEl } = mountWithTask({
      schedulingMode: 'auto',
      tasks: [
        taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00'),
        // t2 starts right after t1's original end — comfortably satisfied pre-drag, but the
        // drag below (t1 +2 days) pushes t1's end past t2's current start, violating the FS
        // link and forcing t2 to cascade.
        taskInput('t2', '2026-01-07T10:00', '2026-01-08T10:00'),
      ],
      dependencies: [{ from: toTaskId('t1'), to: toTaskId('t2'), type: 'FS' }],
    });
    const moved = vi.fn();
    gantt.on('task:moved', moved);
    const beforeT2 = gantt.getTask(toTaskId('t2'))!;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 }); // +2 days
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 148, clientY: 50 });

    const movedIds = moved.mock.calls.map((c) => (c[0] as Task).id);
    expect(movedIds[0]).toBe(toTaskId('t1')); // mover's own event fires first
    expect(movedIds).toContain(toTaskId('t2')); // then the cascaded successor

    const afterT2 = gantt.getTask(toTaskId('t2'))!;
    expect(afterT2.start).not.toBe(beforeT2.start);
  });

  it('readOnly: true — a synthetic drag never fires task:moved and never mutates the task', () => {
    const { gantt, groupEl } = mountWithTask({ readOnly: true });
    const moved = vi.fn();
    gantt.on('task:moved', moved);
    const before = gantt.getTask(toTaskId('t1'))!;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 148, clientY: 50 });

    expect(moved).not.toHaveBeenCalled();
    const after = gantt.getTask(toTaskId('t1'))!;
    expect(after.start).toBe(before.start);
    expect(after.end).toBe(before.end);
  });
});

describe('unmount() / remount()', () => {
  it('unmount() removes the <svg>; a subsequent mutation does not throw and does not touch the (absent) DOM', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    expect(container.querySelector('svg')).not.toBeNull();

    gantt.unmount();
    expect(container.querySelector('svg')).toBeNull();

    expect(() => gantt.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'))).not.toThrow();
    expect(container.children).toHaveLength(0);
  });

  it('mount() again after unmount() (remount) re-renders current state, including post-unmount mutations', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    gantt.unmount();
    gantt.addTask(taskInput('b', '2026-01-06T09:00', '2026-01-07T09:00'));

    gantt.mount(container);
    expect(container.querySelectorAll('.fg-task')).toHaveLength(2);
  });

  it('mount() called twice without an intervening unmount() (implicit remount, item A) leaves exactly one <svg>', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    const container2 = document.createElement('div');
    document.body.appendChild(container2);

    gantt.mount(container);
    gantt.mount(container2); // implicit remount into a different container

    expect(container.querySelectorAll('svg')).toHaveLength(0); // old mount torn down
    expect(container2.querySelectorAll('svg')).toHaveLength(1);

    container2.remove();
  });

  it('mount() called twice into the SAME container tears down the old <svg> first — no duplicate', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    gantt.mount(container);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});

describe('destroy() while mounted', () => {
  it('removes the <svg>; a drag mid-flight at the moment of destroy() leaves no leaked window pointer listeners', () => {
    const gantt = createGantt({ tasks: [taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00')] });
    gantt.mount(container);
    const groupEl = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    const moved = vi.fn();
    gantt.on('task:moved', moved);

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 148, clientY: 50 });

    gantt.destroy();
    expect(container.children).toHaveLength(0);

    expect(() => {
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 300, clientY: 50 });
      dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 300, clientY: 50 });
    }).not.toThrow();
    expect(moved).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
  });
});

describe('refresh() — manual repaint escape hatch', () => {
  it('repaints without throwing while mounted; a no-op headless/post-destroy', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    expect(() => gantt.refresh()).not.toThrow(); // headless, never mounted
    gantt.mount(container);
    expect(() => gantt.refresh()).not.toThrow();
    gantt.destroy();
    expect(() => gantt.refresh()).not.toThrow();
  });
});

describe('click-select — mount() wiring (spec-selection.md §12.4)', () => {
  it('clicking a rendered .fg-task adds fg-task--selected after the reactive re-render, and getSelection() reflects it', () => {
    const gantt = createGantt({
      tasks: [taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00')],
    });
    gantt.mount(container);
    const groupEl = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    expect(groupEl.classList.contains('fg-task--selected')).toBe(false);

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50 });

    const groupElAfter = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    expect(groupElAfter.classList.contains('fg-task--selected')).toBe(true);
    expect(gantt.getSelection()).toEqual([toTaskId('t1')]);
  });

  it("selection:changed fires on a real click via gantt.on(...)", () => {
    const gantt = createGantt({
      tasks: [taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00')],
    });
    gantt.mount(container);
    const changed = vi.fn();
    gantt.on('selection:changed', changed);
    const groupEl = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50 });

    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith([toTaskId('t1')]);
  });

  it('readOnly: true — drag-move does NOT fire, but click-select STILL works (Q2 regression)', () => {
    const gantt = createGantt({
      tasks: [taskInput('t1', '2026-01-05T09:00', '2026-01-07T09:00')],
      readOnly: true,
    });
    gantt.mount(container);
    const moved = vi.fn();
    const changed = vi.fn();
    gantt.on('task:moved', moved);
    gantt.on('selection:changed', changed);
    const groupEl = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;

    // A drag (exceeds threshold) must not move the task under readOnly.
    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 200, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 200, clientY: 50 });
    expect(moved).not.toHaveBeenCalled();

    // A plain click still selects.
    const groupEl2 = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    dispatchPointer(groupEl2, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 2, clientX: 100, clientY: 50 });

    const groupElAfter = container.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    expect(groupElAfter.classList.contains('fg-task--selected')).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(gantt.getSelection()).toEqual([toTaskId('t1')]);
  });

  it('a task both critical AND selected renders BOTH classes, and the inline critical stroke/stroke-dasharray are unaffected by selection', () => {
    // Two independent, equal-length tasks → both are critical (each is its own zero-slack path).
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-05T17:00'),
        taskInput('b', '2026-01-05T09:00', '2026-01-05T17:00'),
      ],
    });
    gantt.mount(container);
    gantt.select(toTaskId('a'));

    const groupEl = container.querySelector('.fg-task[data-task-id="a"]') as SVGGElement;
    expect(groupEl.classList.contains('fg-task--critical')).toBe(true);
    expect(groupEl.classList.contains('fg-task--selected')).toBe(true);

    const bar = groupEl.querySelector('.fg-task__bar') as SVGRectElement;
    expect(bar.style.getPropertyValue('stroke-dasharray')).not.toBe('');
    expect(bar.style.getPropertyValue('stroke')).not.toBe('');
  });

  it('aria-label includes ", selected" when selected, ", critical path" when critical, both suffixes (critical then selected) when both', () => {
    // Independent (no dependencies) tasks: a task's own late-finish is bounded by the
    // GLOBAL projectEnd (see computeCriticalPath's backward pass), so the LONGER task ('a',
    // whose own end IS projectEnd) is critical (zero slack), while the SHORTER task ('b',
    // ending before projectEnd) has positive slack — not critical. A third, unselected task
    // ('c') stays neither critical nor selected, as a negative control.
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-05T17:00'), // 8h — drives projectEnd, critical
        taskInput('b', '2026-01-05T09:00', '2026-01-05T13:00'), // 4h — ends early, positive slack
        taskInput('c', '2026-01-05T09:00', '2026-01-05T11:00'), // 2h — unselected control
      ],
    });
    gantt.mount(container);
    gantt.select([toTaskId('a'), toTaskId('b')]);

    const critAndSelected = container.querySelector('.fg-task[data-task-id="a"]') as SVGGElement;
    expect(critAndSelected.classList.contains('fg-task--critical')).toBe(true);
    expect(critAndSelected.classList.contains('fg-task--selected')).toBe(true);
    expect(critAndSelected.getAttribute('aria-label')).toMatch(/critical path, selected$/);

    const selectedOnly = container.querySelector('.fg-task[data-task-id="b"]') as SVGGElement;
    expect(selectedOnly.classList.contains('fg-task--critical')).toBe(false);
    expect(selectedOnly.classList.contains('fg-task--selected')).toBe(true);
    expect(selectedOnly.getAttribute('aria-label')).toMatch(/, selected$/);
    expect(selectedOnly.getAttribute('aria-label')).not.toMatch(/critical path/);

    const neither = container.querySelector('.fg-task[data-task-id="c"]') as SVGGElement;
    expect(neither.classList.contains('fg-task--critical')).toBe(false);
    expect(neither.classList.contains('fg-task--selected')).toBe(false);
    expect(neither.getAttribute('aria-label')).not.toMatch(/selected/);
  });

  it('aria-selected reflects selection state on every row (spec-keyboard-nav.md §3.2 supersedes the old §8 "no aria-selected" decision)', () => {
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('b', '2026-01-07T09:00', '2026-01-08T09:00'),
      ],
    });
    gantt.mount(container);
    gantt.select(toTaskId('a'));

    const rowA = container.querySelector('.fg-timeline__row[data-task-id="a"]');
    const rowB = container.querySelector('.fg-timeline__row[data-task-id="b"]');
    expect(rowA!.getAttribute('aria-selected')).toBe('true');
    expect(rowB!.getAttribute('aria-selected')).toBe('false');
  });
});

describe('zoomTo() — mounted repaint + scroll-anchor preservation (spec-zoom-runtime.md §13.2)', () => {
  it('zoomTo() while mounted triggers exactly one additional synchronous repaint reflecting the new viewMode', () => {
    const gantt = createGantt({
      viewMode: 'week',
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    gantt.mount(container);
    const svg = container.querySelector('svg')!;
    const widthBefore = svg.getAttribute('width');

    gantt.zoomTo('month'); // pixelsPerDay shrinks (24 -> 8) -> total width shrinks

    const svgAfter = container.querySelector('svg')!;
    expect(svgAfter.getAttribute('width')).not.toBe(widthBefore);
  });

  it('scroll-anchor preservation: the centered date stays centered across a zoom, computed independently via dateToX/xToDate', () => {
    const gantt = createGantt({
      viewMode: 'week',
      tasks: [
        taskInput('a', '2026-01-01T09:00', '2026-06-30T09:00'), // wide range so scrolling is meaningful
      ],
    });
    gantt.mount(container);

    // Reach into the actually-rendered <svg>'s parent (container) — stub realistic scrolled
    // geometry the same way drag-resize.test.ts stubs getBoundingClientRect (jsdom has no
    // layout engine).
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'scrollWidth', { value: 4000, configurable: true });
    let scrollLeftValue = 500;
    Object.defineProperty(container, 'scrollLeft', {
      get: () => scrollLeftValue,
      set: (v: number) => {
        scrollLeftValue = v;
      },
      configurable: true,
    });

    // Independently compute the expected anchor date + expected new scrollLeft using the
    // SAME dateToX/xToDate formula the implementation uses, via a second, independently
    // created renderer at the OLD viewMode/tasks (not a re-use of gantt's internals).
    const tasksSnapshot = gantt.getTasks();
    const before = createSvgRenderer(document.createElement('div'), {
      tasks: tasksSnapshot,
      dependencies: [],
    }, { viewMode: 'week' });
    const LABEL_COLUMN_WIDTH = 160; // mirrors render/svg-renderer.ts's exported constant value
    const anchorContentX = 500 + 800 / 2 - LABEL_COLUMN_WIDTH;
    const anchorDate = before.getTimeScale().xToDate(anchorContentX);

    const after = createSvgRenderer(document.createElement('div'), {
      tasks: tasksSnapshot,
      dependencies: [],
    }, { viewMode: 'month' });
    const expectedNewAnchorX = after.getTimeScale().dateToX(anchorDate);
    const expectedScrollLeft = expectedNewAnchorX + LABEL_COLUMN_WIDTH - 800 / 2;

    gantt.zoomTo('month');

    expect(container.scrollLeft).toBeCloseTo(expectedScrollLeft, 0);
  });

  it('robustness: zoomTo() on a mounted chart with NO DOM geometry stubbing (all-zero jsdom defaults) does not throw and produces a finite scrollLeft', () => {
    const gantt = createGantt({
      viewMode: 'week',
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    gantt.mount(container);

    expect(() => gantt.zoomTo('year')).not.toThrow();
    expect(Number.isFinite(container.scrollLeft)).toBe(true);
    expect(Number.isNaN(container.scrollLeft)).toBe(false);
  });

  it('zoom on an empty chart (0 tasks, EMPTY_STATE_WINDOW_DAYS fallback range) does not throw, view mode still updates', () => {
    const gantt = createGantt({ viewMode: 'week' });
    gantt.mount(container);
    expect(() => gantt.zoomTo('quarter')).not.toThrow();
    expect(gantt.getViewMode()).toBe('quarter');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('keyboard focus survives a zoom-triggered repaint (regression: existing unconditional focus-restoration mechanism, new trigger)', () => {
    const gantt = createGantt({
      viewMode: 'week',
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00'),
        taskInput('b', '2026-01-07T09:00', '2026-01-08T09:00'),
      ],
    });
    gantt.mount(container);

    // Move keyboard-nav's own focus state to row 'b' (roving tabindex) via a real Tab-in
    // (.focus()) followed by an ArrowDown keydown — matching keyboard-nav.test.ts's own
    // setup pattern. The renderer's `hadFocusInside` focus-restoration gate (spec §4.5)
    // only restores focus if `document.activeElement` was already inside the <svg> BEFORE
    // the repaint, so the initial `.focus()` on row 'a' is required, not optional.
    const rowA = container.querySelector('.fg-timeline__row[data-task-id="a"]') as SVGElement & {
      focus(opts?: FocusOptions): void;
    };
    rowA.focus();
    rowA.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));

    const rowB = container.querySelector('.fg-timeline__row[data-task-id="b"]') as SVGElement;
    expect(rowB.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(rowB);

    gantt.zoomTo('day');

    const rowBAfter = container.querySelector('.fg-timeline__row[data-task-id="b"]') as SVGElement;
    expect(rowBAfter).not.toBeNull();
    expect(rowBAfter.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(rowBAfter);
  });

  it("mount() -> zoomTo('day') -> unmount() -> mount() again: the second mount reflects 'day', not the original construction-time viewMode", () => {
    const gantt = createGantt({
      viewMode: 'week',
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')],
    });
    gantt.mount(container);
    gantt.zoomTo('day');
    gantt.unmount();

    const container2 = document.createElement('div');
    document.body.appendChild(container2);
    gantt.mount(container2);

    // pixelsPerDay(day) = 60, much wider than week(24) or the original construction default
    // — assert via the getViewMode() facade getter (state lives on the Gantt instance, not
    // the mount-scoped renderer handle) rather than re-deriving pixel widths here.
    expect(gantt.getViewMode()).toBe('day');
    container2.remove();
  });
});

describe('critical-path:computed — emit-on-change from the render effect (fix #3)', () => {
  it('does not re-emit when a mutation leaves the critical set unchanged; re-emits when it changes', () => {
    // Two independent, equal-length tasks → both are critical (each is its own zero-slack path).
    const gantt = createGantt({
      tasks: [
        taskInput('a', '2026-01-05T09:00', '2026-01-05T17:00'),
        taskInput('b', '2026-01-05T09:00', '2026-01-05T17:00'),
      ],
    });
    const computed = vi.fn();
    gantt.on('critical-path:computed', computed);
    gantt.mount(container); // effect runs once → 1 initial emit
    const afterMount = computed.mock.calls.length;
    expect(afterMount).toBe(1);

    // setProgress doesn't affect scheduling → critical set unchanged → NO re-emit
    // (the render effect still runs, but critical-path:computed is gated on change).
    gantt.setProgress(toTaskId('a'), 0.5);
    expect(computed.mock.calls.length).toBe(afterMount);

    // Adding a longer task makes it the sole critical task → critical set changes → re-emit.
    gantt.addTask(taskInput('c', '2026-01-05T09:00', '2026-01-08T17:00'));
    expect(computed.mock.calls.length).toBe(afterMount + 1);
    expect(computed.mock.lastCall?.[0]).toEqual([toTaskId('c')]);
  });
});

// --- Renderer auto-switch (spec-canvas-auto-switch.md §11) -------------------------------

/** `n` distinct, flat (no `parent`), same-day tasks — row count is all that matters for the
 *  auto-switch threshold check, so every task shares one minimal date span (keeps TimeScale's
 *  derived grid/width small and this helper fast, mirrors canvas-renderer.test.ts's own
 *  `buildFlatTasks` reasoning for why date overlap is irrelevant to row count). */
function buildManyTasks(n: number): TaskInput[] {
  const tasks: TaskInput[] = [];
  for (let i = 0; i < n; i++) {
    tasks.push(taskInput(`t${i}`, '2026-01-05T09:00', '2026-01-05T17:00'));
  }
  return tasks;
}

/** Lenient Proxy-based `CanvasRenderingContext2D` stub — unlike `canvas-renderer.test.ts`'s
 *  call-log-tracking `MockContext2D` (built to assert exact draw calls), these tests only need
 *  "a real Canvas mount completes without throwing and paints *something*", so any unknown
 *  method/property read returns a harmless no-op function (covers the `typeof ctx.roundRect ===
 *  'function'` feature-detection in `canvas-renderer.ts` too — the Proxy always answers
 *  `'function'` for an unset method). Installed via `vi.spyOn` (auto-restored by this file's
 *  existing `afterEach(() => vi.restoreAllMocks())`), matching the exact pattern
 *  `canvas-renderer.test.ts`'s own `installMockContext` established. */
function installMockCanvasContext(): void {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return (..._args: unknown[]): void => {};
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  };
  const ctx = new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
}

// A real mount() of 2000+ tasks does genuine, CPU-heavy DOM work under jsdom (2000+ real
// `<g class="fg-task">` elements, or 2000+ real Canvas 2D draw-call sequences against the
// Proxy stub above) — comfortably outside vitest's 5s default test/assertion timeouts on a
// loaded machine, even though the behavior under test is correct. Every test below that
// mounts an above-threshold project passes an explicit generous timeout (both at the `it()`
// level and to `vi.waitFor()`) for exactly that reason — not masking a bug, just sizing the
// budget to the genuinely heavy DOM work spec-canvas-auto-switch.md §11 asks these tests to
// exercise for real (no renderer internals are stubbed beyond the 2D context itself).
const HEAVY_TEST_TIMEOUT_MS = 60_000;
const HEAVY_WAIT_FOR_TIMEOUT_MS = 30_000;

describe('renderer auto-switch (spec-canvas-auto-switch.md)', () => {
  it(
    'taskCount at/below CANVAS_AUTO_SWITCH_THRESHOLD mounts SVG synchronously; renderer:selected fires before mount() returns, no canvasFallbackReason',
    () => {
      const gantt = createGantt({ tasks: buildManyTasks(CANVAS_AUTO_SWITCH_THRESHOLD) });
      const selected = vi.fn();
      gantt.on('renderer:selected', selected);

      gantt.mount(container);

      expect(container.querySelector('svg')).not.toBeNull();
      expect(container.querySelector('canvas')).toBeNull();
      expect(selected).toHaveBeenCalledTimes(1);
      expect(selected).toHaveBeenCalledWith({ renderer: 'svg', taskCount: CANVAS_AUTO_SWITCH_THRESHOLD });
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'taskCount above the threshold: mount() returns synchronously with the container still empty; renderer:selected fires later with renderer "canvas"',
    async () => {
      installMockCanvasContext();
      const taskCount = CANVAS_AUTO_SWITCH_THRESHOLD + 1;
      const gantt = createGantt({ tasks: buildManyTasks(taskCount) });
      const selected = vi.fn();
      gantt.on('renderer:selected', selected);

      gantt.mount(container);

      // mount() has already returned at this point — nothing painted yet, event not fired yet.
      expect(container.querySelector('canvas')).toBeNull();
      expect(container.querySelector('svg')).toBeNull();
      expect(selected).not.toHaveBeenCalled();

      await vi.waitFor(
        () => {
          expect(selected).toHaveBeenCalledTimes(1);
        },
        HEAVY_WAIT_FOR_TIMEOUT_MS,
      );
      expect(selected).toHaveBeenCalledWith({ renderer: 'canvas', taskCount });
      expect(container.querySelector('canvas')).not.toBeNull();
      expect(container.querySelector('svg')).toBeNull();
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'CanvasDimensionExceededError during Canvas construction falls back to SVG with canvasFallbackReason "dimension-exceeded", warning exactly once',
    async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(createCanvasRenderer).mockImplementationOnce(() => {
        throw new CanvasDimensionExceededError('height', 100_000, 32_767, 3000, 1);
      });
      const taskCount = CANVAS_AUTO_SWITCH_THRESHOLD + 1;
      const gantt = createGantt({ tasks: buildManyTasks(taskCount) });
      const selected = vi.fn();
      gantt.on('renderer:selected', selected);

      gantt.mount(container);

      await vi.waitFor(
        () => {
          expect(selected).toHaveBeenCalledTimes(1);
        },
        HEAVY_WAIT_FOR_TIMEOUT_MS,
      );
      expect(selected).toHaveBeenCalledWith({
        renderer: 'svg',
        taskCount,
        canvasFallbackReason: 'dimension-exceeded',
      });
      expect(container.querySelector('svg')).not.toBeNull();
      expect(container.querySelector('canvas')).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'a generic (non-CanvasDimensionExceededError) Canvas construction failure falls back to SVG with canvasFallbackReason "construction-failed"',
    async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(createCanvasRenderer).mockImplementationOnce(() => {
        throw new Error('simulated construction failure');
      });
      const taskCount = CANVAS_AUTO_SWITCH_THRESHOLD + 1;
      const gantt = createGantt({ tasks: buildManyTasks(taskCount) });
      const selected = vi.fn();
      gantt.on('renderer:selected', selected);

      gantt.mount(container);

      await vi.waitFor(
        () => {
          expect(selected).toHaveBeenCalledTimes(1);
        },
        HEAVY_WAIT_FOR_TIMEOUT_MS,
      );
      expect(selected).toHaveBeenCalledWith({
        renderer: 'svg',
        taskCount,
        canvasFallbackReason: 'construction-failed',
      });
      expect(container.querySelector('svg')).not.toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'a dynamic import() rejection (simulated chunk-load failure) falls back to SVG with canvasFallbackReason "load-failed"',
    async () => {
      // Isolated per-test module-registry override (NOT the shared, static, file-level
      // vi.mock() above): a real ES module that throws during evaluation stays permanently
      // failed in the registry it was evaluated in, so simulating "the import() promise
      // itself rejects" needs a fresh module graph, scoped to just this one test, rather than
      // reusing the always-passthrough `createCanvasRenderer` mock every other test in this
      // block relies on.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.resetModules();
      vi.doMock('../../src/render/canvas-renderer.js', () => {
        throw new Error('simulated chunk-load failure');
      });
      try {
        const { createGantt: createGanttFresh } = await import('../../src/gantt.js');
        const taskCount = CANVAS_AUTO_SWITCH_THRESHOLD + 1;
        const gantt = createGanttFresh({ tasks: buildManyTasks(taskCount) });
        const selected = vi.fn();
        gantt.on('renderer:selected', selected);

        gantt.mount(container);

        await vi.waitFor(
          () => {
            expect(selected).toHaveBeenCalledTimes(1);
          },
          HEAVY_WAIT_FOR_TIMEOUT_MS,
        );
        expect(selected).toHaveBeenCalledWith({
          renderer: 'svg',
          taskCount,
          canvasFallbackReason: 'load-failed',
        });
        expect(container.querySelector('svg')).not.toBeNull();
        expect(container.querySelector('canvas')).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        vi.doUnmock('../../src/render/canvas-renderer.js');
        vi.resetModules();
      }
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'race guard: unmount() before an in-flight above-threshold mount() resolves — no renderer:selected, container untouched, no throw',
    async () => {
      installMockCanvasContext();
      const gantt = createGantt({ tasks: buildManyTasks(CANVAS_AUTO_SWITCH_THRESHOLD + 1) });
      const selected = vi.fn();
      gantt.on('renderer:selected', selected);

      expect(() => {
        gantt.mount(container); // async Canvas attempt started, not awaited
        gantt.unmount(); // supersedes before the dynamic import()/construction resolves
      }).not.toThrow();

      // Flush the still in-flight microtasks the abandoned attempt was suspended on.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(selected).not.toHaveBeenCalled();
      expect(container.querySelector('canvas')).toBeNull();
      expect(container.querySelector('svg')).toBeNull();
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'race guard: a second mount() into a different container supersedes an in-flight first mount() — only the later attempt completes',
    async () => {
      installMockCanvasContext();
      const gantt = createGantt({ tasks: buildManyTasks(CANVAS_AUTO_SWITCH_THRESHOLD + 1) });
      const containerB = document.createElement('div');
      document.body.appendChild(containerB);
      const selected = vi.fn();
      gantt.on('renderer:selected', selected);

      gantt.mount(container); // first attempt, not awaited
      gantt.mount(containerB); // supersedes before the first resolves

      await vi.waitFor(
        () => {
          expect(selected).toHaveBeenCalledTimes(1);
        },
        HEAVY_WAIT_FOR_TIMEOUT_MS,
      );
      expect(selected).toHaveBeenCalledWith(expect.objectContaining({ renderer: 'canvas' }));
      expect(container.querySelector('canvas')).toBeNull();
      expect(containerB.querySelector('canvas')).not.toBeNull();

      containerB.remove();
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'exportSvg()/exportPng() throw a clear "Canvas-rendering mode" error while Canvas-mounted; still work while SVG-mounted (regression)',
    async () => {
      installMockCanvasContext();
      const gantt = createGantt({ tasks: buildManyTasks(CANVAS_AUTO_SWITCH_THRESHOLD + 1) });
      gantt.mount(container);
      await vi.waitFor(
        () => {
          expect(container.querySelector('canvas')).not.toBeNull();
        },
        HEAVY_WAIT_FOR_TIMEOUT_MS,
      );

      expect(() => gantt.exportSvg()).toThrow(/Canvas-rendering mode/);
      await expect(gantt.exportPng()).rejects.toThrow(/Canvas-rendering mode/);

      const svgGantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
      const svgContainer = document.createElement('div');
      document.body.appendChild(svgContainer);
      svgGantt.mount(svgContainer);
      expect(() => svgGantt.exportSvg()).not.toThrow();
      svgContainer.remove();
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'zoomTo()/zoomIn()/zoomOut()/refresh() do not throw while Canvas-mounted, and repaint',
    async () => {
      installMockCanvasContext();
      const gantt = createGantt({
        viewMode: 'week',
        tasks: buildManyTasks(CANVAS_AUTO_SWITCH_THRESHOLD + 1),
      });
      gantt.mount(container);
      await vi.waitFor(
        () => {
          expect(container.querySelector('canvas')).not.toBeNull();
        },
        HEAVY_WAIT_FOR_TIMEOUT_MS,
      );

      expect(() => gantt.zoomTo('month')).not.toThrow();
      expect(gantt.getViewMode()).toBe('month');
      expect(() => gantt.zoomIn()).not.toThrow();
      expect(() => gantt.zoomOut()).not.toThrow();
      expect(() => gantt.refresh()).not.toThrow();
      expect(container.querySelector('canvas')).not.toBeNull();
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'readOnly: true in Canvas mode — the SVG-only interaction disposers are inert no-ops; unmount()/destroy() do not throw and are idempotent',
    async () => {
      installMockCanvasContext();
      const gantt = createGantt({
        readOnly: true,
        tasks: buildManyTasks(CANVAS_AUTO_SWITCH_THRESHOLD + 1),
      });
      gantt.mount(container);
      await vi.waitFor(
        () => {
          expect(container.querySelector('canvas')).not.toBeNull();
        },
        HEAVY_WAIT_FOR_TIMEOUT_MS,
      );

      expect(() => {
        gantt.unmount();
        gantt.unmount(); // idempotent — no-op second call
      }).not.toThrow();
      expect(container.querySelector('canvas')).toBeNull();

      gantt.mount(container);
      await vi.waitFor(
        () => {
          expect(container.querySelector('canvas')).not.toBeNull();
        },
        HEAVY_WAIT_FOR_TIMEOUT_MS,
      );
      expect(() => {
        gantt.destroy();
        gantt.destroy(); // idempotent — no-op second call
      }).not.toThrow();
      expect(container.querySelector('canvas')).toBeNull();
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
