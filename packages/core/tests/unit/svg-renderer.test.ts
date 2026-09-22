// @vitest-environment jsdom
//
// DOM + security tests for the SVG renderer (spec-svg-renderer.md §9.2, decisions Q3/Q6).
// Runs under jsdom (per-file override; the rest of core stays `environment: 'node'`).
// Visual regression (§9.3) and Playwright axe a11y (§9.4) are a separate follow-up
// ticket (spec §11 Q6) and intentionally NOT here.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSvgRenderer } from '../../src/render/svg-renderer.js';
import { computeCriticalPath } from '../../src/compute/critical-path.js';
import { DEFAULT_CALENDAR, normalizeDate } from '../../src/compute/working-calendar.js';
import { TOGGLE_GLYPH_GUTTER_PX } from '../../src/render/renderer-base.js';
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
    // `treegrid`, not `grid`: `baseTasks` has a summary row ('a' parents 'b'), so rows carry
    // `aria-expanded` — which WAI-ARIA permits only under `treegrid`. See the flat-project case
    // below for the `grid` fallback (spec-collapse-expand.md §6.4).
    expect(h.svg.getAttribute('role')).toBe('treegrid');
    expect(h.svg.getAttribute('aria-label')).toBe('Gantt chart');
    expect(h.svg.getAttribute('aria-rowcount')).toBe(String(baseTasks.length));
    expect(h.svg.getAttribute('aria-multiselectable')).toBe('true');
    expect(container.querySelectorAll('svg.fg-timeline')).toHaveLength(1);
  });

  it('a project with no hierarchy stays a plain role="grid"', () => {
    // No row has children -> no row emits `aria-expanded` -> `treegrid` would be an unwarranted
    // promise of an expandable tree. The role is derived per-render from the layout.
    const flat = baseTasks.filter((t) => t.id !== toTaskId('b') && t.type !== 'summary');
    const h = createSvgRenderer(container, { tasks: flat, dependencies: [] });
    expect(h.svg.getAttribute('role')).toBe('grid');
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

describe('collapse/expand — toggle glyph + aria-expanded (spec-collapse-expand.md §6.2/§9.7)', () => {
  it('a hasChildren row (summary "a") gets a .fg-timeline__row-toggle glyph and aria-expanded="true" (expanded by default)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const rowA = h.svg.querySelector('.fg-timeline__row[data-task-id="a"]')!;
    expect(rowA.querySelector('.fg-timeline__row-toggle')).toBeTruthy();
    expect(rowA.getAttribute('aria-expanded')).toBe('true');
  });

  it('a leaf row (no children) gets neither the toggle glyph nor aria-expanded (never "false" on a non-expandable node)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const rowC = h.svg.querySelector('.fg-timeline__row[data-task-id="c"]')!;
    expect(rowC.querySelector('.fg-timeline__row-toggle')).toBeNull();
    expect(rowC.hasAttribute('aria-expanded')).toBe(false);
  });

  it('collapsedIds threaded through input → aria-expanded="false" on the collapsed row, and its descendants are absent from the DOM entirely', () => {
    const h = createSvgRenderer(container, {
      tasks: baseTasks,
      dependencies: baseDeps,
      collapsedIds: new Set([toTaskId('a')]),
    });
    const rowA = h.svg.querySelector('.fg-timeline__row[data-task-id="a"]')!;
    expect(rowA.getAttribute('aria-expanded')).toBe('false');
    expect(h.svg.querySelector('.fg-timeline__row[data-task-id="b"]')).toBeNull();
    expect(h.svg.getAttribute('aria-rowcount')).toBe(String(baseTasks.length - 1)); // b hidden
  });

  it('toggle glyph markup: aria-hidden="true", no task-derived text content (XSS-surface check)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const toggle = h.svg.querySelector('.fg-timeline__row-toggle')!;
    expect(toggle.getAttribute('aria-hidden')).toBe('true');
    expect(toggle.textContent).toBe('');
  });

  it('aria-level is the 1-based depth on EVERY row of a tree, leaves included', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const level = (id: string) =>
      h.svg.querySelector(`.fg-timeline__row[data-task-id="${id}"]`)!.getAttribute('aria-level');
    // 'a' is a root summary -> level 1, NOT 0: `aria-level` is 1-based while `RowLayout.depth`
    // is 0-based, so an off-by-one here would be invisible to a type check but wrong to a
    // screen reader.
    expect(level('a')).toBe('1');
    expect(level('b')).toBe('2'); // child of 'a'
    // 'c' and 'm' are leaves at the root, and they still carry a level — unlike
    // `aria-expanded`, which is omitted on a leaf. Depth is a real fact about a leaf row.
    expect(level('c')).toBe('1');
    expect(level('m')).toBe('1');
  });

  it('aria-level tracks depth beyond 2 levels (grandchild -> "3")', () => {
    const deep: Task[] = [
      task('a', '2026-01-05T09:00', '2026-01-09T17:00', { type: 'summary' }),
      task('b', '2026-01-05T09:00', '2026-01-08T17:00', { type: 'summary', parent: toTaskId('a') }),
      task('c', '2026-01-06T09:00', '2026-01-07T17:00', { parent: toTaskId('b') }),
    ];
    const h = createSvgRenderer(container, { tasks: deep, dependencies: [] });
    const levels = [...h.svg.querySelectorAll('.fg-timeline__row')].map((r) =>
      r.getAttribute('aria-level'),
    );
    expect(levels).toEqual(['1', '2', '3']);
  });

  it('a flat project (role="grid") emits NO aria-level on any row', () => {
    // Same constraint as `aria-expanded`: axe lists `aria-level` in `invalidTableRowAttrs`, so a
    // row may carry it only when its owner resolves to `treegrid`. Emitting it under a plain
    // `grid` would be a serious-impact `aria-conditional-attr` violation, not a harmless extra.
    const flat = baseTasks.filter((t) => t.id !== toTaskId('b') && t.type !== 'summary');
    const h = createSvgRenderer(container, { tasks: flat, dependencies: [] });
    expect(h.svg.getAttribute('role')).toBe('grid');
    const rows = [...h.svg.querySelectorAll('.fg-timeline__row')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.hasAttribute('aria-level')).toBe(false);
  });

  it('collapsing every summary keeps role="treegrid" and keeps aria-level on the still-visible rows', () => {
    // A collapsed parent is still expandable, so `hasChildren` stays true and the chart stays a
    // tree. Regression guard: `aria-level` must be derived from the same predicate as the root
    // role, never from "are any CHILD rows currently visible".
    const h = createSvgRenderer(container, {
      tasks: baseTasks,
      dependencies: baseDeps,
      collapsedIds: new Set([toTaskId('a')]),
    });
    expect(h.svg.getAttribute('role')).toBe('treegrid');
    const rowA = h.svg.querySelector('.fg-timeline__row[data-task-id="a"]')!;
    expect(rowA.getAttribute('aria-level')).toBe('1');
  });

  it('label x-position is shifted uniformly by TOGGLE_GLYPH_GUTTER_PX on every row (spec §6.1 deliberate gutter shift)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const labels = [...h.svg.querySelectorAll('.fg-timeline__row-label')] as SVGTextElement[];
    // Row 'a' (depth 0): x = LABEL_PADDING_PX(8) + 0*LABEL_INDENT_PX(16) + TOGGLE_GLYPH_GUTTER_PX.
    expect(Number(labels[0]!.getAttribute('x'))).toBe(8 + TOGGLE_GLYPH_GUTTER_PX);
    // Row 'b' (depth 1): x = 8 + 1*16 + TOGGLE_GLYPH_GUTTER_PX.
    expect(Number(labels[1]!.getAttribute('x'))).toBe(8 + 16 + TOGGLE_GLYPH_GUTTER_PX);
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

describe('rollup — bar geometry + a11y + drag gate (spec-summary-rollup.md Ticket B2)', () => {
  // 'a' is the summary row in `baseTasks`; its authored span is Jan 5–7, its child 'b' runs to
  // Jan 8, so a real `computeRollup` would widen it. Built by hand here so this file stays a
  // renderer test and does not depend on the compute layer's own behavior.
  const rollup = new Map([
    [
      toTaskId('a'),
      {
        start: normalizeDate('2026-01-05T09:00', cal.timezone),
        end: normalizeDate('2026-01-08T17:00', cal.timezone),
        progress: 0.25,
      },
    ],
  ]);

  const barWidthOf = (h: { svg: SVGSVGElement }, id: string): number =>
    Number(
      (h.svg.querySelector(`.fg-task[data-task-id="${id}"] .fg-task__bar`) as SVGElement).getAttribute('width'),
    );

  it('draws the summary bar at its rolled-up span, leaving every other bar untouched', () => {
    const plain = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const authoredA = barWidthOf(plain, 'a');
    const authoredC = barWidthOf(plain, 'c');
    plain.destroy();

    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps, rollup });
    expect(barWidthOf(h, 'a')).toBeGreaterThan(authoredA);
    expect(barWidthOf(h, 'c')).toBe(authoredC); // no entry → authored, unchanged
  });

  it("the rolled-up bar's aria-label announces the aggregate progress, not the authored one", () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps, rollup });
    const label = h.svg.querySelector('.fg-task[data-task-id="a"]')!.getAttribute('aria-label')!;
    expect(label).toContain('25% complete');
    expect(label).not.toContain('50% complete'); // `task()`'s authored default
  });

  it('marks the rolled-up bar with data-rolled-up so the interaction layer can decline it', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps, rollup });
    expect(h.svg.querySelector('.fg-task[data-task-id="a"]')!.getAttribute('data-rolled-up')).toBe('true');
    // Every other bar stays draggable — the marker is per-bar, not per-chart.
    expect(h.svg.querySelector('.fg-task[data-task-id="c"]')!.getAttribute('data-rolled-up')).toBeNull();
  });

  it('a milestone with a rollup entry is neither re-spanned nor marked', () => {
    // `computeRollup` emits an entry for any task with children regardless of `type`; a diamond
    // has no span to stretch, so it must stay at its authored instant AND stay draggable.
    const withM = new Map(rollup);
    withM.set(toTaskId('m'), {
      start: normalizeDate('2026-01-01T09:00', cal.timezone),
      end: normalizeDate('2026-01-25T17:00', cal.timezone),
      progress: 0.25,
    });
    const plain = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const authoredM = barWidthOf(plain, 'm');
    plain.destroy();

    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps, rollup: withM });
    expect(barWidthOf(h, 'm')).toBe(authoredM);
    expect(h.svg.querySelector('.fg-task[data-task-id="m"]')!.getAttribute('data-rolled-up')).toBeNull();
  });

  it('omitting `rollup` renders exactly as before (opt-in, no behavior change)', () => {
    const a = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const html = a.svg.outerHTML;
    a.destroy();
    const b = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps, rollup: new Map() });
    expect(b.svg.outerHTML).toBe(html);
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

// --- progress fill (spec §5.4, `.fg-task__progress`) -----------------------------------------

describe('progress fill', () => {
  /** The `<rect>` for one task, resolved through its own `.fg-task` group so a sibling task's
   *  fill can never be mistaken for it. */
  const progressOf = (h: { svg: SVGSVGElement }, id: string): SVGElement | null =>
    h.svg.querySelector(`.fg-task[data-task-id="${id}"] .fg-task__progress`);
  const barOf = (h: { svg: SVGSVGElement }, id: string): SVGElement =>
    h.svg.querySelector(`.fg-task[data-task-id="${id}"] .fg-task__bar`) as SVGElement;
  const widthOf = (el: Element | null): number => Number(el?.getAttribute('width'));

  it('paints a fill at `barWidth * progress`, matching the bar on every other geometry axis', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const bar = barOf(h, 'c');
    const fill = progressOf(h, 'c');
    expect(fill).not.toBeNull();
    expect(widthOf(fill)).toBeCloseTo(Number(bar.getAttribute('width')) * 0.5, 6);
    // Same origin and height — only the width encodes the fraction.
    expect(fill!.getAttribute('x')).toBe(bar.getAttribute('x'));
    expect(fill!.getAttribute('y')).toBe(bar.getAttribute('y'));
    expect(fill!.getAttribute('height')).toBe(bar.getAttribute('height'));
  });

  it('sets the fill INLINE via a design token — the property `exportSvg()` bakes', () => {
    // A CSS-rule fill would be stripped with the `<style>` blocks on export and land as SVG's
    // default black; export-svg.test.ts guards the exported artifact, this guards the source.
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(progressOf(h, 'c')!.style.getPropertyValue('fill')).toBe('var(--fg-task-completed, #10b981)');
  });

  it('emits no fill for a milestone, for `progress: 0`, or for a zero-width bar', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = createSvgRenderer(container, {
      tasks: [
        ...baseTasks,
        task('zero', '2026-01-14T09:00', '2026-01-16T17:00', { progress: 0 }),
        task('inverted', '2026-01-20T09:00', '2026-01-10T09:00'),
      ],
      dependencies: [],
    });
    expect(progressOf(h, 'm')).toBeNull();
    expect(progressOf(h, 'zero')).toBeNull();
    expect(progressOf(h, 'inverted')).toBeNull();
    warn.mockRestore();
  });

  it('clamps an out-of-range or NaN progress instead of painting past the bar', () => {
    // `addTask` and the store do NOT validate `progress` (only `setProgress` and the IO
    // boundary do), so these values genuinely reach the renderer.
    const h = createSvgRenderer(container, {
      tasks: [
        task('over', '2026-01-05T09:00', '2026-01-07T17:00', { progress: 1.7 }),
        task('under', '2026-01-09T09:00', '2026-01-12T17:00', { progress: -0.3 }),
        task('nan', '2026-01-14T09:00', '2026-01-16T17:00', { progress: Number.NaN }),
      ],
      dependencies: [],
    });
    expect(widthOf(progressOf(h, 'over'))).toBe(Number(barOf(h, 'over').getAttribute('width')));
    expect(progressOf(h, 'under')).toBeNull();
    expect(progressOf(h, 'nan')).toBeNull();
  });

  it('is painted above the bar and below the focus ring', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const children = [...h.svg.querySelector('.fg-task[data-task-id="c"]')!.children];
    const indexOf = (cls: string): number => children.findIndex((el) => el.classList.contains(cls));
    // SVG paints in document order, so append order IS z-order.
    expect(indexOf('fg-task__bar')).toBeLessThan(indexOf('fg-task__progress'));
    expect(indexOf('fg-task__progress')).toBeLessThan(indexOf('fg-task__focus-ring'));
  });

  it('uses the ROLLED-UP progress, and agrees with the percentage its own aria-label announces', () => {
    // The whole point of the element: the a11y layer has always announced a percentage that
    // nothing painted. Both now resolve `rolled?.progress ?? task.progress` identically.
    const rollup = new Map([
      [
        toTaskId('a'),
        {
          start: normalizeDate('2026-01-05T09:00', cal.timezone),
          end: normalizeDate('2026-01-08T17:00', cal.timezone),
          progress: 0.25,
        },
      ],
    ]);
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps, rollup });
    const group = h.svg.querySelector('.fg-task[data-task-id="a"]')!;
    expect(widthOf(progressOf(h, 'a'))).toBeCloseTo(Number(barOf(h, 'a').getAttribute('width')) * 0.25, 6);
    expect(group.getAttribute('aria-label')).toContain('25% complete');
  });

  it('two renders of the same input produce byte-identical markup', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const before = h.svg.outerHTML;
    h.update({ tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.outerHTML).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------
// Today marker (spec §9.1)
// ---------------------------------------------------------------------------------------
//
// The clock is faked rather than injected: the renderer reads `Temporal.Now` at its single
// DOM boundary, and the polyfill's `Now` derives from `Date.now` — so `vi.setSystemTime`
// controls it, the same way it controls `TaskStore`'s `new Date()` stamps elsewhere.
describe('createSvgRenderer — today marker', () => {
  // Inside `baseTasks`' 2026-01-05..01-13 span, and deliberately mid-day so the line cannot
  // coincide with a day-column edge.
  const INSIDE = new Date('2026-01-08T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(INSIDE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders exactly one full-height line at the current instant', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const lines = h.svg.querySelectorAll('.fg-timeline__today-line');
    expect(lines).toHaveLength(1);

    const line = lines[0] as SVGLineElement;
    expect(line.getAttribute('x1')).toBe(line.getAttribute('x2'));
    expect(line.getAttribute('y1')).toBe('0');
    // Spans the whole chart, header band included — not just the row body.
    expect(Number(line.getAttribute('y2'))).toBe(Number(h.svg.getAttribute('height')));
    expect(Number(line.getAttribute('x1'))).toBeGreaterThan(0);
  });

  it('paints via an inline stroke token, never a CSS rule (survives exportSvg style-stripping)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const line = h.svg.querySelector('.fg-timeline__today-line') as SVGLineElement;
    expect(line.style.getPropertyValue('stroke')).toBe('var(--fg-task-critical, #ef4444)');
    expect(line.style.getPropertyValue('stroke-width')).toBe('2');
  });

  it('marks the line aria-hidden (decoration under a role="grid"/"treegrid" root)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const line = h.svg.querySelector('.fg-timeline__today-line')!;
    expect(line.getAttribute('aria-hidden')).toBe('true');
  });

  it('emits nothing at all when the clock is outside the chart range', () => {
    // A clamped line on the chart edge would read as "today is the first day of this
    // project" — a confident, wrong statement. Absence is the correct answer.
    vi.setSystemTime(new Date('2030-06-01T12:00:00.000Z'));
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.querySelector('.fg-timeline__today-line')).toBeNull();
  });

  it('paints over the rows but under the label divider (document order is z-order)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const children = Array.from(h.svg.children);
    const indexOf = (selector: string): number =>
      children.findIndex((el) => el.matches(selector) || el.querySelector(selector) !== null);

    const rows = indexOf('.fg-timeline__row');
    const today = indexOf('.fg-timeline__today-line');
    const divider = indexOf('.fg-timeline__label-divider');
    expect(rows).toBeLessThan(today);
    expect(today).toBeLessThan(divider);
  });

  it('re-renders byte-identically for the same clock (idempotence)', () => {
    const h = createSvgRenderer(container, { tasks: baseTasks, dependencies: baseDeps });
    const before = h.svg.outerHTML;
    h.update({ tasks: baseTasks, dependencies: baseDeps });
    expect(h.svg.outerHTML).toBe(before);
  });
});
