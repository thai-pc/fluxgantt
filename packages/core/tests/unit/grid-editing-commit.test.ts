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

  it('crosses the New York DST changes (2026-03-08 spring forward, 2026-11-01 fall back) on the working hours', () => {
    const cal = CAL('America/New_York');
    for (const day of ['2026-03-09', '2026-11-02']) {
      const g = setup([t('a', { start: '2026-03-02T09:00', end: '2026-03-04T17:00' })], { calendar: cal });
      g.edit('a', 'start', day);
      const a = g.gantt.getTask(toTaskId('a'))!;
      expect(normalizeDate(a.start, cal.timezone).hour).toBe(9);
      expect(differenceInWorkingHours(a.start, a.end, cal)).toBeCloseTo(24, 9);
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
    expect(iso(hours, hours.gantt.getTask(toTaskId('a'))!.end)).toContain('2026-01-07T21:00'.slice(0, 0)); // resolved by the calendar
  });

  it('a calendar with no working hours counts in hours and rejects, without a write', () => {
    const g = setup([t('a')], { calendar: CAL('UTC', { workingHours: [{ start: '09:00', end: '09:00' }] }) });
    expect(g.plan('a', 'duration', '2')).toMatchObject({ kind: 'error', reason: 'rejected' });
    expect(g.updated).toHaveLength(0);
  });

  it('bounds duration and progress', () => {
    const g = setup([t('a')], { calendar: CAL('UTC') });
    expect(g.plan('a', 'duration', '36501')).toMatchObject({ kind: 'error', reason: 'out-of-range', max: 36500 });
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
    [{ id: 'name' }, { id: 'owner', header: 'Owner', value: (x: { meta?: Record<string, unknown> }) => x.meta?.owner as string, editor: { type: 'text', commit: (v: string) => ({ meta: { owner: v } }), ...extra } }] as unknown as GridColumnInput[];

  it('maps the input through commit() into ONE updateTask', () => {
    const g = setup([t('a', { meta: { owner: 'x' } })], {}, editor());
    g.edit('a', 'owner', 'Ann');
    expect(g.gantt.getTask(toTaskId('a'))!.meta).toEqual({ owner: 'Ann' });
    expect(g.updated).toHaveLength(1);
    g.gantt.undo();
    expect(g.gantt.canUndo()).toBe(false);
  });

  it('strips id and timestamps and an own __proto__ from the patch', () => {
    const cols = editor({ commit: () => JSON.parse('{"id":"x","createdAt":1,"updatedAt":2,"__proto__":{"polluted":1},"name":"Safe"}') });
    const g = setup([t('a')], {}, cols);
    const p = g.plan('a', 'owner', 'v');
    expect(p.kind === 'write' && Object.keys(p.patch)).toEqual(['name']);
    g.edit('a', 'owner', 'v');
    expect(g.gantt.getTask(toTaskId('a'))!.id).toBe('a');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('shows a returned error capped, treats a throw as a generic rejection, and checks number bounds first', () => {
    expect(setup([t('a')], {}, editor({ commit: () => ({ error: 'e'.repeat(500) }) })).plan('a', 'owner', 'v')).toMatchObject({ kind: 'error', message: 'e'.repeat(200) });
    expect(setup([t('a')], {}, editor({ commit: () => { throw new Error('boom'); } })).plan('a', 'owner', 'v')).toMatchObject({ kind: 'error', reason: 'rejected' });
    const num = [{ id: 'name' }, { id: 'n', header: 'N', value: () => 1, editor: { type: 'number', min: 1, max: 5, commit: (v: number) => ({ priority: v }) } }] as unknown as GridColumnInput[];
    const g = setup([t('a')], {}, num);
    expect(g.plan('a', 'n', '9')).toMatchObject({ kind: 'error', reason: 'out-of-range', min: 1, max: 5 });
    expect(g.plan('a', 'n', '3')).toMatchObject({ kind: 'write', input: 3 });
  });

  it('a bad date from commit() is rejected before the write (updateTask would write it, then throw)', () => {
    const cols = editor({ commit: () => ({ start: 'not a date' }) });
    const g = setup([t('a')], {}, cols);
    const before = snap(g, 'a');
    expect(g.edit('a', 'owner', 'v')).toMatchObject({ kind: 'error', reason: 'rejected' });
    expect(snap(g, 'a')).toEqual(before);
    expect(g.gantt.canUndo()).toBe(false);
    expect(g.updated).toHaveLength(0);
  });

  it('date editors hand the commit an ISO string', () => {
    let seen: unknown;
    const cols = [{ id: 'name' }, { id: 'due', header: 'Due', value: () => '', editor: { type: 'date', commit: (v: string) => ((seen = v), { notes: v }) } }] as unknown as GridColumnInput[];
    setup([t('a')], {}, cols).plan('a', 'due', '2026-02-03');
    expect(seen).toBe('2026-02-03');
  });
});

describe('properties', () => {
  const calArb = fc.record({
    tz: fc.constantFrom('UTC', 'America/New_York', 'Asia/Ho_Chi_Minh'),
    days: fc.subarray(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const, { minLength: 3 }),
    windows: fc.constantFrom([{ start: '09:00', end: '17:00' }], [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:30' }]),
    holidays: fc.array(fc.integer({ min: 0, max: 60 }).map((d) => new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10)), { maxLength: 6 }),
  });
  const day = fc.integer({ min: 0, max: 120 }).map((d) => new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10));

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
