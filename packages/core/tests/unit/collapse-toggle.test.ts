// @vitest-environment jsdom
//
// Interaction — collapse/expand toggle-click tests (spec-collapse-expand.md §7.1/§9.5). Runs
// under jsdom (per-file override; the rest of core stays `environment: 'node'`), mirroring
// `selection.test.ts`'s setup style. Uses minimal hand-built structural mocks (rather than a
// real SVG/Canvas renderer) for both SVG and Canvas modes — `enableCollapseToggle` itself only
// consults `handle.pointerEventTarget` and, when present, `handle.hitTestRow`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enableCollapseToggle } from '../../src/interaction/collapse-toggle.js';
import type { SvgRendererHandle } from '../../src/render/svg-renderer.js';
import type { CanvasRendererHandle } from '../../src/render/canvas-renderer.js';
import { toTaskId } from '../../src/types.js';

describe('enableCollapseToggle — SVG mode (DOM delegation)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <div class="fg-timeline__row" data-row-index="0" data-task-id="root">
        <path class="fg-timeline__row-toggle" aria-hidden="true"></path>
        <rect class="fg-task" data-task-id="root"></rect>
      </div>
      <div class="fg-timeline__row" data-row-index="1" data-task-id="leaf">
        <rect class="fg-task" data-task-id="leaf"></rect>
      </div>
    `;
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function setup() {
    // No `hitTestRow` field — enableCollapseToggle discriminates on its absence to take the
    // SVG/DOM-delegation path, exactly as the real SvgRendererHandle (spec-canvas-renderer-
    // ticket2.md §3.3's structural contract).
    const handle = { pointerEventTarget: container, interactionRoot: container } as unknown as SvgRendererHandle;
    const onToggleCollapse = vi.fn();
    const dispose = enableCollapseToggle(handle, () => [], { onToggleCollapse });
    return { handle, dispose, onToggleCollapse };
  }

  it('click on .fg-timeline__row-toggle fires onToggleCollapse with the row\'s task id', () => {
    const { onToggleCollapse } = setup();
    const toggle = container.querySelector('.fg-timeline__row-toggle')!;
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleCollapse).toHaveBeenCalledWith(toTaskId('root'));
  });

  it('click elsewhere on the same row (the task bar, not the toggle) does NOT fire onToggleCollapse', () => {
    const { onToggleCollapse } = setup();
    const bar = container.querySelector('.fg-task[data-task-id="root"]')!;
    bar.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it('click on a row with no toggle glyph at all (a leaf row) does not fire onToggleCollapse', () => {
    const { onToggleCollapse } = setup();
    const leafBar = container.querySelector('.fg-task[data-task-id="leaf"]')!;
    leafBar.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it('click fully outside any row is a no-op, no throw', () => {
    const { onToggleCollapse } = setup();
    expect(() => container.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it('disposer: called once -> subsequent clicks have no effect; called twice does not throw', () => {
    const { dispose, onToggleCollapse } = setup();
    dispose();
    expect(() => dispose()).not.toThrow();
    const toggle = container.querySelector('.fg-timeline__row-toggle')!;
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });
});

describe('enableCollapseToggle — Canvas mode (hitTestRow)', () => {
  let container: HTMLElement;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    container = document.createElement('div');
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function setup(hitTestRow: CanvasRendererHandle['hitTestRow']) {
    const handle = {
      pointerEventTarget: canvas,
      interactionRoot: canvas,
      hitTestRow,
    } as unknown as CanvasRendererHandle;
    const onToggleCollapse = vi.fn();
    const dispose = enableCollapseToggle(handle, () => [], { onToggleCollapse });
    return { canvas, dispose, onToggleCollapse };
  }

  it('hitTestRow() result with hitToggle: true fires onToggleCollapse with the hit task id', () => {
    const hitTestRow = vi.fn().mockReturnValue({ taskId: toTaskId('root'), rowIndex: 0, hitToggle: true });
    const { onToggleCollapse } = setup(hitTestRow);
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleCollapse).toHaveBeenCalledWith(toTaskId('root'));
  });

  it('hitTestRow() result with hitToggle: false does NOT fire onToggleCollapse', () => {
    const hitTestRow = vi.fn().mockReturnValue({ taskId: toTaskId('root'), rowIndex: 0, hitToggle: false });
    const { onToggleCollapse } = setup(hitTestRow);
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it('hitTestRow() returning undefined (a click outside any row) does not fire onToggleCollapse', () => {
    const hitTestRow = vi.fn().mockReturnValue(undefined);
    const { onToggleCollapse } = setup(hitTestRow);
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it('disposer: called once -> subsequent clicks have no effect; called twice does not throw', () => {
    const hitTestRow = vi.fn().mockReturnValue({ taskId: toTaskId('root'), rowIndex: 0, hitToggle: true });
    const { dispose, onToggleCollapse } = setup(hitTestRow);
    dispose();
    expect(() => dispose()).not.toThrow();
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });
});
