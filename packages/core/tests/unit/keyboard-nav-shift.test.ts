// @vitest-environment jsdom
//
// enableKeyboardNav in isolation: the Alt+Arrow wiring contract (RTL read per event, reveal AFTER
// the commit, unbound without `onShift`, link gating). spec-keyboard-move-resize.md.
import { describe, it, expect, vi } from 'vitest';
import { enableKeyboardNav } from '../../src/interaction/keyboard-nav.js';
import type { InteractiveRendererHandle } from '../../src/render/interactive-renderer-handle.js';
import { toTaskId, type Task } from '../../src/types.js';

const mk = (id: string): Task => ({
  id: toTaskId(id),
  name: id,
  start: '2026-01-05T09:00',
  end: '2026-01-07T09:00',
  progress: 0,
  type: 'task',
  createdAt: new Date(),
  updatedAt: new Date(),
});

function setup(opts: { shift?: boolean; readOnly?: boolean } = {}) {
  const tasks = [mk('a'), mk('b')];
  const container = document.createElement('div');
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const els = tasks.map((t, i) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-row-index', String(i));
    root.appendChild(g);
    return g;
  });
  container.appendChild(root);
  const calls: string[] = [];
  const onShift = vi.fn((id: string, d: number, e?: string): void => {
    calls.push(`shift:${id}:${d}:${e ?? ''}`);
  });
  const onReveal = vi.fn((id: string): void => {
    calls.push(`reveal:${id}`);
  });
  const onLink = vi.fn();
  const handle = { interactionRoot: root, container } as unknown as InteractiveRendererHandle;
  const nav = enableKeyboardNav(handle, {
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onRangeSelect: vi.fn(),
    onDeleteSelected: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDuplicateSelected: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReveal,
    ...(opts.shift === false ? {} : { onShift, onLink }),
    getTasks: () => tasks,
    density: 'default',
    isReadOnly: () => opts.readOnly === true,
    getSelection: () => [],
    getCollapsedIds: () => new Set(),
    onToggleCollapse: vi.fn(),
  });
  const press = (k: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, altKey: true, ...init });
    els[0]!.dispatchEvent(e);
    return e;
  };
  return { press, calls, onShift, onReveal, onLink, handle, nav };
}

describe('keyboard-nav Alt+Arrow', () => {
  it('reveals AFTER the commit callback', () => {
    const s = setup();
    s.press('ArrowRight');
    expect(s.calls).toEqual(['shift:a:1:', 'reveal:a']);
  });

  it('LTR: ArrowRight is +1 and Shift adds the end edge', () => {
    const s = setup();
    s.press('ArrowRight');
    s.press('ArrowLeft', { shiftKey: true });
    expect(s.onShift.mock.calls).toEqual([['a', 1, undefined], ['a', -1, 'end']]);
  });

  it('RTL: mirrorX is read on every keydown, assigned after setup', () => {
    const s = setup();
    s.press('ArrowLeft');
    (s.handle as { mirrorX?: (x: number) => number }).mirrorX = (x) => -x;
    s.press('ArrowLeft'); // later dates are visually left in RTL
    s.press('ArrowRight', { shiftKey: true });
    expect(s.onShift.mock.calls).toEqual([['a', -1, undefined], ['a', 1, undefined], ['a', -1, 'end']]);
  });

  it('is unbound (not prevented) without onShift, and while read-only', () => {
    expect(setup({ shift: false }).press('ArrowRight').defaultPrevented).toBe(false);
    const ro = setup({ readOnly: true });
    expect(ro.press('ArrowRight').defaultPrevented).toBe(false);
    expect(ro.onShift).not.toHaveBeenCalled();
  });

  it('does not act after dispose', () => {
    const s = setup();
    s.nav.dispose();
    expect(s.press('ArrowRight').defaultPrevented).toBe(false);
    expect(s.onShift).not.toHaveBeenCalled();
  });

  it('Alt+Enter without a Shift range does not link and is not prevented', () => {
    const s = setup();
    expect(s.press('Enter').defaultPrevented).toBe(false);
    expect(s.onLink).not.toHaveBeenCalled();
  });
});
