// @vitest-environment jsdom
//
// Canvas-mode exportSvg()/exportPng() (spec-canvas-export.md §12). jsdom has no real canvas, so
// pixel output, backing-store limits, `getComputedStyle` custom-property fidelity and `toBlob`
// encoding are Playwright's job; this file covers dispatch, sanitization, limits, cleanup,
// the density source, the allocation probe and the exact paint calls.
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createGantt } from '../helpers/create-gantt.js';
import { createGantt as createGanttBase } from '../../src/gantt.js';
import { withIo } from '../../src/io/mixin.js';
import { withRender, CANVAS_AUTO_SWITCH_THRESHOLD } from '../../src/render/mixin.js';
import { withViewport } from '../../src/viewport/mixin.js';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import {
  MAX_CANVAS_AREA_PX_WEBKIT,
  MAX_CANVAS_DIMENSION_PX,
  MAX_CANVAS_EXPORT_ROWS,
  createCanvasRenderer,
  type CanvasRendererHandle,
} from '../../src/render/canvas-renderer.js';
import {
  MAX_EXPORT_CANVAS_AREA_PX,
  computeExportCanvasSize,
  exportCanvasPng,
} from '../../src/io/export-canvas-png.js';
import { exportSvg } from '../../src/io/export-svg.js';
import { normalizeDate, DEFAULT_CALENDAR } from '../../src/compute/working-calendar.js';
import { toTaskId, type Task } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const cal = DEFAULT_CALENDAR;
const HEAVY = 60_000;
const HEAVY_WAIT = 30_000;
const XSS_NAME = '</text><script>alert(1)</script>';
const XSS_COLOR = 'url(javascript:alert(1))';

function task(id: string, i: number, extra: Partial<Task> = {}): Task {
  const start = normalizeDate('2026-01-05T09:00', cal.timezone).add({ days: i % 20 });
  const now = new Date();
  return {
    id: toTaskId(id),
    name: id,
    start,
    end: start.add({ hours: 8 }),
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}
const flat = (n: number): Task[] => Array.from({ length: n }, (_, i) => task(`t${i}`, i));
const inputs = (n: number): TaskInput[] =>
  Array.from({ length: n }, (_, i) => ({
    id: toTaskId(`t${i}`),
    name: `t${i}`,
    start: '2026-01-05T09:00',
    end: '2026-01-05T17:00',
    progress: 0,
    type: 'task',
  }));

// --- Recording 2D context stub ------------------------------------------------------------
interface Probe {
  calls: { name: string; args: unknown[] }[];
  fonts: unknown[];
  lineDashes: unknown[][];
  alpha: number;
  blob: Blob | null;
  canvases: HTMLCanvasElement[];
}
function installCanvas(over: Partial<Pick<Probe, 'alpha' | 'blob'>> = {}): Probe {
  const probe: Probe = { calls: [], fonts: [], lineDashes: [], alpha: 255, blob: new Blob(['png'], { type: 'image/png' }), canvases: [], ...over };
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'getImageData') return () => ({ data: [0, 0, 0, probe.alpha] });
      return (...args: unknown[]) => {
        probe.calls.push({ name: prop, args });
        if (prop === 'setLineDash') probe.lineDashes.push(args[0] as unknown[]);
      };
    },
    set(target, prop: string, value) {
      if (prop === 'font') probe.fonts.push(value);
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!probe.canvases.includes(this)) probe.canvases.push(this);
    return ctx;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(probe.blob));
  return probe;
}
const calls = (p: Probe, name: string): { args: unknown[] }[] => p.calls.filter((c) => c.name === name);

let containers: HTMLElement[] = [];
function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  containers.push(el);
  return el;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../../src/io/export-canvas-png.js');
  vi.resetModules();
  for (const c of containers) c.remove();
  containers = [];
  Object.defineProperty(navigator, 'userAgent', { value: ORIGINAL_UA, configurable: true });
});
const ORIGINAL_UA = navigator.userAgent;
const WEBKIT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function mountCanvas(tasks: Task[], opts: Parameters<typeof createCanvasRenderer>[2] = {}, inject = true) {
  installCanvas();
  const el = makeContainer();
  const handle = createCanvasRenderer(el, { tasks, dependencies: [] }, opts, inject ? createSvgRenderer : undefined);
  return { el, handle };
}
const parse = (s: string): Document => new DOMParser().parseFromString(s, 'image/svg+xml');

// --- exportSvg, Canvas mode -----------------------------------------------------------------
describe('Canvas-mode exportSvg (handle.createExportSvg)', () => {
  it('serializes a well-formed, un-windowed SVG through the existing pipeline', () => {
    const { handle } = mountCanvas(flat(300), { ariaLabel: 'My plan', viewportHeight: 200 });
    const src = handle.createExportSvg();
    const out = exportSvg(src.svg, { inlineComputedStyle: false });
    src.dispose();
    expect(out.startsWith('<?xml')).toBe(true);
    expect(out.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1);
    const doc = parse(out);
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('title')!.textContent).toBe('My plan');
    // 300 rows exported although the live a11y layer is windowed to far fewer.
    expect(doc.querySelectorAll('[role="row"]')).toHaveLength(300);
    expect(handle.interactionRoot.querySelectorAll('[role="row"]').length).toBeLessThan(300);
    expect(out).not.toContain('fg-task__link-handle');
    expect(out).not.toContain('<style');
    expect(out).not.toContain('tabindex');
  });

  it('title parity with SVG mode for the same config', () => {
    const tasks = flat(5);
    const svgHandle = createSvgRenderer(makeContainer(), { tasks, dependencies: [] }, { ariaLabel: 'Parity' });
    const svgOut = exportSvg(svgHandle.svg, { inlineComputedStyle: false });
    const { handle } = mountCanvas(tasks, { ariaLabel: 'Parity' });
    const src = handle.createExportSvg();
    const canvasOut = exportSvg(src.svg, { inlineComputedStyle: false });
    src.dispose();
    expect(parse(canvasOut).querySelector('title')!.textContent).toBe(parse(svgOut).querySelector('title')!.textContent);
    expect(parse(canvasOut).querySelectorAll('[role="row"]')).toHaveLength(5);
  });

  it('escapes hostile task names and drops hostile colors', () => {
    const tasks = [task('a', 0, { name: XSS_NAME, color: XSS_COLOR }), task('b', 1)];
    const { handle } = mountCanvas(tasks);
    const src = handle.createExportSvg();
    const out = exportSvg(src.svg); // default: inlineComputedStyle true
    src.dispose();
    const doc = parse(out);
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('script')).toBeNull();
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('&lt;/text&gt;&lt;script&gt;');
  });

  it('honors inlineComputedStyle:false (no baked style attributes added)', () => {
    const { handle } = mountCanvas(flat(3));
    const a = handle.createExportSvg();
    const baked = exportSvg(a.svg, { inlineComputedStyle: true });
    a.dispose();
    const b = handle.createExportSvg();
    const raw = exportSvg(b.svg, { inlineComputedStyle: false });
    b.dispose();
    // Baked output carries resolved `style` attributes the raw output does not.
    expect(raw.length).toBeLessThan(baked.length);
    const styleBytes = (x: string): number =>
      Array.from(parse(x).querySelectorAll('[style]')).reduce((n, e) => n + e.getAttribute('style')!.length, 0);
    expect(styleBytes(baked)).toBeGreaterThan(styleBytes(raw));
  });

  it('excludes collapsed descendants and counts only visible rows against the cap', () => {
    const tasks = [
      task('p', 0),
      task('c1', 1, { parent: toTaskId('p') }),
      task('c2', 2, { parent: toTaskId('p') }),
      task('q', 3),
    ];
    installCanvas();
    const handle = createCanvasRenderer(
      makeContainer(),
      { tasks, dependencies: [], collapsedIds: new Set([toTaskId('p')]) },
      {},
      createSvgRenderer,
    );
    const src = handle.createExportSvg();
    const doc = parse(exportSvg(src.svg, { inlineComputedStyle: false }));
    src.dispose();
    expect(doc.querySelectorAll('[role="row"]')).toHaveLength(2);
    expect(doc.documentElement.innerHTML).not.toContain('c1');
  });

  it('SVG-mode and Canvas-mode exports match row for row', () => {
    const tasks = [task('p', 0), task('c1', 1, { parent: toTaskId('p') }), ...flat(6).slice(2)];
    const input = { tasks, dependencies: [], collapsedIds: new Set<never>() };
    const svgHandle = createSvgRenderer(makeContainer(), input, { ariaLabel: 'P' });
    const svgDoc = parse(exportSvg(svgHandle.svg, { inlineComputedStyle: false }));
    installCanvas();
    const handle = createCanvasRenderer(makeContainer(), input, { ariaLabel: 'P' }, createSvgRenderer);
    const src = handle.createExportSvg();
    const canvasDoc = parse(exportSvg(src.svg, { inlineComputedStyle: false }));
    src.dispose();
    const rowsOf = (d: Document): string[] =>
      Array.from(d.querySelectorAll('[role="row"]')).map((r) => new XMLSerializer().serializeToString(r));
    expect(rowsOf(canvasDoc)).toHaveLength(tasks.length);
    expect(rowsOf(canvasDoc)).toEqual(rowsOf(svgDoc));
    expect(canvasDoc.documentElement.getAttribute('width')).toBe(svgDoc.documentElement.getAttribute('width'));
  });

  it('leaves the container exactly as it found it, on success and on failure', () => {
    const { el, handle } = mountCanvas(flat(3));
    const before = Array.from(el.children);
    const scrollTop = el.scrollTop;
    const src = handle.createExportSvg();
    expect(el.children.length).toBe(before.length + 1); // the transient hidden host
    src.dispose();
    src.dispose(); // idempotent
    expect(Array.from(el.children)).toEqual(before);
    expect(el.scrollTop).toBe(scrollTop);

    const boom = vi.fn(() => {
      throw new Error('factory boom');
    });
    const { el: el2, handle: h2 } = (() => {
      installCanvas();
      const e = makeContainer();
      return { el: e, handle: createCanvasRenderer(e, { tasks: flat(2), dependencies: [] }, {}, boom as never) };
    })();
    const before2 = Array.from(el2.children);
    expect(() => h2.createExportSvg()).toThrow('factory boom');
    expect(Array.from(el2.children)).toEqual(before2);
  });

  it('throws without an injected svgFactory, and after destroy()', () => {
    const { handle } = mountCanvas(flat(2), {}, false);
    expect(() => handle.createExportSvg()).toThrow(/svgFactory/);
    const { handle: h2 } = mountCanvas(flat(2));
    h2.destroy();
    expect(() => h2.createExportSvg()).toThrow();
  });

  it('refuses above MAX_CANVAS_EXPORT_ROWS and leaves nothing in the DOM', () => {
    const { el, handle } = mountCanvas(flat(MAX_CANVAS_EXPORT_ROWS + 1), { viewportHeight: 100 });
    const before = Array.from(el.children);
    expect(() => handle.createExportSvg()).toThrow(new RegExp(`${MAX_CANVAS_EXPORT_ROWS}`));
    expect(Array.from(el.children)).toEqual(before);
  }, HEAVY);

  it('reads density from the painted state (setOptions), not from config', () => {
    const { handle } = mountCanvas(flat(2), { density: 'comfortable' });
    const heightOf = (): number => {
      const s = handle.createExportSvg();
      const h = Number(s.svg.getAttribute('height'));
      s.dispose();
      return h;
    };
    const comfortable = heightOf();
    handle.setOptions({ density: 'compact' });
    const compact = heightOf();
    expect(comfortable - compact).toBe(2 * (40 - 24)); // ROW_HEIGHT comfortable 40 / compact 24
  });
});

// --- Facade dispatch -------------------------------------------------------------------------
describe('facade: Canvas-mode export through withIo()', () => {
  async function mountFacade(tasks: TaskInput[], extra: Record<string, unknown> = {}) {
    installCanvasProbe();
    const el = makeContainer();
    const gantt = withViewport(createGantt({ tasks, ...extra }));
    gantt.mount(el);
    await vi.waitFor(() => expect(el.querySelector('canvas')).not.toBeNull(), { timeout: HEAVY_WAIT });
    return { el, gantt };
  }
  let probe: Probe;
  function installCanvasProbe(over: Partial<Pick<Probe, 'alpha' | 'blob'>> = {}): void {
    probe = installCanvas(over);
  }

  it('exportSvg uses runtime setDensity, not config.density', async () => {
    const { gantt } = await mountFacade(inputs(CANVAS_AUTO_SWITCH_THRESHOLD + 1), { density: 'comfortable' });
    const heightOf = (): number => Number(parse(gantt.exportSvg({ inlineComputedStyle: false })).documentElement.getAttribute('height'));
    const before = heightOf();
    gantt.setDensity('compact');
    const after = heightOf();
    expect(before - after).toBe((CANVAS_AUTO_SWITCH_THRESHOLD + 1) * (40 - 24));
  }, HEAVY);

  it('exportSvg throws after unmount (not mounted)', async () => {
    const { gantt } = await mountFacade(inputs(CANVAS_AUTO_SWITCH_THRESHOLD + 1));
    gantt.unmount();
    expect(() => gantt.exportSvg()).toThrow(/not mounted/);
    await expect(gantt.exportPng()).rejects.toThrow(/not mounted/);
  }, HEAVY);

  it('exportPng resolves a Blob and paints every row (not just the live window)', async () => {
    const n = CANVAS_AUTO_SWITCH_THRESHOLD + 1;
    const { gantt } = await mountFacade(inputs(n));
    probe.calls.length = 0;
    const blob = await gantt.exportPng({ scale: 0.1 });
    expect(blob.type).toBe('image/png');
    const names = new Set(calls(probe, 'fillText').map((c) => c.args[0]));
    expect(names.has('t0')).toBe(true);
    expect(names.has(`t${n - 1}`)).toBe(true);
    // Backing store released.
    expect(probe.canvases.at(-1)!.width).toBe(0);
  }, HEAVY);

  it('exportPng reports argument errors before the chunk load (even if unmounted meanwhile)', async () => {
    const { gantt } = await mountFacade(inputs(CANVAS_AUTO_SWITCH_THRESHOLD + 1));
    const p = gantt.exportPng({ scale: 0 });
    gantt.unmount();
    await expect(p).rejects.toThrow(/invalid scale/);
    const { gantt: g2 } = await mountFacade(inputs(CANVAS_AUTO_SWITCH_THRESHOLD + 1));
    await expect(g2.exportPng({ background: 'url(x)' })).rejects.toThrow(/invalid background/);
  }, HEAVY);

  it('exportPng rejects when unmounted while the chunk loads', async () => {
    const { gantt } = await mountFacade(inputs(CANVAS_AUTO_SWITCH_THRESHOLD + 1));
    const p = gantt.exportPng();
    gantt.unmount();
    await expect(p).rejects.toThrow(/unmounted or remounted/);
  }, HEAVY);

  it('exportPng rejects with a clear error when the chunk fails to load', async () => {
    vi.resetModules();
    vi.doMock('../../src/io/export-canvas-png.js', () => {
      throw new Error('chunk 404');
    });
    const [{ createGantt: g }, { withIo: io }, { withRender: render }] = await Promise.all([
      import('../../src/gantt.js'),
      import('../../src/io/mixin.js'),
      import('../../src/render/mixin.js'),
    ]);
    installCanvas();
    const el = makeContainer();
    const gantt = io(render(g({ tasks: inputs(CANVAS_AUTO_SWITCH_THRESHOLD + 1) })));
    gantt.mount(el);
    await vi.waitFor(() => expect(el.querySelector('canvas')).not.toBeNull(), { timeout: HEAVY_WAIT });
    await expect(gantt.exportPng()).rejects.toThrow(/failed to load the Canvas export module/);
    expect(el.querySelector('canvas')).not.toBeNull(); // chart unaffected
  }, HEAVY);
});

// --- exportCanvasPng, direct ------------------------------------------------------------------
describe('exportCanvasPng', () => {
  const handleFor = (tasks: Task[], opts = {}, extra: Record<string, unknown> = {}): CanvasRendererHandle => {
    const el = makeContainer();
    return createCanvasRenderer(el, { tasks, dependencies: [], ...extra }, opts, createSvgRenderer);
  };

  it('validates scale and background before allocating anything', async () => {
    const probe = installCanvas();
    const h = handleFor(flat(2));
    probe.canvases.length = 0;
    await expect(exportCanvasPng(h, { scale: 0 })).rejects.toThrow(/invalid scale/);
    await expect(exportCanvasPng(h, { scale: Number.NaN })).rejects.toThrow(/invalid scale/);
    await expect(exportCanvasPng(h, { background: 'url(x)' })).rejects.toThrow(/invalid background/);
    await expect(exportCanvasPng(h, { scale: 1e-6 })).rejects.toThrow(/degenerate/);
    expect(probe.canvases).toHaveLength(0);
  });

  it('computeExportCanvasSize: boundaries, engine-aware area, degenerate', () => {
    const M = MAX_CANVAS_DIMENSION_PX;
    expect(computeExportCanvasSize(100, 50, 2, false)).toEqual({ pxW: 200, pxH: 100 });
    expect(computeExportCanvasSize(M, 1, 1, false)).toEqual({ pxW: M, pxH: 1 }); // exactly at side
    expect(() => computeExportCanvasSize(M + 1, 1, 1, false)).toThrow(/safe canvas limit/);
    expect(() => computeExportCanvasSize(1, M + 1, 1, false)).toThrow(/safe canvas limit/);
    // exactly at the non-WebKit area cap, then one pixel over
    expect(computeExportCanvasSize(MAX_EXPORT_CANVAS_AREA_PX / 4096, 4096, 1, false).pxW).toBe(32768);
    expect(() => computeExportCanvasSize(32769, 4096, 1, false)).toThrow(/safe canvas limit/);
    // WebKit: far lower area ceiling, at / over
    expect(computeExportCanvasSize(MAX_CANVAS_AREA_PX_WEBKIT / 4096, 4096, 1, true).pxW).toBe(4096);
    expect(() => computeExportCanvasSize(4097, 4096, 1, true)).toThrow(/safe canvas limit/);
    expect(computeExportCanvasSize(4097, 4096, 1, false).pxW).toBe(4097); // fine off WebKit
    expect(() => computeExportCanvasSize(0.4, 100, 1, false)).toThrow(/degenerate/);
  });

  it('uses the WebKit area ceiling when the UA is WebKit', async () => {
    installCanvas();
    const h = handleFor(flat(2));
    Object.defineProperty(navigator, 'userAgent', { value: WEBKIT_UA, configurable: true });
    // 1200 px-ish chart at scale 100 -> far above 16.7M px area but under the per-side limit
    await expect(exportCanvasPng(h, { scale: 80 })).rejects.toThrow(/exceeds this browser's safe canvas limit/);
  });

  it('rejects when the allocation probe reads back a transparent pixel', async () => {
    const probe = installCanvas({ alpha: 0 });
    const h = handleFor(flat(2));
    await expect(exportCanvasPng(h)).rejects.toThrow(/safe canvas limit/);
    expect(probe.canvases.at(-1)!.width).toBe(0); // cleaned up even on failure
  });

  it('rejects when toBlob yields null, and still zeroes the backing store', async () => {
    const probe = installCanvas({ blob: null });
    const h = handleFor(flat(2));
    await expect(exportCanvasPng(h)).rejects.toThrow(/toBlob returned null/);
    expect(probe.canvases.at(-1)!.width).toBe(0);
  });

  it('excludes collapsed descendants from the paint', async () => {
    const tasks = [task('p', 0), task('c1', 1, { parent: toTaskId('p') }), task('q', 2)];
    const probe = installCanvas();
    const h = handleFor(tasks, {}, { collapsedIds: new Set([toTaskId('p')]) });
    probe.calls.length = 0;
    await exportCanvasPng(h);
    const texts = calls(probe, 'fillText').map((c) => c.args[0]);
    expect(texts).toContain('p');
    expect(texts).toContain('q');
    expect(texts).not.toContain('c1');
  });

  it('maps a null 2D context and a throwing probe to the actionable size error with cause', async () => {
    installCanvas();
    const h = handleFor(flat(2));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as never);
    await expect(exportCanvasPng(h)).rejects.toThrow(/gantt\.exportPng: .*safe canvas limit/);
    vi.restoreAllMocks();
    const boom = new Error('boom');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
      fillRect() {},
      getImageData() {
        throw boom;
      },
    })) as never);
    const err = await exportCanvasPng(h).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/safe canvas limit/);
    expect((err as Error).cause).toBe(boom);
  });

  it('rejects above the row cap', async () => {
    installCanvas();
    const h = handleFor(flat(MAX_CANVAS_EXPORT_ROWS + 1), { viewportHeight: 100 });
    await expect(exportCanvasPng(h)).rejects.toThrow(new RegExp(`${MAX_CANVAS_EXPORT_ROWS}`));
  }, HEAVY);

  it('paints every row (beyond the live window), names only as fillText text, constant font', async () => {
    const tasks = [...flat(150).slice(0, 149), task('evil', 149, { name: XSS_NAME, color: XSS_COLOR })];
    const probe = installCanvas();
    const h = createCanvasRenderer(makeContainer(), { tasks, dependencies: [] }, { viewportHeight: 120 }, createSvgRenderer);
    probe.calls.length = 0;
    probe.fonts.length = 0;
    await exportCanvasPng(h, { scale: 1 });
    const texts = calls(probe, 'fillText').map((c) => c.args[0]);
    for (const t of tasks) expect(texts).toContain(t.name);
    expect(new Set(probe.fonts)).toEqual(new Set(['12px system-ui, sans-serif']));
    // Hostile color never reaches a style sink.
    expect(probe.calls.some((c) => JSON.stringify(c.args).includes('javascript'))).toBe(false);
    // Header + grid painted once per column set (setTransform to the export scale happened).
    expect(calls(probe, 'setTransform').some((c) => c.args[0] === 1 && c.args[3] === 1)).toBe(true);
  });

  it('paints critical tasks dashed and does NOT paint selection outlines', async () => {
    const tasks = flat(3);
    const critical = { criticalTaskIds: [tasks[0]!.id], projectEnd: tasks[0]!.end } as never;
    const probe = installCanvas();
    const h = createCanvasRenderer(
      makeContainer(),
      { tasks, dependencies: [], criticalPath: critical, selectedTaskIds: [tasks[1]!.id] },
      {},
      createSvgRenderer,
    );
    probe.calls.length = 0;
    probe.lineDashes.length = 0;
    await exportCanvasPng(h);
    expect(probe.lineDashes.some((d) => d.length === 2 && d[0] === 4 && d[1] === 2)).toBe(true);
    // Selection outline = a stroke with the selected token color; with no critical dash on task 1
    // and selection suppressed, stroke count equals the grid/header/today/critical strokes only.
    const selectedRun = installCanvas();
    const h2 = createCanvasRenderer(makeContainer(), { tasks, dependencies: [], criticalPath: critical }, {}, createSvgRenderer);
    selectedRun.calls.length = 0;
    await exportCanvasPng(h2);
    expect(calls(probe, 'stroke').length).toBe(calls(selectedRun, 'stroke').length);
  });

  it('transparent background skips the fill; opaque fills the full bitmap', async () => {
    const probe = installCanvas();
    const h = handleFor(flat(2));
    probe.calls.length = 0;
    await exportCanvasPng(h, { background: 'transparent' });
    const w = Number(h.getLabelColumnWidth() + h.getTimeScale().totalWidth);
    const fullFills = (): number => calls(probe, 'fillRect').filter((c) => c.args[0] === 0 && c.args[1] === 0 && c.args[2] === Math.round(w)).length;
    expect(fullFills()).toBe(0);
    probe.calls.length = 0;
    await exportCanvasPng(h, { background: '#fff' });
    expect(fullFills()).toBe(1);
  });

  it('PNG height reflects the painted density after setOptions', async () => {
    const probe = installCanvas();
    const h = handleFor(flat(3), { density: 'comfortable' });
    // The background fill is the one fillRect starting at the origin and wider than the 1x1 probe.
    const bgHeight = async (): Promise<number> => {
      probe.calls.length = 0;
      await exportCanvasPng(h);
      return calls(probe, 'fillRect').find((c) => c.args[0] === 0 && c.args[1] === 0 && (c.args[2] as number) > 1)!
        .args[3] as number;
    };
    const comfortable = await bgHeight();
    h.setOptions({ density: 'compact' });
    const compact = await bgHeight();
    expect(comfortable - compact).toBe(3 * (40 - 24));
  });
});

// Keep the unused-import linter honest: the base facade + manual composition must also work.
describe('manual composition', () => {
  it('withIo(withRender(base)) exposes Canvas export without interaction', async () => {
    installCanvas();
    const el = makeContainer();
    const g = withIo(withRender(createGanttBase({ tasks: inputs(CANVAS_AUTO_SWITCH_THRESHOLD + 1) })));
    g.mount(el);
    await vi.waitFor(() => expect(el.querySelector('canvas')).not.toBeNull(), { timeout: HEAVY_WAIT });
    expect(g.exportSvg({ inlineComputedStyle: false })).toContain('<svg');
  }, HEAVY);
});

describe('module isolation (source scan)', () => {
  it('canvas-renderer.ts and export-canvas-png.ts only type-import the SVG renderer', () => {
    for (const f of ['../../src/render/canvas-renderer.ts', '../../src/io/export-canvas-png.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      const stmts = src.match(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+'[^']*svg-renderer[^']*'/g) ?? [];
      for (const st of stmts) expect(st, f).toMatch(/(?:import|export)\s+type\s/);
      expect(src, f).not.toMatch(/import\(\s*'[^']*svg-renderer/);
    }
  });
});
