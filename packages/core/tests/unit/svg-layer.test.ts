// @vitest-environment jsdom
//
// The layer wrapper that holds the chart svg and every pinned overlay (spec-svg-sticky-label-column.md
// section 3.1, 5), plus the logical-insets-only contract task O (RTL) relies on. jsdom has no layout:
// everything here is DOM structure, attributes and inline style text, never pinning behaviour (that is
// the Playwright spec's job).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { exportSvg } from '../../src/io/export-svg.js';
import { toTaskId, type Task } from '../../src/types.js';

function task(id: string, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: toTaskId(id),
    name: id,
    start: '2026-01-05T09:00',
    end: '2026-01-07T17:00',
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => container.remove());

const mount = (extra = {}, tasks = [task('a'), task('b')]) =>
  createSvgRenderer(container, { tasks, dependencies: [] }, extra);

describe('svg renderer layer wrapper', () => {
  it('container > div.fg-timeline__layer > [chart svg, header overlay]; the chart stays the first svg', () => {
    const h = mount();
    expect(container.children).toHaveLength(1);
    const layer = container.firstElementChild as HTMLElement;
    expect(layer.tagName).toBe('DIV');
    expect(layer.className).toBe('fg-timeline__layer');
    expect(h.pointerEventTarget).toBe(layer);
    expect(Array.from(layer.children).map((c) => c.getAttribute('class'))).toEqual([
      'fg-timeline',
      'fg-timeline__sticky-header',
    ]);
    expect(container.querySelector('svg')).toBe(h.svg);
    expect(h.interactionRoot).toBe(h.svg);
    expect(h.container).toBe(container);
  });

  it('destroy() removes the layer and a remount leaves exactly one', () => {
    const h = mount();
    h.destroy();
    expect(container.querySelector('.fg-timeline__layer')).toBeNull();
    mount();
    expect(container.querySelectorAll('.fg-timeline__layer')).toHaveLength(1);
  });

  it('uses logical insets only: no physical left/right/margin/float token in any layer style', () => {
    const h = mount();
    const layer = h.pointerEventTarget;
    const styles = [layer, ...Array.from(layer.children)].map((n) => n.getAttribute('style') ?? '');
    for (const text of styles) {
      expect(text).not.toMatch(/(^|[;\s])(left|right|float)\s*:/);
      expect(text).not.toMatch(/margin-(left|right)/);
    }
  });

  it('pixel-snaps both dividers inside the pinned boxes', () => {
    const h = mount({ labelColumnWidth: 120 });
    for (const root of [h.svg, h.pointerEventTarget.querySelector('.fg-timeline__sticky-header')!]) {
      const header = root.querySelector('.fg-timeline__header line')!;
      expect(header.getAttribute('y1')).toBe('31.5');
      expect(header.getAttribute('y2')).toBe('31.5');
      const divider = root.querySelector('.fg-timeline__label-divider')!;
      expect(divider.getAttribute('x1')).toBe('119.5');
      expect(divider.getAttribute('x2')).toBe('119.5');
    }
  });

  it('exports carry neither the layer, the overlay, nor the grid placement', () => {
    const h = mount();
    const xml = exportSvg(h.svg);
    expect(xml.match(/<svg/g)).toHaveLength(1);
    expect(xml).not.toContain('fg-timeline__layer');
    expect(xml).not.toContain('sticky');
    expect(xml).not.toContain('grid-area');
    expect(xml).toContain('display: block');
  });
});
