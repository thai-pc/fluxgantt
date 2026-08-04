// @vitest-environment jsdom
//
// Property-based tests (fast-check) for `exportSvg` (spec-export-png-svg.md §12.3).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { exportSvg } from '../../src/io/export-svg.js';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { toTaskId, type Task } from '../../src/types.js';

function task(name: string): Task {
  const now = new Date();
  return {
    id: toTaskId('t1'),
    name,
    start: '2026-01-05T09:00',
    end: '2026-01-06T17:00',
    progress: 0.5,
    type: 'task',
    createdAt: now,
    updatedAt: now,
  };
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  // jsdom doesn't resolve `var(...)`, so baking legitimately warns for every element/property
  // pair here (see io-export-svg.test.ts's beforeEach for the full explanation) — silenced,
  // not the concern of this property test.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

// Arbitrary Unicode + HTML-special characters, lengths spanning 0 through well over
// MAX_ARIA_NAME_LENGTH (200) + 50.
const nameArb = fc.string({ minLength: 0, maxLength: 250 });

describe('property: exportSvg never produces unparseable or unescaped-markup output', () => {
  it('always parses cleanly via DOMParser, regardless of task.name content', () => {
    fc.assert(
      fc.property(nameArb, (name) => {
        const h = createSvgRenderer(container, { tasks: [task(name)], dependencies: [] });
        const out = exportSvg(h.svg);

        const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
        expect(doc.querySelector('parsererror')).toBeNull();

        // The raw (unescaped) name must never appear as literal markup — only within an
        // escaped text-node context. A cheap proxy: if the name contains `<` or `&`, the RAW
        // substring must not appear immediately followed by markup-like content; the
        // authoritative check is the round-tripped textContent equality below.
        const label = doc.querySelector('.fg-timeline__row-label');
        expect(label?.textContent).toBe(name);

        h.destroy();
      }),
    );
  });
});
