// @vitest-environment jsdom
//
// Property-based tests (fast-check) for the vertical `scrollToTask` math under the pinned SVG
// header: the row band is `clientHeight - 32` and `scrollTop = row.y` puts a row directly under
// the band, so a row that fits ends up fully inside `[scrollTop, scrollTop + viewH]`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withViewport } from '../../src/viewport/mixin.js';
import { ROW_HEIGHT } from '../../src/render/renderer-base.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const HEADER = 32;
const ROWS = 120;
const ROW_H = ROW_HEIGHT.default;
const ALIGNS = ['nearest', 'start', 'center', 'end'] as const;

const tasks: TaskInput[] = Array.from({ length: ROWS }, (_, i) => ({
  id: toTaskId(`t${i}`),
  name: `Task ${i}`,
  start: '2026-01-05',
  end: '2026-01-09',
  progress: 0,
  type: 'task' as const,
}));

let container: HTMLElement;
let top = 0;
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
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
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
