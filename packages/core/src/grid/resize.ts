// Column resize, the EAGER half (spec-grid-columns.md sections 7 and 9; PR G3). DOM-specific, shared by both
// renderers. What must run synchronously lives here (the drag handles' DOM, swallowing the pointer events, which
// keys to consume, the header focus bookkeeping); the interactive halves (the drag, the header key actions, the
// focus ring) are in `resize-ui.ts`, a lazy chunk fetched on the first pointer-over a handle, the first header
// focus or the first drag/key, so a chart nobody resizes never downloads them.
//
//  - pointer, SVG: a `div.fg-grid__sizer` per column divider over the pinned corner (`gridPaint`);
//  - pointer, Canvas: `attachCanvasResize` in `canvas-grid.ts` (lazy) calls the same `beginDrag`;
//  - keyboard (G3 + G4, `attachKeys`): the chart stays ONE Tab stop (the active row) and has three modes,
//    after the APG treegrid pattern. ROW mode (a row has focus): Right expands a collapsed parent or enters
//    the first cell, Left collapses an expanded parent or moves to the parent row, Ctrl+Home/End the first/last
//    row. CELL mode (a gridcell has focus, `tabindex=-1`): Left/Right/Home/End between cells, Up/Down/Page keep
//    their column (the renderer's post-paint focus restore lands on the row and `onFocus` puts the focus back
//    on the cell), Escape or Left from the first cell returns to the row. HEADER mode: ArrowUp from row 0,
//    Left/Right/Home/End between headers, Alt+Left/Right resizes, ArrowDown / Escape return. WCAG 2.1.1
//    (keyboard); the single-pointer alternative to dragging that SC 2.5.7 asks for is the host's own control
//    calling `resizeGridColumn()`. Which keys are CLAIMED is decided here, synchronously (a deferred
//    `preventDefault` would let Alt+Left through as the browser's History Back); the actions that need the
//    columns or the store run in `resize-ui.ts`.
//
// SECURITY (security.md): only numbers and constant strings reach the DOM here; column ids come from
// validated definitions and are never interpolated into a selector.
import type { PaintEvent } from '../render/svg-renderer.js';
import type * as Ui from './resize-ui.js';
import type { GanttInternal } from '../gantt-internal.js';
import type { GanttInstance } from '../gantt.js';
import { HEADER_HEIGHT, type GridView } from './fit.js';

/** What the resize code needs from `withGrid`. */
export interface ResizeEnv {
  readonly container: HTMLElement;
  /** True while the chart is mirrored (RTL): "toward the chart" is then toward the physical left. */
  mirrored(): boolean;
  /** The columns painted now. */
  view(): GridView;
  /** `resizeGridColumn`. */
  resize(id: string, width: number): boolean;
  /** For the lazy half's keyboard announcement (a no-op without `withInteraction`). */
  readonly internal: GanttInternal;
  /** For the lazy half's row actions (expand/collapse, select the parent). */
  readonly gantt: GanttInstance;
  /** `resizable` was not turned off. */
  readonly can: boolean;
  /** `tab`: the header last focused (where ArrowUp from the first row lands). `col`: the column of the focused
   *  cell, -1 outside cell mode. `back`: header mode was entered from a cell (ArrowDown returns to the cell).
   *  `syn`: our own synthetic key is being dispatched. `stop`: cancels a drag in progress (chart teardown).
   *  `head`: a header holds focus. `paint`: a render is running (see `onFocus`). */
  readonly nav: { tab: number; col: number; back?: boolean; syn?: boolean; stop?: (() => void) | undefined; head?: boolean; paint?: boolean };
  /** The lazy interactive half; resolves undefined if the chunk cannot be fetched (warned once). */
  ui(): Promise<typeof Ui | undefined>;
}

// Hand-minified (every character of a CSS literal ships; rationale lives here). `.fg-grid__ov` is a pinned box
// the size of the corner (sticky on both axes in the layer's one grid cell, like the corner svg), so its
// children use plain logical offsets from it and RTL needs no mirroring. It takes no pointer events itself (the
// chart below must stay clickable); only a sizer does. The hot zone is 8 px, 16 px on a coarse pointer.
// `touch-action:none` lets a finger drag it instead of panning.
const STYLE =
  '.fg-grid__ov{position:sticky;grid-area:1/1;align-self:start;justify-self:start;top:0;inset-inline-start:0;pointer-events:none}' +
  '.fg-grid__sizer{position:absolute;top:0;height:100%;width:8px;margin-inline-start:-4px;inset-inline-start:var(--fg-x);cursor:col-resize;pointer-events:auto;touch-action:none}' +
  '@media (pointer:coarse){.fg-grid__sizer{width:16px;margin-inline-start:-8px}}';

/** Events a sizer keeps from the chart layer's listeners (selection, drag, edit hooks, pan). */
const SWALLOW = ['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'contextmenu'] as const;

export const headerOf = (t: EventTarget | null): HTMLElement | null =>
  t instanceof Element ? t.closest<HTMLElement>('[role=columnheader]') : null;

/** Focuses the header last focused (clamped: the grid may have collapsed to fewer columns). */
export const focusHeader = (env: ResizeEnv): void => {
  const hs = env.container.querySelectorAll<HTMLElement>('[role=columnheader]');
  (hs[env.nav.tab] ?? hs[0])?.focus({ preventScroll: true });
};

/** Focuses the cell of `row` in column `col` (0-based); false when the row has none (a narrower grid). The cell
 *  is script-focusable only (`tabindex=-1`): the chart stays one Tab stop. */
export const focusCell = (row: Element, col: number): boolean => {
  const c = row.querySelector<HTMLElement | SVGElement>(`[role=gridcell][aria-colindex="${col + 1}"]`);
  c?.setAttribute('tabindex', '-1');
  c?.focus({ preventScroll: true });
  return !!c;
};

/** SVG chart, every render: the focus bookkeeping, then (resizable) the drag handles over the corner's column
 *  dividers, rebuilt on every full render. */
export function gridPaint(env: ResizeEnv, e: PaintEvent): void {
  // A render restores focus to the focused ROW right after its paint hooks (a header is inside the svg, so
  // it counts as "focus inside"); `onFocus` uses this flag to put the focus back on the header.
  const n = env.nav;
  n.paint = true;
  queueMicrotask(() => (n.paint = false));
  const v = env.view();
  // Full render only (the row patch has no column), and not the mount paint that precedes the width.
  if (!e.column || !e.corner || Number(e.column.getAttribute('width')) !== v.width) return;
  // Script-focusable only: the chart stays one Tab stop (the active row).
  e.svg.querySelectorAll('[role=columnheader]').forEach((h) => h.setAttribute('tabindex', '-1'));
  if (!env.can) return;
  const layer = e.corner.parentElement!;
  layer.querySelector(':scope > .fg-grid__ov')?.remove();
  const ov = document.createElement('div');
  ov.className = 'fg-grid__ov';
  ov.style.width = `${v.width}px`;
  ov.style.height = `${HEADER_HEIGHT}px`;
  ov.append(document.createElement('style'));
  ov.firstElementChild!.append(STYLE);
  v.cols.forEach((c, i) => {
    if (c.minWidth === c.maxWidth) return; // a fixed column has nothing to drag
    const s = document.createElement('div');
    s.className = 'fg-grid__sizer';
    s.style.setProperty('--fg-x', `${v.offs[i]! + c.width}px`);
    for (const t of SWALLOW) s.addEventListener(t, (ev) => ev.stopPropagation());
    s.addEventListener('pointerover', () => void env.ui()); // preload the drag
    s.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || !ev.isPrimary) return;
      ev.preventDefault();
      void env.ui().then((u) => u?.beginDrag(env, ev, c.id));
    });
    ov.append(s);
  });
  layer.append(ov);
}

/**
 * Whether the grid claims key `e` with focus on `t` (a header, a gridcell, or a row): the one rule, run eagerly on
 * the event target (so `preventDefault` is synchronous) and again by the lazy half on the focus at run time.
 * Alt belongs to the task move/resize in row and cell mode; Ctrl/Meta only to Home/End.
 */
export function claims(env: ResizeEnv, e: KeyboardEvent, t: Element): boolean {
  const k = e.key;
  const home = k === 'Home' || k === 'End';
  const lr = k === 'ArrowLeft' || k === 'ArrowRight';
  if (e.isComposing || ((e.ctrlKey || e.metaKey) && !home)) return false;
  if (headerOf(t)) {
    // Header mode: Left/Right/Home/End/Down/Escape, and Alt+Left/Right resizes.
    return e.altKey ? lr : !e.shiftKey && (lr || home || k === 'ArrowDown' || k === 'Escape');
  }
  const row = t.closest?.('[data-row-index]');
  if (!row || e.altKey || e.shiftKey) return false;
  // Row or cell mode (the target is a row, or a gridcell inside one).
  if (k === 'ArrowUp') return row.getAttribute('data-row-index') === '0';
  return t.getAttribute('role') === 'gridcell' ? lr || home || k === 'Escape' : e.ctrlKey || e.metaKey ? home : lr;
}

/**
 * The grid's keyboard model on both renderers (row, cell and header mode): the key listener and the focus
 * bookkeeping. Returns the disposer. It runs in the CAPTURE phase on the container, ahead of `keyboard-nav`,
 * and claims (`preventDefault` + `stopPropagation`) only what it acts on; everything else (Up/Down/Page,
 * Space, Delete, Enter, F2, Alt+Arrow task move/resize from a row or a cell, `g`) reaches `keyboard-nav`
 * unchanged. The actions run in the lazy half. Tab never lands on a cell or a header: from one, the roving row
 * takes focus first and the default Tab runs from it, so the chart is one stop in both directions.
 */
export function attachKeys(env: ResizeEnv): () => void {
  const { container, nav } = env;
  const onKey = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    const t = e.target as Element;
    // An editor (or any host field) inside the chart keeps its keys.
    if (e.defaultPrevented || nav.syn || t.closest?.('input,textarea,select,[contenteditable]')) return;
    if (e.key === 'Tab' && (headerOf(t) || t.getAttribute('role') === 'gridcell'))
      return container.querySelector<HTMLElement>('[role=row][tabindex="0"]')?.focus({ preventScroll: true });
    if (!claims(env, e, t)) return;
    // Claimed: decided here, synchronously (Alt+Left would fall through to the browser's History Back, and the
    // key must not also reach `keyboard-nav`); acted on in the lazy half, in order.
    e.preventDefault();
    e.stopPropagation();
    void env.ui().then((u) => u?.onKey(env, e));
  };
  const onFocus = (e: Event): void => {
    container.querySelector('.fg-grid__ring')?.remove();
    if (e.type !== 'focusin') return;
    void env.ui(); // preload: the first key after a focus should not wait for the chunk
    const t = e.target as Element;
    const head = headerOf(t);
    if (head || t.getAttribute('role') === 'gridcell') {
      const col = Number(t.getAttribute('aria-colindex')) - 1;
      nav.head = !!head;
      if (head) [nav.tab, nav.col] = [col, -1];
      else nav.col = col;
      void env.ui().then((u) => u?.ring(env));
    } else if (nav.paint && nav.head) focusHeader(env); // the renderer's post-paint restore: keep the header
    else if (!(nav.paint && nav.col >= 0 && focusCell(t, nav.col))) [nav.head, nav.col] = [false, -1]; // ... or the cell
  };
  container.addEventListener('keydown', onKey, true);
  container.addEventListener('focusin', onFocus);
  container.addEventListener('focusout', onFocus);
  return () => {
    container.removeEventListener('keydown', onKey, true);
    container.removeEventListener('focusin', onFocus);
    container.removeEventListener('focusout', onFocus);
  };
}
