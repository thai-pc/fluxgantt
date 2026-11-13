// Ellipsis truncation of grid text (spec-grid-columns.md 5.3): property tests.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fit } from '../../src/grid/svg-grid.js';
import { estimateTextWidth } from '../../src/render/renderer-base.js';

const text = fc.oneof(
  fc.string({ maxLength: 80 }),
  fc.stringMatching(/^[A-Za-z0-9 .,-]{0,80}$/),
  fc.array(fc.constantFrom('é', 'a', '日', '👨‍👩‍👧', '🇻🇳', 'ก', 'م', ' '), { maxLength: 40 }).map((a) => a.join('')),
);
const px = fc.integer({ min: 0, max: 400 });

describe('fit', () => {
  it('returns the text itself when it fits', () => {
    fc.assert(
      fc.property(text, (s) => {
        expect(fit(s, estimateTextWidth(s) / 0.94 + 0.01)).toBe(s);
      }),
    );
  });

  it('otherwise returns a prefix on a grapheme boundary plus an ellipsis, within the 6 % margin budget', () => {
    const seg = new Intl.Segmenter();
    fc.assert(
      fc.property(text, px, (s, max) => {
        const out = fit(s, max);
        if (out === s) return;
        if (out === '') {
          expect(estimateTextWidth('…')).toBeGreaterThan(max * 0.94);
          return;
        }
        expect(out.endsWith('…')).toBe(true);
        expect(estimateTextWidth(out)).toBeLessThanOrEqual(max * 0.94 + 1e-9);
        const prefix = out.slice(0, -1);
        expect(s.startsWith(prefix)).toBe(true);
        // the cut falls between two graphemes of the original
        const bounds = new Set<number>([0]);
        let at = 0;
        for (const { segment } of seg.segment(s)) bounds.add((at += segment.length));
        expect(bounds.has(prefix.length)).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it('is idempotent and monotone in the available width', () => {
    fc.assert(
      fc.property(text, px, px, (s, a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        expect(fit(fit(s, lo), lo)).toBe(fit(s, lo));
        expect(fit(s, hi).length).toBeGreaterThanOrEqual(fit(s, lo).length - 1); // the ellipsis may replace one more unit
      }),
      { numRuns: 300 },
    );
  });

  it('never throws on lone surrogates or a zero width', () => {
    expect(() => fit('\ud800abc\udc00', 0)).not.toThrow();
    expect(() => fit('x'.repeat(1000), 0)).not.toThrow();
  });
});
