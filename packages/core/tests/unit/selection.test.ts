// @vitest-environment jsdom
//
// Interaction — click-select tests (spec-selection.md §12.3). Runs under jsdom (per-file
// override; the rest of core stays `environment: 'node'`), mirroring
// `drag-move.test.ts`'s `PointerEventPolyfill` setup exactly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { createCanvasRenderer } from '../../src/render/canvas-renderer.js';
import { enableClickSelect } from '../../src/interaction/selection.js';
import type { InteractiveRendererHandle } from '../../src/render/interactive-renderer-handle.js';
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
  init: {
    pointerId: number;
    clientX: number;
    clientY: number;
    bubbles?: boolean;
    button?: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  },
): void {
  target.dispatchEvent(
    new PointerEventCtor(type, {
      pointerId: init.pointerId,
      clientX: init.clientX,
      clientY: init.clientY,
      bubbles: init.bubbles ?? false,
      cancelable: true,
      button: init.button ?? 0,
      shiftKey: init.shiftKey ?? false,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
    }),
  );
}

describe('enableClickSelect — DOM interaction', () => {
  let container: HTMLElement;
  let tasks: Task[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tasks = [
      task('t1', '2026-01-05T09:00', '2026-01-07T09:00'),
      task('t2', '2026-01-10T09:00', '2026-01-12T09:00'),
      task('t3', '2026-01-15T09:00', '2026-01-17T09:00'),
    ];
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function setup(options?: Partial<Parameters<typeof enableClickSelect>[2]>) {
    const handle = createSvgRenderer(container, { tasks, dependencies: [] });
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const onRangeSelect = vi.fn();
    const onClear = vi.fn();
    const dispose = enableClickSelect(handle, () => tasks, {
      onSelect,
      onToggle,
      onRangeSelect,
      onClear,
      ...options,
    });
    return { handle, dispose, onSelect, onToggle, onRangeSelect, onClear };
  }

  it('handle.interactionRoot and handle.pointerEventTarget both alias handle.svg (Ticket 2 aliasing guarantee)', () => {
    const { handle } = setup();
    expect(handle.interactionRoot).toBe(handle.svg);
    expect(handle.pointerEventTarget).toBe(handle.svg);
  });

  it('below-threshold click on a .fg-task fires onSelect with the correct TaskId', () => {
    const { handle, onSelect } = setup();
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50 });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(toTaskId('t1'));
  });

  it('click on a row label (sibling of .fg-task, not a descendant) still resolves to that row\'s task — regression for the exact bug this spec fixes', () => {
    const { handle, onSelect, onClear } = setup();
    const labelEl = handle.svg.querySelector('.fg-timeline__row-label') as SVGTextElement;
    expect(labelEl).not.toBeNull();
    // Sanity: the label is NOT inside .fg-task (sibling under .fg-timeline__row).
    expect(labelEl.closest('.fg-task')).toBeNull();

    dispatchPointer(labelEl, 'pointerdown', { pointerId: 1, clientX: 20, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 20, clientY: 50 });

    expect(onClear).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(toTaskId('t1'));
  });

  it('a completed drag (movement exceeding dragThresholdPx) fires NO click-select callback', () => {
    const { handle, onSelect, onToggle, onRangeSelect, onClear } = setup();
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 200, clientY: 50 }); // exceeds threshold
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 200, clientY: 50 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
    expect(onRangeSelect).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('Ctrl+click fires onToggle with the clicked id', () => {
    const { handle, onToggle } = setup();
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true, ctrlKey: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50, ctrlKey: true });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(toTaskId('t2'));
  });

  it('Cmd (metaKey)+click also fires onToggle', () => {
    const { handle, onToggle } = setup();
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true, metaKey: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50, metaKey: true });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(toTaskId('t2'));
  });

  it('Shift+click with a prior plain-click anchor fires onRangeSelect with every row between anchor and target, in row order', () => {
    const { handle, onSelect, onRangeSelect } = setup();
    const g1 = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    const g3 = handle.svg.querySelector('.fg-task[data-task-id="t3"]') as SVGGElement;

    // Plain click on t1 sets the anchor.
    dispatchPointer(g1, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50 });
    expect(onSelect).toHaveBeenCalledWith(toTaskId('t1'));

    // Shift+click on t3 → range select t1..t3 inclusive.
    dispatchPointer(g3, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 150, bubbles: true, shiftKey: true });
    dispatchPointer(window, 'pointerup', { pointerId: 2, clientX: 100, clientY: 150, shiftKey: true });

    expect(onRangeSelect).toHaveBeenCalledTimes(1);
    expect(onRangeSelect).toHaveBeenCalledWith([toTaskId('t1'), toTaskId('t2'), toTaskId('t3')]);
  });

  it('Shift+click as the FIRST interaction (no anchor yet) falls back to onSelect with just the clicked task', () => {
    const { handle, onSelect, onRangeSelect } = setup();
    const g2 = handle.svg.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;

    dispatchPointer(g2, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true, shiftKey: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 100, shiftKey: true });

    expect(onRangeSelect).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(toTaskId('t2'));
  });

  it('click on empty space inside handle.svg (grid cell) fires onClear', () => {
    const { handle, onClear } = setup();
    const gridCell = handle.svg.querySelector('.fg-timeline__grid-cell') as SVGElement | null;
    const target = gridCell ?? handle.svg;

    dispatchPointer(target, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 10, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 300, clientY: 10 });

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('click directly on the root <svg> (outside any row) fires onClear', () => {
    const { handle, onClear } = setup();

    dispatchPointer(handle.svg, 'pointerdown', { pointerId: 1, clientX: 5, clientY: 5, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 5, clientY: 5 });

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('right-click / non-primary button fires no callback', () => {
    const { handle, onSelect, onClear } = setup();
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true, button: 2 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50, button: 2 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('a second concurrent pointerdown (different pointerId) is ignored; the first gesture still resolves on its own pointerup', () => {
    const { handle, onSelect } = setup();
    const g1 = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;
    const g2 = handle.svg.querySelector('.fg-task[data-task-id="t2"]') as SVGGElement;

    dispatchPointer(g1, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(g2, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 100, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 2, clientX: 100, clientY: 100 }); // ignored: second gesture never opened
    expect(onSelect).not.toHaveBeenCalled();

    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50 });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(toTaskId('t1'));
  });

  it('custom dragThresholdPx is respected (movement just under vs. just over the configured value)', () => {
    const { handle, onSelect } = setup({ dragThresholdPx: 10 });
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientX: 108, clientY: 50 }); // dx=8 < 10
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 108, clientY: 50 });
    expect(onSelect).toHaveBeenCalledTimes(1);

    onSelect.mockClear();
    dispatchPointer(groupEl, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointermove', { pointerId: 2, clientX: 112, clientY: 50 }); // dx=12 > 10
    dispatchPointer(window, 'pointerup', { pointerId: 2, clientX: 112, clientY: 50 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disposer: called once -> subsequent clicks have no effect; called twice does not throw', () => {
    const { handle, dispose, onSelect } = setup();
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;

    dispose();
    expect(() => dispose()).not.toThrow();

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('pointercancel mid-gesture: no callback fires on the subsequent pointerup', () => {
    const { handle, onSelect } = setup();
    const groupEl = handle.svg.querySelector('.fg-task[data-task-id="t1"]') as SVGGElement;

    dispatchPointer(groupEl, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true });
    dispatchPointer(window, 'pointercancel', { pointerId: 1, clientX: 100, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 50 });

    expect(onSelect).not.toHaveBeenCalled();
  });
});

// --- Minimal-mock structural test (Ticket 2, spec §12.4) — proves enableClickSelect is
// decoupled from SVG specifically: a bare object satisfying InteractiveRendererHandle (no
// `.svg` field, no `hitTestRow`) with hand-built row markup works identically to a real
// SvgRendererHandle for the DOM-hit-test path.
describe('enableClickSelect — minimal InteractiveRendererHandle mock (SVG-decoupling proof)', () => {
  it('resolves a click via resolveRowHitDom against a bare interactionRoot/pointerEventTarget, no .svg field required', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = `
      <div class="fg-timeline__row" data-row-index="0">
        <div class="fg-task" data-task-id="mock-1"></div>
      </div>
    `;
    const handle: InteractiveRendererHandle = { interactionRoot: root, pointerEventTarget: root };
    const onSelect = vi.fn();
    const onClear = vi.fn();
    const dispose = enableClickSelect(handle, () => [], {
      onSelect,
      onToggle: vi.fn(),
      onRangeSelect: vi.fn(),
      onClear,
    });

    const taskEl = root.querySelector('.fg-task[data-task-id="mock-1"]')!;
    dispatchPointer(taskEl, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 10, clientY: 10 });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(toTaskId('mock-1'));

    dispose();
    root.remove();
  });
});

// --- Canvas click-select (Ticket 2, spec §7.3 / §12.4) — real createCanvasRenderer() handle.
describe('canvas click-select', () => {
  let container: HTMLElement;
  let tasks: Task[];

  function stubGetContext2D(): void {
    const ctx: Partial<CanvasRenderingContext2D> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'canvas') return undefined;
          return (): unknown => undefined;
        },
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as CanvasRenderingContext2D);
  }

  function stubCanvasRect(canvas: HTMLCanvasElement): void {
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => ({}),
    } as DOMRect);
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tasks = [
      task('t1', '2026-01-05T09:00', '2026-01-07T09:00'),
      task('t2', '2026-01-10T09:00', '2026-01-12T09:00'),
      task('t3', '2026-01-15T09:00', '2026-01-17T09:00'),
    ];
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function setupCanvas(options?: Partial<Parameters<typeof enableClickSelect>[2]>) {
    stubGetContext2D();
    const handle = createCanvasRenderer(container, { tasks, dependencies: [] });
    stubCanvasRect(handle.canvas);
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const onRangeSelect = vi.fn();
    const onClear = vi.fn();
    const dispose = enableClickSelect(handle, () => tasks, {
      onSelect,
      onToggle,
      onRangeSelect,
      onClear,
      ...options,
    });
    return { handle, dispose, onSelect, onToggle, onRangeSelect, onClear };
  }

  // Row 0's band midpoint in default density: HEADER_HEIGHT(32) + ROW_HEIGHT.default(32)/2.
  const ROW0_Y = 32 + 16;
  const ROW1_Y = 32 + 32 + 16;
  const ROW2_Y = 32 + 64 + 16;

  it('click on row 0\'s band fires onSelect with the correct TaskId (via hitTestRow, not DOM)', () => {
    const { handle, onSelect } = setupCanvas();
    dispatchPointer(handle.canvas, 'pointerdown', { pointerId: 1, clientX: 100, clientY: ROW0_Y, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: ROW0_Y });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(toTaskId('t1'));
  });

  it('click in the header band fires onClear, not onSelect', () => {
    const { handle, onSelect, onClear } = setupCanvas();
    dispatchPointer(handle.canvas, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 10, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 10 });
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('click below the last row fires onClear, not onSelect', () => {
    const { handle, onSelect, onClear } = setupCanvas();
    const belowLast = 32 + tasks.length * 32 + 200;
    dispatchPointer(handle.canvas, 'pointerdown', { pointerId: 1, clientX: 100, clientY: belowLast, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: belowLast });
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Shift+click after a prior click fires onRangeSelect with the correct ordered ids (via handle.interactionRoot/collectRowRange)', () => {
    const { handle, onSelect, onRangeSelect } = setupCanvas();
    dispatchPointer(handle.canvas, 'pointerdown', { pointerId: 1, clientX: 100, clientY: ROW0_Y, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: ROW0_Y });
    expect(onSelect).toHaveBeenCalledWith(toTaskId('t1'));

    dispatchPointer(handle.canvas, 'pointerdown', {
      pointerId: 2,
      clientX: 100,
      clientY: ROW2_Y,
      bubbles: true,
      shiftKey: true,
    });
    dispatchPointer(window, 'pointerup', { pointerId: 2, clientX: 100, clientY: ROW2_Y, shiftKey: true });

    expect(onRangeSelect).toHaveBeenCalledTimes(1);
    expect(onRangeSelect).toHaveBeenCalledWith([toTaskId('t1'), toTaskId('t2'), toTaskId('t3')]);
  });

  it('Ctrl/Cmd+click fires onToggle, not onSelect', () => {
    const { handle, onToggle, onSelect } = setupCanvas();
    dispatchPointer(handle.canvas, 'pointerdown', {
      pointerId: 1,
      clientX: 100,
      clientY: ROW1_Y,
      bubbles: true,
      ctrlKey: true,
    });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: ROW1_Y, ctrlKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(toTaskId('t2'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('the pointerdown listener is on handle.canvas (pointerEventTarget), not handle.interactionRoot — a dispatch on interactionRoot alone fires nothing', () => {
    const { handle, onSelect, onClear } = setupCanvas();
    dispatchPointer(handle.interactionRoot, 'pointerdown', { pointerId: 1, clientX: 100, clientY: ROW0_Y, bubbles: true });
    dispatchPointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: ROW0_Y });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });
});
