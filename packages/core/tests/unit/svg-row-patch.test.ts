// @vitest-environment jsdom
//
// Selection/focus row patch of the SVG renderer (spec-svg-row-patch.md). A patched DOM must equal a
// forced full render byte for byte, and only the rows whose selection or focus state changed may be
// replaced. "Full render" is detected by the identity of the `<defs>` node every full render makes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSvgRenderer, type SvgRendererHandle, type SvgRendererInput } from '../../src/render/svg-renderer.js';
import { computeCriticalPath } from '../../src/compute/critical-path.js';
import { computeRollup } from '../../src/compute/rollup.js';
import { DEFAULT_CALENDAR } from '../../src/compute/working-calendar.js';
import { createGantt } from '../helpers/create-gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { withIo } from '../../src/io/mixin.js';
import { createGantt as createBase } from '../../src/gantt.js';
import { toTaskId, toDependencyId, type Task, type Dependency, type TaskId } from '../../src/types.js';

const id = toTaskId;
function task(name: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date(0);
  return { id: id(name), name, start, end, progress: 0.5, type: 'task', createdAt: now, updatedAt: now, ...extra };
}
const tasks: Task[] = [
  task('p', '2026-01-05T09:00', '2026-01-14T17:00', { type: 'summary' }),
  task('a', '2026-01-05T09:00', '2026-01-07T17:00', { parent: id('p'), color: '#ff0000' }),
  task('b', '2026-01-08T09:00', '2026-01-12T17:00', { parent: id('p') }),
  task('c', '2026-01-13T09:00', '2026-01-14T17:00', { name: '<b>c</b>' }),
  task('m', '2026-01-15T09:00', '2026-01-15T09:00', { type: 'milestone' }),
];
const deps: Dependency[] = [
  { id: toDependencyId('d1'), from: id('a'), to: id('b'), type: 'FS' },
  { id: toDependencyId('d2'), from: id('b'), to: id('c'), type: 'FS' },
];

let container: HTMLElement;
beforeEach(() => {
  // Far outside the derived range: no today rule, so a re-render at a later instant cannot differ.
  vi.setSystemTime(new Date('2035-01-01T00:00:00Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const input = (sel: TaskId[] = [], focus?: TaskId, rev: number | null = 1, extra: Partial<SvgRendererInput> = {}): SvgRendererInput => ({
  tasks,
  dependencies: deps,
  criticalPath: computeCriticalPath(tasks, deps, DEFAULT_CALENDAR),
  rollup: computeRollup(tasks, DEFAULT_CALENDAR),
  selectedTaskIds: sel,
  ...(focus !== undefined ? { focusedTaskId: focus } : {}),
  ...(rev !== null ? { rev } : {}),
  ...extra,
});

const defsOf = (h: SvgRendererHandle): Element | null => h.svg.querySelector('defs');
const rowEls = (h: SvgRendererHandle): Element[] => [...h.svg.querySelectorAll('.fg-timeline__row')];
const layerOf = (h: SvgRendererHandle): HTMLElement => h.pointerEventTarget;
const tabStops = (h: SvgRendererHandle): number => h.svg.querySelectorAll('[role=row][tabindex="0"]').length;

/** Asserts the patched layer equals what a forced full render produces (and returns it). */
function expectEqualsFull(h: SvgRendererHandle): void {
  const patched = layerOf(h).outerHTML;
  h.setOptions({});
  expect(layerOf(h).outerHTML).toBe(patched);
}

describe('row patch: equality with a full render (T1, T10)', () => {
  it('select one, add, remove, clear', () => {
    const h = createSvgRenderer(container, input(), {});
    for (const sel of [[id('c')], [id('c'), id('a')], [id('a')], []]) {
      const defs = defsOf(h);
      const before = rowEls(h);
      h.update(input(sel));
      expect(defsOf(h)).toBe(defs); // no full render
      const after = rowEls(h);
      const replaced = after.filter((e, i) => e !== before[i]).length;
      expect(replaced).toBeLessThanOrEqual(3);
      expectEqualsFull(h);
      // a full render replaced the nodes; re-pin the identity for the next step
      const d2 = defsOf(h);
      h.update(input(sel)); // no-op
      expect(defsOf(h)).toBe(d2);
    }
  });

  it('only the rows whose selection changed are replaced; the rest are the same nodes', () => {
    const h = createSvgRenderer(container, input([id('a')]), {});
    const before = rowEls(h);
    h.update(input([id('a'), id('c')]));
    const after = rowEls(h);
    const changed = after.map((e, i) => e !== before[i]);
    expect(changed).toEqual(before.map((e) => e.getAttribute('data-task-id') === 'c'));
    expect(after.find((e) => e.getAttribute('data-task-id') === 'c')!.getAttribute('aria-selected')).toBe('true');
    expect(after.find((e) => e.getAttribute('data-task-id') === 'c')!.querySelector('.fg-task--selected')).not.toBeNull();
    expect(after.find((e) => e.getAttribute('data-task-id') === 'c')!.querySelector('.fg-task')!.getAttribute('aria-label')).toMatch(/selected/);
  });

  it('critical, rolled-up, milestone, coloured and hierarchical rows are rebuilt identically', () => {
    const h = createSvgRenderer(container, input(), {});
    h.update(input(tasks.map((t) => t.id)));
    expectEqualsFull(h);
    h.update(input([], id('m')));
    expectEqualsFull(h);
    expect(h.svg.getAttribute('role')).toBe('treegrid');
    expect(rowEls(h)[0]!.getAttribute('aria-expanded')).toBe('true');
  });

  it('a selected id hidden under a collapsed ancestor is skipped silently', () => {
    const collapsed = new Set([id('p')]);
    const h = createSvgRenderer(container, input([], undefined, 1, { collapsedIds: collapsed }), {});
    const before = rowEls(h);
    expect(() => h.update(input([id('a')], undefined, 1, { collapsedIds: collapsed }))).not.toThrow();
    const after = rowEls(h);
    expect(after).toHaveLength(before.length);
    before.forEach((n, i) => expect(after[i]).toBe(n)); // identity, not structural equality
    expect(h.svg.querySelectorAll('[aria-selected="true"]')).toHaveLength(0);
  });
});

describe('row patch: focus (T2, T8)', () => {
  it('a focus-only change replaces exactly two rows and keeps one tab stop', () => {
    const h = createSvgRenderer(container, input([], id('a')), {});
    expect(tabStops(h)).toBe(1);
    const before = rowEls(h);
    h.update(input([], id('c')));
    const replaced = rowEls(h).filter((e, i) => e !== before[i]).map((e) => e.getAttribute('data-task-id'));
    expect(replaced.sort()).toEqual(['a', 'c']);
    expect(tabStops(h)).toBe(1);
    expect(h.svg.querySelector('[role=row][tabindex="0"]')!.getAttribute('data-task-id')).toBe('c');
    expectEqualsFull(h);
  });

  it('DOM focus inside the chart moves with the focus row; focus outside is not stolen', () => {
    const h = createSvgRenderer(container, input([], id('a')), {});
    (rowEls(h)[1] as unknown as SVGElement).focus();
    expect(document.activeElement?.getAttribute('data-task-id')).toBe('a');
    h.update(input([], id('c')));
    expect(document.activeElement?.getAttribute('data-task-id')).toBe('c');

    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    h.update(input([], id('b')));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('a stale focus id leaves zero tab stops and does not throw', () => {
    const h = createSvgRenderer(container, input(), {});
    expect(() => h.update(input([], id('gone')))).not.toThrow();
    expect(tabStops(h)).toBe(0);
    h.update(input([], id('b')));
    expect(tabStops(h)).toBe(1);
  });
});

describe('row patch: no-op and fallbacks (T3, T4)', () => {
  it('same rev, selection, focus and option values mutate nothing', () => {
    const h = createSvgRenderer(container, input([id('a')], id('b')), { viewMode: 'week' });
    const obs = new MutationObserver(() => {});
    obs.observe(layerOf(h), { subtree: true, childList: true, attributes: true, characterData: true });
    h.update(input([id('a')], id('b')), { viewMode: 'week' });
    expect(obs.takeRecords()).toHaveLength(0);
    obs.disconnect();
  });

  const fullCases: Array<[string, (h: SvgRendererHandle) => void]> = [
    ['rev undefined', (h) => h.update(input([id('a')], undefined, null))],
    ['rev differs', (h) => h.update(input([id('a')], undefined, 2))],
    ['viewMode differs', (h) => h.update(input(), { viewMode: 'month' })],
    ['density differs', (h) => h.update(input(), { density: 'compact' })],
    ['locale differs', (h) => h.update(input(), { locale: 'de' })],
    ['labelColumnWidth differs', (h) => h.update(input(), { labelColumnWidth: 100 })],
    ['messages differs', (h) => h.update(input(), { messages: { taskLabel: () => 'x' } })],
    ['timeRange differs', (h) => h.update(input(), { timeRange: { start: '2026-01-01T00:00', end: '2026-02-01T00:00' } })],
    ['setOptions', (h) => h.setOptions({})],
  ];
  it.each(fullCases)('falls back to a full render on: %s', (_n, run) => {
    const h = createSvgRenderer(container, input(), {});
    const defs = defsOf(h);
    run(h);
    expect(defsOf(h)).not.toBe(defs);
  });

  it('the first update after a render that threw is a full render', () => {
    // A task whose `name` getter throws fails the render halfway through the rows.
    const bad = { ...tasks[1]!, get name(): string { throw new Error('boom'); } } as Task;
    const h = createSvgRenderer(container, input(), {});
    expect(() => h.update({ tasks: [bad], dependencies: [], rev: 1 }, { viewMode: 'month' })).toThrow('boom');
    const defs = defsOf(h);
    // Same rev and option values as the failed update: only the cleared patch forces a full render.
    h.update(input(), {});
    expect(defsOf(h)).not.toBe(defs);
    expect(rowEls(h)).toHaveLength(tasks.length);
  });

  it('a patch after destroy is a no-op', () => {
    const h = createSvgRenderer(container, input(), {});
    h.destroy();
    expect(() => h.update(input([id('a')]))).not.toThrow();
  });
});

describe('row patch: pinned layers (T5)', () => {
  it('column and overlay children are the same nodes after a patch, and a clone still resolves its row', () => {
    const h = createSvgRenderer(container, input(), {});
    const layer = layerOf(h);
    const pinned = (): Element[] => [...layer.querySelectorAll('[class^="fg-timeline__sticky-"] *')];
    const before = pinned();
    h.update(input([id('c')], id('b')));
    const after = pinned();
    expect(after).toHaveLength(before.length);
    before.forEach((n, i) => expect(after[i]).toBe(n)); // the same nodes, not equal copies
    const clone = layer.querySelector('.fg-timeline__sticky-column .fg-timeline__row-label[data-task-id="c"]') as SVGElement;
    expect(clone.dataset.taskId).toBe('c');
    expect(clone.dataset.rowIndex).toBe('3');
  });

  it('a paint hook gets the pinned roots after a full render and only svg + rebuilt rows after a patch', () => {
    const hook = vi.fn();
    const h = createSvgRenderer(container, input());
    h.paintHooks.push(hook);
    h.setOptions({});
    expect(Object.keys(hook.mock.calls[0]![0]).sort()).toEqual(['column', 'corner', 'overlay', 'svg']);
    hook.mockClear();
    h.update(input([id('a')]));
    expect(hook).toHaveBeenCalledTimes(1);
    const e = hook.mock.calls[0]![0];
    expect(Object.keys(e).sort()).toEqual(['rows', 'svg']);
    expect(e.svg).toBe(h.svg);
  });
});

describe('row patch through the render mixin (T9, T11, T12)', () => {
  const countFull = (): { n: number } => {
    const c = { n: 0 };
    const real = Element.prototype.append;
    vi.spyOn(Element.prototype, 'append').mockImplementation(function (this: Element, ...nodes: Array<Node | string>) {
      if (this.classList.contains('fg-timeline') && (nodes[0] as Element | undefined)?.nodeName === 'defs') c.n++;
      real.apply(this, nodes);
    });
    return c;
  };

  it('select, deselect and a second select cause no full render; zoom and updateTask cause one each', () => {
    const g = createGantt({ tasks: tasks.map(({ createdAt: _c, updatedAt: _u, ...t }) => t) });
    g.mount(container);
    const c = countFull();
    g.select(id('c'));
    g.select([id('a'), id('c')]);
    g.deselect();
    expect(c.n).toBe(0);
    g.zoomTo('month');
    expect(c.n).toBe(1);
    g.updateTask(id('c'), { name: 'renamed' });
    expect(c.n).toBe(2);
    expect(container.innerHTML).toContain('renamed');
  });

  it('refresh() after an in-place mutation of a task repaints', () => {
    const g = createGantt({ tasks: tasks.map(({ createdAt: _c, updatedAt: _u, ...t }) => t) });
    g.mount(container);
    const live = g.getTasks().find((t) => t.id === id('c'))! as { name: string };
    live.name = 'mutated in place';
    g.refresh();
    expect(container.innerHTML).toContain('mutated in place');
  });

  it('mounting then selecting: critical-path:computed fires once, before renderer:selected', () => {
    const g = createGantt({ tasks: tasks.map(({ createdAt: _c, updatedAt: _u, ...t }) => t), });
    const order: string[] = [];
    g.on('critical-path:computed', () => order.push('cp'));
    g.on('renderer:selected', () => order.push('sel'));
    g.mount(container);
    g.select(id('b'));
    expect(order).toEqual(['cp', 'sel']);
  });
});

describe('row patch with RTL (T6)', () => {
  const rtlTasks = tasks.map(({ createdAt: _c, updatedAt: _u, ...t }) => t);
  it('after patches the DOM equals a refresh, replaced labels are mirrored, and the export matches', () => {
    const g = withIo(withRtl(withRender(createBase({ tasks: rtlTasks, rtl: true }))));
    g.mount(container);
    g.select(id('c'));
    g.select([id('a'), id('c')]);
    const patched = container.innerHTML;
    const label = container.querySelector('.fg-timeline[role] [data-task-id="c"] .fg-timeline__row-label') as SVGTextElement;
    expect(label.getAttribute('transform')).toMatch(/^matrix\(-1 0 0 1 [\d.]+ 0\)$/);
    expect(label.style.getPropertyValue('unicode-bidi')).toBe('plaintext');
    const exportPatched = g.exportSvg();
    g.refresh();
    expect(container.innerHTML).toBe(patched);
    expect(g.exportSvg()).toBe(exportPatched);
  });
});
