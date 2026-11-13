// The duration column must not reintroduce the per-row calendar walk of investigation V / PR #125:
// ONE shared working-hours meter per data revision, never `differenceInWorkingHours` per row.
import { describe, it, expect, vi } from 'vitest';
import type * as WorkingCalendar from '../../src/compute/working-calendar.js';

vi.mock('../../src/compute/working-calendar.js', async (importOriginal) => {
  const real = await importOriginal<typeof WorkingCalendar>();
  return {
    ...real,
    workingHoursMeter: vi.fn(real.workingHoursMeter),
    differenceInWorkingHours: vi.fn(real.differenceInWorkingHours),
  };
});

import { createGantt } from '../../src/gantt.js';
import { withGrid } from '../../src/grid/mixin.js';
import { toTaskId } from '../../src/types.js';
import * as wc from '../../src/compute/working-calendar.js';

const tasks = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: toTaskId(`t${i}`),
    name: `t${i}`,
    start: `2026-01-${String((i % 20) + 5).padStart(2, '0')}`,
    end: `2026-02-${String((i % 20) + 5).padStart(2, '0')}`,
    progress: 0,
    type: 'task' as const,
  }));

describe('duration column cost', () => {
  it('builds exactly one meter for 1000 rows and never walks the calendar per row', () => {
    const gantt = withGrid(createGantt({ tasks: tasks(1000) }));
    const csv = gantt.exportGridCsv();
    expect(csv.split('\r\n')).toHaveLength(1001);
    expect(wc.workingHoursMeter).toHaveBeenCalledTimes(1);
    expect(wc.differenceInWorkingHours).not.toHaveBeenCalled();
  });

  it('builds a new meter only after a data revision, not on a repeated read', () => {
    vi.mocked(wc.workingHoursMeter).mockClear();
    const gantt = withGrid(createGantt({ tasks: tasks(50) }));
    gantt.exportGridCsv();
    gantt.exportGridCsv();
    expect(wc.workingHoursMeter).toHaveBeenCalledTimes(1);
    gantt.updateTask(toTaskId('t0'), { name: 'x' });
    gantt.exportGridCsv();
    expect(wc.workingHoursMeter).toHaveBeenCalledTimes(2);
  });
});
