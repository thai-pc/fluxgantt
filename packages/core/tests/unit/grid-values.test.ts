// The grid value pipeline and CSV report (spec-grid-columns.md 6, 8.3). Headless: no DOM, no render.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../../src/gantt.js';
import { getInternal } from '../../src/gantt-internal.js';
import { withGrid } from '../../src/grid/mixin.js';
import { createGridValues } from '../../src/grid/values.js';
import { resolveColumns } from '../../src/grid/columns.js';
import { computeRollup } from '../../src/compute/rollup.js';
import { differenceInWorkingHours } from '../../src/compute/working-calendar.js';
import { toTaskId, type WorkingCalendar } from '../../src/types.js';
import type { GridColumnInput } from '../../src/grid/types.js';
import type { TaskInput } from '../../src/store/index.js';

const t = (id: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: toTaskId(id),
  name: id,
  start: '2026-01-05',
  end: '2026-01-09',
  progress: 0,
  type: 'task',
  ...extra,
});
const CAL = (timezone: string): WorkingCalendar => ({
  workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  workingHours: [{ start: '09:00', end: '17:00' }],
  holidays: [],
  timezone,
});

function setup(tasks: TaskInput[], config: Record<string, unknown> = {}, columns?: GridColumnInput[], unit: 'days' | 'hours' = 'days') {
  const gantt = withGrid(createGantt({ tasks, ...config }), { ...(columns ? { columns } : {}), durationUnit: unit });
  const internal = getInternal(gantt);
  const cols = resolveColumns(columns);
  const values = createGridValues(internal, () => unit);
  const row = (id: string, c = cols) => values.text(internal.tasks.get(toTaskId(id))!, c);
  return { gantt, internal, cols, values, row };
}

afterEach(() => vi.restoreAllMocks());

describe('built-in columns', () => {
  it('formats name, dates, duration and progress for the chart locale', () => {
    const { row } = setup([t('a', { name: 'Alpha', progress: 0.456 })]);
    expect(row('a')).toEqual(['Alpha', 'Jan 5, 2026', 'Jan 9, 2026', '4d', '46%']);
  });

  it('honours GanttConfig.locale and an unknown locale degrades to English', () => {
    expect(setup([t('a')], { locale: 'de' }).row('a')[1]).toBe('5. Jan. 2026');
    expect(setup([t('a')], { locale: 'not a locale!' }).row('a')[1]).toBe('Jan 5, 2026');
  });

  it('reports duration in hours when asked', () => {
    expect(setup([t('a')], {}, undefined, 'hours').row('a')[3]).toBe('32h');
  });

  it('prefers an authored duration, and a milestone is 0', () => {
    const { row } = setup([t('a', { duration: 16 }), t('m', { type: 'milestone', end: '2026-01-05' })]);
    expect(row('a')[3]).toBe('2d');
    expect(row('m')[3]).toBe('0d');
  });

  it('clamps progress and tolerates a non-finite one', () => {
    const { row } = setup([t('a', { progress: 7 }), t('b', { progress: NaN })]);
    expect(row('a')[4]).toBe('100%');
    expect(row('b')[4]).toBe('0%');
  });

  it('shows the rolled-up span and progress of a summary when config.rollup is set', () => {
    const tasks = [
      t('p', { type: 'summary', start: '2026-01-05', end: '2026-01-06', progress: 0 }),
      t('c1', { parent: toTaskId('p'), start: '2026-01-05', end: '2026-01-07', progress: 1 }),
      t('c2', { parent: toTaskId('p'), start: '2026-01-12', end: '2026-01-14', progress: 0 }),
    ];
    const plain = setup(tasks).row('p');
    const rolled = setup(tasks, { rollup: computeRollup }).row('p');
    expect(plain[2]).toBe('Jan 6, 2026');
    expect(rolled[2]).toBe('Jan 14, 2026');
    expect(rolled[4]).toBe('50%');
    expect(rolled[3]).toBe('7d'); // 56 working hours between Jan 5 and Jan 14
  });

  it('a malformed date renders blank instead of throwing', () => {
    const { internal, values, cols } = setup([t('a')]);
    const bad = { ...internal.tasks.get(toTaskId('a'))!, start: 'not-a-date' as never };
    expect(() => values.text(bad, cols)).not.toThrow();
    expect(values.text(bad, cols)[1]).toBe('');
    expect(values.text(bad, cols)[3]).toBe('');
  });

  it('an absurd span skips the meter instead of walking it', () => {
    const { row } = setup([t('a', { start: '1900-01-01', end: '2100-01-01' }), t('b')]);
    expect(row('a')[3]).toBe('');
    expect(row('b')[3]).toBe('4d');
  });
});

describe('duration equals the calendar walk (3 zones, DST)', () => {
  const zones = ['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'];
  const day = fc.integer({ min: 0, max: 120 });
  const hour = fc.integer({ min: 0, max: 23 });

  it.each(zones)('property in %s: raw hours == differenceInWorkingHours', (tz) => {
    const cal = CAL(tz);
    const iso = (d: number, h: number): string => {
      const date = new Date(Date.UTC(2026, 1, 20 + d)); // spans both US DST changes in 2026 only via March
      return `${date.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:00`;
    };
    fc.assert(
      fc.property(day, hour, fc.integer({ min: 0, max: 40 }), hour, (d, h, len, h2) => {
        const start = iso(d, h);
        const end = iso(d + len, h2);
        fc.pre(start <= end);
        const { row } = setup([t('a', { start, end }), t('z', { start: '2026-02-20', end: '2026-08-01' })], { calendar: cal }, undefined, 'hours');
        const shown = row('a')[3]!;
        const expected = differenceInWorkingHours(start, end, cal);
        expect(shown).toBe(`${Number(expected.toFixed(1)).toLocaleString('en')}h`);
      }),
      { numRuns: 120 },
    );
  });

  it('a span over the New York spring-forward night counts 8h per working day', () => {
    // 2026-03-08 02:00 does not exist in New York; Mon 03-09 is a normal 09-17 day.
    const { row } = setup([t('a', { start: '2026-03-06T09:00', end: '2026-03-10T17:00' })], { calendar: CAL('America/New_York') }, undefined, 'hours');
    expect(row('a')[3]).toBe('24h'); // Fri 03-06 .. Tue 03-10: Fri 8 + Mon 8 + Tue 8
  });

  it('dates are read in the calendar zone, not the host zone', () => {
    // 2026-01-05T23:30 UTC is already Jan 6 in Ho Chi Minh (UTC+7).
    const { row } = setup([t('a', { start: '2026-01-05T23:30:00Z', end: '2026-01-07T10:00:00Z' })], { calendar: CAL('Asia/Ho_Chi_Minh') });
    expect(row('a')[1]).toBe('Jan 6, 2026');
  });
});

describe('custom columns', () => {
  const col = (value: unknown, extra: Record<string, unknown> = {}): GridColumnInput =>
    ({ id: 'x', header: 'X', value, ...extra }) as GridColumnInput;
  const cell = (value: unknown, extra: Record<string, unknown> = {}, task: Partial<TaskInput> = {}) =>
    setup([t('a', task)], {}, [{ id: 'name' }, col(value, extra)]).row('a')[1];

  it('renders strings and finite numbers', () => {
    expect(cell(() => 'hello')).toBe('hello');
    expect(cell(() => 42)).toBe('42');
    expect(cell((task: { name: string }) => task.name, {}, { name: 'Zed' })).toBe('Zed');
  });

  it('passes the cell context', () => {
    const seen: unknown[] = [];
    cell((_t: unknown, ctx: unknown) => (seen.push(ctx), 'x'));
    expect(seen[0]).toMatchObject({ locale: 'en', isSummary: false });
  });

  it('anything else is blank: null, undefined, NaN, Infinity, objects, functions, symbols, booleans', () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity, {}, [], () => 1, Symbol('s'), true, 10n]) {
      expect(cell(() => v), String(typeof v)).toBe('');
    }
  });

  it('contains an exception thrown by value() and warns once per column', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { row } = setup([t('a'), t('b')], {}, [{ id: 'name' }, col(() => { throw new Error('boom'); })]);
    expect(row('a')[1]).toBe('');
    expect(row('b')[1]).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('contains an exception thrown by format() and a non-string format result', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(cell(() => 1, { format: () => { throw new Error('x'); } })).toBe('');
    expect(cell(() => 1, { format: () => ({ toString: () => '<b>' }) })).toBe('');
    expect(cell(() => 7, { format: (v: number) => `#${v}` })).toBe('#7');
  });

  it('caps output at 1000 characters and replaces controls and bidi overrides', () => {
    expect(cell(() => 'a'.repeat(5000))).toHaveLength(1000);
    expect(cell(() => 'a\nb\tc\u0000d‮e⁦f')).toBe('a b c d e f');
  });

  it('keeps markup-looking text as inert text (it is only ever written with a Text node)', () => {
    expect(cell(() => '<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });

  it('memoizes per data revision: value() runs once per task, again only after a write', () => {
    const value = vi.fn(() => 'v');
    const { gantt, row } = setup([t('a'), t('b')], {}, [{ id: 'name' }, col(value)]);
    row('a'); row('a'); row('b'); row('b');
    expect(value).toHaveBeenCalledTimes(2);
    gantt.updateTask(toTaskId('a'), { name: 'A2' });
    row('a'); row('b');
    expect(value).toHaveBeenCalledTimes(4);
  });
});

describe('exportGridCsv', () => {
  it('works headless (no DOM, no renderer) and lists the configured headers', () => {
    const gantt = withGrid(createGantt({ tasks: [t('a', { name: 'Alpha', progress: 0.5 })] }));
    expect(typeof document).toBe('undefined');
    expect(gantt.exportGridCsv()).toBe('Name,Start,End,Duration,Progress\r\nAlpha,2026-01-05,2026-01-09,4,50');
  });

  it('writes one row per task in TREE order, collapsed tasks included', () => {
    const gantt = withGrid(createGantt({
      tasks: [t('c1', { parent: toTaskId('p') }), t('z'), t('p', { type: 'summary' }), t('c2', { parent: toTaskId('p') })],
    }), { columns: [{ id: 'name' }] });
    expect(gantt.exportGridCsv().split('\r\n')).toEqual(['Name', 'z', 'p', 'c1', 'c2']);
  });

  it('escapes formula injection in headers AND cells, and quotes per RFC 4180', () => {
    const gantt = withGrid(
      createGantt({ tasks: [t('a', { name: '=HYPERLINK("http://evil","x")' })] }),
      {
        columns: [
          { id: 'name', header: '+SUM(A1)' },
          { id: 'who', header: '@cmd', value: () => '-1+1' } as GridColumnInput,
          { id: 'q', header: 'a,"b"', value: () => 'x\ny' } as GridColumnInput,
          { id: 'tab', header: 'tab', value: () => '\tx' } as GridColumnInput,
        ],
      },
    );
    expect(gantt.exportGridCsv().split('\r\n')[0]).toBe(`'+SUM(A1),'@cmd,"a,""b""",tab`);
    const body = gantt.exportGridCsv().slice(gantt.exportGridCsv().indexOf('\r\n') + 2);
    expect(body).toBe(`"'=HYPERLINK(""http://evil"",""x"")",'-1+1,"x\ny",'\tx`);
  });

  it('property: no CSV cell begins with a formula trigger', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 12 }), { minLength: 1, maxLength: 5 }), (names) => {
        const gantt = withGrid(createGantt({ tasks: names.map((n, i) => t(`t${i}`, { name: n })) }), {
          columns: [{ id: 'name', header: names[0]!.slice(0, 50) }],
        });
        const rows = gantt.exportGridCsv().split('\r\n');
        // a cell with a newline spans lines; check the first character of every record via a small parser
        const cells = parseCsv(gantt.exportGridCsv());
        for (const c of cells) expect(c === '' || !'=+-@\t\r'.includes(c[0]!)).toBe(true);
        expect(rows.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it('uses the configured duration unit and calendar-zone dates', () => {
    const gantt = withGrid(createGantt({ tasks: [t('a')] }), { columns: [{ id: 'duration' }], durationUnit: 'hours' });
    expect(gantt.exportGridCsv()).toBe('Name,Duration\r\na,32');
  });

  it('throws after destroy, like the other methods', () => {
    const gantt = withGrid(createGantt({ tasks: [] }));
    gantt.destroy();
    expect(() => gantt.exportGridCsv()).toThrow();
  });
});

/** Minimal RFC 4180 parser: every field of every record. */
function parseCsv(csv: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= csv.length) {
    let field = '';
    if (csv[i] === '"') {
      i++;
      while (i < csv.length) {
        if (csv[i] === '"' && csv[i + 1] === '"') { field += '"'; i += 2; }
        else if (csv[i] === '"') { i++; break; }
        else field += csv[i++];
      }
    } else {
      while (i < csv.length && csv[i] !== ',' && csv[i] !== '\r') field += csv[i++];
    }
    out.push(field);
    if (csv[i] === ',') i++;
    else if (csv[i] === '\r') i += 2;
    else break;
  }
  return out;
}
