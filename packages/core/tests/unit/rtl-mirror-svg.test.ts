// @vitest-environment jsdom
//
// `mirrorSvg()` (spec-rtl-chart.md section 5.3): the pure DOM half of `withRtl`.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { mirrorSvg } from '../../src/rtl/mirror-svg.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name: string, attrs: Record<string, string> = {}): SVGElement => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

function chart(): SVGSVGElement {
  const svg = el('svg', { width: '400', height: '100' }) as SVGSVGElement;
  const header = el('g', { class: 'fg-timeline__header' });
  const label = el('text', { x: '40', y: '8' });
  label.textContent = 'مارس 2026';
  header.append(label);
  const rows = el('g', { class: 'fg-timeline__rows' });
  const rowLabel = el('text', { x: '8', y: '50', 'text-anchor': 'start' });
  rowLabel.textContent = 'التصميم';
  rows.append(rowLabel, el('rect', { x: '200', width: '50' }));
  svg.append(el('defs'), el('style'), header, rows);
  return svg;
}

describe('mirrorSvg', () => {
  it('wraps every prior child, in order, in one transformed rtl group', () => {
    const svg = chart();
    const before = [...svg.childNodes];
    mirrorSvg(svg, 400);

    expect(svg.children).toHaveLength(1);
    const g = svg.firstElementChild!;
    expect(g.getAttribute('class')).toBe('fg-rtl');
    expect(g.getAttribute('transform')).toBe('matrix(-1 0 0 1 400 0)');
    expect(g.getAttribute('direction')).toBe('rtl');
    expect([...g.childNodes]).toEqual(before); // same nodes (defs and style included), same order
  });

  it('counter-flips each text about its own x so the anchor lands at W - x', () => {
    const svg = chart();
    mirrorSvg(svg, 400);
    const [header, rowLabel] = [...svg.querySelectorAll('text')];
    expect(header!.getAttribute('transform')).toBe('matrix(-1 0 0 1 80 0)');
    expect(rowLabel!.getAttribute('transform')).toBe('matrix(-1 0 0 1 16 0)');
    // parent maps p -> W - p, the text maps u -> 2x - u: net u -> u + (W - 2x), anchor x -> W - x
    for (const [x, W] of [[40, 400], [8, 400]] as const) expect(2 * x - x + (W - 2 * x)).toBe(W - x);
  });

  it('leaves non-text geometry untouched (it mirrors through the group)', () => {
    const svg = chart();
    mirrorSvg(svg, 400);
    expect(svg.querySelector('rect')!.hasAttribute('transform')).toBe(false);
  });

  it('skips a text whose x is not finite instead of writing NaN into the DOM', () => {
    const svg = chart();
    svg.querySelector('text')!.setAttribute('x', 'abc');
    mirrorSvg(svg, 400);
    expect(svg.querySelector('text')!.hasAttribute('transform')).toBe(false);
    expect(svg.outerHTML).not.toContain('NaN');
  });

  it('is idempotent', () => {
    const svg = chart();
    mirrorSvg(svg, 400);
    const once = svg.outerHTML;
    mirrorSvg(svg, 400);
    expect(svg.outerHTML).toBe(once);
  });

  it('is a no-op for a non-finite width', () => {
    for (const w of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const svg = chart();
      const before = svg.outerHTML;
      mirrorSvg(svg, w);
      expect(svg.outerHTML).toBe(before);
    }
  });

  it('gives an svg and its overlay identical output for equal widths', () => {
    const a = chart();
    const b = chart();
    mirrorSvg(a, 640);
    mirrorSvg(b, 640);
    expect(a.outerHTML).toBe(b.outerHTML);
  });

  it('net horizontal map of a text anchor is x -> W - x for any x and W (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }), (x, W) => {
        const svg = el('svg') as SVGSVGElement;
        const t = el('text', { x: String(x) });
        svg.append(t);
        mirrorSvg(svg, W);
        const own = /matrix\(-1 0 0 1 (-?\d+) 0\)/.exec(t.getAttribute('transform')!)!;
        const parent = /matrix\(-1 0 0 1 (-?\d+) 0\)/.exec(svg.firstElementChild!.getAttribute('transform')!)!;
        const apply = (tx: number, u: number): number => tx - u;
        expect(apply(Number(parent[1]), apply(Number(own[1]), x))).toBe(x + (W - 2 * x)); // translation only
        expect(apply(Number(parent[1]), x)).toBe(W - x);
      }),
    );
  });
});
