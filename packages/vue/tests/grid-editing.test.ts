// `@fluxgantt/vue/grid-editing` — `<FluxGanttGridEditing>` (PR G7): composition order, the `cell-edit-requested`
// emit with veto, the exposed editing methods, `gridEditing` option forwarding, cleanup.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { toTaskId } from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import { FluxGanttGridEditing } from '../src/grid-editing.js';
import type { FluxGanttGridEditingRef, CellEditRequestedPayload } from '../src/grid-editing.js';
import { FluxGanttGrid } from '../src/grid.js';

const a = toTaskId('a');
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
const TASKS = [taskInput('a'), taskInput('b')];
const vm = (w: { vm: unknown }): FluxGanttGridEditingRef =>
  w.vm as unknown as FluxGanttGridEditingRef;
const editorOpen = (root: ParentNode): boolean => root.querySelector('input, textarea') !== null;
const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
};

function mountEditing(props: Record<string, unknown> = {}) {
  return mount(FluxGanttGridEditing, {
    props: { tasks: TASKS, ...props },
    attachTo: document.body,
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('<FluxGanttGridEditing>', () => {
  it('composes the grid and the editing capability on the exposed instance', () => {
    const w = mountEditing();
    const g = vm(w);
    for (const m of [
      'getGridColumns',
      'setGridColumns',
      'resizeGridColumn',
      'exportGridCsv',
      'startCellEdit',
      'cancelCellEdit',
      'isEditingCell',
    ] as const) {
      expect(typeof g[m]).toBe('function');
    }
    expect(w.element.querySelectorAll('[role="columnheader"]').length).toBeGreaterThan(0);
    expect(g.isEditingCell()).toBe(false);
    w.unmount();
  });

  it('opens the built-in editor on startCellEdit and closes it on cancelCellEdit', async () => {
    const w = mountEditing();
    expect(vm(w).startCellEdit(a, 'name')).toBe(true);
    await until(() => vm(w).isEditingCell());
    expect(editorOpen(w.element)).toBe(true);
    vm(w).cancelCellEdit();
    expect(vm(w).isEditingCell()).toBe(false);
    expect(editorOpen(w.element)).toBe(false);
    w.unmount();
  });

  it('returns false for an uneditable cell and in a readOnly chart', () => {
    const w = mountEditing({
      gridEditing: { isEditable: (_t: unknown, columnId: string) => columnId !== 'name' },
    });
    expect(vm(w).startCellEdit(a, 'name')).toBe(false);
    expect(vm(w).startCellEdit(toTaskId('nope'), 'start')).toBe(false);
    expect(w.emitted('cell-edit-requested')).toBeUndefined();
    w.unmount();
    const ro = mountEditing({ readOnly: true });
    expect(vm(ro).startCellEdit(a, 'name')).toBe(false);
    ro.unmount();
  });

  it('emits cell-edit-requested, and preventDefault replaces the built-in editor', async () => {
    const seen: CellEditRequestedPayload[] = [];
    // Vue's emit looks the handler up by its `on` + event name (`onCell-edit-requested`, as `onTask-updated`).
    const w = mountEditing({
      'onCell-edit-requested': (e: CellEditRequestedPayload) => {
        seen.push(e);
        e.preventDefault();
      },
    });
    vm(w).startCellEdit(a, 'name');
    await until(() => seen.length === 1);
    expect(seen[0]).toMatchObject({ taskId: a, columnId: 'name' });
    expect(w.emitted('cell-edit-requested')).toHaveLength(1);
    expect(vm(w).isEditingCell()).toBe(false);
    expect(editorOpen(w.element)).toBe(false);
    w.unmount();
  });

  it('follows a changed @cell-edit-requested handler', async () => {
    const first = vi.fn((e: CellEditRequestedPayload) => e.preventDefault());
    const second = vi.fn((e: CellEditRequestedPayload) => e.preventDefault());
    const w = mountEditing({ 'onCell-edit-requested': first });
    await w.setProps({ 'onCell-edit-requested': second });
    vm(w).startCellEdit(a, 'name');
    await until(() => second.mock.calls.length === 1);
    expect(first).not.toHaveBeenCalled();
    w.unmount();
  });

  it('commits through the built-in editor as an ordinary task-updated, and beforeCommit follows the latest prop', async () => {
    const first = vi.fn(() => 'no');
    const second = vi.fn(() => undefined);
    const w = mountEditing({ gridEditing: { beforeCommit: first } });
    await w.setProps({ gridEditing: { beforeCommit: second } });
    vm(w).startCellEdit(a, 'name');
    await until(() => editorOpen(w.element));
    const input = w.element.querySelector('input')!;
    input.value = 'Renamed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await until(() => (w.emitted('task-updated')?.length ?? 0) === 1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(vm(w).getTask(a)!.name).toBe('Renamed');
    w.unmount();
  });

  it('still bridges the grid props and column-resized', async () => {
    const w = mountEditing({ gridColumns: [{ id: 'name' }] });
    await w.setProps({ gridColumns: [{ id: 'name' }, { id: 'start' }] });
    expect(
      vm(w)
        .getGridColumns()
        .map((c) => c.id),
    ).toEqual(['name', 'start']);
    vm(w).resizeGridColumn('start', 133);
    expect(w.emitted('column-resized')).toHaveLength(1);
    w.unmount();
  });

  it('declares the grid props and emits plus its own (drift guard)', () => {
    const grid = FluxGanttGrid as unknown as {
      props: Record<string, unknown>;
      emits: Record<string, unknown>;
    };
    const editing = FluxGanttGridEditing as unknown as {
      props: Record<string, unknown>;
      emits: Record<string, unknown>;
    };
    expect(Object.keys(editing.props).sort()).toEqual(
      [...Object.keys(grid.props), 'gridEditing'].sort(),
    );
    expect(Object.keys(editing.emits).sort()).toEqual(
      [...Object.keys(grid.emits), 'cell-edit-requested'].sort(),
    );
  });

  it('cleans up on unmount: the chart is removed and the listeners are gone', async () => {
    const handler = vi.fn((e: CellEditRequestedPayload) => e.preventDefault());
    const w = mountEditing({ 'onCell-edit-requested': handler });
    const instance = vm(w);
    const el = w.element;
    instance.startCellEdit(a, 'name');
    await until(() => handler.mock.calls.length === 1);
    w.unmount();
    expect(el.querySelector('.fg-timeline')).toBeNull();
    instance.startCellEdit(a, 'name');
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
