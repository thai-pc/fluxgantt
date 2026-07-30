// @vitest-environment jsdom
//
// DOM + security tests for the SVG renderer (spec-svg-renderer.md §9.2, chốt Q3/Q6).
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
  it('mount một <svg class="fg-timeline"> với role/aria-label', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.tagName.toLowerCase()).toBe('svg');
    expect(h.svg.getAttribute('class')).toBe('fg-timeline');
    expect(h.svg.getAttribute('role')).toBe('img');
    expect(h.svg.getAttribute('aria-label')).toBe('Gantt chart');
    expect(container.querySelectorAll('svg.fg-timeline')).toHaveLength(1);
  });

  it('đúng số .fg-task theo task count, đủ 4 class type + dependency', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.querySelectorAll('.fg-task')).toHaveLength(4);
    expect(h.svg.querySelectorAll('.fg-task--summary')).toHaveLength(1);
    expect(h.svg.querySelectorAll('.fg-task--milestone')).toHaveLength(1);
    expect(h.svg.querySelectorAll('.fg-dependency')).toHaveLength(3);
    // label thụt lề theo depth: child 'b' có x lớn hơn root 'a'
    const rows = [...h.svg.querySelectorAll('.fg-timeline__row-label')] as SVGTextElement[];
    expect(rows[0]!.textContent).toBe('a');
    expect(Number(rows[1]!.getAttribute('x'))).toBeGreaterThan(Number(rows[0]!.getAttribute('x')));
  });

  it('milestone bar có transform rotate(45 ...)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const m = h.svg.querySelector('.fg-task--milestone .fg-task__bar');
    expect(m!.getAttribute('transform')).toMatch(/rotate\(45 /);
  });
});

describe('critical path — a11y "phân biệt không cần màu"', () => {
  it('.fg-task--critical có stroke-dasharray khác rỗng (không chỉ đổi màu)', () => {
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

  it('không truyền criticalPath → không có .fg-task--critical', () => {
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

  it.each(payloads)('render %s như text node, KHÔNG thành markup thật', (payload) => {
    const t = task('evil', '2026-01-05T09:00', '2026-01-07T17:00', { name: payload });
    const h = createSvgRenderer(container, { tasks: [t], dependencies: [] });

    // (a) text hiển thị đúng literal string gốc → chứng minh nó là TEXT NODE inert,
    //     không phải markup bị parse (đây là assertion cốt lõi của XSS-safety).
    const label = h.svg.querySelector('.fg-timeline__row-label');
    expect(label!.textContent).toBe(payload);

    // (b) kiểm tra dựa trên DOM: nếu payload bị parse thành markup, sẽ có element/attribute
    //     thật. Vì là text đã escape → 0. (KHÔNG grep chuỗi serialize: text/attribute đã
    //     escape vẫn chứa substring "onload=" một cách vô hại → false positive.)
    expect(container.querySelectorAll('script, img')).toHaveLength(0);
    expect(container.querySelectorAll('[onerror], [onload]')).toHaveLength(0);
  });

  it('aria-label chứa name cũng không tạo markup (attribute value, escaped)', () => {
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
  ])('task.color độc %s → fallback token, không chứa input gốc', (evil) => {
    const t = task('x', '2026-01-05T09:00', '2026-01-07T17:00', { color: evil });
    const h = createSvgRenderer(container, { tasks: [t], dependencies: [] });
    const bar = h.svg.querySelector('.fg-task__bar') as SVGElement;
    const fill = bar.style.getPropertyValue('fill');
    expect(fill).not.toContain('javascript');
    expect(fill).not.toContain('expression');
    expect(fill).not.toContain('script');
    expect(fill).toContain('var(--fg-task-default');
  });

  it('task.color hợp lệ (#hex) được dùng nguyên', () => {
    const t = task('x', '2026-01-05T09:00', '2026-01-07T17:00', { color: '#abcdef' });
    const h = createSvgRenderer(container, { tasks: [t], dependencies: [] });
    const bar = h.svg.querySelector('.fg-task__bar') as SVGElement;
    expect(bar.style.getPropertyValue('fill')).toBe('#abcdef');
  });
});

describe('SECURITY — enum whitelist (N3/N5, CSS-token spoofing)', () => {
  it('task.type lạ (lách TS) → class fallback fg-task--task, không inject token thừa', () => {
    const evil = task('x', '2026-01-05T09:00', '2026-01-07T17:00', {
      type: 'foo fg-task--critical' as unknown as Task['type'],
    });
    const h = createSvgRenderer(container, { tasks: [evil], dependencies: [] });
    const wrapper = h.svg.querySelector('.fg-task') as SVGElement;
    expect(wrapper.getAttribute('class')).toBe('fg-task fg-task--task');
    // không bị nhuộm critical bằng cách nhồi type
    expect(h.svg.querySelectorAll('.fg-task--critical')).toHaveLength(0);
  });

  it('dependency.type lạ → bị skip (không render, không crash)', () => {
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
    expect(h.svg.querySelectorAll('.fg-dependency')).toHaveLength(1); // chỉ FS hợp lệ
  });
});

describe('end < start — clamp + console.warn (chốt Q5)', () => {
  it('không crash, bar width 0, phát đúng MỘT console.warn/render', () => {
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
  it('update() cùng input 2 lần → DOM giống hệt (không leak node)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const before = h.svg.querySelectorAll('.fg-task').length;
    h.update({ tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.querySelectorAll('.fg-task')).toHaveLength(before);
  });

  it('update() với input khác → số .fg-task khớp count mới, không orphan node cũ', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    h.update({ tasks: [baseTasks[0]!], dependencies: [] });
    expect(h.svg.querySelectorAll('.fg-task')).toHaveLength(1);
    expect(h.svg.querySelectorAll('.fg-dependency')).toHaveLength(0);
  });

  it('setOptions({density}) repaint với input đã lưu', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    h.setOptions({ density: 'compact' });
    expect(h.svg.querySelectorAll('.fg-task')).toHaveLength(4);
  });

  it('destroy() gỡ hết DOM; update()/destroy() sau đó là no-op', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    h.destroy();
    expect(container.children).toHaveLength(0);
    expect(() => h.update({ tasks: baseTasks, dependencies: baseDeps })).not.toThrow();
    expect(() => h.destroy()).not.toThrow();
    expect(container.children).toHaveLength(0);
  });
});
