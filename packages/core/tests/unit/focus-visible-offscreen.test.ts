// @vitest-environment jsdom
//
// Row focus frame (spec-focus-visible-offscreen.md): SVG DOM, row patch, export, Canvas paint order
// and the contrast arithmetic of the focus token defaults. Real pixels / :focus-visible / forced colors
// are the Playwright specs' job.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSvgRenderer, type SvgRendererHandle, type SvgRendererInput } from '../../src/render/svg-renderer.js';
import { createCanvasRenderer } from '../../src/render/canvas-renderer.js';
import { exportSvg } from '../../src/io/export-svg.js';
import { DARK_TOKENS } from '../../src/theme/tokens.js';
import { toTaskId, type Task, type TaskId } from '../../src/types.js';

const id = toTaskId;
function task(name: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date(0);
  return { id: id(name), name, start, end, progress: 0, type: 'task', createdAt: now, updatedAt: now, ...extra };
}
const tasks: Task[] = [
  task('a', '2026-01-05T09:00', '2026-01-07T17:00'),
  task('b', '2026-01-08T09:00', '2026-01-12T17:00'),
  task('c', '2026-01-13T09:00', '2026-01-14T17:00'),
];
const input = (focus?: TaskId, rev = 1): SvgRendererInput => ({
  tasks,
  dependencies: [],
  selectedTaskIds: [],
  ...(focus !== undefined ? { focusedTaskId: focus } : {}),
  rev,
});

let container: HTMLElement;
beforeEach(() => {
  vi.setSystemTime(new Date('2035-01-01T00:00:00Z')); // no today rule in range
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const frames = (h: SvgRendererHandle): SVGRectElement[] => [
  ...h.pointerEventTarget.querySelectorAll<SVGRectElement>('.fg-timeline__focus-row'),
];
const column = (h: SvgRendererHandle): Element => h.pointerEventTarget.querySelector('.fg-timeline__sticky-column')!;

describe('SVG row focus frame', () => {
  it('has a chart copy and a column clone, aria-hidden, at the focused row', () => {
    const h = createSvgRenderer(container, input(id('b')), {});
    const f = frames(h);
    expect(f).toHaveLength(2);
    const [chart, clone] = f as [SVGRectElement, SVGRectElement];
    expect(chart.closest('.fg-timeline__sticky-column')).toBeNull();
    expect(column(h).contains(clone)).toBe(true);
    for (const r of f) {
      expect(r.getAttribute('aria-hidden')).toBe('true');
      expect(r.getAttribute('fill') ?? r.style.fill).toBeTruthy();
      expect(r.hasAttribute('data-task-id')).toBe(false);
      expect(r.hasAttribute('data-row-index')).toBe(false);
      expect(r.classList.contains('fg-task__bar')).toBe(false);
    }
    expect(chart.getAttribute('y')).toBe(clone.getAttribute('y'));
    expect(Number(chart.getAttribute('width'))).toBe(Number(h.svg.getAttribute('width')) - 2);
    expect(Number(chart.getAttribute('x'))).toBe(1);
    // y = header + row.y + 1, row 1 sits one row below row 0
    const y0 = Number(frames(createSvgRenderer(container, input(id('a')), {}))[0]!.getAttribute('y'));
    const rowH = Number(chart.getAttribute('height')) + 2;
    expect(Number(chart.getAttribute('y'))).toBe(y0 + rowH);
  });

  it('is present with labelColumnWidth 0 (chart copy; the column clone is empty-width)', () => {
    const h = createSvgRenderer(container, input(id('a')), { labelColumnWidth: 0 });
    expect(frames(h).length).toBeGreaterThanOrEqual(1);
    expect(column(h).getAttribute('width')).toBe('0');
  });

  it('CSS: the :has rule is its own rule, inert by default, pointer-events none, no comments', () => {
    const h = createSvgRenderer(container, input(id('a')), {});
    const css = [...h.svg.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).not.toContain('/*');
    expect(css).toMatch(/\.fg-timeline__focus-row\{stroke:none;pointer-events:none\}/);
    const hasRule = css.split('}').find((r) => r.includes(':has('))!;
    expect(hasRule).toContain('.fg-timeline__focus-row{stroke:var(--fg-task-focus,#0369a1)');
    expect(hasRule).not.toContain('.fg-task__focus-ring');
    expect(css).toContain('.fg-timeline__row:focus-visible .fg-task__focus-ring{stroke:var(--fg-task-focus,#0369a1)');
  });
});

describe('row focus frame: row patch', () => {
  const layerOf = (h: SvgRendererHandle): HTMLElement => h.pointerEventTarget;
  function expectEqualsFull(h: SvgRendererHandle): void {
    const patched = layerOf(h).outerHTML;
    h.setOptions({});
    expect(layerOf(h).outerHTML).toBe(patched);
  }

  it('a focus-only update moves both frames without a full render and equals one', () => {
    const h = createSvgRenderer(container, input(id('a')), {});
    let prev = frames(h)[0]!.getAttribute('y');
    for (const target of [id('c'), id('b'), id('a'), id('c')]) {
      const defs = h.svg.querySelector('defs');
      h.update(input(target));
      expect(h.svg.querySelector('defs')).toBe(defs); // patched, not repainted
      const ys = frames(h).map((f) => f.getAttribute('y'));
      expect(ys).toHaveLength(2);
      expect(ys[0]).toBe(ys[1]);
      expect(ys[0]).not.toBe(prev);
      prev = ys[0]!;
      expectEqualsFull(h);
    }
  });

  it('replaces exactly two rows on a focus move (frame is not per row)', () => {
    const h = createSvgRenderer(container, input(id('a')), {});
    const before = [...h.svg.querySelectorAll('.fg-timeline__row')];
    h.update(input(id('c')));
    const after = [...h.svg.querySelectorAll('.fg-timeline__row')];
    expect(after.filter((e, i) => e !== before[i])).toHaveLength(2);
  });

  it('same rev and focus mutates nothing', () => {
    const h = createSvgRenderer(container, input(id('b')), {});
    const obs = new MutationObserver(() => {});
    obs.observe(layerOf(h), { subtree: true, childList: true, attributes: true, characterData: true });
    h.update(input(id('b')));
    expect(obs.takeRecords()).toHaveLength(0);
    obs.disconnect();
  });

  it('a stale focus id keeps the frame (inert) and does not throw', () => {
    const h = createSvgRenderer(container, input(id('a')), {});
    expect(() => h.update(input(id('gone')))).not.toThrow();
    expect(frames(h)).toHaveLength(2);
    expectEqualsFull(h);
  });
});

describe('row focus frame: export', () => {
  it('is stripped from exportSvg: output is byte-identical to an export of the chart without the frame', () => {
    const h = createSvgRenderer(container, input(id('a')), {});
    const out = exportSvg(h.svg);
    expect(out).not.toContain('fg-timeline__focus-row');
    h.svg.querySelector('.fg-timeline__focus-row')!.remove();
    expect(exportSvg(h.svg)).toBe(out);
  });
});

describe('Canvas row focus frame', () => {
  type Call = { name: string; args: unknown[] };
  interface Rec {
    calls: Call[];
    props: Record<string, unknown>;
    strokeStyleAtStrokeRect: unknown[];
    lineDashAtStrokeRect: unknown[];
  }
  const recs = new WeakMap<HTMLCanvasElement, Rec>();
  let rafQueue: Array<(t: number) => void> = [];
  const flush = (): void => {
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(0);
  };

  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => rafQueue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      let rec = recs.get(this);
      if (!rec) {
        const r: Rec = { calls: [], props: { textAlign: 'start', direction: 'ltr' }, strokeStyleAtStrokeRect: [], lineDashAtStrokeRect: [] };
        const ctx = new Proxy(r.props, {
          get: (t, k: string) =>
            k in t
              ? t[k]
              : (...args: unknown[]): void => {
                  r.calls.push({ name: k, args });
                  if (k === 'strokeRect') {
                    r.strokeStyleAtStrokeRect.push(t.strokeStyle);
                    r.lineDashAtStrokeRect.push(t.__dash);
                  }
                  if (k === 'setLineDash') t.__dash = args[0];
                },
          set: (t, k: string, v: unknown) => {
            t[k] = v;
            return true;
          },
        });
        recs.set(this, (rec = Object.assign(r, { ctx })));
        (rec as unknown as { ctx: unknown }).ctx = ctx;
      }
      return (rec as unknown as { ctx: CanvasRenderingContext2D }).ctx;
    } as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  const mount = (opts: Parameters<typeof createCanvasRenderer>[2] = {}) =>
    createCanvasRenderer(container, { tasks, dependencies: [] }, { viewMode: 'week', viewportHeight: 400, ...opts });
  const labelCanvas = (): HTMLCanvasElement => container.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas-labels')!;
  const strokeRects = (c: HTMLCanvasElement): Call[] => recs.get(c)!.calls.filter((k) => k.name === 'strokeRect');

  function focusRow(name: string): void {
    const row = container.querySelector<HTMLElement>(`[data-task-id="${name}"]`)!;
    row.focus();
    flush();
  }

  it('paints one frame on the chart ctx and one on the label ctx, before the divider, with the token', () => {
    const h = mount();
    flush();
    expect(strokeRects(h.canvas)).toHaveLength(0); // no focus inside: nothing
    expect(strokeRects(labelCanvas())).toHaveLength(0);
    focusRow('b');
    const chart = strokeRects(h.canvas);
    const label = strokeRects(labelCanvas());
    expect(chart.length).toBeGreaterThanOrEqual(1);
    expect(label.length).toBeGreaterThanOrEqual(1);
    const lastChart = recs.get(h.canvas)!;
    const lastLabel = recs.get(labelCanvas())!;
    expect(lastChart.strokeStyleAtStrokeRect.at(-1)).toBe('#0369a1');
    expect(lastLabel.strokeStyleAtStrokeRect.at(-1)).toBe('#0369a1');
    expect(lastLabel.lineDashAtStrokeRect.at(-1)).toEqual([]);
    // inset by half the 2px line: x = 1, y = row.y + 1
    const [x, y] = label.at(-1)!.args as number[];
    expect(x).toBe(1);
    const [, , w, hgt] = label.at(-1)!.args as number[];
    expect(w).toBeGreaterThan(0);
    expect(y).toBe(1 + 1 * (hgt! + 2)); // row index 1, inset by half the 2px line
    // paint order on the label ctx: labels, then the frame, then the divider (last stroke/line)
    const names = lastLabel.calls.map((k) => k.name);
    const lastFrame = names.lastIndexOf('strokeRect');
    const lastText = names.lastIndexOf('fillText');
    expect(lastFrame).toBeGreaterThan(lastText);
    expect(names.slice(lastFrame + 1)).toContain('lineTo'); // the divider is painted after the frame
  });

  it('paints no label-ctx frame when labelColumnWidth is 0', () => {
    mount({ labelColumnWidth: 0 });
    flush();
    focusRow('a');
    expect(strokeRects(labelCanvas())).toHaveLength(0);
  });

  it('mirrors the label ctx before the frame in RTL', () => {
    mount({ rtl: true });
    flush();
    focusRow('a');
    const names = recs.get(labelCanvas())!.calls.map((k) => k.name);
    const frame = names.lastIndexOf('strokeRect');
    expect(frame).toBeGreaterThan(-1);
    const mirrored = recs.get(labelCanvas())!.calls.findLastIndex((k) => k.name === 'transform' || k.name === 'scale' || k.name === 'setTransform');
    expect(mirrored).toBeGreaterThan(-1);
    expect(mirrored).toBeLessThan(frame);
  });
});

describe('focus token contrast', () => {
  const lum = (hex: string): number => {
    const c = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  it('light default reaches 3:1 on every light ground and wash', () => {
    for (const g of ['#ffffff', '#f3f4f6', '#f9fafb', '#fef3c7', '#fee2e2']) {
      expect(ratio('#0369a1', g)).toBeGreaterThanOrEqual(3);
    }
  });
  it('the old default failed (documents why it changed)', () => {
    expect(ratio('#0ea5e9', '#ffffff')).toBeLessThan(3);
  });
  it('dark token reaches 3:1 on every dark ground and wash', () => {
    expect(DARK_TOKENS['--fg-task-focus']).toBe('#38bdf8');
    for (const g of ['#0a0a0a', '#18181b', '#422006', '#450a0a']) {
      expect(ratio('#38bdf8', g)).toBeGreaterThanOrEqual(3);
    }
  });
});
