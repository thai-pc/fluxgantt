// @vitest-environment jsdom
//
// Chart ground in exports (spec-export-background.md). `exportSvg` paints the resolved `--fg-bg`
// (else white) as the first rendered child of the DETACHED clone; real pixel proof is the
// Playwright e2e (tests/e2e/export-background.spec.ts).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { exportSvg } from '../../src/io/export-svg.js';
import { isValidBackground, resolveChartBackground } from '../../src/io/export-background.js';
import { createGantt as createGanttBase } from '../../src/gantt.js';
import { withIo } from '../../src/io/mixin.js';
import { withRender } from '../../src/render/mixin.js';
import { withTheme } from '../../src/theme/mixin.js';
import { DARK_TOKENS } from '../../src/theme/tokens.js';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { toTaskId, type Task } from '../../src/types.js';

function task(id: string): Task {
  const now = new Date();
  return {
    id: toTaskId(id),
    name: id,
    start: '2026-01-05T09:00',
    end: '2026-01-07T17:00',
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
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

const mount = () => createSvgRenderer(container, { tasks: [task('a'), task('b')], dependencies: [] });
const parse = (s: string): Document => new DOMParser().parseFromString(s, 'image/svg+xml');
/** The first element child that is not the accessible-name `<title>`. */
const firstRendered = (out: string): Element => {
  const kids = Array.from(parse(out).documentElement.children).filter((c) => c.localName !== 'title');
  return kids[0]!;
};

describe('exportSvg — background rect', () => {
  it('defaults to a white full-size rect before every other rendered element, <title> stays first', () => {
    const h = mount();
    const doc = parse(exportSvg(h.svg));
    const kids = Array.from(doc.documentElement.children);
    expect(kids[0]!.localName).toBe('title');
    const rect = kids[1]!;
    expect(rect.localName).toBe('rect');
    expect(rect.getAttribute('width')).toBe('100%');
    expect(rect.getAttribute('height')).toBe('100%');
    expect(rect.getAttribute('fill')).toBe('#ffffff');
  });

  it('uses the container --fg-bg (dark theme ground)', () => {
    container.style.setProperty('--fg-bg', '#0a0a0a');
    const h = mount();
    expect(firstRendered(exportSvg(h.svg)).getAttribute('fill')).toBe('#0a0a0a');
  });

  it('honors a descendant override of --fg-bg (computed style, not the container inline)', () => {
    container.style.setProperty('--fg-bg', '#0a0a0a');
    const h = mount();
    h.svg.style.setProperty('--fg-bg', '#123456');
    expect(firstRendered(exportSvg(h.svg)).getAttribute('fill')).toBe('#123456');
  });

  it('works with inlineComputedStyle:false too', () => {
    const h = mount();
    expect(firstRendered(exportSvg(h.svg, { inlineComputedStyle: false })).getAttribute('fill')).toBe('#ffffff');
  });

  it('explicit background wins over --fg-bg (hex and keyword)', () => {
    container.style.setProperty('--fg-bg', '#0a0a0a');
    const h = mount();
    expect(firstRendered(exportSvg(h.svg, { background: '#ff0000' })).getAttribute('fill')).toBe('#ff0000');
    expect(firstRendered(exportSvg(h.svg, { background: 'black' })).getAttribute('fill')).toBe('black');
  });

  it("'transparent' omits the rect entirely", () => {
    const h = mount();
    const liveRects = h.svg.querySelectorAll('rect').length;
    const doc = parse(exportSvg(h.svg, { background: 'transparent' }));
    // The bake never adds a rect: the count equals the live one, and none is a full-size ground.
    expect(doc.querySelectorAll('rect')).toHaveLength(liveRects);
    expect(doc.querySelector('rect[width="100%"]')).toBeNull();
  });

  it('never touches the live DOM', () => {
    const h = mount();
    const rects = h.svg.querySelectorAll('rect').length;
    const first = h.svg.firstElementChild;
    exportSvg(h.svg);
    expect(h.svg.querySelectorAll('rect')).toHaveLength(rects);
    expect(h.svg.firstElementChild).toBe(first);
  });

  it('does not shift the live/clone baking pairing (baked colors still land on the right elements)', () => {
    const h = mount();
    const withBg = parse(exportSvg(h.svg));
    const without = parse(exportSvg(h.svg, { background: 'transparent' }));
    const styles = (d: Document): (string | null)[] =>
      Array.from(d.querySelectorAll('rect')).filter((r) => r.getAttribute('width') !== '100%').map((r) => r.getAttribute('style'));
    expect(styles(withBg)).toEqual(styles(without));
  });

  it.each(['red;background:url(javascript:alert(1))', 'url(x)', '"><script>', '', 'not-a-color', 'var(--x)'])(
    'throws synchronously on invalid background %j',
    (bg) => {
      const h = mount();
      expect(() => exportSvg(h.svg, { background: bg })).toThrow(/gantt\.exportSvg: invalid background/);
    },
  );

  it.each(['url(javascript:alert(1))', 'oklch(0.2 0 0)', 'var(--nope)', 'red;x:y'])(
    'a hostile/unsupported host --fg-bg %j falls back to white without throwing',
    (v) => {
      container.style.setProperty('--fg-bg', v);
      const h = mount();
      const out = exportSvg(h.svg);
      expect(firstRendered(out).getAttribute('fill')).toBe('#ffffff');
      expect(parse(out).querySelector('parsererror')).toBeNull();
      expect(out).not.toContain('<script');
    },
  );
});

describe('isValidBackground / resolveChartBackground', () => {
  it('accepts the whitelist and rejects injection shapes', () => {
    for (const ok of ['transparent', 'white', '#fff', '#0a0a0a', 'rgb(1, 2, 3)', 'hsl(10, 20%, 30%)']) {
      expect(isValidBackground(ok)).toBe(true);
    }
    for (const bad of ['', 'url(x)', 'a b', 'red;', '#12', '<x>', 'var(--a)']) expect(isValidBackground(bad)).toBe(false);
  });

  it('accepts the space-separated rgb()/hsl() form and still rejects look-alikes', () => {
    for (const ok of ['rgb(10 10 10)', 'rgb(10 10 10 / 0.5)', 'hsl(210 40% 96%)']) expect(isValidBackground(ok)).toBe(true);
    for (const bad of ['rgb(10 10 10);', 'rgb(10 10)', 'rgb(10 10 10) url(x)', 'rgb(var(--a) 1 2)']) {
      expect(isValidBackground(bad)).toBe(false);
    }
  });

  it('a space-form host --fg-bg is honored (modern browsers return it as authored)', () => {
    container.style.setProperty('--fg-bg', 'rgb(10 10 10)');
    expect(resolveChartBackground(container)).toBe('rgb(10 10 10)');
    expect(firstRendered(exportSvg(mount().svg)).getAttribute('fill')).toBe('rgb(10 10 10)');
  });

  it('a host --fg-bg the browser cannot parse as a color (typo) falls back to white', () => {
    // jsdom has no `CSS`; a browser does, and `blak` passes the letters-only whitelist.
    vi.stubGlobal('CSS', { supports: (_prop: string, v: string) => v !== 'blak' });
    try {
      container.style.setProperty('--fg-bg', 'blak');
      expect(resolveChartBackground(container)).toBe('#ffffff');
      container.style.setProperty('--fg-bg', 'black');
      expect(resolveChartBackground(container)).toBe('black');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resolves from the element and defaults to white', () => {
    expect(resolveChartBackground(container)).toBe('#ffffff');
    container.style.setProperty('--fg-bg', ' #101010 ');
    expect(resolveChartBackground(container)).toBe('#101010');
  });
});

describe('real withTheme path', () => {
  it('setTheme(dark) alone yields the #0a0a0a ground in exportSvg; light yields white', () => {
    const gantt = withTheme(withIo(withRender(createGanttBase({ tasks: [task('a')] }))));
    gantt.mount(container);
    expect(firstRendered(gantt.exportSvg()).getAttribute('fill')).toBe('#ffffff');
    gantt.setTheme('dark');
    expect(firstRendered(gantt.exportSvg()).getAttribute('fill')).toBe(DARK_TOKENS['--fg-bg']);
    expect(DARK_TOKENS['--fg-bg']).toBe('#0a0a0a');
    expect(firstRendered(gantt.exportSvg({ background: 'transparent' })).localName).not.toBe('rect');
    gantt.destroy();
  });
});

describe('property: background option', () => {
  const hexArb = fc.array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 6, maxLength: 6 }).map((a) => `#${a.join('')}`);

  it('a valid color is the exact fill of the first rendered child', () => {
    const h = mount();
    fc.assert(
      fc.property(hexArb, (c) => {
        expect(firstRendered(exportSvg(h.svg, { background: c })).getAttribute('fill')).toBe(c);
      }),
    );
  });

  it('arbitrary junk either throws or is whitelisted, and never reaches the output as markup', () => {
    const h = mount();
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (s) => {
        let out: string;
        try {
          out = exportSvg(h.svg, { background: s, inlineComputedStyle: false });
        } catch (e) {
          expect((e as Error).message).toMatch(/invalid background/);
          expect(isValidBackground(s)).toBe(false);
          return;
        }
        expect(isValidBackground(s)).toBe(true);
        expect(parse(out).querySelector('parsererror')).toBeNull();
        expect(parse(out).querySelector('script')).toBeNull();
      }),
    );
  });
});
