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
import { HEADER_FONT_PX } from '../render/renderer-base.js';
import type { PaintEvent, PaintHook } from '../render/svg-renderer.js';
import type { GanttInternal } from '../gantt-internal.js';
import { toTaskId, type Task } from '../types.js';
import { HEADER_HEIGHT, PAD, makeCut, makeHeaderName, place, type GridView } from './fit.js';
import type { GridValues } from './values.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Grid text is pinned to the header font (size and family): the width estimate is calibrated for it. */
const FONT = `${HEADER_FONT_PX}px system-ui,sans-serif`;
const CELL_STYLE = 'dominant-baseline:middle;fill:var(--fg-fg,#18181b)';
const HEAD_STYLE = `font:${FONT};dominant-baseline:middle;fill:var(--fg-fg-muted,#6b6b73)`;
const LINE_STYLE = 'stroke:var(--fg-border,#e5e7eb)';

// Hand-minified (every character of a CSS literal ships; rationale lives here). The real cells and
// headers are hidden LIVE because the pinned layers paint them; `exportSvg()` strips every `<style>`,
// so an export shows them. Scoped to the chart svg so the pinned clones are not hidden.
const STYLE =
  '.fg-timeline__layer>.fg-timeline .fg-grid__cells,.fg-timeline__layer>.fg-timeline .fg-grid__head-text{opacity:0}';

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
  // `unicode-bidi: plaintext`: the cell's own first strong character sets its direction, so a cut
  // LTR text keeps its ellipsis at the end under an RTL mirror (as `withRtl` does for row labels).
  const t = el('text', anchor === 'start' ? { x, y, 'unicode-bidi': 'plaintext' } : { x, y, 'text-anchor': anchor, 'unicode-bidi': 'plaintext' });
  if (full !== undefined) t.append(el('title', {}));
  t.append(content);
  if (full !== undefined) t.firstElementChild!.append(full);
  return t;
};

/** Adds the grid to a freshly painted chart (full render) or to the rows a patch rebuilt. */
export function createGridPaint(
  internal: GanttInternal,
  view: () => GridView,
  values: GridValues,
): PaintHook {
  const cut = makeCut();

  const headerName = makeHeaderName(internal);

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
    const texts = values.text(task, v.all);
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
        const shown = cut(full, max);
        if (shown !== full && name) {
          name.replaceChildren(el('title', {}), shown);
          name.firstElementChild!.append(full);
          if (cloneLabel) {
            cloneLabel.replaceChildren(el('title', {}), shown);
            cloneLabel.firstElementChild!.append(full);
          }
        }
        return;
      }
      const [x, anchor] = place(col, v.offs[i]!);
      const shown = cut(full, col.width - 2 * PAD);
      const t = textEl(x, y, anchor, shown, shown !== full ? full : undefined);
      out?.append(t.cloneNode(true));
      t.setAttribute('role', 'gridcell');
      t.setAttribute('aria-colindex', String(i + 1));
      t.setAttribute('data-column-id', col.id);
      if (shown !== full) t.setAttribute('aria-label', full);
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
      const shown = cut(col.header, col.width - 2 * PAD);
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
      h.append(textEl(x, HEADER_HEIGHT / 2, anchor, shown, shown !== col.header ? col.header : undefined));
      head.append(h);
      cornerRows.append(textEl(x, HEADER_HEIGHT / 2, anchor, shown));
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
