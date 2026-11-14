// The calendar-aware commit mapping of the grid cell editors (spec-grid-columns.md 10.4, 13.1). Headless: no DOM.
// One edit is ONE store write (one undo entry, one `task:updated`); start keeps the working duration, end snaps back.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../../src/gantt.js';
import { getInternal } from '../../src/gantt-internal.js';
import { withGrid } from '../../src/grid/mixin.js';
import { planEdit, type Plan } from '../../src/grid-editing/commit.js';
import { addWorkingHours, differenceInWorkingHours, normalizeDate } from '../../src/compute/working-calendar.js';
import { toTaskId, type WorkingCalendar } from '../../src/types.js';
import type { GridColumnInput } from '../../src/grid/types.js';
import type { TaskInput } from '../../src/store/index.js';

const t = (id: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id: toTaskId(id),
  name: id,
  start: '2026-01-05T09:00:00+00:00[UTC]',
  end: '2026-01-07T17:00:00+00:00[UTC]',
  progress: 0.25,
  type: 'task',
  ...extra,
});
const CAL = (timezone: string, extra: Partial<WorkingCalendar> = {}): WorkingCalendar => ({
  workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  workingHours: [{ start: '09:00', end: '17:00' }],
  holidays: [],
  timezone,
  ...extra,
});

function setup(tasks: TaskInput[], config: Record<string, unknown> = {}, columns?: GridColumnInput[], unit: 'days' | 'hours' = 'days') {
  const gantt = withGrid(createGantt({ tasks, ...config }), { ...(columns ? { columns } : {}), durationUnit: unit });
  const internal = getInternal(gantt);
  const grid = internal.gv!();
  const updated: unknown[] = [];
  gantt.on('task:updated', (p) => updated.push(p));
  const plan = (id: string, col: string, text: string): Plan => {
    const i = grid.view.all.findIndex((c) => c.id === col);
    const task = gantt.getTask(toTaskId(id))!;
    return planEdit({ gantt, internal, unit }, task, grid.view.all[i]!, text, grid.values.raw(task, grid.view.all)[i]!);
  };
  const edit = (id: string, col: string, text: string): Plan => {
    const p = plan(id, col, text);
    if (p.kind === 'write') p.run();
    return p;
  };
  return { gantt, internal, updated, plan, edit, cal: internal.calendar };
}
const snap = (g: ReturnType<typeof setup>, id: string) => JSON.parse(JSON.stringify(g.gantt.getTask(toTaskId(id))));
const iso = (g: ReturnType<typeof setup>, v: unknown) => normalizeDate(v as string, g.cal.timezone).toString();

describe('one edit is one write', () => {
  const cases: [string, string, string][] = [
    ['name', 'name', 'Renamed'],
    ['start', 'start', '2026-01-12'],
    ['end', 'end', '2026-01-16'],
    ['duration', 'duration', '5'],
    ['progress', 'progress', '80'],
  ];
  it.each(cases)('%s: one history entry, one task:updated, one undo restores the task exactly', (_n, col, text) => {
    const g = setup([t('a')], { calendar: CAL('UTC') });
    const before = snap(g, 'a');
    const p = g.edit('a', col, text);
    expect(p.kind).toBe('write');
    expect(g.updated).toHaveLength(1);
    expect(snap(g, 'a')).not.toEqual(before);
    expect(g.gantt.canUndo()).toBe(true);
    g.gantt.undo();
    expect(g.gantt.canUndo()).toBe(false); // exactly one entry
    expect(snap(g, 'a')).toEqual(before);
  });

  it('a value that changes nothing writes nothing', () => {
    const g = setup([t('a', { name: 'Alpha' })], { calendar: CAL('UTC') });
    for (const [col, text] of [['name', ' Alpha '], ['start', '2026-01-05'], ['end', '2026-01-07'], ['progress', '25'], ['progress', '25%']] as const) {
      expect(g.plan('a', col, text).kind, `${col} ${text}`).toBe('noop');
    }
    expect(g.updated).toHaveLength(0);
    expect(g.gantt.canUndo()).toBe(false);
  });

  it('the grouped cascade of an auto-scheduled start edit is the same undo entry', () => {
    const g = setup(
      [t('a'), t('b', { start: '2026-01-08T09:00:00+00:00[UTC]', end: '2026-01-09T17:00:00+00:00[UTC]' })],
      { calendar: CAL('UTC'), schedulingMode: 'auto' },
    );
    g.gantt.linkTasks(toTaskId('a'), toTaskId('b'), 'FS');
    const b0 = snap(g, 'b');
    g.updated.length = 0;
    g.edit('a', 'start', '2026-01-19');
    expect(snap(g, 'b')).not.toEqual(b0); // the successor moved
    g.gantt.undo();
    expect(snap(g, 'b')).toEqual(b0);
    expect(g.gantt.canUndo()).toBe(true); // only the link is left
    g.gantt.undo();
    expect(g.gantt.canUndo()).toBe(false);
  });

  it('manual scheduling touches only the task', () => {
    const g = setup([t('a'), t('b', { start: '2026-01-08T09:00:00+00:00[UTC]', end: '2026-01-09T17:00:00+00:00[UTC]' })], { calendar: CAL('UTC') });
    g.gantt.linkTasks(toTaskId('a'), toTaskId('b'), 'FS');
    const b0 = snap(g, 'b');
    g.edit('a', 'start', '2026-01-19');
    expect(snap(g, 'b')).toEqual(b0);
  });
});

describe('start', () => {
  for (const tz of ['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh']) {
    it(`keeps the working duration across a weekend, a holiday and a lunch break (${tz})`, () => {
      const cal = CAL(tz, { workingHours: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }], holidays: ['2026-01-14'] });
      const g = setup([t('a', { start: '2026-01-05T09:00', end: '2026-01-07T17:00' })], { calendar: cal });
      const hours = differenceInWorkingHours(g.gantt.getTask(toTaskId('a'))!.start, g.gantt.getTask(toTaskId('a'))!.end, cal);
      expect(hours).toBe(21); // three days of 3 + 4 working hours
      g.edit('a', 'start', '2026-01-13'); // the end crosses the 14th, a holiday, and a weekend
      const a = g.gantt.getTask(toTaskId('a'))!;
      expect(differenceInWorkingHours(a.start, a.end, cal)).toBeCloseTo(hours, 9);
      expect(normalizeDate(a.start, tz).hour).toBe(9);
      expect(normalizeDate(a.start, tz).toPlainDate().toString()).toBe('2026-01-13');
    });
  }

  it('snaps a Saturday and a holiday forward to the next working day and says so', () => {
    const g = setup([t('a')], { calendar: CAL('UTC', { holidays: ['2026-01-12'] }) });
    const p = g.plan('a', 'start', '2026-01-10'); // Saturday; Monday the 12th is a holiday
    expect(p.kind === 'write' && p.snapped).toBe('next');
    g.edit('a', 'start', '2026-01-10');
    expect(iso(g, g.gantt.getTask(toTaskId('a'))!.start)).toContain('2026-01-13T09:00:00');
  });

  it('a milestone moves to the day and keeps end = start', () => {
    const g = setup([t('m', { type: 'milestone', start: '2026-01-05T09:00', end: '2026-01-05T09:00' })], { calendar: CAL('UTC') });
    g.edit('m', 'start', '2026-01-08');
    const m = g.gantt.getTask(toTaskId('m'))!;
    expect(iso(g, m.start)).toBe(iso(g, m.end));
    expect(iso(g, m.start)).toContain('2026-01-08T09:00:00');
  });

  it('uses the authored duration when there is one', () => {
    const g = setup([t('a', { duration: 24 })], { calendar: CAL('UTC') });
    g.edit('a', 'start', '2026-01-12');
    const a = g.gantt.getTask(toTaskId('a'))!;
    expect(a.duration).toBe(24);
    expect(iso(g, a.end)).toBe(iso(g, addWorkingHours('2026-01-12T09:00:00+00:00[UTC]', 24, g.cal)));
  });

  it('a working span that crosses the New York DST changes (2026-03-08 spring forward, 2026-11-01 fall back) keeps its hours and its local times', () => {
    const cal = CAL('America/New_York');
    // Friday start, 24 working hours: Friday, Monday (after the change) and Tuesday, ending 17:00 local on the 10th / 3rd.
    for (const [from, day, endDay] of [['2026-03-02', '2026-03-06', '2026-03-10'], ['2026-10-26', '2026-10-30', '2026-11-03']] as const) {
      const g = setup([t('a', { start: `${from}T09:00`, end: `${from.slice(0, 8)}${String(Number(from.slice(8)) + 2).padStart(2, '0')}T17:00` })], { calendar: cal });
      g.edit('a', 'start', day);
      const a = g.gantt.getTask(toTaskId('a'))!;
      const [s, e] = [normalizeDate(a.start, cal.timezone), normalizeDate(a.end, cal.timezone)];
      expect([s.toPlainDate().toString(), s.hour]).toEqual([day, 9]);
      expect([e.toPlainDate().toString(), e.hour, e.minute]).toEqual([endDay, 17, 0]);
      expect(differenceInWorkingHours(a.start, a.end, cal)).toBeCloseTo(24, 9);
      // an offset change happened inside the span
      expect(s.offsetNanoseconds).not.toBe(e.offsetNanoseconds);
    }
  });

  it('rejects a calendar with no working day', () => {
    const g = setup([t('a')], { calendar: CAL('UTC', { workingDays: [] }) });
    expect(g.plan('a', 'start', '2026-01-12').kind).toBe('error');
  });
});

describe('end', () => {
  it('snaps back to a working day, ends at the last working window and rewrites duration with the end', () => {
    const g = setup([t('a')], { calendar: CAL('UTC') });
    const p = g.edit('a', 'end', '2026-01-18'); // Sunday -> Friday the 16th
    expect(p.kind === 'write' && p.snapped).toBe('previous');
    const a = g.gantt.getTask(toTaskId('a'))!;
    expect(iso(g, a.end)).toContain('2026-01-16T17:00:00');
    // the invariant `resizeTask` documents: end = start + duration working hours
    expect(iso(g, a.end)).toBe(iso(g, addWorkingHours(a.start, a.duration!, g.cal)));
  });

  it('rejects an end that is not after the start, including one that snaps back before it', () => {
    const g = setup([t('a')], { calendar: CAL('UTC') });
    expect(g.plan('a', 'end', '2026-01-03')).toMatchObject({ kind: 'error', reason: 'end-before-start' });
    expect(g.plan('a', 'end', '2026-01-04')).toMatchObject({ kind: 'error', reason: 'end-before-start' }); // Sunday -> Friday the 2nd
    expect(g.updated).toHaveLength(0);
  });

  it('is a no-op when the working duration already matches', () => {
    const g = setup([t('a')], { calendar: CAL('UTC') });
    expect(g.plan('a', 'end', '2026-01-07').kind).toBe('noop');
  });
});

describe('duration and progress', () => {
  it('reads days as the calendar day length and hours as hours', () => {
    const days = setup([t('a')], { calendar: CAL('UTC') });
    days.edit('a', 'duration', '2.5');
    expect(days.gantt.getTask(toTaskId('a'))!.duration).toBe(20);
    const hours = setup([t('a')], { calendar: CAL('UTC') }, undefined, 'hours');
    hours.edit('a', 'duration', '20');
    expect(hours.gantt.getTask(toTaskId('a'))!.duration).toBe(20);
    // 20 working hours from Mon 09:00 end at 13:00 on Wednesday (8 + 8 + 4)
    expect(iso(hours, hours.gantt.getTask(toTaskId('a'))!.end)).toContain('2026-01-07T13:00:00');
  });

  it('a calendar with no working hours (or no working day) rejects a duration, without a write', () => {
    const g = setup([t('a')], { calendar: CAL('UTC', { workingHours: [{ start: '09:00', end: '09:00' }] }) });
    expect(g.plan('a', 'duration', '2')).toMatchObject({ kind: 'error', reason: 'rejected' });
    expect(g.updated).toHaveLength(0);
  });

  it('bounds duration and progress', () => {
    const g = setup([t('a')], { calendar: CAL('UTC') });
    expect(g.plan('a', 'duration', '3651')).toMatchObject({ kind: 'error', reason: 'out-of-range', max: 3650 });
    expect(g.plan('a', 'duration', '-1')).toMatchObject({ kind: 'error', reason: 'not-a-number' });
    expect(g.plan('a', 'progress', '150')).toMatchObject({ kind: 'error', reason: 'out-of-range', min: 0, max: 100 });
    expect(g.plan('a', 'progress', 'abc')).toMatchObject({ kind: 'error', reason: 'not-a-number' });
    g.edit('a', 'progress', '100%');
    expect(g.gantt.getTask(toTaskId('a'))!.progress).toBe(1);
    g.edit('a', 'progress', '0');
    expect(g.gantt.getTask(toTaskId('a'))!.progress).toBe(0);
  });

  it('a milestone has no end or duration, a summary has no rolled-up cell to edit', () => {
    const g = setup(
      [t('m', { type: 'milestone', end: '2026-01-05T09:00' }), t('s', { type: 'summary' }), t('c', { parent: toTaskId('s') })],
      { calendar: CAL('UTC') },
    );
    expect(g.plan('m', 'end', '2026-01-12').kind).toBe('error');
    expect(g.plan('m', 'duration', '2').kind).toBe('error');
    expect(g.plan('s', 'start', '2026-01-12').kind).toBe('error');
    expect(g.plan('s', 'progress', '50').kind).toBe('error');
    expect(g.plan('s', 'name', 'Group').kind).toBe('write'); // the name is always editable
    expect(g.plan('m', 'progress', '50').kind).toBe('write');
  });
});

describe('name and custom columns', () => {
  it('strips controls and bidi overrides, trims, and rejects empty and over-long names', () => {
    const g = setup([t('a')]);
    expect(g.plan('a', 'name', '  x‮y\u0000z\n ')).toMatchObject({ kind: 'write', input: 'xyz' });
    expect(g.plan('a', 'name', '   ')).toMatchObject({ kind: 'error', reason: 'empty' });
    expect(g.plan('a', 'name', 'x'.repeat(1001))).toMatchObject({ kind: 'error', reason: 'too-long' });
  });

  const editor = (extra: Record<string, unknown> = {}) =>
    [{ id: 'name' }, { id: 'owner', header: 'Owner', value: (x: { name: string }) => x.name, editor: { type: 'text', commit: (v: string) => ({ name: v }), ...extra } }] as unknown as GridColumnInput[];

  it('maps the input through commit() into ONE updateTask', () => {
    const g = setup([t('a')], {}, editor());
    g.edit('a', 'owner', 'Ann');
    expect(g.gantt.getTask(toTaskId('a'))!.name).toBe('Ann');
    expect(g.updated).toHaveLength(1);
    g.gantt.undo();
    expect(g.gantt.canUndo()).toBe(false);
  });

  it('allows name, start, end, duration and progress only; anything else is rejected and nothing is written', () => {
    for (const patch of [
      '{"id":"x","name":"Safe"}',
      '{"createdAt":1}',
      '{"__proto__":{"polluted":1},"name":"Safe"}',
      '{"meta":{"a":1}}',
      '{"color":"url(javascript:alert(1))"}',
      '{"parent":"a"}',
      '{"type":"summary"}',
      '{"notes":"x"}',
      '{"extra":1}',
    ]) {
      const g = setup([t('a')], {}, editor({ commit: () => JSON.parse(patch) }));
      const before = snap(g, 'a');
      expect(g.edit('a', 'owner', 'v'), patch).toMatchObject({ kind: 'error', reason: 'rejected' });
      expect(snap(g, 'a')).toEqual(before);
      expect(g.updated).toHaveLength(0);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(setup([t('a')], {}, editor({ commit: () => [1] })).plan('a', 'owner', 'v')).toMatchObject({ kind: 'error' });
    expect(setup([t('a')], {}, editor({ commit: () => null })).plan('a', 'owner', 'v')).toMatchObject({ kind: 'error' });
  });

  it('runs the built-in validators on each allowed field', () => {
    const run = (patch: object) => setup([t('a')], {}, editor({ commit: () => patch })).plan('a', 'owner', 'v');
    // name: cleaned, 500 characters at most
    expect(run({ name: ' x‮y ' })).toMatchObject({ kind: 'write', patch: { name: 'xy' } });
    expect(run({ name: 'x'.repeat(501) })).toMatchObject({ kind: 'error', reason: 'too-long' });
    expect(run({ name: '  ' })).toMatchObject({ kind: 'error', reason: 'empty' });
    expect(run({ name: 5 })).toMatchObject({ kind: 'error', reason: 'rejected' });
    // dates: 1900..2200, end after start
    expect(run({ start: '3000-01-05' })).toMatchObject({ kind: 'error', reason: 'not-a-date' });
    expect(run({ start: '1800-01-05' })).toMatchObject({ kind: 'error', reason: 'not-a-date' });
    expect(run({ start: 'not a date' })).toMatchObject({ kind: 'error', reason: 'rejected' });
    expect(run({ end: '2026-01-02T09:00:00+00:00[UTC]' })).toMatchObject({ kind: 'error', reason: 'end-before-start' });
    expect(run({ start: '2026-02-02T09:00:00+00:00[UTC]' })).toMatchObject({ kind: 'error', reason: 'end-before-start' });
    expect(run({ start: '2026-01-05T09:00:00+00:00[UTC]', end: '2026-01-09T17:00:00+00:00[UTC]' })).toMatchObject({ kind: 'write' });
    // duration: finite, in range
    for (const duration of [Number.NaN, -1, Infinity, 87_601, '8']) expect(run({ duration }), String(duration)).toMatchObject({ kind: 'error' });
    expect(run({ duration: 16 })).toMatchObject({ kind: 'write' });
    // progress is a fraction
    for (const progress of [Number.NaN, -0.1, 1.5, 50, '1']) expect(run({ progress }), String(progress)).toMatchObject({ kind: 'error' });
    expect(run({ progress: 0.5 })).toMatchObject({ kind: 'write' });
  });

  it('shows a returned error capped, treats a throw as a generic rejection, and checks number bounds first', () => {
    expect(setup([t('a')], {}, editor({ commit: () => ({ error: 'e'.repeat(500) }) })).plan('a', 'owner', 'v')).toMatchObject({ kind: 'error', message: 'e'.repeat(200) });
    expect(setup([t('a')], {}, editor({ commit: () => { throw new Error('boom'); } })).plan('a', 'owner', 'v')).toMatchObject({ kind: 'error', reason: 'rejected' });
    const num = [{ id: 'name' }, { id: 'n', header: 'N', value: () => 1, editor: { type: 'number', min: 1, max: 5, commit: (v: number) => ({ duration: v }) } }] as unknown as GridColumnInput[];
    const g = setup([t('a')], {}, num);
    expect(g.plan('a', 'n', '9')).toMatchObject({ kind: 'error', reason: 'out-of-range', min: 1, max: 5 });
    expect(g.plan('a', 'n', '3')).toMatchObject({ kind: 'write', input: 3 });
    // without a max a number is capped at 1e15 before it reaches commit()
    const open = [{ id: 'name' }, { id: 'n', header: 'N', value: () => 1, editor: { type: 'number', commit: (v: number) => ({ duration: v }) } }] as unknown as GridColumnInput[];
    expect(setup([t('a')], {}, open).plan('a', 'n', '9'.repeat(33))).toMatchObject({ kind: 'error', reason: 'too-long' });
    expect(setup([t('a')], {}, open).plan('a', 'n', '9'.repeat(18))).toMatchObject({ kind: 'error', reason: 'out-of-range' });
  });

  it('date editors hand the commit an ISO string', () => {
    let seen: unknown;
    const cols = [{ id: 'name' }, { id: 'due', header: 'Due', value: () => '', editor: { type: 'date', commit: (v: string) => ((seen = v), { start: v }) } }] as unknown as GridColumnInput[];
    setup([t('a')], {}, cols).plan('a', 'due', '2026-02-03');
    expect(seen).toBe('2026-02-03');
  });

  it('a name that is only different by controls or padding is a no-op', () => {
    const g = setup([t('a', { name: '  Padded\u0000 ' })]);
    expect(g.plan('a', 'name', 'Padded')).toEqual({ kind: 'noop' });
  });

  it('the patch of a duration edit is computed only when asked for', () => {
    const g = setup([t('a')], { calendar: CAL('UTC') });
    const p = g.plan('a', 'duration', '2');
    expect(p.kind).toBe('write');
    if (p.kind === 'write') expect(p.patch).toMatchObject({ duration: 16 });
  });
});

describe('properties', () => {
  const calArb = fc.record({
    tz: fc.constantFrom('UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'),
    days: fc.subarray(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const, { minLength: 3 }),
    windows: fc.constantFrom([{ start: '09:00', end: '17:00' }], [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:30' }]),
    holidays: fc.array(fc.integer({ min: 0, max: 330 }).map((d) => new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10)), { maxLength: 6 }),
  });
  const day = fc.integer({ min: 0, max: 330 }).map((d) => new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10));

  it('every write is exactly one undo entry and one task:updated, in any calendar, on any day', () => {
    fc.assert(
      fc.property(calArb, day, fc.constantFrom('start', 'end'), (c, d, col) => {
        const calendar = CAL(c.tz, { workingDays: [...c.days], workingHours: c.windows.map((w) => ({ ...w })), holidays: c.holidays });
        const g = setup([t('a', { start: '2026-01-05T09:00', end: '2026-01-08T16:00' })], { calendar });
        const p = g.edit('a', col, d);
        if (p.kind !== 'write') return;
        expect(g.updated).toHaveLength(1);
        g.gantt.undo();
        expect(g.gantt.canUndo()).toBe(false);
      }),
      { numRuns: 30 },
    );
  });

  it('start edit then undo is the identity, redo restores the edit', () => {
    fc.assert(
      fc.property(calArb, day, (c, d) => {
        const calendar = CAL(c.tz, { workingDays: [...c.days], workingHours: c.windows.map((w) => ({ ...w })), holidays: c.holidays });
        const g = setup([t('a', { start: '2026-01-05T09:00', end: '2026-01-08T16:00' })], { calendar });
        const before = snap(g, 'a');
        const p = g.edit('a', 'start', d);
        if (p.kind !== 'write') return;
        const after = snap(g, 'a');
        g.gantt.undo();
        expect(snap(g, 'a')).toEqual(before);
        g.gantt.redo();
        expect(snap(g, 'a')).toEqual(after);
      }),
      { numRuns: 30 },
    );
  });

  it("an end edit leaves end = start + duration working hours and never an end before the start", () => {
    fc.assert(
      fc.property(calArb, day, (c, d) => {
        const calendar = CAL(c.tz, { workingDays: [...c.days], workingHours: c.windows.map((w) => ({ ...w })), holidays: c.holidays });
        const g = setup([t('a', { start: '2026-01-05T09:00', end: '2026-01-08T16:00' })], { calendar });
        const p = g.edit('a', 'end', d);
        if (p.kind !== 'write') return;
        const a = g.gantt.getTask(toTaskId('a'))!;
        expect(normalizeDate(a.end, c.tz).epochNanoseconds > normalizeDate(a.start, c.tz).epochNanoseconds).toBe(true);
        expect(normalizeDate(a.end, c.tz).epochNanoseconds).toBe(addWorkingHours(a.start, a.duration!, calendar).epochNanoseconds);
      }),
      { numRuns: 30 },
    );
  });

  it('a start edit keeps the working duration', () => {
    fc.assert(
      fc.property(calArb, day, (c, d) => {
        const calendar = CAL(c.tz, { workingDays: [...c.days], workingHours: c.windows.map((w) => ({ ...w })), holidays: c.holidays });
        const g = setup([t('a', { start: '2026-01-05T09:00', end: '2026-01-08T16:00' })], { calendar });
        const a0 = g.gantt.getTask(toTaskId('a'))!;
        const h0 = differenceInWorkingHours(a0.start, a0.end, calendar);
        const p = g.edit('a', 'start', d);
        if (p.kind !== 'write') return;
        const a = g.gantt.getTask(toTaskId('a'))!;
        expect(differenceInWorkingHours(a.start, a.end, calendar)).toBeCloseTo(h0, 6);
      }),
      { numRuns: 30 },
    );
  });
});
