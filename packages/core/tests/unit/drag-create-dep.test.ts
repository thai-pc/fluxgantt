// @vitest-environment jsdom
//
// Interaction — drag-create-dependency tests (spec-drag-create-dependency.md §9). Runs under
// jsdom (per-file override; the rest of core stays `environment: 'node'`), reusing
// `drag-resize.test.ts`'s `PointerEventPolyfill`/`dispatchPointer` helper pattern.
//
// IMPORTANT DEVIATION from the drag-move/drag-resize test pattern (spec §9): this feature's
// drop resolution reads `event.target`, so any test that needs a specific drop target must
// dispatch the terminating `pointerup` (and, for `onLinking` candidate assertions,
// intermediate `pointermove`s) directly on the intended element with `bubbles: true`, not on
// `window`. Dispatching on `window` (or any element outside `.fg-task`) simulates "drop on
// empty space".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { enableDragCreateDep } from '../../src/interaction/drag-create-dep.js';
import { enableDragResize } from '../../src/interaction/drag-resize.js';
import { enableDragMove } from '../../src/interaction/drag-move.js';
import { toTaskId, type Task, type TaskId } from '../../src/types.js';

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

// --- Pointer polyfill (mirrors drag-resize.test.ts) ------------------------------------
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

describe('enableDragCreateDep — DOM interaction', () => {
  let container: HTMLElement;
  let tasks: Task[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tasks = [
      task('t1', '2026-01-05T09:00', '2026-01-07T09:00'),
      task('t2', '2026-01-10T09:00', '2026-01-12T09:00'),
    ];
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function setup(options: Parameters<typeof enableDragCreateDep>[2]) {
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl1 = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    const groupEl2 = handle.svg.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;
    const dispose = enableDragCreateDep(handle, () => tasks, options);
    return { handle, groupEl1, groupEl2, dispose };
  }

  function handleEl(groupEl: Element, end: 'start' | 'end'): SVGCircleElement {
    return groupEl.querySelector(`.fg-task__link-handle[data-handle-end="${end}"]`) as SVGCircleElement;
  }

  function handleCoords(el: SVGCircleElement): { cx: number; cy: number } {
    return { cx: Number(el.getAttribute('cx')), cy: Number(el.getAttribute('cy')) };
  }

  // --- hitTest targeting -------------------------------------------------------------------

  it('renders exactly two link handles (start + end) per task bar', () => {
    const { groupEl1 } = setup({ onDependencyCreated: vi.fn() });
    expect(groupEl1.querySelectorAll('.fg-task__link-handle')).toHaveLength(2);
    expect(handleEl(groupEl1, 'start')).toBeTruthy();
    expect(handleEl(groupEl1, 'end')).toBeTruthy();
  });

  it('pointerdown on the bar body (not a handle) never claims — gesture never starts', () => {
    const onDependencyCreated = vi.fn();
    const { groupEl1 } = setup({ onDependencyCreated });
    const barEl = groupEl1.querySelector('.fg-task__bar')!;
    const x = Number(barEl.getAttribute('x'));
    const width = Number(barEl.getAttribute('width'));
    const midX = x + width / 2;

    dispatchPointer(barEl, 'pointerdown', { pointerId: 1, clientX: midX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: midX + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: midX + 48, clientY: 50 });

    expect(onDependencyCreated).not.toHaveBeenCalled();
    expect(container.querySelector('.fg-dependency-preview')).toBeNull();
  });

  // Which handle was grabbed sets the FS edge DIRECTION (predecessor.finish → successor.start):
  //  - END handle of t1 → t1 is the predecessor → t1 → t2.
  //  - START handle of t1 → t1 is the successor → the drop target t2 is the predecessor → t2 → t1.
  it.each([
    ['end', ['t1', 't2']],
    ['start', ['t2', 't1']],
  ] as const)(
    'pointerdown on the %s handle claims the gesture and links in that end’s direction',
    (end, [expectedFrom, expectedTo]) => {
      const onDependencyCreated = vi.fn();
      const onLinking = vi.fn();
      const { groupEl1, groupEl2 } = setup({ onDependencyCreated, onLinking });
      const h = handleEl(groupEl1, end);
      const { cx, cy } = handleCoords(h);

      dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
      dispatchPointer(groupEl2, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy, bubbles: true });

      expect(onDependencyCreated).toHaveBeenCalledTimes(1);
      expect(onDependencyCreated).toHaveBeenCalledWith(expectedFrom, expectedTo);
    },
  );

  // Regression (review A1): a PURELY VERTICAL link drag (dx=0) must cross the drag threshold —
  // the coordinator's old horizontal-only `Math.abs(dxRaw)` gate never fired for it, so the
  // single most common geometry (link a task to the one directly below it) silently no-op'd.
  it('a straight-down drag (dx=0, dy past the threshold) still starts and commits the link', () => {
    const onDependencyCreated = vi.fn();
    const { groupEl1, groupEl2 } = setup({ onDependencyCreated });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    // Same X, only Y moves — radial distance = 20px ≥ 4px threshold.
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx, clientY: cy + 20 });
    dispatchPointer(groupEl2, 'pointerup', { pointerId: 1, clientX: cx, clientY: cy + 20, bubbles: true });

    expect(onDependencyCreated).toHaveBeenCalledTimes(1);
    expect(onDependencyCreated).toHaveBeenCalledWith('t1', 't2');
  });

  // --- Priority beats resize/move -----------------------------------------------------------

  it('priority beats resize: pointerdown exactly on the END handle claims link, resize never fires', () => {
    const onDependencyCreated = vi.fn();
    const onTaskResized = vi.fn();
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl1 = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    const groupEl2 = handle.svg.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;
    enableDragResize(handle, () => tasks, { onTaskResized });
    enableDragCreateDep(handle, () => tasks, { onDependencyCreated });

    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    dispatchPointer(groupEl2, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy, bubbles: true });

    expect(onDependencyCreated).toHaveBeenCalledTimes(1);
    expect(onTaskResized).not.toHaveBeenCalled();
  });

  it('regression: pointerdown inside the resize edge zone but NOT on the handle itself still claims resize', () => {
    const onDependencyCreated = vi.fn();
    const onTaskResized = vi.fn();
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl1 = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    enableDragResize(handle, () => tasks, { onTaskResized });
    enableDragCreateDep(handle, () => tasks, { onDependencyCreated });

    const barEl = groupEl1.querySelector('.fg-task__bar')!;
    const x = Number(barEl.getAttribute('x'));
    const width = Number(barEl.getAttribute('width'));
    const rightEdgeX = x + width;
    // 6px left of the exact right edge — inside the default 8px resize zone, but NOT on the
    // handle circle itself (dispatched on the bar, not the handle element).
    const nearEdge = rightEdgeX - 6;

    dispatchPointer(barEl, 'pointerdown', { pointerId: 1, clientX: nearEdge, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: nearEdge + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: nearEdge + 48, clientY: 50 });

    expect(onTaskResized).toHaveBeenCalledTimes(1);
    expect(onDependencyCreated).not.toHaveBeenCalled();
  });

  it('priority beats move: pointerdown on the bar body still claims move, not link', () => {
    const onDependencyCreated = vi.fn();
    const onTaskMoved = vi.fn();
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl1 = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    enableDragMove(handle, () => tasks, { onTaskMoved });
    enableDragCreateDep(handle, () => tasks, { onDependencyCreated });

    const barEl = groupEl1.querySelector('.fg-task__bar')!;
    const x = Number(barEl.getAttribute('x'));
    const width = Number(barEl.getAttribute('width'));
    const midX = x + width / 2;

    dispatchPointer(barEl, 'pointerdown', { pointerId: 1, clientX: midX, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: midX + 48, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: midX + 48, clientY: 50 });

    expect(onTaskMoved).toHaveBeenCalledTimes(1);
    expect(onDependencyCreated).not.toHaveBeenCalled();
  });

  // --- Target resolution ---------------------------------------------------------------------

  it('valid drop: dragging from A onto B calls onDependencyCreated(A, B) exactly once', () => {
    const onDependencyCreated = vi.fn();
    const { groupEl1, groupEl2 } = setup({ onDependencyCreated });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    // Drop on a DESCENDANT of B's group (its own bar), not just the group itself.
    const barEl2 = groupEl2.querySelector('.fg-task__bar')!;
    dispatchPointer(barEl2, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy, bubbles: true });

    expect(onDependencyCreated).toHaveBeenCalledTimes(1);
    expect(onDependencyCreated).toHaveBeenCalledWith('t1', 't2');
  });

  it('self drop: dropping back on the origin task never calls onDependencyCreated', () => {
    const onDependencyCreated = vi.fn();
    const { groupEl1 } = setup({ onDependencyCreated });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    dispatchPointer(groupEl1, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy, bubbles: true });

    expect(onDependencyCreated).not.toHaveBeenCalled();
  });

  it('empty-space drop: dropping on window/a plain div never calls onDependencyCreated', () => {
    const onDependencyCreated = vi.fn();
    const { groupEl1 } = setup({ onDependencyCreated });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy });

    expect(onDependencyCreated).not.toHaveBeenCalled();
  });

  // --- onLinking live candidate -------------------------------------------------------------

  it('onLinking reports the live drop candidate under the pointer, undefined for empty space', () => {
    const onDependencyCreated = vi.fn();
    const onLinking = vi.fn();
    const { groupEl1, groupEl2 } = setup({ onDependencyCreated, onLinking });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy }); // start the gesture
    onLinking.mockClear();

    dispatchPointer(groupEl2, 'pointermove', { pointerId: 1, clientX: cx + 30, clientY: cy, bubbles: true });
    expect(onLinking).toHaveBeenLastCalledWith('t1', 't2');

    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 40, clientY: cy });
    expect(onLinking).toHaveBeenLastCalledWith('t1', undefined);

    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: cx + 40, clientY: cy });
  });

  // --- Preview lifecycle ----------------------------------------------------------------------

  it('below dragThresholdPx: no .fg-dependency-preview element ever appended', () => {
    const { handle, groupEl1 } = setup({ onDependencyCreated: vi.fn() });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 2, clientY: cy }); // < default 4px
    expect(handle.svg.querySelector('.fg-dependency-preview')).toBeNull();
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: cx + 2, clientY: cy });
  });

  it('past threshold: exactly one preview path appended with pointer-events:none and a d attribute starting at the handle origin', () => {
    const { handle, groupEl1 } = setup({ onDependencyCreated: vi.fn() });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });

    const previews = handle.svg.querySelectorAll('.fg-dependency-preview');
    expect(previews).toHaveLength(1);
    const path = previews[0] as SVGPathElement;
    expect(path.style.pointerEvents).toBe('none');
    expect(path.getAttribute('d')).toContain(`M ${cx} ${cy}`);

    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy });
  });

  it('pointermove updates the d attribute second point', () => {
    const { handle, groupEl1 } = setup({ onDependencyCreated: vi.fn() });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    const path = handle.svg.querySelector('.fg-dependency-preview') as SVGPathElement;
    const dAfterFirstMove = path.getAttribute('d');

    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 40, clientY: cy });
    expect(path.getAttribute('d')).not.toBe(dAfterFirstMove);

    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: cx + 40, clientY: cy });
  });

  it('commit (valid drop): preview removed from the DOM', () => {
    const { handle, groupEl1, groupEl2 } = setup({ onDependencyCreated: vi.fn() });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    dispatchPointer(groupEl2, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy, bubbles: true });

    expect(handle.svg.querySelector('.fg-dependency-preview')).toBeNull();
  });

  it('commit (self/empty-space silent revert): preview ALSO removed', () => {
    const { handle, groupEl1 } = setup({ onDependencyCreated: vi.fn() });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy }); // empty space

    expect(handle.svg.querySelector('.fg-dependency-preview')).toBeNull();
  });

  it('escape mid-drag: onCancel fires, preview removed, LINKING_CLASS removed, cursor reset', () => {
    const { handle, groupEl1 } = setup({ onDependencyCreated: vi.fn() });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    expect(groupEl1.classList.contains('fg-task--linking')).toBe(true);
    expect(document.body.style.cursor).toBe('crosshair');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(handle.svg.querySelector('.fg-dependency-preview')).toBeNull();
    expect(groupEl1.classList.contains('fg-task--linking')).toBe(false);
    expect(document.body.style.cursor).toBe('');
  });

  // --- Pointer-capture release ---------------------------------------------------------------

  it('releasePointerCapture is invoked on the handle element after the drag starts', () => {
    const { groupEl1 } = setup({ onDependencyCreated: vi.fn() });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);
    const releaseSpy = vi.fn();
    (h as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture = releaseSpy;

    expect(() => {
      dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
      dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    }).not.toThrow();

    expect(releaseSpy).toHaveBeenCalled();
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy });
  });

  // --- Race guards -----------------------------------------------------------------------------

  it('race guard: getTasks() no longer containing the origin task at hitTest time declines', () => {
    const onDependencyCreated = vi.fn();
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl1 = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    enableDragCreateDep(handle, () => tasks.filter((t) => t.id !== toTaskId('t1')), { onDependencyCreated });

    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy });

    expect(onDependencyCreated).not.toHaveBeenCalled();
    expect(handle.svg.querySelector('.fg-dependency-preview')).toBeNull();
  });

  it('disposer mid-drag cancels the open gesture (no commit)', () => {
    const onDependencyCreated = vi.fn();
    const { handle, groupEl1, dispose } = setup({ onDependencyCreated });
    const h = handleEl(groupEl1, 'end');
    const { cx, cy } = handleCoords(h);

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });

    dispose();

    expect(handle.svg.querySelector('.fg-dependency-preview')).toBeNull();
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy });
    expect(onDependencyCreated).not.toHaveBeenCalled();
  });
});

// --- Milestones — allowed, no exclusion (unlike drag-resize) -------------------------------

describe('enableDragCreateDep — milestones are valid link endpoints', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('a milestone renders link handles and can be dragged as a source', () => {
    const tasks: Task[] = [
      task('m1', '2026-01-05T09:00', '2026-01-05T09:00', { type: 'milestone' }),
      task('t2', '2026-01-10T09:00', '2026-01-12T09:00'),
    ];
    const onDependencyCreated = vi.fn();
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const groupEl1 = handle.svg.querySelector('.fg-task[data-task-id="m1"]') as SVGGElement;
    const groupEl2 = handle.svg.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;
    enableDragCreateDep(handle, () => tasks, { onDependencyCreated });

    const h = groupEl1.querySelector('.fg-task__link-handle[data-handle-end="end"]') as SVGCircleElement;
    const cx = Number(h.getAttribute('cx'));
    const cy = Number(h.getAttribute('cy'));

    dispatchPointer(h, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: cx + 20, clientY: cy });
    dispatchPointer(groupEl2, 'pointerup', { pointerId: 1, clientX: cx + 20, clientY: cy, bubbles: true });

    expect(onDependencyCreated).toHaveBeenCalledTimes(1);
    expect(onDependencyCreated).toHaveBeenCalledWith('m1', 't2' as TaskId);
  });
});
