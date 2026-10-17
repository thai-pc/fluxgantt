// @vitest-environment jsdom
//
// Property-based tests (fast-check) for the vertical `scrollToTask` math under the pinned SVG
// header: the row band is `clientHeight - 32` and `scrollTop = row.y` puts a row directly under
// the band, so a row that fits ends up fully inside `[scrollTop, scrollTop + viewH]`. The horizontal
// block does the same for the pinned label column: the free area is `clientWidth - labelW`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { Temporal } from '@js-temporal/polyfill';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withViewport } from '../../src/viewport/mixin.js';
import { ROW_HEIGHT } from '../../src/render/renderer-base.js';
import { getInternal } from '../../src/gantt-internal.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const HEADER = 32;
const ROWS = 120;
const ROW_H = ROW_HEIGHT.default;
const ALIGNS = ['nearest', 'start', 'center', 'end'] as const;

const tasks: TaskInput[] = Array.from({ length: ROWS }, (_, i) => ({
  id: toTaskId(`t${i}`),
  name: `Task ${i}`,
  // Staggered so the horizontal properties see bars at very different x.
  start: Temporal.PlainDate.from('2026-01-05').add({ days: i * 3 }).toString(),
  end: Temporal.PlainDate.from('2026-01-09').add({ days: i * 3 }).toString(),
  progress: 0,
  type: 'task' as const,
}));

let container: HTMLElement;
let top = 0;
let left = 0;
let width = 800;
let height = 400;
let gantt: ReturnType<typeof makeGantt>;

function makeGantt() {
  return withViewport(withRender(createGantt({ tasks })));
}

beforeAll(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  gantt = makeGantt();
  gantt.mount(container);
  Object.defineProperty(container, 'clientWidth', { get: () => width, configurable: true });
  Object.defineProperty(container, 'scrollLeft', {
    get: () => left,
    set: (v: number) => {
      left = v;
    },
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', { get: () => height, configurable: true });
  Object.defineProperty(container, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = v;
    },
    configurable: true,
  });
});
afterAll(() => {
  gantt.destroy();
  container.remove();
});

const rowArb = fc.integer({ min: 0, max: ROWS - 1 });
// Tall enough that a 32px row always fits the band (viewH >= ROW_H).
const heightArb = fc.integer({ min: HEADER + ROW_H, max: 1200 });
const alignArb = fc.constantFrom(...ALIGNS);

describe('scrollToTask vertical math (pinned header)', () => {
  it('never writes a negative scrollTop and a row that fits ends fully inside the row band', () => {
    fc.assert(
      fc.property(rowArb, heightArb, alignArb, fc.integer({ min: 0, max: 4000 }), (row, h, align, start) => {
        height = h;
        top = start;
        gantt.scrollToTask(toTaskId(`t${row}`), { align });
        const viewH = h - HEADER;
        const rowTop = row * ROW_H;
        expect(top).toBeGreaterThanOrEqual(0);
        expect(rowTop).toBeGreaterThanOrEqual(top);
        expect(rowTop + ROW_H).toBeLessThanOrEqual(top + viewH);
      }),
      { numRuns: 150 },
    );
  });

  it('start puts the row top exactly at scrollTop (directly under the band)', () => {
    fc.assert(
      fc.property(rowArb, heightArb, (row, h) => {
        height = h;
        top = 0;
        gantt.scrollToTask(toTaskId(`t${row}`), { align: 'start' });
        expect(top).toBe(row * ROW_H);
      }),
      { numRuns: 100 },
    );
  });

  it('nearest is a no-op when the row is already visible', () => {
    fc.assert(
      fc.property(rowArb, heightArb, fc.integer({ min: 0, max: 4000 }), (row, h, start) => {
        const viewH = h - HEADER;
        const rowTop = row * ROW_H;
        fc.pre(rowTop >= start && rowTop + ROW_H <= start + viewH);
        height = h;
        top = start;
        gantt.scrollToTask(toTaskId(`t${row}`), { align: 'nearest' });
        expect(top).toBe(start);
      }),
      { numRuns: 150 },
    );
  });
});

describe('scrollToTask horizontal math (pinned label column)', () => {
  const LABEL_W = 160;
  const d = (id: string): { d0: number; d1: number } => {
    const scale = getInternal(gantt).mountOf()!.handle.getTimeScale();
    const t = gantt.getTask(toTaskId(id))!;
    return { d0: scale.dateToX(t.start), d1: scale.dateToX(t.end) };
  };
  const widthArb = fc.integer({ min: LABEL_W + 120, max: 1600 });

  it('a bar that fits lands fully inside the free area [labelW, clientWidth] and never at a negative offset', () => {
    fc.assert(
      fc.property(rowArb, widthArb, alignArb, fc.integer({ min: 0, max: 6000 }), (row, w, align, start) => {
        const { d0, d1 } = d(`t${row}`);
        fc.pre(d1 - d0 <= w - LABEL_W);
        width = w;
        height = 400;
        left = start;
        gantt.scrollToTask(toTaskId(`t${row}`), { align });
        expect(left).toBeGreaterThanOrEqual(0);
        const screen0 = LABEL_W + d0 - left;
        const screen1 = LABEL_W + d1 - left;
        // Clamped at 0, an `end`/`center` target near the chart start can leave slack on the left.
        if (left > 0) {
          expect(screen0).toBeGreaterThanOrEqual(LABEL_W - 1e-6);
          expect(screen1).toBeLessThanOrEqual(w + 1e-6);
        } else {
          expect(screen1).toBeLessThanOrEqual(w + 1e-6);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('nearest is a no-op when the bar is already inside the free area, not merely the container', () => {
    fc.assert(
      fc.property(rowArb, widthArb, fc.integer({ min: 0, max: 6000 }), (row, w, start) => {
        const { d0, d1 } = d(`t${row}`);
        fc.pre(d0 >= start && d1 <= start + (w - LABEL_W));
        width = w;
        left = start;
        gantt.scrollToTask(toTaskId(`t${row}`), { align: 'nearest' });
        expect(left).toBe(start);
      }),
      { numRuns: 150 },
    );
  });

  it('start puts the bar edge exactly at the column edge (or 0 when it cannot go further)', () => {
    fc.assert(
      fc.property(rowArb, widthArb, (row, w) => {
        const { d0 } = d(`t${row}`);
        width = w;
        left = 0;
        gantt.scrollToTask(toTaskId(`t${row}`), { align: 'start' });
        expect(left).toBe(Math.max(0, d0));
      }),
      { numRuns: 100 },
    );
  });
});
