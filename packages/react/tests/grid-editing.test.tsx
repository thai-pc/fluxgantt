// `@fluxgantt/react/grid-editing` — `<FluxGanttGridEditing>` (PR G7): composition order, the `cell:edit-requested`
// bridge with veto, the editing ref methods, `gridEditing` option forwarding, cleanup.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { StrictMode, createRef } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { toTaskId } from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import { FluxGanttGridEditing, useFluxGanttGridEditing } from '../src/grid-editing.js';
import type { FluxGanttGridEditingRef, CellEditRequestedPayload } from '../src/grid-editing.js';

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
const editorOpen = (root: ParentNode): boolean => root.querySelector('input, textarea') !== null;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('<FluxGanttGridEditing>', () => {
  it('composes the grid and the editing capability on the ref', () => {
    const ref = createRef<FluxGanttGridEditingRef>();
    const { container } = render(<FluxGanttGridEditing ref={ref} tasks={TASKS} />);
    const g = ref.current!;
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
    expect(container.querySelectorAll('[role="columnheader"]').length).toBeGreaterThan(0);
    expect(g.isEditingCell()).toBe(false);
  });

  it('opens the built-in editor on startCellEdit and closes it on cancelCellEdit', async () => {
    const ref = createRef<FluxGanttGridEditingRef>();
    const { container } = render(<FluxGanttGridEditing ref={ref} tasks={TASKS} />);
    expect(ref.current!.startCellEdit(a, 'name')).toBe(true);
    await waitFor(() => expect(ref.current!.isEditingCell()).toBe(true));
    expect(editorOpen(container)).toBe(true);
    act(() => ref.current!.cancelCellEdit());
    expect(ref.current!.isEditingCell()).toBe(false);
    expect(editorOpen(container)).toBe(false);
  });

  it('returns false for an uneditable cell and in a readOnly chart', () => {
    const ref = createRef<FluxGanttGridEditingRef>();
    const onCellEditRequested = vi.fn();
    render(
      <FluxGanttGridEditing
        ref={ref}
        tasks={TASKS}
        gridEditing={{ isEditable: (_t, columnId) => columnId !== 'name' }}
        onCellEditRequested={onCellEditRequested}
      />,
    );
    expect(ref.current!.startCellEdit(a, 'name')).toBe(false);
    expect(ref.current!.startCellEdit(toTaskId('nope'), 'start')).toBe(false);
    expect(onCellEditRequested).not.toHaveBeenCalled();
    const ro = createRef<FluxGanttGridEditingRef>();
    render(<FluxGanttGridEditing ref={ro} tasks={TASKS} readOnly />);
    expect(ro.current!.startCellEdit(a, 'name')).toBe(false);
  });

  it('bridges cell:edit-requested, and preventDefault replaces the built-in editor', async () => {
    const ref = createRef<FluxGanttGridEditingRef>();
    const seen: CellEditRequestedPayload[] = [];
    const { container } = render(
      <FluxGanttGridEditing
        ref={ref}
        tasks={TASKS}
        onCellEditRequested={(e) => {
          seen.push(e);
          e.preventDefault();
        }}
      />,
    );
    // The editor code loads on first use, so the request fires a moment after `startCellEdit` returns.
    ref.current!.startCellEdit(a, 'name');
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ taskId: a, columnId: 'name' });
    expect(ref.current!.isEditingCell()).toBe(false);
    expect(editorOpen(container)).toBe(false);
  });

  it('follows the latest onCellEditRequested', async () => {
    const ref = createRef<FluxGanttGridEditingRef>();
    const first = vi.fn((e: CellEditRequestedPayload) => e.preventDefault());
    const second = vi.fn((e: CellEditRequestedPayload) => e.preventDefault());
    const { rerender } = render(
      <FluxGanttGridEditing ref={ref} tasks={TASKS} onCellEditRequested={first} />,
    );
    rerender(<FluxGanttGridEditing ref={ref} tasks={TASKS} onCellEditRequested={second} />);
    ref.current!.startCellEdit(a, 'name');
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
  });

  it('commits through the built-in editor as an ordinary task:updated, and beforeCommit follows the latest render', async () => {
    const ref = createRef<FluxGanttGridEditingRef>();
    const onTaskUpdated = vi.fn();
    const first = vi.fn(() => 'no');
    const second = vi.fn(() => undefined);
    const { container, rerender } = render(
      <FluxGanttGridEditing
        ref={ref}
        tasks={TASKS}
        onTaskUpdated={onTaskUpdated}
        gridEditing={{ beforeCommit: first }}
      />,
    );
    rerender(
      <FluxGanttGridEditing
        ref={ref}
        tasks={TASKS}
        onTaskUpdated={onTaskUpdated}
        gridEditing={{ beforeCommit: second }}
      />,
    );
    ref.current!.startCellEdit(a, 'name');
    await waitFor(() => expect(editorOpen(container)).toBe(true));
    const input = container.querySelector('input')!;
    act(() => {
      input.value = 'Renamed';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() => expect(onTaskUpdated).toHaveBeenCalledTimes(1));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(ref.current!.getTask(a)!.name).toBe('Renamed');
  });

  it('still bridges the grid props: gridColumns, onColumnResized', () => {
    const ref = createRef<FluxGanttGridEditingRef>();
    const onColumnResized = vi.fn();
    const { rerender } = render(
      <FluxGanttGridEditing
        ref={ref}
        tasks={TASKS}
        gridColumns={[{ id: 'name' }]}
        onColumnResized={onColumnResized}
      />,
    );
    const set = vi.spyOn(ref.current!, 'setGridColumns');
    rerender(
      <FluxGanttGridEditing
        ref={ref}
        tasks={TASKS}
        gridColumns={[{ id: 'name' }, { id: 'start' }]}
        onColumnResized={onColumnResized}
      />,
    );
    expect(set).toHaveBeenCalledTimes(1);
    act(() => {
      ref.current!.resizeGridColumn('start', 133);
    });
    expect(onColumnResized).toHaveBeenCalledTimes(1);
  });

  it('cleans up on unmount and under StrictMode', async () => {
    const ref = createRef<FluxGanttGridEditingRef>();
    const onCellEditRequested = vi.fn((e: CellEditRequestedPayload) => e.preventDefault());
    const { container, unmount } = render(
      <StrictMode>
        <FluxGanttGridEditing ref={ref} tasks={TASKS} onCellEditRequested={onCellEditRequested} />
      </StrictMode>,
    );
    expect(container.querySelectorAll('.fg-timeline')).toHaveLength(1);
    const instance = ref.current!;
    instance.startCellEdit(a, 'name');
    await waitFor(() => expect(onCellEditRequested).toHaveBeenCalledTimes(1));
    unmount();
    expect(container.querySelector('.fg-timeline')).toBeNull();
    instance.startCellEdit(a, 'name');
    await new Promise((r) => setTimeout(r, 20));
    expect(onCellEditRequested).toHaveBeenCalledTimes(1);
  });

  it('exports the hook', () => {
    expect(typeof useFluxGanttGridEditing).toBe('function');
  });
});
