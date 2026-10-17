// Headless (Node, no DOM) guarantees of `rtl` (spec-rtl-chart.md AC9): the option and the mixin are
// inert without a mount, and the State and Compute layers have no RTL knowledge at all.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createGantt } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withRtl } from '../../src/rtl/mixin.js';
import { toTaskId } from '../../src/types.js';

const tasks = [{ id: toTaskId('a'), name: 'a', start: '2026-01-05', end: '2026-01-09', progress: 0, type: 'task' as const }];

describe('headless rtl', () => {
  it('runs in Node without a DOM and does not throw (with and without withRender)', () => {
    expect(typeof document).toBe('undefined');
    const bare = withRtl(createGantt({ tasks, rtl: true }));
    expect(bare.getTasks()).toHaveLength(1);
    const rendered = withRtl(withRender(createGantt({ tasks, rtl: true })));
    expect(rendered.getTasks()).toHaveLength(1);
    rendered.unmount(); // no mount, still fine
    expect(() => rendered.destroy()).not.toThrow();
    expect(() => bare.destroy()).not.toThrow();
  });

  it('computes the same critical path with rtl true or false', () => {
    const deps = [{ from: toTaskId('a'), to: toTaskId('b'), type: 'FS' as const }];
    const two = [...tasks, { id: toTaskId('b'), name: 'b', start: '2026-01-12', end: '2026-01-14', progress: 0, type: 'task' as const }];
    const a = createGantt({ tasks: two, dependencies: deps });
    const b = withRtl(createGantt({ tasks: two, dependencies: deps, rtl: true }));
    expect(b.computeCriticalPath()).toEqual(a.computeCriticalPath());
  });

  it('store/ and compute/ mention no RTL (AC9)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
      });
    const root = join(__dirname, '../../src');
    for (const dir of ['store', 'compute']) {
      for (const file of walk(join(root, dir))) {
        expect(readFileSync(file, 'utf8'), file).not.toMatch(/\brtl\b|mirrorX/i);
      }
    }
    expect(readFileSync(join(root, 'render/renderer-base.ts'), 'utf8')).not.toMatch(/\brtl\b|mirrorX/i);
  });
});
