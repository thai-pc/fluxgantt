// @vitest-environment jsdom
//
// Security matrix for the grid (security.md sections 1-2; spec-grid-columns.md 13.2): everything a
// column definition or a `value()` can smuggle must come out as inert text. Cell text, headers, ids,
// `format()` output and task names are untrusted.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withIo } from '../../src/io/mixin.js';
import { withGrid } from '../../src/grid/mixin.js';
import { toTaskId } from '../../src/types.js';
import { UNSAFE_TEXT } from '../../src/grid/columns.js';
import type { GridColumnInput } from '../../src/grid/types.js';

const PAYLOADS = [
  '<img src=x onerror=window.__xss=1>',
  '</text><script>window.__xss=1</script>',
  '"><svg onload=window.__xss=1>',
  "' onmouseover='window.__xss=1",
  'javascript:window.__xss=1',
  'url(javascript:window.__xss=1)',
  '<foreignObject><iframe srcdoc="<script>parent.__xss=1</script>"></iframe></foreignObject>',
  ']]><script>window.__xss=1</script><![CDATA[',
  '&lt;script&gt;window.__xss=1&lt;/script&gt;',
  '${window.__xss=1}',
  '‮<b>reversed</b>\u0000\n\r\t',
];

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  delete (window as unknown as Record<string, unknown>).__xss;
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

const mountWith = (name: string, columns: GridColumnInput[]) => {
  const g = withGrid(withIo(withRender(createGantt({
    tasks: [{ id: toTaskId('a'), name, start: '2026-01-05', end: '2026-01-09', progress: 0, type: 'task', meta: { note: name } }],
  }))), { columns });
  g.mount(container);
  return g;
};

/** The chart must hold no element a payload could have created, and no handler attribute. */
function expectInert(root: ParentNode): void {
  expect(root.querySelectorAll('script, img, iframe, foreignObject, a, use, image, animate, set').length).toBe(0);
  for (const el of root.querySelectorAll('*')) {
    for (const attr of el.getAttributeNames()) expect(attr.startsWith('on'), `${el.tagName} ${attr}`).toBe(false);
  }
  expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
}

describe.each(PAYLOADS.map((p) => [JSON.stringify(p), p] as const))('payload %s', (_label, payload) => {
  it('value() output is a Text node in the chart, the pinned clone and aria-label', () => {
    const g = mountWith('n', [{ id: 'name' }, { id: 'x', header: 'X', width: 600, value: () => payload } as GridColumnInput]);
    expectInert(container);
    const expected = payload.replace(UNSAFE_TEXT, ' ');
    const cell = container.querySelector('svg.fg-timeline [data-column-id=x][role=gridcell]')!;
    // a cut cell carries the full text in aria-label and a <title>; an uncut one is just the text
    expect(cell.getAttribute('aria-label') ?? cell.textContent).toBe(expected);
    expect([...cell.childNodes].every((n) => n.nodeType === Node.TEXT_NODE || (n as Element).tagName === 'title')).toBe(true);
    const clone = container.querySelector('.fg-timeline__sticky-column g[data-task-id=a] text')!;
    expect([...clone.childNodes].every((n) => n.nodeType === Node.TEXT_NODE || (n as Element).tagName === 'title')).toBe(true);
    expect(clone.querySelector('title')?.textContent ?? clone.textContent).toBe(expected);
    g.exportGridCsv(); // does not throw
  });

  it('format() output is inert too', () => {
    mountWith('n', [{ id: 'name' }, { id: 'x', header: 'X', width: 600, value: () => 1, format: () => payload } as GridColumnInput]);
    expectInert(container);
  });

  it('a header is inert text in the header row, its aria-label and the corner clone', () => {
    mountWith('n', [{ id: 'name' }, { id: 'x', header: payload, value: () => 1, width: 600 } as GridColumnInput]);
    expectInert(container);
    const head = container.querySelector('[role=columnheader][data-column-id=x]')!;
    expect(head.getAttribute('aria-label')).toContain(payload.replace(UNSAFE_TEXT, ' '));
    expect(container.querySelector('.fg-timeline__sticky-corner')!.querySelectorAll('*:not(svg):not(g):not(text):not(line):not(title)').length).toBe(0);
  });

  it('a task name (truncated, with title and aria-label) stays inert', () => {
    mountWith(payload.repeat(5), [{ id: 'name', width: 120 }]);
    expectInert(container);
  });

  it('meta-derived values stay inert', () => {
    mountWith(payload, [{ id: 'name' }, { id: 'x', header: 'X', value: (t) => String(t.meta?.note) } as GridColumnInput]);
    expectInert(container);
  });

  it('the exported SVG parses as XML with no script, handler or foreign content', () => {
    // (the task NAME is left plain: a raw NUL in a name is an existing exportSvg matter, not the grid's)
    const g = mountWith('n', [{ id: 'name' }, { id: 'x', header: payload, value: () => payload } as GridColumnInput]);
    const svg = g.exportSvg();
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expectInert(doc);
  });

  it('CSV: a header or cell is never a live formula', () => {
    const csv = withGrid(createGantt({ tasks: [{ id: toTaskId('a'), name: '=' + payload, start: '2026-01-05', end: '2026-01-09', progress: 0, type: 'task' }] }), {
      columns: [{ id: 'name', header: '=' + payload }],
    }).exportGridCsv();
    expect(csv.startsWith(`"'=`) || csv.startsWith(`'=`)).toBe(true);
    for (const line of csv.split('\r\n')) expect(line.replace(/^"/, '')).toMatch(/^'=/);
  });
});

describe('hostile values and definitions', () => {
  const col = (value: () => unknown): GridColumnInput => ({ id: 'x', header: 'X', value } as GridColumnInput);

  it('objects with a throwing toString, boxed strings, proxies and functions render blank, never call into the object', () => {
    const tripwire = vi.fn(() => '<img>');
    const hostile = [{ toString: tripwire }, new String('s'), new Proxy({}, {}), () => 's', { valueOf: tripwire }];
    for (const h of hostile) {
      container.replaceChildren();
      mountWith('n', [{ id: 'name' }, col(() => h)]);
      expect(container.querySelector('svg.fg-timeline [role=gridcell][data-column-id=x]')!.textContent).toBe('');
    }
    expect(tripwire).not.toHaveBeenCalled();
  });

  it('a throwing value() is contained and the chart still paints', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountWith('n', [{ id: 'name' }, col(() => { throw new Error('<img onerror=1>'); })]);
    expect(container.querySelectorAll('[role=columnheader]')).toHaveLength(2);
  });

  it('a huge value is cut to 1000 characters before it reaches the DOM', () => {
    mountWith('n', [{ id: 'name' }, { id: 'x', header: 'X', width: 600, value: () => 'a'.repeat(5_000_000) } as GridColumnInput]);
    const cell = container.querySelector('svg.fg-timeline [role=gridcell][data-column-id=x]')!;
    expect((cell.getAttribute('aria-label') ?? cell.textContent!).length).toBeLessThanOrEqual(1000);
  });

  it('hostile ids are rejected at definition time and never reach an attribute', () => {
    for (const id of PAYLOADS) {
      expect(() => withGrid(createGantt({ tasks: [] }), { columns: [{ id, header: 'h', value: () => 1 } as GridColumnInput] })).toThrow(RangeError);
    }
    for (const id of PAYLOADS) {
      const g = withGrid(withRender(createGantt({ tasks: [] })));
      expect(() => g.setGridColumns([{ id, header: 'h', value: () => 1 } as GridColumnInput])).toThrow(RangeError);
    }
  });

  it('an over-long or non-string header is rejected', () => {
    expect(() => withGrid(createGantt({ tasks: [] }), { columns: [{ id: 'x', header: 'h'.repeat(201), value: () => 1 } as GridColumnInput] })).toThrow(RangeError);
    expect(() => withGrid(createGantt({ tasks: [] }), { columns: [{ id: 'x', header: { toString: () => '<b>' }, value: () => 1 } as never] })).toThrow(RangeError);
  });

  it('a throwing messages.gridColumnLabel falls back to the English name', () => {
    const g = withGrid(withRender(createGantt({
      tasks: [],
      messages: { gridColumnLabel: () => { throw new Error('x'); } },
    })));
    g.mount(container);
    expect(container.querySelector('[role=columnheader]')!.getAttribute('aria-label')).toBe('Name');
  });

  it('a gridColumnLabel that returns a non-string or a huge string is replaced / capped', () => {
    for (const [ret, check] of [[{ a: 1 }, (s: string) => s === 'Name'], ['x'.repeat(5000), (s: string) => s.length === 400]] as const) {
      container.replaceChildren();
      const g = withGrid(withRender(createGantt({ tasks: [], messages: { gridColumnLabel: () => ret as never } })));
      g.mount(container);
      expect(check(container.querySelector('[role=columnheader]')!.getAttribute('aria-label')!)).toBe(true);
    }
  });
});

describe('an export always parses as XML (characters XML 1.0 forbids never reach it)', () => {
  const BAD = ['x\uffffy', 'x\ufffey', 'x\ud800y', 'x\udc00y', 'x\ud83dy', 'a\u0000b', 'a\u0001b', 'a\u000bb', 'a\u001fb', 'tail\ud800'];
  const parses = (svg: string): boolean => new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror') === null;
  const cases = BAD.map((b) => [JSON.stringify(b), b] as const);

  it.each(cases)('value() returning %s', (_l, bad) => {
    const g = mountWith('n', [{ id: 'name' }, { id: 'x', header: 'X', value: () => bad } as GridColumnInput]);
    expect(parses(g.exportSvg())).toBe(true);
  });

  it.each(cases)('format() returning %s', (_l, bad) => {
    const g = mountWith('n', [{ id: 'name' }, { id: 'x', header: 'X', value: () => 1, format: () => bad } as GridColumnInput]);
    expect(parses(g.exportSvg())).toBe(true);
  });

  it.each(cases)('messages.gridColumnLabel returning %s', (_l, bad) => {
    const g = withGrid(withIo(withRender(createGantt({
      tasks: [{ id: toTaskId('a'), name: 'n', start: '2026-01-05', end: '2026-01-09', progress: 0, type: 'task' }],
      messages: { gridColumnLabel: () => bad },
    }))));
    g.mount(container);
    expect(parses(g.exportSvg())).toBe(true);
    expect(container.querySelector('[role=columnheader]')!.getAttribute('aria-label')).not.toMatch(UNSAFE_TEXT);
  });

  it.each(cases)('a header %s', (_l, bad) => {
    const g = mountWith('n', [{ id: 'name' }, { id: 'x', header: bad, value: () => 1 } as GridColumnInput]);
    expect(parses(g.exportSvg())).toBe(true);
  });
});

describe('static source scan: no markup sinks in the grid sources', () => {
  const dir = resolve(import.meta.dirname, '../../src/grid') + '/';
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1');
  it.each(readdirSync(dir).filter((f) => f.endsWith('.ts')))('%s', (file) => {
    const code = strip(readFileSync(dir + file, 'utf8'));
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'setAttribute(\'style\'', 'createContextualFragment', 'DOMParser', 'srcdoc']) {
      expect(code, `${file} uses ${sink}`).not.toContain(sink);
    }
    expect(code).not.toMatch(/querySelector(All)?\(\s*`/); // no selector built from a template
    expect(code).not.toMatch(/cssText\s*=\s*`/);
  });
});
