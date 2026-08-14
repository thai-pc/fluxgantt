// @vitest-environment jsdom
//
// DOM + security tests for the SVG renderer (spec-svg-renderer.md §9.2, decisions Q3/Q6).
// Runs under jsdom (per-file override; the rest of core stays `environment: 'node'`).
// Visual regression (§9.3) and Playwright axe a11y (§9.4) are a separate follow-up
// ticket (spec §11 Q6) and intentionally NOT here.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { computeCriticalPath } from '../../src/compute/critical-path.js';
import { DEFAULT_CALENDAR } from '../../src/compute/working-calendar.js';
import { toTaskId, toDependencyId, type Task, type Dependency } from '../../src/types.js';

const cal = DEFAULT_CALENDAR;

function task(id: string, start: string, end: string, extra: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: toTaskId(id),
    name: id,
    start,
    end,
    progress: 0.5,
    type: 'task',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

const baseTasks: Task[] = [
  task('a', '2026-01-05T09:00', '2026-01-07T17:00', { type: 'summary' }),
  task('b', '2026-01-06T09:00', '2026-01-08T17:00', { parent: toTaskId('a') }),
  task('c', '2026-01-09T09:00', '2026-01-12T17:00'),
  task('m', '2026-01-13T09:00', '2026-01-13T09:00', { type: 'milestone' }),
];
const baseDeps: Dependency[] = [
  { id: toDependencyId('d1'), from: toTaskId('a'), to: toTaskId('b'), type: 'SS' },
  { id: toDependencyId('d2'), from: toTaskId('b'), to: toTaskId('c'), type: 'FS' },
  { id: toDependencyId('d3'), from: toTaskId('c'), to: toTaskId('m'), type: 'FF' },
];

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

describe('createSvgRenderer — structure', () => {
  it('mounts an <svg class="fg-timeline"> with role/aria-label', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.tagName.toLowerCase()).toBe('svg');
    expect(h.svg.getAttribute('class')).toBe('fg-timeline');
    expect(h.svg.getAttribute('role')).toBe('grid');
    expect(h.svg.getAttribute('aria-label')).toBe('Gantt chart');
    expect(h.svg.getAttribute('aria-rowcount')).toBe(String(baseTasks.length));
    expect(h.svg.getAttribute('aria-multiselectable')).toBe('true');
    expect(container.querySelectorAll('svg.fg-timeline')).toHaveLength(1);
  });

  it('correct .fg-task count per task count, all 4 type classes + dependencies', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.querySelectorAll('.fg-task')).toHaveLength(4);
    expect(h.svg.querySelectorAll('.fg-task--summary')).toHaveLength(1);
    expect(h.svg.querySelectorAll('.fg-task--milestone')).toHaveLength(1);
    expect(h.svg.querySelectorAll('.fg-dependency')).toHaveLength(3);
    // label indents by depth: child 'b' has a larger x than root 'a'
    const rows = [...h.svg.querySelectorAll('.fg-timeline__row-label')] as SVGTextElement[];
    expect(rows[0]!.textContent).toBe('a');
    expect(Number(rows[1]!.getAttribute('x'))).toBeGreaterThan(Number(rows[0]!.getAttribute('x')));
  });

  it('milestone bar has transform rotate(45 ...)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const m = h.svg.querySelector('.fg-task--milestone .fg-task__bar');
    expect(m!.getAttribute('transform')).toMatch(/rotate\(45 /);
  });
});

describe('keyboard-nav — ARIA grid/row/gridcell structure (spec-keyboard-nav.md §12.6)', () => {
  it('each row has role="row", 1-based aria-rowindex, data-task-id, aria-selected', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const rows = [...h.svg.querySelectorAll('.fg-timeline__row')] as SVGElement[];
    expect(rows).toHaveLength(baseTasks.length);
    rows.forEach((row, i) => {
      expect(row.getAttribute('role')).toBe('row');
      expect(row.getAttribute('aria-rowindex')).toBe(String(i + 1));
      expect(row.getAttribute('data-task-id')).toBe(baseTasks[i]!.id);
      expect(row.getAttribute('aria-selected')).toBe('false');
    });
  });

  it('selectedTaskIds → matching rows get aria-selected="true"', () => {
    const h = createSvgRenderer(container, {
      tasks: baseTasks,
      dependencies: baseDeps,
      selectedTaskIds: [baseTasks[1]!.id],
    });
    const rows = [...h.svg.querySelectorAll('.fg-timeline__row')] as SVGElement[];
    expect(rows[1]!.getAttribute('aria-selected')).toBe('true');
    expect(rows[0]!.getAttribute('aria-selected')).toBe('false');
  });

  it('each row wraps a single role="gridcell" child', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const rows = [...h.svg.querySelectorAll('.fg-timeline__row')] as SVGElement[];
    for (const row of rows) {
      const cells = row.querySelectorAll(':scope > .fg-timeline__row-cell[role="gridcell"]');
      expect(cells).toHaveLength(1);
    }
  });

  it('exactly one row has tabindex="0" matching input.focusedTaskId, the rest are "-1"', () => {
    const h = createSvgRenderer(container, {
      tasks: baseTasks,
      dependencies: baseDeps,
      focusedTaskId: baseTasks[2]!.id,
    });
    const rows = [...h.svg.querySelectorAll('.fg-timeline__row')] as SVGElement[];
    const zeroTabindex = rows.filter((r) => r.getAttribute('tabindex') === '0');
    expect(zeroTabindex).toHaveLength(1);
    expect(zeroTabindex[0]!.getAttribute('data-task-id')).toBe(baseTasks[2]!.id);
    for (const row of rows) {
      if (row !== zeroTabindex[0]) expect(row.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('focusedTaskId unset → the first row defaults to tabindex="0"', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const rows = [...h.svg.querySelectorAll('.fg-timeline__row')] as SVGElement[];
    expect(rows[0]!.getAttribute('tabindex')).toBe('0');
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.getAttribute('tabindex')).toBe('-1');
  });

  it('the focus-ring CSS block is present in the rendered <style>', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const styles = [...h.svg.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
    expect(styles).toContain('fg-task__focus-ring');
    expect(styles).toContain(':focus-visible');
  });
});

describe('critical path — a11y "distinguishable without color"', () => {
  it('.fg-task--critical has a non-empty stroke-dasharray (not color alone)', () => {
    const cp = computeCriticalPath(baseTasks, baseDeps, cal);
    const h = createSvgRenderer(container, {
      tasks: baseTasks,
      dependencies: baseDeps,
      criticalPath: cp,
    });
    const critical = [...h.svg.querySelectorAll('.fg-task--critical .fg-task__bar')] as SVGElement[];
    expect(critical.length).toBeGreaterThan(0);
    for (const el of critical) {
      const dash = el.style.getPropertyValue('stroke-dasharray');
      expect(dash).not.toBe('');
      expect(dash).toContain('--fg-task-critical-dash');
    }
  });

  it('no criticalPath passed → no .fg-task--critical', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.querySelectorAll('.fg-task--critical')).toHaveLength(0);
  });
});

describe('SECURITY — XSS qua task.name (untrusted)', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg onload=alert(1)>',
    'javascript:alert(1)',
  ];

  it.each(payloads)('renders %s as a text node, NOT real markup', (payload) => {
    const t = task('evil', '2026-01-05T09:00', '2026-01-07T17:00', { name: payload });
    const h = createSvgRenderer(container, { tasks: [t], dependencies: [] });

    // (a) the text shows the exact original literal → proves it is an inert TEXT NODE,
    //     not parsed markup (this is the core XSS-safety assertion).
    const label = h.svg.querySelector('.fg-timeline__row-label');
    expect(label!.textContent).toBe(payload);

    // (b) DOM-based check: if the payload were parsed as markup, real elements/attributes
    //     would exist. Since it is escaped text → 0. (Do NOT grep the serialized string:
    //     escaped text/attributes still harmlessly contain the substring "onload=" → false positive.)
    expect(container.querySelectorAll('script, img')).toHaveLength(0);
    expect(container.querySelectorAll('[onerror], [onload]')).toHaveLength(0);
  });

  it('aria-label containing name also creates no markup (attribute value, escaped)', () => {
    const t = task('x', '2026-01-05T09:00', '2026-01-07T17:00', { name: '"><script>alert(1)</script>' });
    createSvgRenderer(container, { tasks: [t], dependencies: [] });
    expect(container.querySelector('script')).toBeNull();
  });
});

describe('SECURITY — color injection', () => {
  it.each([
    'url(javascript:alert(1))',
    'expression(alert(1))',
    'red; } * { display:none',
    '<script>alert(1)</script>',
  ])('malicious task.color %s → fallback token, does not contain the original input', (evil) => {
    const t = task('x', '2026-01-05T09:00', '2026-01-07T17:00', { color: evil });
    const h = createSvgRenderer(container, { tasks: [t], dependencies: [] });
    const bar = h.svg.querySelector('.fg-task__bar') as SVGElement;
    const fill = bar.style.getPropertyValue('fill');
    expect(fill).not.toContain('javascript');
    expect(fill).not.toContain('expression');
    expect(fill).not.toContain('script');
    expect(fill).toContain('var(--fg-task-default');
  });

  it('valid task.color (#hex) is used as-is', () => {
    const t = task('x', '2026-01-05T09:00', '2026-01-07T17:00', { color: '#abcdef' });
    const h = createSvgRenderer(container, { tasks: [t], dependencies: [] });
    const bar = h.svg.querySelector('.fg-task__bar') as SVGElement;
    expect(bar.style.getPropertyValue('fill')).toBe('#abcdef');
  });
});

describe('SECURITY — enum whitelist (N3/N5, CSS-token spoofing)', () => {
  it('unknown task.type (bypassing TS) → falls back to class fg-task--task, no extra token injected', () => {
    const evil = task('x', '2026-01-05T09:00', '2026-01-07T17:00', {
      type: 'foo fg-task--critical' as unknown as Task['type'],
    });
    const h = createSvgRenderer(container, { tasks: [evil], dependencies: [] });
    const wrapper = h.svg.querySelector('.fg-task') as SVGElement;
    expect(wrapper.getAttribute('class')).toBe('fg-task fg-task--task');
    // not marked critical by stuffing the type
    expect(h.svg.querySelectorAll('.fg-task--critical')).toHaveLength(0);
  });

  it('unknown dependency.type → skipped (not rendered, no crash)', () => {
    const t1 = task('a', '2026-01-05T09:00', '2026-01-07T17:00');
    const t2 = task('b', '2026-01-08T09:00', '2026-01-10T17:00');
    const deps = [
      { id: toDependencyId('ok'), from: toTaskId('a'), to: toTaskId('b'), type: 'FS' as const },
      {
        id: toDependencyId('bad'),
        from: toTaskId('a'),
        to: toTaskId('b'),
        type: 'ZZ' as unknown as Dependency['type'],
      },
    ];
    const h = createSvgRenderer(container, { tasks: [t1, t2], dependencies: deps });
    expect(h.svg.querySelectorAll('.fg-dependency')).toHaveLength(1); // only the valid FS
  });
});

describe('end < start — clamp + console.warn (decision Q5)', () => {
  it('no crash, bar width 0, emits exactly ONE console.warn per render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = task('bad', '2026-01-20T09:00', '2026-01-10T09:00');
    const h = createSvgRenderer(container, { tasks: [bad], dependencies: [] });
    const bar = h.svg.querySelector('.fg-task__bar') as SVGElement;
    expect(Number(bar.getAttribute('width'))).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/end before start/);
  });
});

describe('update / setOptions / destroy — idempotent (spec §9.2)', () => {
  it('update() with the same input twice → identical DOM (no leaked nodes)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const before = h.svg.querySelectorAll('.fg-task').length;
    h.update({ tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.querySelectorAll('.fg-task')).toHaveLength(before);
  });

  it('update() with a different input → .fg-task count matches the new count, no orphaned old nodes', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    h.update({ tasks: [baseTasks[0]!], dependencies: [] });
    expect(h.svg.querySelectorAll('.fg-task')).toHaveLength(1);
    expect(h.svg.querySelectorAll('.fg-dependency')).toHaveLength(0);
  });

  it('setOptions({density}) repaints with the stored input', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    h.setOptions({ density: 'compact' });
    expect(h.svg.querySelectorAll('.fg-task')).toHaveLength(4);
  });

  it('destroy() removes all DOM; update()/destroy() afterwards are no-ops', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    h.destroy();
    expect(container.children).toHaveLength(0);
    expect(() => h.update({ tasks: baseTasks, dependencies: baseDeps })).not.toThrow();
    expect(() => h.destroy()).not.toThrow();
    expect(container.children).toHaveLength(0);
  });
});
