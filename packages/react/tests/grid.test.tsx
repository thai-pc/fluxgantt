// `@fluxgantt/react/grid` — `<FluxGanttGrid>` (spec-grid-columns.md section 15, PR G7): prop binding, structural
// column diffing (`setGridColumns`, never a remount), the dev warnings, the `column:resized` bridge, the ref and
// the lifecycle.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { StrictMode, createRef } from 'react';
import { render, act } from '@testing-library/react';
import { toTaskId } from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import { FluxGanttGrid, useFluxGanttGrid } from '../src/grid.js';
import type { FluxGanttGridRef, GridColumnInput } from '../src/grid.js';
import { diffColumns } from '../src/grid-shared.js';

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
const owner = (t: Readonly<TaskInput>): string =>
  String((t as { meta?: { owner?: string } }).meta?.owner ?? '');
const OWNER: GridColumnInput = { id: 'owner', header: 'Owner', value: owner as never };

const headers = (root: Element): string[] =>
  Array.from(root.querySelectorAll('.fg-grid__cells [role="columnheader"], [role="columnheader"]'))
    .map((e) => e.textContent ?? '')
    .filter((v, i, all) => all.indexOf(v) === i);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('<FluxGanttGrid>', () => {
  it('renders the default grid columns', () => {
    const { container } = render(<FluxGanttGrid tasks={TASKS} />);
    expect(container.querySelector('.fg-timeline')).not.toBeNull();
    expect(headers(container)).toEqual(['Name', 'Start', 'End', 'Duration', 'Progress']);
  });

  it('binds gridColumns and gridOptions at construction', () => {
    const ref = createRef<FluxGanttGridRef>();
    const { container } = render(
      <FluxGanttGrid
        ref={ref}
        tasks={TASKS}
        gridColumns={[{ id: 'name', header: 'Task' }, OWNER, { id: 'duration' }]}
        gridOptions={{ durationUnit: 'hours', resizable: false }}
      />,
    );
    expect(headers(container)).toEqual(['Task', 'Owner', 'Duration']);
    expect(ref.current!.getGridColumns().map((c) => c.id)).toEqual(['name', 'owner', 'duration']);
    // `resizable: false` froze the widths.
    expect(ref.current!.resizeGridColumn('owner', 200)).toBe(false);
    expect(ref.current!.exportGridCsv()).toContain('Task,Owner,Duration');
  });

  it('keeps the default (non-grid) props working: className, style and task events', () => {
    const onTaskAdded = vi.fn();
    const ref = createRef<FluxGanttGridRef>();
    const { container } = render(
      <FluxGanttGrid
        ref={ref}
        tasks={TASKS}
        className="mine"
        style={{ height: 300 }}
        onTaskAdded={onTaskAdded}
      />,
    );
    expect(container.firstElementChild?.className).toBe('fg-gantt mine');
    act(() => {
      ref.current!.addTask(taskInput('c'));
    });
    expect(onTaskAdded).toHaveBeenCalledTimes(1);
  });

  it('applies a changed gridColumns with setGridColumns, without a remount', () => {
    const ref = createRef<FluxGanttGridRef>();
    const { container, rerender } = render(
      <FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={[{ id: 'name' }]} />,
    );
    const instance = ref.current!;
    const root = container.firstElementChild;
    const timeline = container.querySelector('.fg-timeline');
    const set = vi.spyOn(instance, 'setGridColumns');
    const unmount = vi.spyOn(instance, 'unmount');

    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={[{ id: 'name' }, OWNER]} />);

    expect(set).toHaveBeenCalledTimes(1);
    expect(headers(container)).toEqual(['Name', 'Owner']);
    expect(ref.current).toBe(instance);
    expect(container.firstElementChild).toBe(root);
    expect(container.querySelector('.fg-timeline')).toBe(timeline);
    expect(unmount).not.toHaveBeenCalled();
  });

  it('does not call setGridColumns for a structurally equal gridColumns', () => {
    const ref = createRef<FluxGanttGridRef>();
    const value = owner as never;
    const make = (): GridColumnInput[] => [
      { id: 'name', width: 200 },
      { id: 'owner', header: 'Owner', value },
    ];
    const { rerender } = render(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={make()} />);
    const set = vi.spyOn(ref.current!, 'setGridColumns');
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={make()} />);
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={make()} />);
    expect(set).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a user resize survives a re-render with structurally equal columns, and a new width applies', () => {
    const ref = createRef<FluxGanttGridRef>();
    const cols = (w: number): GridColumnInput[] => [{ id: 'name' }, { id: 'start', width: w }];
    const { rerender } = render(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={cols(100)} />);
    act(() => {
      expect(ref.current!.resizeGridColumn('start', 180)).toBe(true);
    });
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={cols(100)} />);
    expect(ref.current!.getGridColumns().find((c) => c.id === 'start')!.width).toBe(180);
    // The host persisted a width and passes it back: that IS a structural change.
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={cols(140)} />);
    expect(ref.current!.getGridColumns().find((c) => c.id === 'start')!.width).toBe(140);
  });

  it('removing gridColumns restores the default columns', () => {
    const ref = createRef<FluxGanttGridRef>();
    const { rerender } = render(
      <FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={[{ id: 'name' }]} />,
    );
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} />);
    expect(ref.current!.getGridColumns().map((c) => c.id)).toEqual([
      'name',
      'start',
      'end',
      'duration',
      'progress',
    ]);
  });

  it('warns ONCE when a column function changes identity on every render, and still applies the columns', () => {
    const ref = createRef<FluxGanttGridRef>();
    const inline = (): GridColumnInput[] => [
      { id: 'name' },
      { id: 'owner', header: 'Owner', value: (t) => owner(t as never) },
    ];
    const { rerender } = render(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={inline()} />);
    const set = vi.spyOn(ref.current!, 'setGridColumns');
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={inline()} />);
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={inline()} />);
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={inline()} />);
    expect(set).toHaveBeenCalledTimes(3);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.filter((m) => m.includes('changed identity'))).toHaveLength(1);
    expect(messages[0]).toContain('useCallback');
  });

  it('warns once when gridOptions change after construction, and ignores the change', () => {
    const ref = createRef<FluxGanttGridRef>();
    const { rerender } = render(
      <FluxGanttGrid ref={ref} tasks={TASKS} gridOptions={{ resizable: true }} />,
    );
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridOptions={{ resizable: true }} />);
    expect(warn).not.toHaveBeenCalled();
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridOptions={{ resizable: false }} />);
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridOptions={{ resizable: true }} />);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('gridOptions'))).toHaveLength(1);
    expect(ref.current!.resizeGridColumn('start', 133)).toBe(true); // still resizable
  });

  it('bridges column:resized to onColumnResized and follows the latest callback', () => {
    const ref = createRef<FluxGanttGridRef>();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<FluxGanttGrid ref={ref} tasks={TASKS} onColumnResized={first} />);
    rerender(<FluxGanttGrid ref={ref} tasks={TASKS} onColumnResized={second} />);
    act(() => {
      ref.current!.resizeGridColumn('start', 133);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    const payload = second.mock.calls[0]![0] as {
      columnId: string;
      width: number;
      widths: Record<string, number>;
    };
    expect(payload.columnId).toBe('start');
    expect(payload.width).toBe(133);
    expect(payload.widths['start']).toBe(133);
    expect(Object.keys(payload.widths)).toEqual(['name', 'start', 'end', 'duration', 'progress']);
  });

  it('exposes the grid capability methods on the ref', () => {
    const ref = createRef<FluxGanttGridRef>();
    const { container } = render(<FluxGanttGrid ref={ref} tasks={TASKS} />);
    const g = ref.current!;
    for (const m of [
      'getGridColumns',
      'setGridColumns',
      'resizeGridColumn',
      'exportGridCsv',
    ] as const) {
      expect(typeof g[m]).toBe('function');
    }
    act(() => g.setGridColumns([{ id: 'name' }, OWNER]));
    expect(headers(container)).toEqual(['Name', 'Owner']);
    expect(g.exportGridCsv().split('\r\n')[0]).toBe('Name,Owner');
  });

  it('throws with context for an invalid initial column, and for an invalid later one', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <FluxGanttGrid
          tasks={TASKS}
          gridColumns={[{ id: 'bad id!', header: 'x', value: () => 1 }]}
        />,
      ),
    ).toThrow(/invalid initial config/);
    const ref = createRef<FluxGanttGridRef>();
    const { rerender } = render(<FluxGanttGrid ref={ref} tasks={TASKS} />);
    const instance = ref.current!;
    expect(() =>
      rerender(
        <FluxGanttGrid
          ref={ref}
          tasks={TASKS}
          gridColumns={[{ id: 'bad id!', header: 'x', value: () => 1 }]}
        />,
      ),
    ).toThrow(RangeError);
    expect(instance.getGridColumns()).toHaveLength(5); // nothing changed
  });

  it('survives a destroyed instance on a later gridColumns change', () => {
    const ref = createRef<FluxGanttGridRef>();
    const { rerender } = render(<FluxGanttGrid ref={ref} tasks={TASKS} />);
    ref.current!.destroy();
    expect(() =>
      rerender(<FluxGanttGrid ref={ref} tasks={TASKS} gridColumns={[{ id: 'name' }]} />),
    ).not.toThrow();
  });

  it('composes with rtl and a theme', () => {
    const { container } = render(<FluxGanttGrid tasks={TASKS} rtl theme="dark" />);
    expect(headers(container)).toEqual(['Name', 'Start', 'End', 'Duration', 'Progress']);
    expect(container.querySelector('.fg-timeline')).not.toBeNull();
  });

  it('cleans up on unmount: the chart is removed and the column:resized listener is gone', () => {
    const ref = createRef<FluxGanttGridRef>();
    const onColumnResized = vi.fn();
    const { container, unmount } = render(
      <FluxGanttGrid ref={ref} tasks={TASKS} onColumnResized={onColumnResized} />,
    );
    const instance = ref.current!;
    unmount();
    expect(container.querySelector('.fg-timeline')).toBeNull();
    instance.resizeGridColumn('start', 150);
    expect(onColumnResized).not.toHaveBeenCalled();
  });

  it('under StrictMode builds one instance, one grid and one resize listener', () => {
    const ref = createRef<FluxGanttGridRef>();
    const onColumnResized = vi.fn();
    const { container } = render(
      <StrictMode>
        <FluxGanttGrid ref={ref} tasks={TASKS} onColumnResized={onColumnResized} />
      </StrictMode>,
    );
    expect(container.querySelectorAll('.fg-timeline')).toHaveLength(1);
    act(() => {
      ref.current!.resizeGridColumn('start', 150);
    });
    expect(onColumnResized).toHaveBeenCalledTimes(1);
  });

  it('exports the hook', () => {
    expect(typeof useFluxGanttGrid).toBe('function');
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
    // a data change wins over a function change
    expect(diffColumns([c()], [c({ value: () => 'x', width: 70 })])).toBe('changed');
  });
  it('compares editors by their data and function identity', () => {
    const commit = (): { name: string } => ({ name: 'x' });
    const e = (extra: object = {}): GridColumnInput =>
      c({ editor: { type: 'text', commit, ...extra } });
    expect(diffColumns([e()], [e()])).toBe('same');
    expect(diffColumns([e()], [e({ maxLength: 5 })])).toBe('changed');
    expect(diffColumns([e()], [e({ commit: () => ({ name: 'y' }) })])).toBe('functions');
    expect(diffColumns([e()], [e({ initial: () => '' })])).toBe('functions');
    expect(diffColumns([c()], [e()])).toBe('changed');
    expect(diffColumns([e()], [c({ editor: false })])).toBe('changed');
    expect(diffColumns([c({ editor: false })], [c({ editor: false })])).toBe('same');
  });
});
