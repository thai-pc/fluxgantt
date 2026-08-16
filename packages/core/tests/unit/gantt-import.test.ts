// Headless facade tests — `gantt.importJson()`/`gantt.importCsv()` (spec-import-wiring.md §9).
// Runs under vitest's default `node` environment — no `mount()`/DOM needed for any of these
// (matches gantt-history.test.ts/gantt-selection.test.ts precedent, not gantt-dom.test.ts).
import { describe, it, expect, vi } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

/** A minimal, schema-valid `{fluxgantt, tasks, dependencies}` JSON envelope. */
function jsonEnvelope(
  tasks: readonly { id: string; name: string; start: string; end: string; progress: number; type: string }[],
  dependencies: readonly { from: string; to: string; type?: string; lag?: number }[] = [],
): object {
  return {
    fluxgantt: { schemaVersion: '1.0' },
    tasks,
    dependencies,
  };
}

describe('Gantt#importJson — wholesale-replace correctness', () => {
  it('replaces an existing, DIFFERENT task/dependency set entirely (old data gone, not merged)', () => {
    const gantt = createGantt({
      tasks: [taskInput('old-a', '2026-01-01', '2026-01-02'), taskInput('old-b', '2026-01-02', '2026-01-03')],
      dependencies: [{ from: toTaskId('old-a'), to: toTaskId('old-b'), type: 'FS' }],
    });

    const summary = gantt.importJson(
      jsonEnvelope(
        [
          { id: 'new-x', name: 'X', start: '2026-02-01T00:00:00Z', end: '2026-02-02T00:00:00Z', progress: 0, type: 'task' },
          { id: 'new-y', name: 'Y', start: '2026-02-02T00:00:00Z', end: '2026-02-03T00:00:00Z', progress: 0, type: 'task' },
        ],
        [{ from: 'new-x', to: 'new-y', type: 'FS' }],
      ),
    );

    expect(summary).toEqual({ format: 'json', taskCount: 2, dependencyCount: 1 });
    const ids = gantt.getTasks().map((t) => t.id);
    expect(new Set(ids)).toEqual(new Set([toTaskId('new-x'), toTaskId('new-y')]));
    expect(gantt.getTasks()).toHaveLength(2);
    expect(gantt.getDependencies()).toHaveLength(1);
    expect(gantt.getDependencies()[0]!.from).toBe(toTaskId('new-x'));
    expect(gantt.getDependencies()[0]!.to).toBe(toTaskId('new-y'));
  });

  it('importJson({tasks: []}) wholesale-clears to empty', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-01', '2026-01-02')],
    });
    const summary = gantt.importJson(jsonEnvelope([]));
    expect(summary).toEqual({ format: 'json', taskCount: 0, dependencyCount: 0 });
    expect(gantt.getTasks()).toEqual([]);
    expect(gantt.getDependencies()).toEqual([]);
  });

  it('importCsv with a fresh task set clears pre-existing DEPENDENCIES too (dataset-wide replace, not tasks-only)', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-01', '2026-01-02'), taskInput('b', '2026-01-02', '2026-01-03')],
      dependencies: [{ from: toTaskId('a'), to: toTaskId('b'), type: 'FS' }],
    });
    expect(gantt.getDependencies()).toHaveLength(1);

    const csv = 'id,name,start,end,duration,progress,type,parent,notes,color\nc,C,2026-03-01T00:00:00Z,2026-03-02T00:00:00Z,,0,task,,,';
    const summary = gantt.importCsv(csv);

    expect(summary).toEqual({ format: 'csv', taskCount: 1, dependencyCount: 0 });
    expect(gantt.getDependencies()).toEqual([]);
    expect(gantt.getTasks().map((t) => t.id)).toEqual([toTaskId('c')]);
  });

  it('imported tasks are NOT double-stamped — createdAt/updatedAt set once, matching a single addTask() shape', () => {
    const gantt = createGantt({});
    gantt.importJson(
      jsonEnvelope([
        { id: 'x', name: 'X', start: '2026-02-01T00:00:00Z', end: '2026-02-02T00:00:00Z', progress: 0, type: 'task' },
      ]),
    );
    const imported = gantt.getTask(toTaskId('x'))!;
    expect(imported.createdAt).toBeInstanceOf(Date);
    expect(imported.updatedAt).toBeInstanceOf(Date);
    expect(imported.createdAt.getTime()).toBe(imported.updatedAt.getTime());

    // Same shape as a direct addTask() call.
    const gantt2 = createGantt({});
    const added = gantt2.addTask(taskInput('y', '2026-02-01', '2026-02-02'));
    expect(added.createdAt).toBeInstanceOf(Date);
    expect(added.createdAt.getTime()).toBe(added.updatedAt.getTime());
  });
});

describe('Gantt#importJson/importCsv — history cleared', () => {
  it('clears both undo/redo stacks; canUndo()/canRedo() false; undo()/redo() return false post-import', () => {
    const gantt = createGantt({});
    gantt.addTask(taskInput('a', '2026-01-01', '2026-01-02'));
    gantt.moveTask(toTaskId('a'), '2026-01-02');
    expect(gantt.canUndo()).toBe(true);

    gantt.importJson(jsonEnvelope([{ id: 'z', name: 'Z', start: '2026-02-01T00:00:00Z', end: '2026-02-02T00:00:00Z', progress: 0, type: 'task' }]));

    expect(gantt.canUndo()).toBe(false);
    expect(gantt.canRedo()).toBe(false);
    expect(gantt.undo()).toBe(false);
    expect(gantt.redo()).toBe(false);
  });

  it('import is NOT itself undoable — undo() after import does not restore the pre-import dataset', () => {
    const gantt = createGantt({});
    gantt.addTask(taskInput('a', '2026-01-01', '2026-01-02'));
    gantt.importJson(jsonEnvelope([{ id: 'z', name: 'Z', start: '2026-02-01T00:00:00Z', end: '2026-02-02T00:00:00Z', progress: 0, type: 'task' }]));

    expect(gantt.undo()).toBe(false); // stack was cleared, nothing to undo
    expect(gantt.getTasks().map((t) => t.id)).toEqual([toTaskId('z')]);
  });

  it('history:changed fires exactly once with {canUndo:false, canRedo:false} when stacks were non-empty pre-import', () => {
    const gantt = createGantt({});
    gantt.addTask(taskInput('a', '2026-01-01', '2026-01-02'));

    const onHistory = vi.fn();
    gantt.on('history:changed', onHistory);
    gantt.importJson(jsonEnvelope([]));

    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(onHistory).toHaveBeenLastCalledWith({ canUndo: false, canRedo: false });
  });

  it('history:changed does NOT fire when both stacks were already empty pre-import', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-01', '2026-01-02')] }); // construction-seeded, no history
    const onHistory = vi.fn();
    gantt.on('history:changed', onHistory);
    gantt.importJson(jsonEnvelope([]));
    expect(onHistory).not.toHaveBeenCalled();
  });
});

describe('Gantt#importJson/importCsv — selection cleared', () => {
  it('clears the selection, fires selection:changed exactly once, even with a colliding id in the new dataset', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-01', '2026-01-02')] });
    gantt.select(toTaskId('a'));
    expect(gantt.getSelection()).toEqual([toTaskId('a')]);

    const onChanged = vi.fn();
    gantt.on('selection:changed', onChanged);
    gantt.importJson(jsonEnvelope([{ id: 'a', name: 'A2', start: '2026-03-01T00:00:00Z', end: '2026-03-02T00:00:00Z', progress: 0, type: 'task' }]));

    expect(gantt.getSelection()).toEqual([]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenLastCalledWith([]);
  });

  it('selection:changed does NOT fire when the selection was already empty pre-import', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-01', '2026-01-02')] });
    const onChanged = vi.fn();
    gantt.on('selection:changed', onChanged);
    gantt.importJson(jsonEnvelope([]));
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('Gantt#importJson/importCsv — readOnly independence', () => {
  it('importJson()/importCsv() both succeed and wholesale-replace on a readOnly instance', () => {
    const gantt = createGantt({ readOnly: true, tasks: [taskInput('a', '2026-01-01', '2026-01-02')] });

    gantt.importJson(jsonEnvelope([{ id: 'b', name: 'B', start: '2026-02-01T00:00:00Z', end: '2026-02-02T00:00:00Z', progress: 0, type: 'task' }]));
    expect(gantt.getTasks().map((t) => t.id)).toEqual([toTaskId('b')]);

    const csv = 'id,name,start,end,duration,progress,type,parent,notes,color\nc,C,2026-03-01T00:00:00Z,2026-03-02T00:00:00Z,,0,task,,,';
    gantt.importCsv(csv);
    expect(gantt.getTasks().map((t) => t.id)).toEqual([toTaskId('c')]);
  });
});

describe("Gantt#importJson/importCsv — 'data:imported' event", () => {
  it('fires exactly once per call, payload matches the return value; task:added/dependency:added fire ZERO times', () => {
    const gantt = createGantt({});
    const onImported = vi.fn();
    const onTaskAdded = vi.fn();
    const onDepAdded = vi.fn();
    gantt.on('data:imported', onImported);
    gantt.on('task:added', onTaskAdded);
    gantt.on('dependency:added', onDepAdded);

    const summary = gantt.importJson(
      jsonEnvelope(
        [
          { id: 'x', name: 'X', start: '2026-02-01T00:00:00Z', end: '2026-02-02T00:00:00Z', progress: 0, type: 'task' },
          { id: 'y', name: 'Y', start: '2026-02-02T00:00:00Z', end: '2026-02-03T00:00:00Z', progress: 0, type: 'task' },
        ],
        [{ from: 'x', to: 'y', type: 'FS' }],
      ),
    );

    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenLastCalledWith(summary);
    expect(summary).toEqual({ format: 'json', taskCount: 2, dependencyCount: 1 });
    expect(onTaskAdded).not.toHaveBeenCalled();
    expect(onDepAdded).not.toHaveBeenCalled();
  });

  it('an import that wholesale-replaces down to an empty dataset still fires data:imported once, not suppressed', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-01', '2026-01-02')] });
    const onImported = vi.fn();
    gantt.on('data:imported', onImported);
    gantt.importJson(jsonEnvelope([]));
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenLastCalledWith({ format: 'json', taskCount: 0, dependencyCount: 0 });
  });

  it('importCsv fires data:imported once with dependencyCount always 0', () => {
    const gantt = createGantt({});
    const onImported = vi.fn();
    gantt.on('data:imported', onImported);
    const csv = 'id,name,start,end,duration,progress,type,parent,notes,color\nc,C,2026-03-01T00:00:00Z,2026-03-02T00:00:00Z,,0,task,,,';
    const summary = gantt.importCsv(csv);
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ format: 'csv', taskCount: 1, dependencyCount: 0 });
  });
});

describe('Gantt#importJson/importCsv — atomicity (highest priority)', () => {
  it('a schema-valid but CYCLIC dependency JSON import against an already-populated instance throws and leaves the live instance byte-for-byte unchanged', () => {
    const gantt = createGantt({
      tasks: [taskInput('T1', '2026-01-01', '2026-01-02'), taskInput('T2', '2026-01-02', '2026-01-03')],
      dependencies: [{ from: toTaskId('T1'), to: toTaskId('T2'), type: 'FS' }],
    });
    gantt.select(toTaskId('T1'));
    gantt.moveTask(toTaskId('T2'), '2026-01-05'); // give it real undo/redo history
    gantt.undo();
    gantt.redo();

    const tasksBefore = gantt.getTasks();
    const depsBefore = gantt.getDependencies();
    const selectionBefore = gantt.getSelection();
    const canUndoBefore = gantt.canUndo();
    const canRedoBefore = gantt.canRedo();

    const onImported = vi.fn();
    gantt.on('data:imported', onImported);

    const cyclicPayload = jsonEnvelope(
      [
        { id: 'A', name: 'A', start: '2026-05-01T00:00:00Z', end: '2026-05-02T00:00:00Z', progress: 0, type: 'task' },
        { id: 'B', name: 'B', start: '2026-05-02T00:00:00Z', end: '2026-05-03T00:00:00Z', progress: 0, type: 'task' },
      ],
      [
        { from: 'A', to: 'B', type: 'FS' },
        { from: 'B', to: 'A', type: 'FS' }, // creates a cycle — passes importJson's own schema validation, only
        // rejected once DependencyStore.link() sees the second edge (io/json.ts does NOT
        // validate dependency cycles, per its own documented note).
      ],
    );

    expect(() => gantt.importJson(cyclicPayload)).toThrow(/cycle/i);

    // Full byte-for-byte state preservation post-throw — not just "still 2 tasks".
    expect(gantt.getTasks()).toEqual(tasksBefore);
    expect(gantt.getDependencies()).toEqual(depsBefore);
    expect(gantt.getSelection()).toEqual(selectionBefore);
    expect(gantt.canUndo()).toBe(canUndoBefore);
    expect(gantt.canRedo()).toBe(canRedoBefore);
    // Neither A nor B ever landed.
    expect(gantt.getTask(toTaskId('A'))).toBeUndefined();
    expect(gantt.getTask(toTaskId('B'))).toBeUndefined();

    expect(onImported).not.toHaveBeenCalled();
  });

  // Duplicate-id defense-in-depth is NOT independently testable via the public
  // importJson()/importCsv() surface: importJsonFn/importCsvFn's OWN `seenIds` check already
  // rejects a duplicate id within a single import batch before #loadDataset ever runs
  // (already covered by io-json.test.ts/io-csv.test.ts). No facade-level test can exercise
  // #loadDataset's own duplicate-id branch through import without directly unit-testing the
  // private helper.

  it('importCsv: a schema-invalid CSV (missing required column) leaves a pre-populated instance unchanged', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-01', '2026-01-02')] });
    const tasksBefore = gantt.getTasks();

    // Missing required columns entirely (just a bogus header) — importCsvFn rejects before
    // #commitImport/#loadDataset are ever reached, so this is trivially untouched; asserted
    // anyway for documentation value.
    expect(() => gantt.importCsv('not,a,valid,header\n1,2,3,4')).toThrow();
    expect(gantt.getTasks()).toEqual(tasksBefore);
  });
});

describe('Gantt#importJson/importCsv — return value / round-trip', () => {
  it("importJson()'s return value and the data:imported listener's received value are the identical ImportSummary", () => {
    const gantt = createGantt({});
    let fromEvent: unknown;
    gantt.on('data:imported', (summary) => {
      fromEvent = summary;
    });
    const returned = gantt.importJson(jsonEnvelope([{ id: 'x', name: 'X', start: '2026-02-01T00:00:00Z', end: '2026-02-02T00:00:00Z', progress: 0, type: 'task' }]));
    expect(fromEvent).toEqual(returned);
  });

  it('exportJson() then importJson() round-trips task fields but re-stamps createdAt/updatedAt (documented, expected non-identity)', () => {
    const gantt = createGantt({
      tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00', { progress: 0.5, notes: 'hello' })],
    });
    const original = gantt.getTask(toTaskId('a'))!;
    const bundle = gantt.exportJson();

    gantt.importJson(bundle);

    const reimported = gantt.getTask(toTaskId('a'))!;
    expect(reimported.id).toEqual(original.id);
    expect(reimported.name).toBe(original.name);
    expect(reimported.progress).toBe(original.progress);
    expect(reimported.notes).toBe(original.notes);
    expect(reimported.type).toBe(original.type);
    // createdAt/updatedAt do NOT round-trip — both re-stamped to "now" (validated-but-dropped
    // on import, not a bug).
    expect(reimported.createdAt.getTime()).not.toBe(original.createdAt.getTime());
  });
});

describe('Gantt#importJson/importCsv — lifecycle', () => {
  it('after destroy(), both importJson() and importCsv() throw /destroyed/', () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.destroy();
    expect(() => gantt.importJson(jsonEnvelope([]))).toThrow(/destroyed/);
    expect(() =>
      gantt.importCsv('id,name,start,end,duration,progress,type,parent,notes,color'),
    ).toThrow(/destroyed/);
  });
});
