// @vitest-environment jsdom
//
// The layer wrapper that holds the chart svg and every pinned overlay (spec-svg-sticky-label-column.md
// section 3.1, 5), plus the logical-insets-only contract task O (RTL) relies on. jsdom has no layout:
// everything here is DOM structure, attributes and inline style text, never pinning behaviour (that is
// the Playwright spec's job).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
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

const mount = (extra = {}, tasks: Task[] = [task('a'), task('b')]) =>
  createSvgRenderer(container, { tasks, dependencies: [] }, extra);

const part = (h: { pointerEventTarget: HTMLElement }, name: string): Element =>
  h.pointerEventTarget.querySelector(`.fg-timeline__sticky-${name}`)!;
const tree = [
  task('p', { type: 'summary' }),
  task('c1', { parent: toTaskId('p') }),
  task('c2', { parent: toTaskId('p') }),
  task('leaf'),
];

describe('svg renderer layer wrapper', () => {
  it('container > div.fg-timeline__layer > [chart svg, column, header, corner]; the chart stays the first svg', () => {
    const h = mount();
    expect(container.children).toHaveLength(1);
    const layer = container.firstElementChild as HTMLElement;
    expect(layer.tagName).toBe('DIV');
    expect(layer.className).toBe('fg-timeline__layer');
    expect(h.pointerEventTarget).toBe(layer);
    expect(Array.from(layer.children).map((c) => c.getAttribute('class'))).toEqual([
      'fg-timeline',
      'fg-timeline__sticky-column',
      'fg-timeline__sticky-header',
      'fg-timeline__sticky-corner',
    ]);
    expect(container.querySelector('svg')).toBe(h.svg);
    expect(h.interactionRoot).toBe(h.svg);
    expect(h.container).toBe(container);
  });

  it('every overlay is aria-hidden and carries no role, tabindex, id or aria-* of its own beyond that', () => {
    const h = mount({}, tree);
    for (const name of ['column', 'header', 'corner']) {
      const root = part(h, name);
      expect(root.getAttribute('aria-hidden')).toBe('true');
      for (const bad of ['role', 'tabindex', 'id']) {
        expect(root.hasAttribute(bad)).toBe(false);
        expect(root.querySelector(`[${bad}]`)).toBeNull();
      }
      expect(root.querySelector('[aria-label],[aria-selected],[aria-expanded]')).toBeNull();
    }
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
    expect(styles.join('')).toContain('inset-inline-start');
    for (const text of styles) {
      expect(text).not.toMatch(/(^|[;\s])(left|right|float)\s*:/);
      expect(text).not.toMatch(/margin-(left|right)|border-(left|right)|padding-(left|right)/);
    }
  });

  it('pixel-snaps both dividers inside the pinned boxes', () => {
    const h = mount({ labelColumnWidth: 120 });
    const header = h.svg.querySelector('.fg-timeline__header line')!;
    expect(header.getAttribute('y1')).toBe('31.5');
    expect(header.getAttribute('y2')).toBe('31.5');
    expect(part(h, 'header').querySelector('.fg-timeline__header line')!.getAttribute('y1')).toBe('31.5');
    for (const root of [h.svg, part(h, 'column')]) {
      const divider = root.querySelector('.fg-timeline__label-divider')!;
      expect(divider.getAttribute('x1')).toBe('119.5');
      expect(divider.getAttribute('x2')).toBe('119.5');
    }
  });

  it('exports carry neither the layer, the overlays, nor the grid placement', () => {
    const h = mount({}, tree);
    const xml = exportSvg(h.svg);
    expect(xml.match(/<svg/g)).toHaveLength(1);
    expect(xml).not.toContain('fg-timeline__layer');
    expect(xml).not.toContain('sticky');
    expect(xml).not.toContain('grid-area');
    expect(xml).toContain('display: block');
    // Full names stay visible: the live hide rule is a stripped <style>, never an inline opacity.
    for (const t of tree) expect(xml).toContain(`>${t.name}</text>`);
    expect(xml).not.toMatch(/opacity/);
  });

  it('exports are identical whatever the geometry of the pinned layers (scroll cannot leak in)', () => {
    const h = mount({}, tree);
    const before = exportSvg(h.svg);
    container.scrollLeft = 400;
    container.scrollTop = 500;
    h.setOptions({ labelColumnWidth: 160 });
    expect(exportSvg(h.svg)).toBe(before);
  });
});

describe('pinned label column', () => {
  const geometry = (h: ReturnType<typeof mount>) => ({
    column: [part(h, 'column').getAttribute('width'), part(h, 'column').getAttribute('height')],
    header: [part(h, 'header').getAttribute('width'), part(h, 'header').getAttribute('height')],
    corner: [part(h, 'corner').getAttribute('width'), part(h, 'corner').getAttribute('height')],
  });

  it('sizes the column to the label width and the chart height, the header to the chart width', () => {
    const h = mount({ labelColumnWidth: 120 }, tree);
    const g = geometry(h);
    expect(g.column).toEqual(['120', h.svg.getAttribute('height')]);
    expect(g.header).toEqual([h.svg.getAttribute('width'), '32']);
    expect(g.corner).toEqual(['120', '32']);
    // No viewBox: a clone keeps its original's user-space coordinates.
    expect(part(h, 'column').hasAttribute('viewBox')).toBe(false);
  });

  it('rewrites every size on setOptions (width, density, viewMode) and update()', () => {
    const h = mount({}, tree);
    h.setOptions({ labelColumnWidth: 80 });
    expect(geometry(h).column[0]).toBe('80');
    expect(geometry(h).corner[0]).toBe('80');
    const w0 = geometry(h).header[0];
    h.setOptions({ viewMode: 'day' });
    expect(geometry(h).header[0]).toBe(h.svg.getAttribute('width'));
    expect(geometry(h).header[0]).not.toBe(w0);
    h.setOptions({ density: 'comfortable' });
    expect(geometry(h).column[1]).toBe(h.svg.getAttribute('height'));
    h.update({ tasks: [task('only')], dependencies: [] });
    expect(geometry(h).column[1]).toBe(h.svg.getAttribute('height'));
    h.setOptions({ labelColumnWidth: 0 });
    expect(geometry(h).column[0]).toBe('0');
    expect(geometry(h).corner[0]).toBe('0');
  });

  it('holds one label clone per visible row, in order, with the row dataset, and toggles only for parents', () => {
    const h = mount({}, tree);
    const column = part(h, 'column');
    const labels = [...column.querySelectorAll('.fg-timeline__row-label')];
    expect(labels.map((l) => l.textContent)).toEqual(['p', 'c1', 'c2', 'leaf']);
    expect(labels.map((l) => (l as SVGElement).dataset.rowIndex)).toEqual(['0', '1', '2', '3']);
    expect(labels.map((l) => (l as SVGElement).dataset.taskId)).toEqual(['p', 'c1', 'c2', 'leaf']);
    const toggles = [...column.querySelectorAll('.fg-timeline__row-toggle')] as SVGElement[];
    expect(toggles.map((t) => t.dataset.taskId)).toEqual(['p']);
    expect(column.querySelectorAll('.fg-timeline__label-divider')).toHaveLength(1);
    // The real labels are untouched, still in their gridcells (accessible names, export).
    const real = [...h.svg.querySelectorAll('[role="gridcell"] .fg-timeline__row-label')];
    expect(real.map((l) => l.textContent)).toEqual(['p', 'c1', 'c2', 'leaf']);
    // A clone is a copy, not the node itself.
    expect(labels.every((l) => !h.svg.contains(l))).toBe(true);
  });

  it('clones only the VISIBLE rows (collapsed children are absent)', () => {
    const h = createSvgRenderer(
      container,
      { tasks: tree, dependencies: [], collapsedIds: new Set([toTaskId('p')]) },
      {},
    );
    const names = [...part(h, 'column').querySelectorAll('.fg-timeline__row-label')].map((l) => l.textContent);
    expect(names).toEqual(['p', 'leaf']);
  });

  it('copies names as text, never markup (angle brackets, ampersands, quotes, 300 chars)', () => {
    const nasty = ['<img src=x onerror=alert(1)>', 'a & b "q" \'s\'', '<svg><script>1</script></svg>', 'x'.repeat(300)];
    const h = mount({}, nasty.map((n, i) => task(`n${i}`, { name: n })));
    const column = part(h, 'column');
    expect([...column.querySelectorAll('.fg-timeline__row-label')].map((l) => l.textContent)).toEqual(nasty);
    expect(column.querySelector('img,script')).toBeNull();
    expect(column.querySelectorAll('*').length).toBe(1 + nasty.length); // divider + labels only
  });

  it('refreshes the clones when a task is renamed or removed', () => {
    const h = mount({}, tree);
    h.update({ tasks: [task('p', { name: 'renamed' }), task('z')], dependencies: [] });
    const column = part(h, 'column');
    expect([...column.querySelectorAll('.fg-timeline__row-label')].map((l) => l.textContent)).toEqual([
      'renamed',
      'z',
    ]);
    expect(column.querySelectorAll('.fg-timeline__row-toggle')).toHaveLength(0);
  });

  it('an empty chart leaves only the divider in the column', () => {
    const h = mount({ timeRange: { start: '2026-01-05T09:00', end: '2026-02-05T09:00' } }, []);
    expect(part(h, 'column').children).toHaveLength(1);
    expect(part(h, 'column').getAttribute('height')).toBe(h.svg.getAttribute('height'));
  });

  it('hides the real labels live through one injected rule (no comment text shipped)', () => {
    const h = mount();
    const css = [...h.svg.querySelectorAll('style')].map((s) => s.textContent).join('');
    // Scoped to the chart root: a bare `.fg-timeline__row-label` would also hide the pinned clones (the
    // injected <style> is document-global).
    expect(css).toContain('.fg-timeline .fg-timeline__row-label{opacity:0}');
    expect(css).not.toMatch(/(^|[},])\.fg-timeline__row-label\{opacity/);
    expect(css).not.toContain('/*');
    // Never an inline opacity: that would survive into exports.
    for (const l of h.svg.querySelectorAll('.fg-timeline__row-label')) {
      expect((l as SVGElement).style.opacity).toBe('');
    }
  });

  it('gives the column an opaque ground that borrows the host --fg-bg token', () => {
    const h = mount();
    const style = part(h, 'column').getAttribute('style')!;
    expect(style).toMatch(/background:\s*var\(--fg-bg,\s*#fff\)/);
  });

  it('property: for any task tree the column is exactly the clone of the chart labels and toggles', () => {
    const names = fc.string({ minLength: 0, maxLength: 40 });
    fc.assert(
      fc.property(
        fc.array(fc.record({ name: names, parent: fc.nat(8) }), { minLength: 1, maxLength: 12 }),
        fc.boolean(),
        (specs, collapseFirst) => {
          const tasks: Task[] = specs.map((sp, i) =>
            task(`t${i}`, {
              name: sp.name,
              ...(i > 0 && sp.parent < i ? { parent: toTaskId(`t${sp.parent}`) } : {}),
            }),
          );
          const parentIds = new Set(tasks.map((t) => t.parent).filter((p) => p !== undefined));
          const typed = tasks.map((t) => (parentIds.has(t.id) ? { ...t, type: 'summary' as const } : t));
          const el = document.createElement('div');
          document.body.appendChild(el);
          try {
            const collapsed = new Set(collapseFirst && typed[0] ? [typed[0].id] : []);
            const h = createSvgRenderer(el, { tasks: typed, dependencies: [], collapsedIds: collapsed });
            const column = el.querySelector('.fg-timeline__sticky-column')!;
            const real = [
              ...h.svg.querySelectorAll('.fg-timeline__row-toggle,.fg-timeline__row-label'),
            ] as SVGElement[];
            const clones = [
              ...column.querySelectorAll('.fg-timeline__row-toggle,.fg-timeline__row-label'),
            ] as SVGElement[];
            expect(clones.map((c) => c.outerHTML.replace(/ data-[a-z-]+="[^"]*"/g, ''))).toEqual(
              real.map((r) => r.outerHTML),
            );
            expect(clones.map((c) => c.dataset.rowIndex)).toEqual(
              real.map((r) => r.closest<SVGElement>('[data-row-index]')!.dataset.rowIndex),
            );
            expect(clones.map((c) => c.dataset.taskId)).toEqual(
              real.map((r) => r.closest<SVGElement>('[data-row-index]')!.dataset.taskId),
            );
          } finally {
            el.remove();
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
