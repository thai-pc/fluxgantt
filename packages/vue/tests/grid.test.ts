// `@fluxgantt/vue/grid` — `<FluxGanttGrid>` (spec-grid-columns.md section 15, PR G7): prop binding, structural
// column diffing (`setGridColumns`, never a remount), the dev warnings, the `column-resized` emit, the exposed
// methods and the lifecycle.
import { describe, it, expect, expectTypeOf, vi, afterEach, beforeEach } from 'vitest';
import { nextTick, reactive, ref, h, defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { toTaskId } from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import type * as GridModule from '@fluxgantt/core/grid';
import { FluxGanttGrid } from '../src/grid.js';
import type { FluxGanttGridRef, FluxGanttGridEmits, GridColumnInput } from '../src/grid.js';
import type { FluxGanttEmits } from '../src/types.js';
import { diffColumns } from '../src/grid-shared.js';
import { FluxGantt } from '../src/FluxGantt.js';

function taskInput(id: string, extra: Partial<TaskInput> = {}): TaskInput {
  return {
    id: toTaskId(id),
    name: id,
    start: '2026-01-05T09:00',
    end: '2026-01-06T09:00',
    progress: 0,
    type: 'task',
    ...extra,
  };
}
const TASKS = [taskInput('a'), taskInput('b', { meta: { owner: 'Ann' } })];
const ownerOf = (t: Readonly<TaskInput>): string =>
  String((t as { meta?: { owner?: string } }).meta?.owner ?? '');
const OWNER_VALUE = ownerOf as never;
const OWNER: GridColumnInput = { id: 'owner', header: 'Owner', value: OWNER_VALUE };

// The exposed methods are pre-bound COPIES, so a spy on them never sees the composable's own calls: capture
// the real instance `withGrid` returns instead.
const composed = vi.hoisted(() => ({
  last: undefined as undefined | { setGridColumns: (c: never) => void },
}));
vi.mock('@fluxgantt/core/grid', async (importOriginal) => {
  const actual = await importOriginal<typeof GridModule>();
  return {
    ...actual,
    withGrid: ((...args: Parameters<typeof actual.withGrid>) => {
      const g = actual.withGrid(...args);
      composed.last = g;
      return g;
    }) as typeof actual.withGrid,
  };
});

const headers = (root: Element): string[] =>
  Array.from(root.querySelectorAll('[role="columnheader"]'))
    .map((e) => e.textContent ?? '')
    .filter((v, i, all) => all.indexOf(v) === i);
const vm = (w: { vm: unknown }): FluxGanttGridRef => w.vm as unknown as FluxGanttGridRef;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function mountGrid(props: Record<string, unknown> = {}) {
  return mount(FluxGanttGrid, { props: { tasks: TASKS, ...props }, attachTo: document.body });
}

describe('<FluxGanttGrid>', () => {
  it('renders the default grid columns', () => {
    const w = mountGrid();
    expect(w.element.querySelector('.fg-timeline')).not.toBeNull();
    expect(headers(w.element)).toEqual(['Name', 'Start', 'End', 'Duration', 'Progress']);
    w.unmount();
  });

  it('binds gridColumns and gridOptions at construction', () => {
    const w = mountGrid({
      gridColumns: [{ id: 'name', header: 'Task' }, OWNER, { id: 'duration' }],
      gridOptions: { durationUnit: 'hours', resizable: false },
    });
    expect(headers(w.element)).toEqual(['Task', 'Owner', 'Duration']);
    expect(
      vm(w)
        .getGridColumns()
        .map((c) => c.id),
    ).toEqual(['name', 'owner', 'duration']);
    expect(vm(w).resizeGridColumn('owner', 200)).toBe(false); // resizable: false
    expect(vm(w).exportGridCsv()).toContain('Task,Owner,Duration');
    w.unmount();
  });

  it('keeps the default props, class fallthrough and task emits working', () => {
    const w = mount(FluxGanttGrid, {
      props: { tasks: TASKS },
      attrs: { class: 'mine' },
      attachTo: document.body,
    });
    expect(w.element.className).toBe('fg-gantt mine');
    vm(w).addTask(taskInput('c'));
    expect(w.emitted('task-added')).toHaveLength(1);
    w.unmount();
  });

  it('applies a changed gridColumns with setGridColumns, without a remount', async () => {
    const w = mountGrid({ gridColumns: [{ id: 'name' }] });
    const root = w.element;
    const timeline = w.element.querySelector('.fg-timeline');
    const set = vi.spyOn(composed.last!, 'setGridColumns');
    const before = w.vm.$.uid;

    await w.setProps({ gridColumns: [{ id: 'name' }, OWNER] });

    expect(set).toHaveBeenCalledTimes(1);
    expect(headers(w.element)).toEqual(['Name', 'Owner']);
    expect(w.element).toBe(root);
    expect(w.element.querySelector('.fg-timeline')).toBe(timeline);
    expect(w.vm.$.uid).toBe(before);
    w.unmount();
  });

  it('does not call setGridColumns for a structurally equal gridColumns', async () => {
    const make = (): GridColumnInput[] => [
      { id: 'name', width: 200 },
      { id: 'owner', header: 'Owner', value: OWNER_VALUE },
    ];
    const w = mountGrid({ gridColumns: make() });
    const set = vi.spyOn(composed.last!, 'setGridColumns');
    await w.setProps({ gridColumns: make() });
    await w.setProps({ gridColumns: make() });
    expect(set).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    w.unmount();
  });

  it('a user resize survives structurally equal columns, and a new width applies', async () => {
    const cols = (width: number): GridColumnInput[] => [{ id: 'name' }, { id: 'start', width }];
    const w = mountGrid({ gridColumns: cols(100) });
    expect(vm(w).resizeGridColumn('start', 180)).toBe(true);
    await w.setProps({ gridColumns: cols(100) });
    expect(
      vm(w)
        .getGridColumns()
        .find((c) => c.id === 'start')!.width,
    ).toBe(180);
    await w.setProps({ gridColumns: cols(140) });
    expect(
      vm(w)
        .getGridColumns()
        .find((c) => c.id === 'start')!.width,
    ).toBe(140);
    w.unmount();
  });

  it('reacts to an in-place mutation of a reactive columns array', async () => {
    const columns = reactive<GridColumnInput[]>([{ id: 'name' }]);
    const Host = defineComponent({
      setup: () => () => h(FluxGanttGrid, { tasks: TASKS, gridColumns: columns }),
    });
    const w = mount(Host, { attachTo: document.body });
    expect(headers(w.element)).toEqual(['Name']);
    columns.push(OWNER);
    await nextTick();
    await nextTick();
    expect(headers(w.element)).toEqual(['Name', 'Owner']);
    // Mutating a width in place is a structural change too.
    columns[0] = { id: 'name', width: 222 };
    await nextTick();
    await nextTick();
    expect(w.findComponent(FluxGanttGrid).vm).toBeTruthy();
    expect(vm(w.findComponent(FluxGanttGrid)).getGridColumns()[0]!.width).toBe(222);
    w.unmount();
  });

  it('reacts to a ref holding the columns', async () => {
    const columns = ref<GridColumnInput[]>([{ id: 'name' }]);
    const Host = defineComponent({
      setup: () => () => h(FluxGanttGrid, { tasks: TASKS, gridColumns: columns.value }),
    });
    const w = mount(Host, { attachTo: document.body });
    columns.value = [{ id: 'name' }, OWNER];
    await nextTick();
    await nextTick();
    expect(headers(w.element)).toEqual(['Name', 'Owner']);
    w.unmount();
  });

  it('removing gridColumns restores the default columns', async () => {
    const w = mountGrid({ gridColumns: [{ id: 'name' }] });
    await w.setProps({ gridColumns: undefined } as never);
    expect(
      vm(w)
        .getGridColumns()
        .map((c) => c.id),
    ).toEqual(['name', 'start', 'end', 'duration', 'progress']);
    w.unmount();
  });

  it('warns ONCE when a column function changes identity on every update, and still applies the columns', async () => {
    const inline = (): GridColumnInput[] => [
      { id: 'name' },
      { id: 'owner', header: 'Owner', value: (t) => ownerOf(t as never) },
    ];
    const w = mountGrid({ gridColumns: inline() });
    const set = vi.spyOn(composed.last!, 'setGridColumns');
    await w.setProps({ gridColumns: inline() });
    await w.setProps({ gridColumns: inline() });
    await w.setProps({ gridColumns: inline() });
    expect(set).toHaveBeenCalledTimes(3);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.filter((m) => m.includes('changed identity'))).toHaveLength(1);
    w.unmount();
  });

  it('warns once when gridOptions change after construction, and ignores the change', async () => {
    const w = mountGrid({ gridOptions: { resizable: true } });
    await w.setProps({ gridOptions: { resizable: true } });
    expect(warn).not.toHaveBeenCalled();
    await w.setProps({ gridOptions: { resizable: false } });
    await w.setProps({ gridOptions: { resizable: true } });
    await w.setProps({ gridOptions: { resizable: false } });
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('gridOptions'))).toHaveLength(1);
    expect(vm(w).resizeGridColumn('start', 133)).toBe(true); // still resizable
    w.unmount();
  });

  it('emits column-resized and follows a changed @column-resized handler', async () => {
    const first = vi.fn();
    const second = vi.fn();
    // Vue's emit looks the handler up by its camelized `on` + event name, so the kebab-case event name
    // appears as `onColumn-resized` here (the same quirk as `onTask-updated`).
    const w = mountGrid({ 'onColumn-resized': first });
    await w.setProps({ 'onColumn-resized': second });
    vm(w).resizeGridColumn('start', 133);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    const payload = second.mock.calls[0]![0] as {
      columnId: string;
      width: number;
      widths: Record<string, number>;
    };
    expect(payload.columnId).toBe('start');
    expect(payload.width).toBe(133);
    expect(Object.keys(payload.widths)).toEqual(['name', 'start', 'end', 'duration', 'progress']);
    expect(w.emitted('column-resized')).toHaveLength(1);
    w.unmount();
  });

  it('exposes the grid capability methods, pre-bound', () => {
    const w = mountGrid();
    const g = vm(w);
    for (const m of [
      'getGridColumns',
      'setGridColumns',
      'resizeGridColumn',
      'exportGridCsv',
    ] as const) {
      expect(typeof g[m]).toBe('function');
    }
    g.setGridColumns([{ id: 'name' }, OWNER]);
    expect(headers(w.element)).toEqual(['Name', 'Owner']);
    expect(g.exportGridCsv().split('\r\n')[0]).toBe('Name,Owner');
    w.unmount();
  });

  it('throws with context for an invalid initial column, and RangeError for an invalid later one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      mountGrid({ gridColumns: [{ id: 'bad id!', header: 'x', value: () => 1 }] }),
    ).toThrow(/invalid initial config/);
    const w = mountGrid();
    const instance = vm(w);
    const errors: unknown[] = [];
    w.vm.$.appContext.config.errorHandler = (e) => errors.push(e);
    await w.setProps({ gridColumns: [{ id: 'bad id!', header: 'x', value: () => 1 }] });
    expect(errors[0]).toBeInstanceOf(RangeError);
    expect(instance.getGridColumns()).toHaveLength(5); // nothing changed
    w.unmount();
  });

  it('survives a destroyed instance on a later gridColumns change', async () => {
    const w = mountGrid();
    vm(w).destroy();
    const errors: unknown[] = [];
    w.vm.$.appContext.config.errorHandler = (e) => errors.push(e);
    await w.setProps({ gridColumns: [{ id: 'name' }] });
    expect(errors).toEqual([]);
    w.unmount();
  });

  it('composes with rtl and a theme', () => {
    const w = mountGrid({ rtl: true, theme: 'dark' });
    expect(headers(w.element)).toEqual(['Name', 'Start', 'End', 'Duration', 'Progress']);
    w.unmount();
  });

  it('cleans up on unmount: the chart is removed and the emit listeners are gone', () => {
    const onColumnResized = vi.fn();
    const w = mountGrid({ 'onColumn-resized': onColumnResized });
    const instance = vm(w);
    const el = w.element;
    w.unmount();
    expect(el.querySelector('.fg-timeline')).toBeNull();
    instance.resizeGridColumn('start', 150);
    expect(onColumnResized).not.toHaveBeenCalled();
  });

  it('declares the default props and emits plus its own (drift guard)', () => {
    const base = FluxGantt as unknown as {
      props: Record<string, unknown>;
      emits: Record<string, unknown>;
    };
    const grid = FluxGanttGrid as unknown as {
      props: Record<string, unknown>;
      emits: Record<string, unknown>;
    };
    expect(Object.keys(grid.props).sort()).toEqual(
      [...Object.keys(base.props), 'gridColumns', 'gridOptions'].sort(),
    );
    expect(Object.keys(grid.emits).sort()).toEqual(
      [...Object.keys(base.emits), 'column-resized'].sort(),
    );
  });
});

describe('diffColumns', () => {
  const f = (): string => 'x';
  const c = (extra: object = {}): GridColumnInput =>
    ({ id: 'owner', header: 'Owner', value: f, ...extra }) as GridColumnInput;
  it('classifies same, changed and function-only differences', () => {
    expect(diffColumns(undefined, undefined)).toBe('same');
    expect(diffColumns([c()], [c()])).toBe('same');
    expect(diffColumns([c()], [c(), c()])).toBe('changed');
    for (const extra of [
      { header: 'O' },
      { width: 90 },
      { minWidth: 60 },
      { maxWidth: 400 },
      { align: 'end' },
      { id: 'o2' },
    ]) {
      expect(diffColumns([c()], [c(extra)])).toBe('changed');
    }
    expect(diffColumns([c()], [c({ value: () => 'x' })])).toBe('functions');
    expect(diffColumns([c()], [c({ format: () => 'x' })])).toBe('functions');
    expect(diffColumns([c()], [c({ value: () => 'x', width: 70 })])).toBe('changed');
  });
  it('compares editors by their data and function identity', () => {
    const commit = (): { name: string } => ({ name: 'x' });
    const e = (extra: object = {}): GridColumnInput =>
      c({ editor: { type: 'text', commit, ...extra } });
    expect(diffColumns([e()], [e()])).toBe('same');
    expect(diffColumns([e()], [e({ maxLength: 5 })])).toBe('changed');
    expect(diffColumns([e()], [e({ commit: () => ({ name: 'y' }) })])).toBe('functions');
    expect(diffColumns([c()], [e()])).toBe('changed');
    expect(diffColumns([c({ editor: false })], [c({ editor: false })])).toBe('same');
  });
});

describe('re-applying gridColumns never loses user state (M1)', () => {
  const cols = (): GridColumnInput[] => [
    { id: 'name' },
    { id: 'start' },
    { id: 'owner', header: 'Owner', value: (t) => ownerOf(t as never) },
  ];
  const widthOf = (w: { vm: unknown }, id: string): number =>
    vm(w)
      .getGridColumns()
      .find((c) => c.id === id)!.width;

  it('resize, then an unrelated update with a new inline value identity: the width is kept', async () => {
    const w = mountGrid({ gridColumns: cols() });
    vm(w).resizeGridColumn('start', 180);
    const set = vi.spyOn(composed.last!, 'setGridColumns');
    await w.setProps({ gridColumns: cols() });
    expect(set).toHaveBeenCalledTimes(1);
    expect(widthOf(w, 'start')).toBe(180);
    w.unmount();
  });

  it('resize, then a header change: the resized width is kept, a changed prop width wins', async () => {
    const base = (header: string, width?: number): GridColumnInput[] => [
      { id: 'name' },
      { id: 'start', header },
      { id: 'end', ...(width ? { width } : {}) },
    ];
    const w = mountGrid({ gridColumns: base('Begin') });
    vm(w).resizeGridColumn('start', 170);
    vm(w).resizeGridColumn('end', 150);
    await w.setProps({ gridColumns: base('From') });
    expect(headers(w.element)).toContain('From');
    expect(widthOf(w, 'start')).toBe(170);
    expect(widthOf(w, 'end')).toBe(150);
    await w.setProps({ gridColumns: base('From', 99) });
    expect(widthOf(w, 'end')).toBe(99);
    expect(widthOf(w, 'start')).toBe(170);
    w.unmount();
  });

  it('re-passing the original columns does not reset a user resize (documented); setGridColumns does', async () => {
    const make = (): GridColumnInput[] => [{ id: 'name' }, { id: 'start', width: 100 }];
    const w = mountGrid({ gridColumns: make() });
    vm(w).resizeGridColumn('start', 180);
    await w.setProps({ gridColumns: make() });
    expect(widthOf(w, 'start')).toBe(180);
    vm(w).setGridColumns(make());
    expect(widthOf(w, 'start')).toBe(100);
    w.unmount();
  });

  it('the dev warning states the consequence', async () => {
    const w = mountGrid({ gridColumns: cols() });
    await w.setProps({ gridColumns: cols() });
    const msg = String(warn.mock.calls.find((c) => String(c[0]).includes('changed identity'))?.[0]);
    expect(msg).toContain('repaints the grid each time');
    expect(msg).toContain('editor is held back');
    w.unmount();
  });

  it('rethrows an error that is not a destroyed instance', async () => {
    const w = mountGrid({ gridColumns: cols() });
    vi.spyOn(composed.last!, 'setGridColumns').mockImplementation(() => {
      throw new TypeError('boom');
    });
    const errors: unknown[] = [];
    w.vm.$.appContext.config.errorHandler = (e) => errors.push(e);
    await w.setProps({ gridColumns: cols() });
    expect(errors[0]).toBeInstanceOf(TypeError);
    w.unmount();
  });

  it('names the right component in the invalid-initial-config error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      mountGrid({ gridColumns: [{ id: 'bad id!', header: 'x', value: () => 1 }] }),
    ).toThrow(/useFluxGanttGrid\/<FluxGanttGrid>/);
  });
});

describe('RTL', () => {
  it('mirrors the grid (composition order: the grid is composed inside withRtl)', () => {
    const w = mountGrid({ rtl: true });
    expect(w.element.querySelector('.fg-rtl')).not.toBeNull();
    const texts = Array.from((w.element as Element).querySelectorAll('.fg-grid__cells text'));
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t.getAttribute('transform') ?? '').toMatch(/^matrix\(-1 0 0 1 /);
    w.unmount();
    const ltr = mountGrid();
    expect(ltr.element.querySelector('.fg-rtl')).toBeNull();
    ltr.unmount();
  });
});

describe('emits types (type-level)', () => {
  it('FluxGanttGridEmits extends FluxGanttEmits and matches the component', () => {
    const emit = (() => {}) as unknown as InstanceType<typeof FluxGanttGrid>['$emit'];
    const typed: FluxGanttGridEmits = emit;
    expectTypeOf<FluxGanttGridEmits>().toExtend<FluxGanttEmits>();
    // @ts-expect-error a wrong payload for column-resized is a compile error
    const bad = () => typed('column-resized', 42);
    // @ts-expect-error an unknown event is a compile error
    const unknown = () => typed('column-resizedd', {});
    expect([bad, unknown]).toHaveLength(2);
  });
});
