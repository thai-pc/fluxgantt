// Headless (node env) tests for `withViewport()` (spec-viewport-api.md §9.1): nothing here needs a
// DOM, which is itself the point — `setDensity` must be safe before mount, and the scroll methods
// must degrade to `false` rather than throw.
import { describe, it, expect } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withResponsive } from '../../src/responsive/mixin.js';
import { withViewport } from '../../src/viewport/mixin.js';
import { getInternal } from '../../src/gantt-internal.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const T1 = toTaskId('t1');
const TASKS: readonly TaskInput[] = [
  { id: T1, name: 'One', start: '2026-01-05', end: '2026-01-09', progress: 0, type: 'task' },
];

function make(config: Parameters<typeof createGantt>[0] = { tasks: TASKS }) {
  return withViewport(createGantt(config));
}

describe('withViewport (headless)', () => {
  it('scrollToTask / scrollToDate return false when unmounted, without throwing', () => {
    const g = make();
    expect(g.scrollToTask(T1)).toBe(false);
    expect(g.scrollToDate('2026-01-06')).toBe(false);
  });

  it('scrollToTask throws on an unknown id', () => {
    expect(() => make().scrollToTask(toTaskId('nope'))).toThrow();
  });

  it('all three methods throw after destroy()', () => {
    const g = make();
    g.destroy();
    expect(() => g.scrollToTask(T1)).toThrow();
    expect(() => g.scrollToDate('2026-01-06')).toThrow();
    expect(() => g.setDensity('compact')).toThrow();
  });

  it.each(['bogus', 'constructor', '__proto__', undefined, 3, null])(
    'setDensity rejects the invalid value %s',
    (bad) => {
      const g = make();
      expect(() => g.setDensity(bad as never)).toThrow(/invalid density/);
    },
  );

  it('setDensity emits viewport:changed with { viewMode, density } and stores the slot', () => {
    const g = make({ tasks: TASKS, viewMode: 'month' });
    const seen: unknown[] = [];
    g.on('viewport:changed', (p) => seen.push(p));
    g.setDensity('compact');
    expect(seen).toEqual([{ viewMode: 'month', density: 'compact' }]);
    expect(getInternal(g).density).toBe('compact');
    expect(getInternal(g).densityPinned).toBe(true);
  });

  it('an equal-to-current call emits nothing but still pins', () => {
    const g = make();
    const seen: unknown[] = [];
    g.on('viewport:changed', (p) => seen.push(p));
    g.setDensity('default');
    expect(seen).toEqual([]);
    expect(getInternal(g).densityPinned).toBe(true);
    expect(getInternal(g).density).toBeUndefined();
  });

  it('zoomTo still emits exactly { viewMode } (no density key)', () => {
    const g = make();
    const seen: object[] = [];
    g.on('viewport:changed', (p) => seen.push(p));
    g.zoomTo('month');
    expect(seen).toEqual([{ viewMode: 'month' }]);
    expect('density' in seen[0]!).toBe(false);
  });

  it('is not gated by readOnly and is not an undo step', () => {
    const g = make({ tasks: TASKS, readOnly: true });
    expect(() => g.setDensity('comfortable')).not.toThrow();
    expect(g.canUndo()).toBe(false);
  });

  it('mixin application order is irrelevant', () => {
    const a = withViewport(withResponsive(withRender(createGantt({ tasks: TASKS }))));
    const b = withResponsive(withRender(withViewport(createGantt({ tasks: TASKS }))));
    for (const g of [a, b]) {
      g.setDensity('compact');
      expect(getInternal(g).density).toBe('compact');
    }
  });
});
