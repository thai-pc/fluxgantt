// @vitest-environment jsdom
//
// Unit tests for `exportSvg` (spec-export-png-svg.md §12.1). Runs under jsdom (per-file
// override; the rest of core stays `environment: 'node'`), matching svg-renderer.test.ts /
// gantt-dom.test.ts.
//
// NOTE: jsdom's own CSS cascade / `var()` resolution is limited (it does not really resolve a
// host stylesheet override of a `--fg-*` custom property) — the REAL WYSIWYG proof for baking
// (decision 1: an overridden `--fg-*` token ends up as the resolved value in the export) needs
// a Playwright e2e test in a real browser; not something jsdom can prove. This file tests the
// baking/removal/serialization MECHANISM with `getComputedStyle` mocked to canned values.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exportSvg, isSafeStyleValue } from '../../src/io/export-svg.js';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { createGantt } from '../../src/gantt.js';
import { computeCriticalPath } from '../../src/compute/critical-path.js';
import { DEFAULT_CALENDAR } from '../../src/compute/working-calendar.js';
import { toTaskId, toDependencyId, type Task, type Dependency } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

function task(id: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return { id: toTaskId(id), name: id, start, end, progress: 0.5, type: 'task', createdAt: now, updatedAt: now, ...extra };
}

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

const baseTasks: Task[] = [
  task('a', '2026-01-05T09:00', '2026-01-07T17:00'),
  task('b', '2026-01-08T09:00', '2026-01-09T17:00'),
];
const baseDeps: Dependency[] = [{ id: toDependencyId('d1'), from: toTaskId('a'), to: toTaskId('b'), type: 'FS' }];

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  // Silenced by default — real (unmocked) jsdom `getComputedStyle` returns the raw
  // UNRESOLVED `var(...)` string for every baked property (jsdom limitation, spec §12.4),
  // which fails `isSafeStyleValue` and warns for every element/property pair in most tests
  // here. Tests that specifically assert on `console.warn` read this same spy directly
  // (`vi.mocked(console.warn)`), they don't re-spy.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

/** jsdom does NOT resolve `var(...)` — `getComputedStyle().getPropertyValue(...)` on a live
 *  element just returns the raw declared string verbatim (confirmed empirically), which means
 *  every `BAKED_STYLE_PROPERTIES` entry fails `isSafeStyleValue` (parentheses) under REAL
 *  (unmocked) jsdom computed style. Safe canned defaults for all six baked properties, so a
 *  test that mocks only ONE property (e.g. a hostile `fill`) doesn't also trip the safety
 *  check — and warn — for the other five due to this jsdom limitation (spec §12.4). */
const SAFE_STYLE_DEFAULTS: Record<string, string> = {
  fill: '#111111',
  stroke: 'none',
  'stroke-width': '2px',
  'stroke-dasharray': '4 2',
  'text-anchor': 'middle',
  'dominant-baseline': 'middle',
};

/** Wraps `window.getComputedStyle` so `getPropertyValue(prop)` returns a canned value for
 *  every one of the six `BAKED_STYLE_PROPERTIES` (defaulting to `SAFE_STYLE_DEFAULTS`,
 *  overridable per test) — every other property call passes through to the REAL computed
 *  style. Minimal object (only `getPropertyValue` is used by `exportSvg`), not a full
 *  `CSSStyleDeclaration`. */
function mockComputedStyle(overrides: Partial<typeof SAFE_STYLE_DEFAULTS> = {}): void {
  const values = { ...SAFE_STYLE_DEFAULTS, ...overrides };
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const cs = real(el, pseudo ?? undefined);
    return {
      getPropertyValue: (prop: string) => (prop in values ? values[prop]! : cs.getPropertyValue(prop)),
    } as CSSStyleDeclaration;
  });
}

describe('exportSvg — structure', () => {
  it('emits an XML declaration + explicit xmlns and parses cleanly', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const out = exportSvg(h.svg);
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.tagName.toLowerCase()).toBe('svg');
  });

  it('strips the link-handle <style> block', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.querySelector('style')).not.toBeNull(); // sanity: live svg has it
    const out = exportSvg(h.svg);
    expect(out).not.toContain('<style');
  });

  it('removes .fg-task__link-handle ELEMENTS, not merely the style hiding them', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.querySelectorAll('.fg-task__link-handle').length).toBeGreaterThan(0); // sanity
    const out = exportSvg(h.svg);
    expect(out).not.toContain('fg-task__link-handle');
    expect(out).not.toContain('<circle');
  });

  it('promotes the default aria-label into a <title> first child', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const out = exportSvg(h.svg);
    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    const title = doc.documentElement.firstElementChild;
    expect(title?.tagName.toLowerCase()).toBe('title');
    expect(title?.textContent).toBe('Gantt chart');
    expect(doc.documentElement.getAttribute('aria-label')).toBe('Gantt chart');
    expect(doc.documentElement.getAttribute('role')).toBe('img');
  });

  it('promotes a custom ariaLabel into <title>', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps }, { ariaLabel: 'My project' });
    const out = exportSvg(h.svg);
    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    expect(doc.documentElement.firstElementChild?.textContent).toBe('My project');
  });

  it('a critical-path task bar still carries a stroke-dasharray declaration (a11y survives export)', () => {
    const criticalPath = computeCriticalPath(baseTasks, baseDeps, DEFAULT_CALENDAR);
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps, criticalPath });
    const out = exportSvg(h.svg);
    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    const criticalBar = doc.querySelector('.fg-task--critical .fg-task__bar');
    expect(criticalBar).not.toBeNull();
    expect(criticalBar!.getAttribute('style') ?? '').toContain('stroke-dasharray');
  });

  it('leaves a legitimate marker-end attribute reference untouched (only BAKED_STYLE_PROPERTIES are touched)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const out = exportSvg(h.svg);
    expect(out).toContain('marker-end="url(#fg-dep-arrowhead)"');
  });

  it('empty chart (0 tasks, mounted) does not throw and exports a well-formed SVG', () => {
    const h = createSvgRenderer(
      container,
      { tasks: [], dependencies: [] },
      { timeRange: { start: '2026-01-01', end: '2026-01-14' } },
    );
    let out = '';
    expect(() => (out = exportSvg(h.svg))).not.toThrow();
    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
  });

  it('inlineComputedStyle: false keeps the original var(--fg-token, fallback) declaration verbatim', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const out = exportSvg(h.svg, { inlineComputedStyle: false });
    expect(out).toContain('var(--fg-task-default, #6366f1)');
  });
});

describe('exportSvg — computed-style baking', () => {
  it('bakes the LIVE-resolved value (not the raw var() string) into the clone', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    mockComputedStyle({ fill: 'rgb(1, 2, 3)' });
    const out = exportSvg(h.svg);
    expect(out).toContain('rgb(1, 2, 3)');
    expect(out).not.toContain('var(--fg-task-default');
  });

  it('a bad prop/value fails isSafeStyleValue and is skipped', () => {
    expect(isSafeStyleValue('fill', 'javascript:alert(1)')).toBe(false);
    expect(isSafeStyleValue('fill', 'expression(alert(1))')).toBe(false);
    expect(isSafeStyleValue('fill', 'url(https://evil.example/x)')).toBe(false);
    expect(isSafeStyleValue('fill', '#6366f1')).toBe(true);
    expect(isSafeStyleValue('fill', 'rgb(1, 2, 3)')).toBe(true);
    expect(isSafeStyleValue('fill', 'none')).toBe(true);
    expect(isSafeStyleValue('fill', 'url(#fg-dep-arrowhead)')).toBe(true);
    expect(isSafeStyleValue('stroke-dasharray', '4 2')).toBe(true);
    expect(isSafeStyleValue('stroke-dasharray', '4;2')).toBe(false);
  });

  it('accepts modern getComputedStyle serializations without silently dropping them (review A1/B6)', () => {
    // Space-separated CSS Color 4 form (what modern browsers may return from getComputedStyle):
    expect(isSafeStyleValue('fill', 'rgb(100 116 139)')).toBe(true);
    expect(isSafeStyleValue('fill', 'rgb(100 116 139 / 0.5)')).toBe(true);
    expect(isSafeStyleValue('stroke', 'hsl(210 40% 96%)')).toBe(true);
    // A paint-server ref serialized WITH quotes (getComputedStyle output) — still a local ref:
    expect(isSafeStyleValue('fill', 'url("#fg-dep-arrowhead")')).toBe(true);
    // Still rejects an external/quoted url and a scheme:
    expect(isSafeStyleValue('fill', 'url("https://evil.example/x")')).toBe(false);
  });

  it('bakes every whitelisted property, not just fill (review C6)', () => {
    // Build a minimal SVG whose rect declares ALL four bakeable props inline, so the bake loop
    // is exercised for each (not renderer-dependent on a critical bar existing).
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '50');
    const rect = document.createElementNS(ns, 'rect');
    for (const [p, v] of Object.entries({
      fill: 'var(--x, #000)',
      stroke: 'var(--y, #000)',
      'stroke-width': 'var(--z, 1px)',
      'stroke-dasharray': 'var(--d, 0)',
    })) {
      rect.style.setProperty(p, v);
    }
    svg.appendChild(rect);
    container.appendChild(svg);

    mockComputedStyle({
      fill: 'rgb(1, 2, 3)',
      stroke: 'rgb(4, 5, 6)',
      'stroke-width': '3px',
      'stroke-dasharray': '5 4',
    });
    const out = exportSvg(svg);
    // Each resolved value must actually reach the serialized output through the bake loop.
    expect(out).toContain('rgb(1, 2, 3)'); // fill
    expect(out).toContain('rgb(4, 5, 6)'); // stroke
    expect(out).toContain('stroke-width: 3px');
    expect(out).toContain('stroke-dasharray: 5 4');
  });

  it('skips a hostile computed value (never appears in output) and warns exactly once', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    mockComputedStyle({ fill: 'url(https://evil.example/x)' });
    const warnSpy = vi.mocked(console.warn); // already spied by the outer beforeEach
    warnSpy.mockClear();
    const out = exportSvg(h.svg);
    expect(out).not.toContain('evil.example');
    // The clone keeps its original var(...) declaration for that property instead.
    expect(out).toContain('var(--fg-task-default');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('exportSvg — security (security.md §1)', () => {
  it('escapes task.name special characters — no active content when reopened as HTML', () => {
    const nasty = `<img src=x onerror=alert(1)>&"'💥`;
    const h = createSvgRenderer(container, {
      tasks: [task('x', '2026-01-05T09:00', '2026-01-06T09:00', { name: nasty })],
      dependencies: [],
    });
    const out = exportSvg(h.svg);

    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const label = doc.querySelector('.fg-timeline__row-label');
    expect(label?.textContent).toBe(nasty);
    expect(out).not.toContain('<img src=x onerror=alert(1)>');

    // Direct regression for "exported SVG can be opened as HTML" — assign to a scratch
    // DETACHED div, never appended to a live page.
    const scratch = document.createElement('div');
    scratch.innerHTML = out;
    expect(scratch.querySelector('script')).toBeNull();
    expect(scratch.querySelector('img[onerror]')).toBeNull();
  });

  it('a hostile aria-label is inert in the <title> when reopened as HTML (review C2)', () => {
    // The <title> is the ONE new sink exportSvg introduces (aria-label → title), on a code path
    // distinct from the renderer's task.name text node — assert it too stays inert.
    const nasty = `</title><script>alert(1)</script>`;
    const h = createSvgRenderer(
      container,
      { tasks: [task('x', '2026-01-05T09:00', '2026-01-06T09:00')], dependencies: [] },
      { ariaLabel: nasty },
    );
    const out = exportSvg(h.svg);

    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('title')?.textContent).toBe(nasty); // preserved as literal text
    expect(out).not.toContain('<script>'); // never a real element

    const scratch = document.createElement('div');
    scratch.innerHTML = out;
    expect(scratch.querySelector('script')).toBeNull();
  });

  it('a name at/over MAX_ARIA_NAME_LENGTH round-trips as literal text', () => {
    const long = 'x'.repeat(260);
    const h = createSvgRenderer(container, {
      tasks: [task('x', '2026-01-05T09:00', '2026-01-06T09:00', { name: long })],
      dependencies: [],
    });
    const out = exportSvg(h.svg);
    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    expect(doc.querySelector('.fg-timeline__row-label')?.textContent).toBe(long);
  });
});

describe('exportSvg — facade (gantt.ts)', () => {
  it('exportSvg() throws synchronously with a "not mounted" message before mount()', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    expect(() => gantt.exportSvg()).toThrow(/not mounted/);
  });

  it('exportSvg() works once mounted, and throws again after destroy()', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    expect(() => gantt.exportSvg()).not.toThrow();
    const out = gantt.exportSvg();
    expect(out).toContain('<?xml');

    gantt.destroy();
    expect(() => gantt.exportSvg()).toThrow(/not mounted/);
  });

  it('exportSvg() throws again after unmount()', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    gantt.unmount();
    expect(() => gantt.exportSvg()).toThrow(/not mounted/);
  });
});
