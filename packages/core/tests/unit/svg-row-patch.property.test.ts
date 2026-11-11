// @vitest-environment jsdom
//
// Property test for the SVG row patch (spec-svg-row-patch.md section 8): after EVERY operation of a
// random sequence, the live DOM equals what a forced full repaint (`refresh()`) produces, there is
// at most one tab stop, and the `aria-selected` rows are exactly the visible selected ids. Run once
// LTR and once with `rtl: true` (where the patched rows must also come back mirrored).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../helpers/create-gantt.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { computeRollup } from '../../src/compute/rollup.js';
import { toTaskId, type ViewMode } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const MODES: ViewMode[] = ['day', 'week', 'month'];

type Op =
  | { k: 'select'; i: number; j: number }
  | { k: 'selectAll' }
  | { k: 'deselect' }
  | { k: 'key'; key: 'ArrowDown' | 'ArrowUp'; shift: boolean }
  | { k: 'collapse'; i: number }
  | { k: 'update'; i: number; days: number }
  | { k: 'rename'; i: number }
  | { k: 'add'; parent: number | null }
  | { k: 'remove'; i: number }
  | { k: 'zoom'; m: number }
  | { k: 'refresh' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ k: fc.constant('select' as const), i: fc.nat(11), j: fc.nat(11) }) },
  { weight: 1, arbitrary: fc.constant<Op>({ k: 'selectAll' }) },
  { weight: 1, arbitrary: fc.constant<Op>({ k: 'deselect' }) },
  { weight: 5, arbitrary: fc.record({ k: fc.constant('key' as const), key: fc.constantFrom('ArrowDown' as const, 'ArrowUp' as const), shift: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('collapse' as const), i: fc.nat(11) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('update' as const), i: fc.nat(11), days: fc.integer({ min: 0, max: 6 }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('rename' as const), i: fc.nat(11) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('add' as const), parent: fc.option(fc.nat(11), { nil: null }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('remove' as const), i: fc.nat(11) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('zoom' as const), m: fc.nat(2) }) },
  { weight: 1, arbitrary: fc.constant<Op>({ k: 'refresh' }) },
);

const projectArb = fc.record({
  // parent[i] < i (or none) keeps the hierarchy acyclic.
  parents: fc.array(fc.option(fc.nat(11), { nil: null }), { minLength: 3, maxLength: 12 }),
  days: fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 12, maxLength: 12 }),
  starts: fc.array(fc.integer({ min: 0, max: 8 }), { minLength: 12, maxLength: 12 }),
  deps: fc.array(fc.tuple(fc.nat(11), fc.nat(11)), { maxLength: 6 }),
  ops: fc.array(opArb, { minLength: 1, maxLength: 25 }),
});

const day = (n: number): string => `2026-01-${String(5 + n).padStart(2, '0')}`;

let container: HTMLElement;
beforeEach(() => {
  vi.setSystemTime(new Date('2035-01-01T00:00:00Z')); // today rule out of range: renders are repeatable
  container = document.createElement('div');
  document.body.appendChild(container);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Project = typeof projectArb extends fc.Arbitrary<infer T> ? T : never;

function run(p: Project, rtl: boolean): void {
  const n = p.parents.length;
  const ids = Array.from({ length: n }, (_, i) => toTaskId(`t${i}`));
  const tasks: TaskInput[] = ids.map((id, i) => {
    const par = p.parents[i];
    const parent = par !== null && par !== undefined && par % n < i ? ids[par % n] : undefined;
    return {
      id,
      name: `Task ${i}`,
      start: `${day(p.starts[i]!)}T09:00`,
      end: `${day(p.starts[i]! + p.days[i]!)}T17:00`,
      progress: (i % 4) / 4,
      type: i % 5 === 4 ? 'milestone' : 'task',
      ...(parent ? { parent } : {}),
    };
  });
  const g0 = createGantt({ tasks, rollup: computeRollup, ...(rtl ? { rtl: true } : {}) });
  const gantt = rtl ? withRtl(g0) : g0;
  for (const [a, b] of p.deps) {
    if (a % n < b % n) {
      try { gantt.linkTasks(ids[a % n]!, ids[b % n]!, 'FS'); } catch { /* cycle or duplicate: not under test */ }
    }
  }
  gantt.mount(container);

  let fullRenders = 0;
  const realAppend = Element.prototype.append;
  const appendSpy = vi.spyOn(Element.prototype, 'append').mockImplementation(function (this: Element, ...nodes: Array<Node | string>) {
    if (this.classList.contains('fg-timeline') && (nodes[0] as Element | undefined)?.nodeName === 'defs') fullRenders++;
    realAppend.apply(this, nodes);
  });

  try {
    let counter = 0;
    const live = (i: number) => {
      const all = gantt.getTasks();
      return all[i % all.length];
    };
    const log: string[] = [];
    for (const op of p.ops) {
      log.push(JSON.stringify(op));
        const before = fullRenders;
      let selectionOnly = false;
      switch (op.k) {
        case 'select': {
          const all = gantt.getTasks();
          if (all.length === 0) break;
          const a = op.i % all.length;
          const b = op.j % all.length;
          gantt.select(a === b ? all[a]!.id : [all[a]!.id, all[b]!.id]);
          selectionOnly = true;
          break;
        }
        case 'selectAll': gantt.selectAll(); selectionOnly = true; break;
        case 'deselect': gantt.deselect(); selectionOnly = true; break;
        case 'key': {
          const target = container.querySelector('[role=row][tabindex="0"]') ?? container.querySelector('svg.fg-timeline');
          target?.dispatchEvent(new KeyboardEvent('keydown', { key: op.key, shiftKey: op.shift, bubbles: true, cancelable: true }));
          selectionOnly = true;
          break;
        }
        case 'collapse': { const t = live(op.i); if (t) gantt.toggleCollapse(t.id); break; }
        case 'update': { const t = live(op.i); if (t) gantt.updateTask(t.id, { end: `${day(op.days + 6)}T17:00`, start: `${day(6)}T09:00` }); break; }
        case 'rename': { const t = live(op.i); if (t) gantt.updateTask(t.id, { name: `renamed ${counter++}` }); break; }
        case 'add': {
          const all = gantt.getTasks();
          const parent = op.parent !== null && all.length > 0 ? all[op.parent % all.length]!.id : undefined;
          gantt.addTask({ id: toTaskId(`n${counter++}`), name: `New ${counter}`, start: '2026-01-06T09:00', end: '2026-01-08T17:00', progress: 0, type: 'task', ...(parent ? { parent } : {}) });
          break;
        }
        case 'remove': { const t = live(op.i); if (t && gantt.getTasks().length > 1) gantt.removeTask(t.id); break; }
        case 'zoom': gantt.zoomTo(MODES[op.m]!); break;
        case 'refresh': gantt.refresh(); break;
      }
      const renderedByOp = fullRenders - before;
      // Selection and keyboard operations never rebuild the chart; data operations may (a removal that
      // also drops dependencies is more than one store revision), and the oracle below checks the result.
      if (selectionOnly) expect(renderedByOp, `full renders for ${log.join(' ')}`).toBe(0);

      const html = container.innerHTML;
      const tabStops = container.querySelectorAll('svg.fg-timeline [role=row][tabindex="0"]').length;
      expect(tabStops, `tab stops after ${log.join(' ')}`).toBeLessThanOrEqual(1);
      const rowIds = new Set([...container.querySelectorAll('svg.fg-timeline [role=row]')].map((r) => r.getAttribute('data-task-id')));
      const painted = [...container.querySelectorAll('svg.fg-timeline [role=row][aria-selected="true"]')].map((r) => r.getAttribute('data-task-id')).sort();
      const expected = gantt.getSelection().filter((id) => rowIds.has(id)).sort();
      expect(painted, `selected rows after ${log.join(' ')}`).toEqual(expected);

      gantt.refresh(); // the oracle: a forced full repaint
      // Pre-existing on master (verified against it): a key press moves the keyboard's own focus without
      // always changing the selection (Shift+Arrow inside a range, ArrowUp onto the only selected row),
      // so no repaint follows and the roving `tabindex` lags until the next render. A patch preserves
      // that on purpose, so the roving `tabindex` is not compared after a key press (the one-tab-stop
      // bound above still is); every other attribute still is.
      const norm = (h: string): string => (op.k === 'key' ? h.replace(/ tabindex="-?\d"/g, '') : h);
      expect(norm(container.innerHTML), `patched DOM differs from a full render after ${log.join(' ')}`).toBe(norm(html));
    }
  } finally {
    appendSpy.mockRestore();
    gantt.unmount();
  }
}

describe('row patch equals a full render over random operation sequences', () => {
  it('LTR', () => {
    fc.assert(fc.property(projectArb, (p) => { container.replaceChildren(); run(p, false); }), { numRuns: Number(process.env.FC_RUNS ?? 100), seed: 20261111 });
  }, 280_000);
  it('RTL', () => {
    fc.assert(fc.property(projectArb, (p) => { container.replaceChildren(); run(p, true); }), { numRuns: Number(process.env.FC_RUNS ?? 100), seed: 20261112 });
  }, 280_000);
});
