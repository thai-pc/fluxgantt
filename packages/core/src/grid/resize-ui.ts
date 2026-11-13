// Column resize and the grid keyboard model, the LAZY half (see `resize.ts`): the pointer drag, the key
// actions of the three modes (row, cell, header) and the SVG focus ring. Fetched by `resize.ts` /
// `canvas-grid.ts` through `env.ui()` on the first pointer-over a handle, the first header or cell focus or
// the first drag/key; kept out of every size fixture like `canvas-grid.ts`. DOM-specific.
//
// SECURITY (security.md): only numbers and constants reach the DOM; ids are compared as attribute values.
import { announceGrid } from './announce.js';
import { HEADER_HEIGHT } from './fit.js';
import { toTaskId } from '../types.js';
import { focusCell, focusHeader, headerOf, type ResizeEnv } from './resize.js';

/** Keyboard step in px; Shift makes it fine. */
const STEP = 16;
const FINE_STEP = 2;

/**
 * Starts a pointer drag of column `id`'s inline-end edge from the pointerdown `start`. The listeners are on
 * `window` in the capture phase (not on the pressed element), so a repaint that replaces the sizer mid-drag
 * cannot orphan the drag. The width commits ONCE on release; Escape, pointercancel or another press cancels.
 * The guide is `position:fixed` on the container: inside a host ancestor with `transform`, `filter` or
 * `contain: paint` it is drawn offset (the commit is still correct).
 */
export function beginDrag(env: ResizeEnv, start: PointerEvent, id: string): void {
  const col = env.view().cols.find((c) => c.id === id);
  if (env.nav.stop || !col || col.minWidth === col.maxWidth) return; // one drag at a time
  // Growing is "toward the chart": rightward, or leftward when mirrored.
  const sign = env.mirrored() ? -1 : 1;
  const x0 = start.clientX;
  const widthAt = (x: number): number => Math.min(col.maxWidth, Math.max(col.minWidth, Math.round(col.width + sign * (x - x0))));
  const box = env.container.getBoundingClientRect();
  // A border, not a fill, so forced colors recolour it.
  const guide = document.createElement('div');
  guide.className = 'fg-grid__guide';
  guide.style.cssText = 'position:fixed;pointer-events:none;margin-left:-1px;border-left:2px solid var(--fg-task-focus,#0369a1)';
  guide.style.top = `${box.top}px`;
  guide.style.height = `${box.height}px`;
  let width = col.width;
  const place = (): void => {
    guide.style.left = `${x0 + sign * (width - col.width)}px`;
  };
  place();
  env.container.append(guide);
  const end = (commit: boolean): void => {
    for (const [t, f] of table) window.removeEventListener(t, f, true);
    env.nav.stop = undefined;
    guide.remove();
    if (commit && width !== col.width) env.resize(col.id, width);
  };
  const ours = (e: Event): boolean => (e as PointerEvent).pointerId === start.pointerId;
  const table: [string, (e: Event) => void][] = [
    [
      'pointermove',
      (e) => {
        if (!ours(e)) return;
        width = widthAt((e as PointerEvent).clientX);
        place();
      },
    ],
    [
      'pointerup',
      (e) => {
        if (!ours(e)) return;
        width = widthAt((e as PointerEvent).clientX);
        end(true);
      },
    ],
    ['pointercancel', () => end(false)],
    ['pointerdown', () => end(false)], // another press (a second finger; or the release was missed while loading)
    [
      'keydown',
      (e) => {
        if ((e as KeyboardEvent).key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        end(false);
      },
    ],
  ];
  env.nav.stop = () => end(false);
  for (const [t, f] of table) window.addEventListener(t, f, true);
}

/** Focuses a row (`[role=row]` of the real grid, not a pinned clone): the first, or the roving one. From a header
 *  entered out of cell mode, ArrowDown lands on the same column's cell of the first row. */
const focusRow = (env: ResizeEnv, first: boolean): void => {
  const { nav } = env;
  nav.head = false; // leaving on purpose: the focus the row's own repaint may restore is not ours to undo
  const q = (s: string) => env.container.querySelector<HTMLElement>(`[role=row]${s}`);
  const row = first ? q('[data-row-index="0"]') ?? q('[tabindex="0"]') : q('[tabindex="0"]');
  if (!(first && nav.back && row && focusCell(row, nav.tab))) row?.focus();
};

/** Dispatches a key on `t` for `keyboard-nav` (which owns row movement and selection); our own listener skips it. */
const forward = (env: ResizeEnv, t: Element, key: string): void => {
  env.nav.syn = true;
  try {
    t.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  } finally {
    env.nav.syn = false;
  }
};

/**
 * Moves row focus (and the selection, as every row move does) to the parent of `row`. `keyboard-nav` follows
 * a row's `focusin`, and the parent may have no element at all (Canvas windows its rows), so a stub row
 * announces it; the renderer's post-paint restore then focuses the real one.
 */
const toParent = (env: ResizeEnv, row: Element, parent: string): void => {
  const stub = document.createElement('div');
  stub.setAttribute('data-row-index', '0');
  stub.setAttribute('data-task-id', parent);
  row.parentElement!.append(stub);
  stub.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  stub.remove();
  env.gantt.select(toTaskId(parent));
  // SVG: the row is above the viewport or under the pinned header (Canvas reveals its own focused row).
  const a = document.activeElement;
  if (a instanceof SVGElement) {
    const over = env.container.getBoundingClientRect().top + HEADER_HEIGHT - a.getBoundingClientRect().top;
    if (over > 0) env.container.scrollTop -= over;
  }
};

/**
 * The key actions the eager listener claimed. They act on where focus IS when they run, not on the event's
 * target: the first keys can arrive before this chunk has loaded, and the queued ones then apply in order, each
 * after the one before. Directions are LOGICAL: "toward" is the chart's inline-end, leftward when mirrored.
 */
export function onKey(env: ResizeEnv, e: KeyboardEvent): void {
  const { nav } = env;
  const t = document.activeElement;
  if (!t || !env.container.contains(t)) return; // focus has left the chart
  const cols = env.view().cols;
  const last = cols.length - 1;
  const i = Number(t.getAttribute('aria-colindex')) - 1;
  const k = e.key;
  const toward = (k === 'ArrowRight') === !env.mirrored();
  const head = headerOf(t);
  const row = head ? null : t.closest('[data-row-index]');
  if (row) {
    const cell = t.getAttribute('role') === 'gridcell';
    if (k === 'ArrowUp') {
      // The first row (or one of its cells) enters header mode, on the cell's own column.
      if (row.getAttribute('data-row-index') !== '0') return;
      nav.back = cell;
      if (cell) nav.tab = i;
      return focusHeader(env);
    }
    if (e.ctrlKey || e.metaKey) return forward(env, t, k); // first/last row, same column (the paint restores the cell)
    if (cell) {
      const j = k === 'Home' ? 0 : k === 'End' ? last : i + (toward ? 1 : -1);
      if (k === 'Escape' || j < 0) (row as HTMLElement | SVGElement).focus(); // back to row mode
      else focusCell(row, Math.min(j, last));
      return;
    }
    const id = row.getAttribute('data-task-id')!;
    const open = row.getAttribute('aria-expanded');
    if (toward) return open === 'false' ? env.gantt.toggleCollapse(toTaskId(id)) : void focusCell(row, 0);
    if (open === 'true') return env.gantt.toggleCollapse(toTaskId(id));
    const parent = env.internal.tasks.get(toTaskId(id))?.parent;
    if (parent !== undefined) toParent(env, row, parent);
    return;
  }
  if (!head) return;
  if (k === 'ArrowDown' || k === 'Escape') return focusRow(env, k === 'ArrowDown');
  const c = cols[i];
  if (!c) return;
  if (e.altKey) {
    if (!env.can) return;
    const step = e.shiftKey ? FINE_STEP : STEP;
    env.resize(c.id, c.width + (toward ? step : -step));
    focusHeader(env); // a repaint replaced the header
    const width = env.view().cols[i]?.width ?? c.width;
    announceGrid(
      env.internal,
      { kind: 'column-resized', columnId: c.id, header: c.header, width, locale: env.internal.config.locale ?? 'en' },
      `${c.header}: ${width} pixels wide`,
    );
    return;
  }
  const j = k === 'Home' ? 0 : k === 'End' ? last : i + (toward ? 1 : -1);
  nav.tab = Math.min(Math.max(j, 0), last);
  focusHeader(env);
}

// A focused cell keeps the row's focus frame (the chart's `:focus-visible` rule only knows a focused ROW): while
// the cell ring exists, the frame rects show. Carried by the ring itself, so it goes when the ring goes. Two rules,
// as the renderer's own (a UA without `:has` drops only its own rule; forced colors recolour the stroke).
const ROW_FRAME =
  '.fg-timeline__layer:has(.fg-grid__cell) .fg-timeline__focus-row{display:inline;stroke:var(--fg-task-focus,#0369a1);stroke-width:min(var(--fg-task-focus-width,2px),2px)}' +
  '@media (forced-colors:active){.fg-timeline__layer:has(.fg-grid__cell) .fg-timeline__focus-row{stroke:Highlight}}';

/** The SVG focus frame over the focused header or cell (the real ones are invisible live; Canvas paints its own). */
export function ring(env: ResizeEnv): void {
  const { container } = env;
  container.querySelector('.fg-grid__ring')?.remove();
  const layer = container.querySelector('.fg-timeline__layer');
  const a = document.activeElement;
  const v = env.view();
  const i = Number(a?.getAttribute('aria-colindex')) - 1;
  const col = v.cols[i];
  const cell = a?.getAttribute('role') === 'gridcell';
  if (!layer || !col || !a || !container.contains(a) || !(cell || headerOf(a))) return;
  // A header ring pins to the top; a cell ring sits on its row (the label's y is the row's centre), inset so it
  // reads against the row frame, and scrolls with the row. Sticky on the inline-start axis only: it follows the
  // pinned column.
  const h = cell ? Number(layer.querySelector('.fg-timeline__focus-row')?.getAttribute('height')) + 2 : HEADER_HEIGHT;
  const y = Number(a.closest('[data-row-index]')?.querySelector('.fg-timeline__row-label')?.getAttribute('y'));
  const inset = cell ? 4 : 0;
  const r = document.createElement('div');
  r.className = cell ? 'fg-grid__ring fg-grid__cell' : 'fg-grid__ring';
  r.style.cssText =
    'position:sticky;grid-area:1/1;align-self:start;justify-self:start;box-sizing:border-box;pointer-events:none;border:2px solid var(--fg-task-focus,#0369a1)' +
    (cell ? '' : ';top:0');
  r.style.insetInlineStart = `${v.offs[i]! + inset}px`;
  if (cell) {
    r.style.marginTop = `${y - h / 2 + inset}px`;
    r.append(document.createElement('style'));
    r.firstElementChild!.append(ROW_FRAME);
  }
  r.style.width = `${col.width - 2 * inset}px`;
  r.style.height = `${h - 2 * inset}px`;
  layer.append(r);
}
