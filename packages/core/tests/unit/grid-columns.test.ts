// resolveColumns / toColumnId (spec-grid-columns.md 2.3): validation, defaults, clamping. Headless.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_GRID_COLUMNS,
  MAX_COLUMN_COUNT,
  publicColumn,
  resolveColumns,
  toColumnId,
} from '../../src/grid/columns.js';
import type { GridColumnInput } from '../../src/grid/types.js';

const custom = (id: string, extra: Partial<GridColumnInput> = {}): GridColumnInput =>
  ({ id, header: id, value: () => 'x', ...extra }) as GridColumnInput;

describe('resolveColumns', () => {
  it('defaults to name, start, end, duration, progress', () => {
    const cols = resolveColumns(undefined);
    expect(cols.map((c) => c.id)).toEqual(['name', 'start', 'end', 'duration', 'progress']);
    expect(cols.map((c) => c.header)).toEqual(['Name', 'Start', 'End', 'Duration', 'Progress']);
    expect(cols.map((c) => c.align)).toEqual(['start', 'start', 'start', 'end', 'end']);
    expect(cols.every((c) => c.builtIn)).toBe(true);
    expect(DEFAULT_GRID_COLUMNS.map((c) => c.id)).toEqual(cols.map((c) => c.id));
  });

  it('prepends `name` when missing, and an empty list is just `name`', () => {
    expect(resolveColumns([{ id: 'end' }]).map((c) => c.id)).toEqual(['name', 'end']);
    expect(resolveColumns([]).map((c) => c.id)).toEqual(['name']);
  });

  it('throws when `name` is present but not first', () => {
    expect(() => resolveColumns([{ id: 'start' }, { id: 'name' }])).toThrow(RangeError);
  });

  it('rejects ids outside ^[A-Za-z0-9_-]{1,64}$', () => {
    for (const id of ['', ' a', 'a b', 'a.b', 'a"b', 'a<b>', 'é', 'a'.repeat(65), 'x\n', '__proto__\u0000']) {
      expect(() => resolveColumns([custom(id)]), JSON.stringify(id)).toThrow(RangeError);
    }
    expect(() => resolveColumns([custom('a'.repeat(64))])).not.toThrow();
    expect(() => resolveColumns([custom('__proto__')])).not.toThrow(); // legal text, never an object key
    expect(() => resolveColumns([{ id: 5 } as never])).toThrow(RangeError);
    expect(() => resolveColumns([null as never])).toThrow(RangeError);
    expect(() => resolveColumns('nope' as never)).toThrow(RangeError);
  });

  it('rejects duplicates, a custom column reusing a built-in id, and a custom column without value()', () => {
    expect(() => resolveColumns([custom('a'), custom('a')])).toThrow(/duplicate/);
    expect(() => resolveColumns([custom('start')])).toThrow(/built-in/);
    expect(() => resolveColumns([{ id: 'start', value: () => 1 } as never])).toThrow(/built-in/);
    expect(() => resolveColumns([{ id: 'x', header: 'X' } as never])).toThrow(/value/);
    expect(() => resolveColumns([{ id: 'x', value: () => 1 } as never])).toThrow(/header/);
    expect(() => resolveColumns([custom('x', { format: 5 as never })])).toThrow(/format/);
  });

  it('allows at most 24 columns, `name` included', () => {
    const many = (n: number): GridColumnInput[] => Array.from({ length: n }, (_, i) => custom(`c${i}`));
    expect(resolveColumns(many(MAX_COLUMN_COUNT - 1))).toHaveLength(24); // name is prepended
    expect(() => resolveColumns(many(MAX_COLUMN_COUNT))).toThrow(/at most 24/);
  });

  it('caps and sanitizes headers, and validates align and widths', () => {
    expect(() => resolveColumns([custom('a', { header: 'h'.repeat(201) })])).toThrow(RangeError);
    expect(resolveColumns([custom('a', { header: 'h'.repeat(200) })])[1]!.header).toHaveLength(200);
    expect(resolveColumns([custom('a', { header: 'a‮b\nc\u0000' })])[1]!.header).toBe('a b c ');
    expect(() => resolveColumns([custom('a', { align: 'left' as never })])).toThrow(/align/);
    for (const bad of [NaN, Infinity, '5' as never]) {
      expect(() => resolveColumns([custom('a', { width: bad })])).toThrow(/width/);
    }
  });

  it('clamps width into [minWidth, maxWidth]', () => {
    const [, a, b, c] = resolveColumns([
      custom('a', { width: 1 }),
      custom('b', { width: 9999 }),
      custom('c', { width: 100, minWidth: 120, maxWidth: 80 }), // max is raised to min
    ]);
    expect(a!.width).toBe(48);
    expect(b!.width).toBe(600);
    expect(c!.width).toBe(120);
    expect(c!.maxWidth).toBe(120);
  });

  it('publicColumn drops the host callbacks', () => {
    const col = resolveColumns([custom('a', { format: (v) => String(v) })])[1]!;
    expect(col.value).toBeTypeOf('function');
    expect(publicColumn(col)).not.toHaveProperty('value');
    expect(publicColumn(col)).not.toHaveProperty('format');
    expect(publicColumn(col).builtIn).toBe(false);
  });

  it('property: any accepted list has unique ids, `name` first, <= 24 columns and clamped widths', () => {
    const def = fc.record({
      id: fc.string({ maxLength: 70 }),
      width: fc.oneof(fc.double({ noNaN: false }), fc.constant(undefined)),
      minWidth: fc.oneof(fc.integer({ min: -50, max: 300 }), fc.constant(undefined)),
      maxWidth: fc.oneof(fc.integer({ min: -50, max: 900 }), fc.constant(undefined)),
    });
    fc.assert(
      fc.property(fc.array(def, { maxLength: 30 }), (list) => {
        const input = list.map((d) => ({
          ...d,
          header: 'h',
          value: () => 1,
          ...(d.width === undefined ? { width: undefined } : {}),
        })) as unknown as GridColumnInput[];
        for (const k of input) {
          for (const key of ['width', 'minWidth', 'maxWidth'] as const) {
            if ((k as unknown as Record<string, unknown>)[key] === undefined) delete (k as unknown as Record<string, unknown>)[key];
          }
        }
        let cols;
        try {
          cols = resolveColumns(input);
        } catch (e) {
          expect(e).toBeInstanceOf(RangeError);
          return;
        }
        expect(cols.length).toBeLessThanOrEqual(24);
        expect(cols[0]!.id).toBe('name');
        expect(new Set(cols.map((c) => c.id)).size).toBe(cols.length);
        for (const c of cols) {
          expect(c.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
          expect(Number.isFinite(c.width)).toBe(true);
          expect(c.width).toBeGreaterThanOrEqual(c.minWidth);
          expect(c.width).toBeLessThanOrEqual(c.maxWidth);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('toColumnId', () => {
  it('brands a valid id and throws on an invalid one', () => {
    expect(toColumnId('owner_1-b')).toBe('owner_1-b');
    expect(() => toColumnId('a b')).toThrow(RangeError);
    expect(() => toColumnId(undefined as never)).toThrow(RangeError);
  });
});
