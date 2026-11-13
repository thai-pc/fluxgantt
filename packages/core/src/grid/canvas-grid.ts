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
import type { CanvasGridPainter, CanvasRendererHandle } from '../render/canvas-renderer.js';
import { HEADER_FONT_PX, TOGGLE_GLYPH_GUTTER_PX } from '../render/renderer-base.js';
import { HEADER_HEIGHT, PAD, makeCut, makeHeaderName, place, type GridView } from './fit.js';
import type { ResizeEnv } from './resize.js';
import { beginDrag } from './resize-ui.js';
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
  /** Set when the headers are keyboard-resizable: they become script-focusable (`tabindex=-1`). */
  focusable?: boolean,
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
    paintHeader(ctx, height, tokens, focusColumn) {
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
        // The focused column header's frame (WCAG 2.4.7), inside its cell so the neighbours do not clip it.
        const f = v.cols.findIndex((c) => c.id === focusColumn);
        if (f >= 0) {
          const w = tokens.taskFocusWidth;
          ctx.strokeStyle = tokens.taskFocus;
          ctx.lineWidth = w;
          ctx.strokeRect(v.offs[f]! + w / 2, w / 2, v.cols[f]!.width - w, HEADER_HEIGHT - w);
        }
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
        const h = div(
          'columnheader',
          {
            'aria-colindex': String(i + 1),
            'data-column-id': col.id,
            'aria-label': headerName(col, i, v.cols.length),
          },
          col.header,
        );
        if (focusable) h.setAttribute('tabindex', '-1');
        head.append(h);
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

/**
 * Pointer resize on the Canvas chart: a capture-phase `pointerdown` on the chart canvas (the pinned label
 * canvas is `pointer-events:none`, so every pointer event lands there) that starts a drag when the press
 * is in the header band within the hot zone of a column divider (8 px, 16 px for touch). It swallows the
 * event, so selection, drag and edit hooks never see it. Returns the disposer.
 */
export function attachCanvasResize(handle: CanvasRendererHandle, env: ResizeEnv): () => void {
  const canvas = handle.pointerEventTarget;
  const labels = handle.container.querySelector<HTMLElement>('canvas.fg-timeline-canvas-labels');
  /** The column whose inline-end edge is under the point, or undefined. */
  const edgeAt = (x: number, y: number, touch: boolean): string | undefined => {
    if (!labels) return undefined;
    const r = labels.getBoundingClientRect();
    if (!(y >= r.top && y < r.top + HEADER_HEIGHT)) return undefined;
    const d = handle.mirrorX ? r.right - x : x - r.left; // layout x inside the pinned column
    const v = env.view();
    // a fixed column (min === max) has nothing to drag
    return v.cols.find((c, i) => c.minWidth !== c.maxWidth && Math.abs(d - (v.offs[i]! + c.width)) <= (touch ? 8 : 4))?.id;
  };
  const down = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary) return;
    const id = edgeAt(e.clientX, e.clientY, e.pointerType === 'touch');
    if (id === undefined) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    beginDrag(env, e, id);
  };
  let hot = false;
  const hover = (e: PointerEvent): void => {
    const over = e.pointerType !== 'touch' && !e.buttons && edgeAt(e.clientX, e.clientY, false) !== undefined;
    // Over a divider the hover belongs to us: `canvas-drag` (withInteraction) would reset the cursor on the
    // next frame, so it does not get to see the move.
    if (over) e.stopImmediatePropagation();
    if (over === hot) return;
    hot = over;
    canvas.style.cursor = over ? 'col-resize' : '';
    // and re-assert after a hover frame that was already scheduled by the move before this one
    if (over) requestAnimationFrame(() => {
      if (hot) canvas.style.cursor = 'col-resize';
    });
  };
  // A finger on a divider must drag, not pan the chart: `touch-action` cannot be set per region.
  const touch = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (t && e.cancelable && edgeAt(t.clientX, t.clientY, true) !== undefined) e.preventDefault();
  };
  canvas.addEventListener('pointerdown', down, true);
  canvas.addEventListener('pointermove', hover, true);
  canvas.addEventListener('touchstart', touch, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', down, true);
    canvas.removeEventListener('pointermove', hover, true);
    canvas.removeEventListener('touchstart', touch);
    if (hot) canvas.style.cursor = '';
  };
}
