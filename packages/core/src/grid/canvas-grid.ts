// The Canvas grid painter (spec-grid-columns.md sections 4.3 and 5.4; PR G2). It lives in its own lazy
// chunk: `grid/mixin.ts` reaches it only through a dynamic `import()` on a Canvas mount, so an SVG chart
// (and every size fixture) never loads it. DOM-specific.
//
// The renderer owns the label canvas, the clip and the RTL mirror; this paints in LAYOUT space (x is the
// distance from the inline-start edge) and the mirror applies unchanged. The hidden a11y layer gets REAL
// `gridcell` / `columnheader` elements (the pixels are `aria-hidden`), so the structure matches the SVG
// treegrid. Cell text comes from `values.ts` (capped and stripped) and is cut by the same `fit` as the SVG
// painter, so a cell reads the same in both renderers and in both exports.
//
// SECURITY (security.md): text reaches the page only through `fillText` or `textContent`; column ids are
// validated before `setAttribute('data-column-id')`; nothing is concatenated into markup or a font string.
import type { GanttInternal } from '../gantt-internal.js';
import { fillTextAt } from '../render/canvas-mirror.js';
import type { CanvasGridPainter } from '../render/canvas-renderer.js';
import { HEADER_FONT_PX, TOGGLE_GLYPH_GUTTER_PX } from '../render/renderer-base.js';
import { HEADER_HEIGHT, PAD, makeCut, makeHeaderName, place, type GridView } from './fit.js';
import type { GridValues } from './values.js';

/** Compile-time constant, never built from data. Same size and family as the SVG grid text. */
const FONT = `${HEADER_FONT_PX}px system-ui, sans-serif`;
/** Alignment in LAYOUT space as the PHYSICAL value `fillTextAt` mirrors itself: under RTL it also switches the
 *  base direction per label, so a logical `end` would flip sides for Latin text in an RTL chart. */
const ALIGN = { start: 'left', center: 'center', end: 'right' } as const;
/** Row label indent per depth, px (`LABEL_INDENT_PX` in `render/canvas-renderer.ts`). */
const INDENT = 16;

const div = (role: string, attrs: Record<string, string>, text?: string): HTMLElement => {
  const e = document.createElement('div');
  e.setAttribute('role', role);
  for (const k in attrs) e.setAttribute(k, attrs[k]!);
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Creates the painter for one instance. `view` is read on every call, so a resize or a column change
 *  only needs the renderer to repaint. */
export function createCanvasGrid(
  internal: GanttInternal,
  view: () => GridView,
  values: GridValues,
): CanvasGridPainter {
  const cut = makeCut();
  const headerName = makeHeaderName(internal);
  return {
    get nameWidth(): number {
      return view().cols[0]!.width;
    },
    get colCount(): number {
      return view().cols.length;
    },
    nameText(row) {
      const v = view();
      const x = PAD + row.depth * INDENT + TOGGLE_GLYPH_GUTTER_PX;
      return cut(values.text(row.task, v.all)[0]!, v.cols[0]!.width - x - PAD);
    },
    paintHeader(ctx, height, tokens) {
      const v = view();
      ctx.save();
      try {
        ctx.fillStyle = tokens.bgSubtle;
        ctx.fillRect(0, 0, v.width, HEADER_HEIGHT);
        ctx.fillStyle = tokens.fgMuted;
        ctx.font = FONT;
        ctx.textBaseline = 'middle';
        v.cols.forEach((col, i) => {
          ctx.textAlign = ALIGN[col.align];
          fillTextAt(ctx, cut(col.header, col.width - 2 * PAD), place(col, v.offs[i]!)[0], HEADER_HEIGHT / 2);
        });
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeStyle = tokens.border;
        ctx.beginPath();
        for (let i = 1; i < v.cols.length; i++) {
          ctx.moveTo(v.offs[i]! - 0.5, 0);
          ctx.lineTo(v.offs[i]! - 0.5, height);
        }
        ctx.stroke();
        ctx.strokeStyle = tokens.borderStrong;
        ctx.beginPath();
        ctx.moveTo(0, HEADER_HEIGHT - 0.5);
        ctx.lineTo(v.width, HEADER_HEIGHT - 0.5);
        ctx.stroke();
      } finally {
        ctx.restore();
      }
    },
    paintRow(ctx, row, y, rowHeight, tokens) {
      const v = view();
      if (v.cols.length < 2) return;
      const texts = values.text(row.task, v.all);
      ctx.save();
      try {
        ctx.fillStyle = tokens.fg;
        ctx.font = FONT;
        ctx.textBaseline = 'middle';
        for (let i = 1; i < v.cols.length; i++) {
          const col = v.cols[i]!;
          ctx.textAlign = ALIGN[col.align];
          fillTextAt(ctx, cut(texts[i]!, col.width - 2 * PAD), place(col, v.offs[i]!)[0], y + rowHeight / 2);
        }
      } finally {
        ctx.restore();
      }
    },
    appendHeader(layer) {
      const v = view();
      const head = div('row', { 'aria-rowindex': '1' });
      v.cols.forEach((col, i) => {
        head.append(
          div(
            'columnheader',
            {
              'aria-colindex': String(i + 1),
              'data-column-id': col.id,
              'aria-label': headerName(col, i, v.cols.length),
            },
            col.header,
          ),
        );
      });
      layer.prepend(head);
    },
    appendCells(rowEl, row) {
      const v = view();
      const texts = values.text(row.task, v.all);
      rowEl.firstElementChild?.setAttribute('aria-colindex', '1'); // the name cell
      for (let i = 1; i < v.cols.length; i++) {
        rowEl.append(div('gridcell', { 'aria-colindex': String(i + 1), 'data-column-id': v.cols[i]!.id }, texts[i]));
      }
    },
    columnAt(x) {
      const v = view();
      if (!(x >= 0) || x >= v.width) return undefined;
      for (let i = v.cols.length - 1; i >= 0; i--) if (x >= v.offs[i]!) return v.cols[i]!.id;
      return undefined;
    },
  };
}
