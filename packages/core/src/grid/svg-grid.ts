// The SVG grid painter (spec-grid-columns.md section 5.2), registered as a `PaintHook`. DOM-specific.
//
// DUAL MODEL, as for the label column: REAL cells live in the chart `<svg>` (gridcell / columnheader
// roles for assistive tech, visible in `exportSvg()`, hidden live by the injected `<style>` because
// the pinned layers show the picture) and `aria-hidden` CLONES (text only) are added to the pinned
// column and corner. Focusable or role-bearing content inside `aria-hidden` fails axe, so the clones
// carry neither.
//
// SECURITY (security.md): every string that reaches the DOM is a Text node (`append(string)`) or a
// `setAttribute` value. Cell text comes from `values.ts` (already capped and stripped); column ids are
// validated; nothing is concatenated into markup, a selector or a `cssText`.
import { HEADER_FONT_PX, estimateTextWidth } from '../render/renderer-base.js';
import type { PaintEvent, PaintHook } from '../render/svg-renderer.js';
import type { GanttInternal } from '../gantt-internal.js';
import { toTaskId, type Task } from '../types.js';
import type { Column } from './columns.js';
import type { GridValues } from './values.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Keep in sync with `HEADER_HEIGHT` in `render/svg-renderer.ts` (not exported from there).
const HEADER_HEIGHT = 32;
const PAD = 8;
/** Grid text is pinned to the header font (size and family): the width estimate is calibrated for it. */
const FONT = `${HEADER_FONT_PX}px system-ui,sans-serif`;
const CELL_STYLE = 'dominant-baseline:middle;fill:var(--fg-fg,#18181b)';
const HEAD_STYLE = `font:${FONT};dominant-baseline:middle;fill:var(--fg-fg-muted,#6b6b73)`;
const LINE_STYLE = 'stroke:var(--fg-border,#e5e7eb)';
const ANCHOR = { start: 'start', center: 'middle', end: 'end' } as const;

// Hand-minified (every character of a CSS literal ships; rationale lives here). The real cells and
// headers are hidden LIVE because the pinned layers paint them; `exportSvg()` strips every `<style>`,
// so an export shows them. Scoped to the chart svg so the pinned clones are not hidden.
const STYLE =
  '.fg-timeline__layer>.fg-timeline .fg-grid__cells,.fg-timeline__layer>.fg-timeline .fg-grid__head-text{opacity:0}';

/** What the painter needs to know about the active columns. */
export interface GridView {
  readonly cols: readonly Column[];
  /** Inline-start offset of each column; `offs[i] + cols[i].width` is the next one. */
  readonly offs: readonly number[];
  /** Sum of the widths: the pinned column's width. */
  readonly width: number;
}

const el = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const e = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const k in attrs) e.setAttribute(k, attrs[k] as string);
  return e;
};
const g = (attrs: Record<string, string | number>, style?: string): SVGElement => {
  const e = el('g', attrs);
  if (style) e.style.cssText = style;
  return e;
};
const textEl = (x: number, y: number, anchor: string, content: string, full?: string): SVGElement => {
  const t = el('text', anchor === 'start' ? { x, y } : { x, y, 'text-anchor': anchor });
  if (full !== undefined) t.append(el('title', {}));
  t.append(content);
  if (full !== undefined) t.firstElementChild!.append(full);
  return t;
};

let segmenter: Intl.Segmenter | undefined;

/** `text` cut with an ellipsis to fit `max` px (6 % margin, on a grapheme boundary), or `text` itself. */
export function fit(text: string, max: number): string {
  const budget = max * 0.94;
  if (estimateTextWidth(text) <= budget) return text;
  segmenter ??= typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : undefined;
  const parts = segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
  let lo = 0;
  let hi = parts.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (estimateTextWidth(parts.slice(0, mid).join('') + '…') <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo || estimateTextWidth('…') <= budget ? parts.slice(0, lo).join('') + '…' : '';
}

/** Where a cell's text sits inside its column. */
const place = (col: Column, off: number): [number, string] => [
  col.align === 'end' ? off + col.width - PAD : col.align === 'center' ? off + col.width / 2 : off + PAD,
  ANCHOR[col.align],
];

/** Adds the grid to a freshly painted chart (full render) or to the rows a patch rebuilt. */
export function createGridPaint(
  internal: GanttInternal,
  view: () => GridView,
  values: GridValues,
): PaintHook {
  const locale = internal.config.locale ?? 'en';
  const label = internal.config.messages?.gridColumnLabel;

  const headerName = (c: Column, i: number, n: number): string => {
    let name = `${c.header}, column ${i + 1} of ${n}`;
    try {
      const custom = label?.({ columnId: c.id, header: c.header, index: i + 1, count: n, locale });
      if (typeof custom === 'string') name = custom;
    } catch {
      // a throwing host function falls back to the English name
    }
    return name.slice(0, 400);
  };

  /** Decorates one row of the chart svg; returns the clone row for the pinned column. */
  const decorate = (
    row: Element,
    task: Task,
    v: GridView,
    cloneLabel: Element | undefined,
    index: number,
    clone: boolean,
  ): SVGElement | undefined => {
    row.setAttribute('aria-rowindex', String(index + 2)); // the header row is aria-rowindex 1
    const texts = values.text(task, v.cols);
    const name = row.querySelector('.fg-timeline__row-label');
    const y = Number(name?.getAttribute('y'));
    const out = clone
      ? g({ 'data-row-index': row.getAttribute('data-row-index')!, 'data-task-id': task.id }, CELL_STYLE)
      : undefined;
    const real = g({}, CELL_STYLE);
    real.setAttribute('class', 'fg-grid__cells');
    row.append(real);
    v.cols.forEach((col, i) => {
      const full = texts[i]!;
      if (i === 0) {
        row.querySelector('.fg-timeline__row-cell')?.setAttribute('aria-colindex', '1');
        const max = col.width - (Number(name?.getAttribute('x')) || PAD) - PAD;
        const cut = fit(full, max);
        if (cut !== full && name) {
          name.replaceChildren(el('title', {}), cut);
          name.firstElementChild!.append(full);
          name.parentElement?.setAttribute('aria-label', full);
          if (cloneLabel) {
            cloneLabel.replaceChildren(el('title', {}), cut);
            cloneLabel.firstElementChild!.append(full);
          }
        }
        return;
      }
      const [x, anchor] = place(col, v.offs[i]!);
      const cut = fit(full, col.width - 2 * PAD);
      const t = textEl(x, y, anchor, cut, cut !== full ? full : undefined);
      out?.append(t.cloneNode(true));
      t.setAttribute('role', 'gridcell');
      t.setAttribute('aria-colindex', String(i + 1));
      t.setAttribute('data-column-id', col.id);
      if (cut !== full) t.setAttribute('aria-label', full);
      real.append(t);
    });
    return out;
  };

  const lines = (v: GridView, height: number): SVGElement => {
    const group = g({}, LINE_STYLE);
    for (let i = 1; i < v.cols.length; i++) {
      group.append(el('line', { x1: v.offs[i]! - 0.5, x2: v.offs[i]! - 0.5, y1: 0, y2: height }));
    }
    return group;
  };

  const full = (e: PaintEvent, v: GridView): void => {
    const { svg, column, corner } = e;
    const rowsGroup = svg.querySelector('.fg-timeline__rows')!;
    const rows = Array.from(rowsGroup.children);
    const height = Number(svg.getAttribute('height'));
    const n = v.cols.length;
    svg.setAttribute('aria-colcount', String(n));
    svg.setAttribute('aria-rowcount', String(rows.length + 1));
    // Grid text is pinned to one size so the width estimate holds; one inherited declaration each.
    (rowsGroup as SVGElement).style.font = FONT;
    column!.style.font = FONT;
    svg.append(el('style', {}));
    svg.lastElementChild!.append(STYLE);

    // Body: real cells, truncated names, and the clone rows for the pinned column.
    const cloneLabels = column!.querySelectorAll('.fg-timeline__row-label');
    const cloneRows = document.createDocumentFragment();
    rows.forEach((row, i) => {
      const task = internal.tasks.get(toTaskId(row.getAttribute('data-task-id') ?? ''));
      if (!task) return;
      const c = decorate(row, task, v, cloneLabels[i], i, true);
      if (c) cloneRows.append(c);
    });

    // Header: a real `row` of `columnheader`s (assistive tech and export) and its clones in the corner.
    const head = g({ role: 'row', 'aria-rowindex': 1 });
    const band = el('rect', { x: 0, y: 0, width: v.width, height: HEADER_HEIGHT });
    band.style.fill = 'var(--fg-bg-subtle,#f3f4f6)';
    head.append(band);
    const cornerRows = g({}, HEAD_STYLE);
    v.cols.forEach((col, i) => {
      const [x, anchor] = place(col, v.offs[i]!);
      const cut = fit(col.header, col.width - 2 * PAD);
      const h = g(
        {
          class: 'fg-grid__head-text',
          role: 'columnheader',
          'aria-colindex': i + 1,
          'data-column-id': col.id,
          'aria-label': headerName(col, i, n),
        },
        HEAD_STYLE,
      );
      h.append(textEl(x, HEADER_HEIGHT / 2, anchor, cut, cut !== col.header ? col.header : undefined));
      head.append(h);
      cornerRows.append(textEl(x, HEADER_HEIGHT / 2, anchor, cut));
    });
    const rule = el('line', { x1: 0, x2: v.width, y1: HEADER_HEIGHT - 0.5, y2: HEADER_HEIGHT - 0.5 });
    rule.style.stroke = 'var(--fg-border-strong,#d4d4d8)';
    head.append(rule);
    rowsGroup.before(lines(v, height), head);
    column!.append(lines(v, height), cloneRows);
    corner!.replaceChildren(lines(v, HEADER_HEIGHT), cornerRows); // the renderer never clears the corner
  };

  return (e) => {
    const v = view();
    if (e.column) {
      // The mount paint runs before the pinned width is applied; the repaint that follows is painted.
      if (Number(e.column.getAttribute('width')) === v.width) full(e, v);
    } else if (e.svg.hasAttribute('aria-colcount') && e.rows) {
      for (const row of e.rows) {
        const task = internal.tasks.get(toTaskId(row.getAttribute('data-task-id') ?? ''));
        if (task) decorate(row, task, v, undefined, Number(row.getAttribute('data-row-index')), false);
      }
    }
  };
}
