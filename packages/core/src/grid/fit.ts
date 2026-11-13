// Text fitting for grid cells (spec-grid-columns.md section 5.3), shared by the SVG painter and the
// lazy Canvas painter so a cell is cut at the same character in both renderers and in both exports.
// Pure and DOM-free: the width comes from `estimateTextWidth` (no `measureText`), which is the repo's
// rule for every text cut (deterministic in Node, identical in SVG, Canvas and the exports).
import { HEADER_FONT_PX, estimateTextWidth } from '../render/renderer-base.js';
import type { GanttInternal } from '../gantt-internal.js';
import { UNSAFE_TEXT, type Column } from './columns.js';

let segmenter: Intl.Segmenter | undefined;

/** The narrowest an estimated character can be (0.35 em at the grid font), in px. */
const MIN_CHAR_PX = 0.35 * HEADER_FONT_PX;

/** `text` cut with an ellipsis to fit `max` px (6 % margin, on a grapheme boundary), or `text` itself. */
export function fit(text: string, max: number): string {
  const budget = max * 0.94;
  if (text.length * MIN_CHAR_PX <= budget && estimateTextWidth(text) <= budget) return text;
  // Only this many code units can ever fit, so a long text is cut BEFORE the (slow) segmentation.
  const head = text.slice(0, Math.ceil(budget / MIN_CHAR_PX) + 2);
  segmenter ??= typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : undefined;
  const parts = segmenter ? Array.from(segmenter.segment(head), (s) => s.segment) : Array.from(head);
  let lo = 0;
  let hi = parts.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (estimateTextWidth(parts.slice(0, mid).join('') + '…') <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo || estimateTextWidth('…') <= budget ? parts.slice(0, lo).join('') + '…' : '';
}

/** A memoized `fit`. The cut is a pure function of (text, width): remembered across repaints (zoom,
 *  collapse, scroll, patches), bounded so a data set of long unique texts cannot grow it without limit. */
export function makeCut(): (text: string, max: number) => string {
  const cuts = new Map<string, string>();
  return (text, max) => {
    const key = `${max}|${text}`;
    let out = cuts.get(key);
    if (out === undefined) {
      if (cuts.size >= 4096) cuts.clear();
      cuts.set(key, (out = fit(text, max)));
    }
    return out;
  };
}

/** Horizontal padding inside a cell, px. */
export const PAD = 8;
const ANCHOR = { start: 'start', center: 'middle', end: 'end' } as const;

/** Where a cell's text sits inside its column. */
export const place = (col: Column, off: number): [number, string] => [
  col.align === 'end' ? off + col.width - PAD : col.align === 'center' ? off + col.width / 2 : off + PAD,
  ANCHOR[col.align],
];

/** The accessible name of a column header: the host's `gridColumnLabel`, else the header text. */
export function makeHeaderName(internal: GanttInternal): (c: Column, i: number, n: number) => string {
  const locale = internal.config.locale ?? 'en';
  const label = internal.config.messages?.gridColumnLabel;
  return (c, i, n) => {
    let name = c.header; // the column position comes from aria-colindex / aria-colcount
    try {
      const custom = label?.({ columnId: c.id, header: c.header, index: i + 1, count: n, locale });
      if (typeof custom === 'string') name = custom;
    } catch {
      // a throwing host function falls back to the English name
    }
    return name.slice(0, 400).replace(UNSAFE_TEXT, ' ');
  };
}

/** Height of the header band, px. Keep in sync with `HEADER_HEIGHT` in `render/svg-renderer.ts` and
 *  `render/canvas-renderer.ts` (importing the latter would tie this chunk to the Canvas renderer). */
export const HEADER_HEIGHT = 32;

/** What the painter needs to know about the active columns. */
export interface GridView {
  /** Every configured column; the values are read (and memoized) for all of them, so collapsing to
   *  the name column and the CSV report share one memo. `cols` is always a prefix of it. */
  readonly all: readonly Column[];
  /** The columns painted now: `all`, or just `name` while collapsed. */
  readonly cols: readonly Column[];
  /** Inline-start offset of each column; `offs[i] + cols[i].width` is the next one. */
  readonly offs: readonly number[];
  /** Sum of the widths: the pinned column's width. */
  readonly width: number;
}
