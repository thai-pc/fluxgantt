// Column resize, the EAGER half (spec-grid-columns.md sections 7 and 9; PR G3). DOM-specific, shared by both
// renderers. What must run synchronously lives here (the drag handles' DOM, swallowing the pointer events, which
// keys to consume, the header focus bookkeeping); the interactive halves (the drag, the header key actions, the
// focus ring) are in `resize-ui.ts`, a lazy chunk fetched on the first pointer-over a handle, the first header
// focus or the first drag/key, so a chart nobody resizes never downloads them.
//
//  - pointer, SVG: a `div.fg-grid__sizer` per column divider over the pinned corner (`sizerPaint`);
//  - pointer, Canvas: `attachCanvasResize` in `canvas-grid.ts` (lazy) calls the same `beginDrag`;
//  - keyboard: the chart stays ONE Tab stop (the active row). ArrowUp from the first row moves to the column
//    headers (header mode, the seed of G4's), Left/Right/Home/End move between them, Alt+Left/Right resizes,
//    ArrowDown / Escape return to a row (`attachHeaderKeys`). WCAG 2.1.1 (keyboard); the single-pointer
//    alternative to dragging that SC 2.5.7 asks for is the host's own control calling `resizeGridColumn()`.
//
// SECURITY (security.md): only numbers and constant strings reach the DOM here; column ids come from
// validated definitions and are never interpolated into a selector.
import type { PaintEvent } from '../render/svg-renderer.js';
import type * as Ui from './resize-ui.js';
import type { GanttInternal } from '../gantt-internal.js';
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
  /** `tab`: the header last focused (where ArrowUp from the first row lands). `stop`: cancels a drag in
   *  progress (chart teardown). `head`: a header holds focus. `paint`: a render is running (see `onFocus`). */
  readonly nav: { tab: number; stop?: (() => void) | undefined; head?: boolean; paint?: boolean };
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

const headerOf = (t: EventTarget | null): HTMLElement | null =>
  t instanceof Element ? t.closest<HTMLElement>('[role=columnheader]') : null;

/** Focuses the header last focused (clamped: the grid may have collapsed to fewer columns). */
export const focusHeader = (env: ResizeEnv): void => {
  const hs = env.container.querySelectorAll<HTMLElement>('[role=columnheader]');
  (hs[env.nav.tab] ?? hs[0])?.focus({ preventScroll: true });
};

/** Focuses a row (`[role=row]` of the real grid, not a pinned clone): the first, or the roving one. */
const focusRow = (env: ResizeEnv, first: boolean): void => {
  env.nav.head = false; // leaving on purpose: the focus the row's own repaint may restore is not ours to undo
  const q = (s: string) => env.container.querySelector<HTMLElement>(`[role=row]${s}`);
  (first ? q('[data-row-index="0"]') ?? q('[tabindex="0"]') : q('[tabindex="0"]'))?.focus();
};

/** SVG chart: the drag handles over the corner's column dividers, rebuilt on every full render. */
export function sizerPaint(env: ResizeEnv, e: PaintEvent): void {
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
 * Header mode on both renderers: the key listener and the focus bookkeeping. Returns the disposer.
 * The keys it consumes are decided here, synchronously (a deferred `preventDefault` would let Alt+Left
 * through as the browser's History Back); the resize and the header-to-header moves run in the lazy half.
 */
export function attachHeaderKeys(env: ResizeEnv): () => void {
  const { container, nav } = env;
  const onKey = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (e.ctrlKey || e.metaKey || e.isComposing) return;
    const k = e.key;
    const head = headerOf(e.target);
    if (!head) {
      // Row mode: ArrowUp on the first row enters header mode. Captured before keyboard-nav sees it.
      const row = (e.target as Element).closest?.('[role=row]');
      if (k === 'ArrowUp' && !e.altKey && !e.shiftKey && row?.getAttribute('data-row-index') === '0') {
        e.preventDefault();
        e.stopPropagation();
        focusHeader(env);
      }
      return;
    }
    const lr = k === 'ArrowLeft' || k === 'ArrowRight';
    if (e.altKey ? !lr : e.shiftKey || !(lr || k === 'Home' || k === 'End' || k === 'ArrowDown' || k === 'Escape')) return;
    e.preventDefault(); // even at a limit: Alt+Left would fall through to the browser's History Back
    e.stopPropagation();
    if (k === 'ArrowDown' || k === 'Escape') focusRow(env, k === 'ArrowDown');
    else void env.ui().then((u) => u?.onKey(env, e, head));
  };
  const onFocus = (e: Event): void => {
    container.querySelector('.fg-grid__ring')?.remove();
    if (e.type !== 'focusin') return;
    const head = headerOf(e.target);
    if (head) {
      nav.head = true;
      nav.tab = Number(head.getAttribute('aria-colindex')) - 1;
      void env.ui().then((u) => u?.ring(env));
    } else if (nav.paint && nav.head) focusHeader(env); // the renderer's post-paint restore: keep the header
    else nav.head = false;
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
