// CSV IO layer tests (spec-io-json-csv.md §6, §8, testing.md §3 IO layer priority).
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CSV_COLUMNS,
  IoValidationError,
  escapeCsvValue,
  // (unescapeCsvValue removed — security review B1; import is now literal, no unescape)
  exportCsv,
  importCsv,
} from '../../src/io/index.js';
import { toTaskId, type Task } from '../../src/types.js';

const now = new Date('2026-01-01T00:00:00Z');

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: toTaskId('t-1'),
    name: 'Task 1',
    start: '2026-01-05T09:00:00Z',
    end: '2026-01-05T17:00:00Z',
    progress: 0,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('exportCsv / importCsv — round-trip', () => {
  it('round-trips every column of the flat subset', () => {
    const tasks = [
      makeTask({
        id: toTaskId('full'),
        name: 'Full task',
        duration: 40,
        progress: 0.5,
        type: 'summary',
        notes: 'Some notes',
        color: '#6366f1',
      }),
      makeTask({ id: toTaskId('child'), parent: toTaskId('full'), type: 'milestone' }),
      makeTask({ id: toTaskId('minimal') }), // no duration/parent/notes/color
    ];

    const csv = exportCsv(tasks);
    const result = importCsv(csv);

    expect(result.tasks).toHaveLength(3);
    const byId = new Map(result.tasks.map((t) => [t.id, t]));

    const full = byId.get(toTaskId('full'))!;
    expect(full.name).toBe('Full task');
    expect(full.duration).toBe(40);
    expect(full.progress).toBe(0.5);
    expect(full.type).toBe('summary');
    expect(full.parent).toBeUndefined();
    expect(full.notes).toBe('Some notes');
    expect(full.color).toBe('#6366f1');

    const child = byId.get(toTaskId('child'))!;
    expect(child.parent).toBe(toTaskId('full'));
    expect(child.type).toBe('milestone');

    const minimal = byId.get(toTaskId('minimal'))!;
    expect(minimal.duration).toBeUndefined();
    expect(minimal.parent).toBeUndefined();
    expect(minimal.notes).toBeUndefined();
    expect(minimal.color).toBeUndefined();
  });

  it('exports with a column subset/order and importCsv of that narrower CSV succeeds', () => {
    const tasks = [makeTask()];
    const csv = exportCsv(tasks, { columns: ['name', 'id', 'start', 'end', 'progress', 'type'] });
    const header = csv.split('\r\n')[0];
    expect(header).toBe('name,id,start,end,progress,type');
    expect(() => importCsv(csv)).not.toThrow();
  });

  it('exportCsv omitting a required column, then importCsv throws "missing required CSV column"', () => {
    const tasks = [makeTask()];
    const csv = exportCsv(tasks, { columns: ['id', 'name', 'start', 'end', 'type'] }); // no progress
    expect(() => importCsv(csv)).toThrow(/missing required CSV column "progress"/);
  });

  it('exportCsv throws synchronously for an unknown column name', () => {
    expect(() => exportCsv([], { columns: ['bogus' as never] })).toThrow();
  });
});

describe('RFC 4180 edge cases', () => {
  it('round-trips a name containing a comma, a double-quote, and an embedded CRLF', () => {
    const tasks = [
      makeTask({ id: toTaskId('t1'), name: 'Hello, "World"' }),
      makeTask({ id: toTaskId('t2'), name: 'Line1\r\nLine2' }),
      makeTask({ id: toTaskId('t3'), notes: 'a,b,"c",\r\nd' }),
    ];
    const csv = exportCsv(tasks);
    const result = importCsv(csv);
    const byId = new Map(result.tasks.map((t) => [t.id, t]));
    expect(byId.get(toTaskId('t1'))!.name).toBe('Hello, "World"');
    expect(byId.get(toTaskId('t2'))!.name).toBe('Line1\r\nLine2');
    expect(byId.get(toTaskId('t3'))!.notes).toBe('a,b,"c",\r\nd');
  });
});

describe('formula-injection escaping (security.md §2) — always-on round-trip', () => {
  const triggerNames = ['=SUM(A1)', '+cmd', '-1+1', '@mention', '\ttabbed', '\rcr-prefixed'];

  it.each(triggerNames)('the raw exported cell is `\'`-prefixed (Excel/Sheets would treat it as text): %j', (originalName) => {
    // Export ONLY the `name` column (a standalone check, not fed to importCsv — importCsv
    // requires the 6 required columns, checked separately below) so the raw output line is
    // exactly one cell — makes the "starts with an escaped `'`" assertion unambiguous
    // regardless of RFC-4180 quoting.
    const csv = exportCsv([makeTask({ name: originalName })], { columns: ['name'] });
    const dataLine = csv.split('\r\n')[1]!;
    const expectedRawCell = escapeCsvValue(originalName);
    // escapeCsvValue always prefixes exactly one `'` for a trigger char — assert the
    // character immediately after the opening quote-or-cell-start is `'`.
    const unwrapped = dataLine.startsWith('"') ? dataLine.slice(1, -1).replace(/""/g, '"') : dataLine;
    expect(unwrapped[0]).toBe("'");
    expect(unwrapped).toBe(expectedRawCell);
  });

  it.each(triggerNames)('import keeps the escaped value LITERAL — never re-materializes a live formula (security review B1): %j', (originalName) => {
    // B1: importCsv does NOT unescape. Exporting a formula-like name adds one `'` guard;
    // importing keeps it literally (`'=SUM(A1)`), so the value is never turned back into the
    // live formula string `=SUM(A1)`. CSV is intentionally lossy for trigger-char-leading
    // values (JSON is the lossless format); the safety property — no live formula ever
    // reconstructed on import — is what matters.
    const csv = exportCsv([makeTask({ name: originalName })]);
    const result = importCsv(csv);
    const imported = result.tasks[0]!.name;
    expect(imported).toBe(escapeCsvValue(originalName)); // the `'`-guarded value, verbatim
    expect(imported).not.toBe(originalName); // NOT the live-formula original
  });

  it('a third-party CSV cell that legitimately starts with `\'`+trigger is NOT corrupted on import (B1)', () => {
    // The core of B1: a real CSV (not our export) whose `name` is the literal string
    // `'=SUM(A1)` (e.g. a user hand-escaped it in Excel) must import UNCHANGED — blindly
    // stripping the `'` would silently reintroduce the live formula.
    const csv = 'id,name,start,end,progress,type\r\nt1,\'=SUM(A1),2026-01-05T09:00:00Z,2026-01-06T09:00:00Z,0,task\r\n';
    const result = importCsv(csv);
    expect(result.tasks[0]!.name).toBe("'=SUM(A1)"); // preserved verbatim, not turned into =SUM(A1)
  });

  it('escapeCsvValue prefixes exactly one `\'` for a trigger char and leaves a normal value untouched', () => {
    for (const name of triggerNames) {
      expect(escapeCsvValue(name)).toBe(`'${name}`);
    }
    expect(escapeCsvValue('Normal name')).toBe('Normal name');
  });
});

describe('header order independence / unknown columns', () => {
  it('parses correctly regardless of column order', () => {
    const csv = [
      'type,end,start,name,id,progress',
      'task,2026-01-05T17:00:00Z,2026-01-05T09:00:00Z,Shuffled,shuffled-1,0.25',
    ].join('\r\n');
    const result = importCsv(csv);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.name).toBe('Shuffled');
    expect(result.tasks[0]!.progress).toBe(0.25);
  });

  it('ignores an unknown extra header column', () => {
    const csv = [
      'id,name,start,end,progress,type,foo',
      'x,n,2026-01-05T09:00:00Z,2026-01-05T17:00:00Z,0,task,ignored-value',
    ].join('\r\n');
    const result = importCsv(csv);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.name).toBe('n');
  });
});

describe('importCsv — malformed-input rejection', () => {
  it('rejects a ragged row (wrong cell count)', () => {
    const csv = ['id,name,start,end,progress,type', 'x,n,2026-01-05,2026-01-06,0'].join('\r\n');
    expect(() => importCsv(csv)).toThrow(IoValidationError);
  });

  it('rejects a header missing a required column', () => {
    const csv = ['id,name,start,end,type', 'x,n,2026-01-05,2026-01-06,task'].join('\r\n');
    expect(() => importCsv(csv)).toThrow(/missing required CSV column/);
  });

  it('rejects a non-numeric progress cell', () => {
    const csv = [
      'id,name,start,end,progress,type',
      'x,n,2026-01-05T09:00:00Z,2026-01-06T09:00:00Z,abc,task',
    ].join('\r\n');
    expect(() => importCsv(csv)).toThrow(IoValidationError);
  });

  it('rejects a non-numeric duration cell', () => {
    const csv = [
      'id,name,start,end,duration,progress,type',
      'x,n,2026-01-05T09:00:00Z,2026-01-06T09:00:00Z,abc,0,task',
    ].join('\r\n');
    expect(() => importCsv(csv)).toThrow(IoValidationError);
  });

  it('rejects an empty CSV string (zero rows)', () => {
    expect(() => importCsv('')).toThrow(/csv has no header row/);
  });

  it('rejects an oversized CSV (injected small maxInputLengthChars)', () => {
    const csv = ['id,name,start,end,progress,type', 'x,n,2026-01-05,2026-01-06,0,task'].join('\r\n');
    expect(() => importCsv(csv, { limits: { maxInputLengthChars: 5 } })).toThrow(IoValidationError);
  });

  it('rejects a duplicate task id within one import', () => {
    const csv = [
      'id,name,start,end,progress,type',
      'x,n,2026-01-05T09:00:00Z,2026-01-06T09:00:00Z,0,task',
      'x,n2,2026-01-05T09:00:00Z,2026-01-06T09:00:00Z,0,task',
    ].join('\r\n');
    expect(() => importCsv(csv)).toThrow(/duplicate task id/);
  });

  it('rejects an empty-string id cell', () => {
    const csv = [
      'id,name,start,end,progress,type',
      ',n,2026-01-05T09:00:00Z,2026-01-06T09:00:00Z,0,task',
    ].join('\r\n');
    expect(() => importCsv(csv)).toThrow(IoValidationError);
  });
});

describe('checkHierarchyDepth via the parent column', () => {
  it('rejects a parent cycle within the batch', () => {
    const csv = [
      'id,name,start,end,progress,type,parent',
      'a,a,2026-01-05T09:00:00Z,2026-01-06T09:00:00Z,0,task,b',
      'b,b,2026-01-05T09:00:00Z,2026-01-06T09:00:00Z,0,task,a',
    ].join('\r\n');
    expect(() => importCsv(csv)).toThrow(IoValidationError);
  });

  it('rejects a parent chain deeper than maxHierarchyDepth', () => {
    const header = 'id,name,start,end,progress,type,parent';
    const rows = Array.from({ length: 6 }, (_, i) => {
      const parent = i > 0 ? `t${i - 1}` : '';
      return `t${i},t${i},2026-01-05T09:00:00Z,2026-01-06T09:00:00Z,0,task,${parent}`;
    });
    const csv = [header, ...rows].join('\r\n');
    expect(() => importCsv(csv, { limits: { maxHierarchyDepth: 3 } })).toThrow(IoValidationError);
  });
});

describe('DEFAULT_CSV_COLUMNS', () => {
  it('is exactly the 10-column tuple in the documented order', () => {
    expect(DEFAULT_CSV_COLUMNS).toEqual([
      'id',
      'name',
      'start',
      'end',
      'duration',
      'progress',
      'type',
      'parent',
      'notes',
      'color',
    ]);
  });
});
