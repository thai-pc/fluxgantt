// `@fluxgantt/react/grid-editing` — `<FluxGanttGridEditing>` (PR G7): composition order, the `cell:edit-requested`
// bridge with veto, the editing ref methods, `gridEditing` option forwarding, cleanup.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { StrictMode, createRef } from 'react';
import { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { toTaskId } from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import { FluxGanttGridEditing, useFluxGanttGridEditing } from '../src/grid-editing.js';
import type { GridColumnInput } from '../src/grid-editing.js';
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

describe('an open editor survives re-applies of gridColumns (M1)', () => {
  const inline = (): GridColumnInput[] => [
    { id: 'name' },
    { id: 'owner', header: 'Owner', value: () => 'x' },
  ];

  it('holds a parent re-render back while typing, then applies once when the edit ends', async () => {
    const ref = createRef<FluxGanttGridEditingRef>();
    const { container, rerender } = render(
      <FluxGanttGridEditing ref={ref} tasks={TASKS} gridColumns={inline()} />,
    );
    const set = vi.spyOn(ref.current!, 'setGridColumns');
    ref.current!.startCellEdit(a, 'name');
    await waitFor(() => expect(ref.current!.isEditingCell()).toBe(true));
    const input = container.querySelector('input')!;
    act(() => {
      input.value = 'half typed';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    rerender(<FluxGanttGridEditing ref={ref} tasks={TASKS} gridColumns={inline()} />);
    rerender(<FluxGanttGridEditing ref={ref} tasks={TASKS} gridColumns={inline()} />);
    expect(ref.current!.isEditingCell()).toBe(true);
    expect(container.querySelector('input')).toBe(input);
    expect(input.value).toBe('half typed');
    expect(set).not.toHaveBeenCalled();
    act(() => ref.current!.cancelCellEdit());
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 120));
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('a setState in onCellEditRequested (no preventDefault) does not close the editor it just opened', async () => {
    const ref = createRef<FluxGanttGridEditingRef>();
    function Host() {
      const [n, setN] = useState(0);
      return (
        <FluxGanttGridEditing
          ref={ref}
          tasks={TASKS}
          gridColumns={inline()}
          onCellEditRequested={() => setN(n + 1)}
        />
      );
    }
    const { container } = render(<Host />);
    await act(async () => {
      ref.current!.startCellEdit(a, 'name');
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(ref.current!.isEditingCell()).toBe(true);
    expect(editorOpen(container)).toBe(true);
  });

  it('warns once when activate or commitOnBlur change after mount, or a callback is added late', () => {
    const ref = createRef<FluxGanttGridEditingRef>();
    const { rerender } = render(
      <FluxGanttGridEditing ref={ref} tasks={TASKS} gridEditing={{ activate: ['enter'] }} />,
    );
    rerender(
      <FluxGanttGridEditing ref={ref} tasks={TASKS} gridEditing={{ activate: ['enter'] }} />,
    );
    expect(console.warn).not.toHaveBeenCalled();
    rerender(<FluxGanttGridEditing ref={ref} tasks={TASKS} gridEditing={{ activate: ['f2'] }} />);
    rerender(
      <FluxGanttGridEditing ref={ref} tasks={TASKS} gridEditing={{ commitOnBlur: false }} />,
    );
    const calls = vi
      .mocked(console.warn)
      .mock.calls.filter((c) => String(c[0]).includes('gridEditing'));
    expect(calls).toHaveLength(1);

    const late = createRef<FluxGanttGridEditingRef>();
    vi.mocked(console.warn).mockClear();
    const r2 = render(<FluxGanttGridEditing ref={late} tasks={TASKS} />);
    r2.rerender(
      <FluxGanttGridEditing
        ref={late}
        tasks={TASKS}
        gridEditing={{ beforeCommit: () => undefined }}
      />,
    );
    expect(
      vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('gridEditing')),
    ).toHaveLength(1);
  });

  it('names the editing component in the invalid-initial-config error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <FluxGanttGridEditing
          tasks={TASKS}
          gridColumns={[{ id: 'bad id!', header: 'x', value: () => 1 }]}
        />,
      ),
    ).toThrow(/useFluxGanttGridEditing\/<FluxGanttGridEditing>/);
  });
});
