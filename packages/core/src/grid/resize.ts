// Column resize (spec-grid-columns.md sections 7 and 9; PR G3). DOM-specific, shared by both renderers:
//
//  - pointer, SVG: a `div.fg-grid__sizer` per column divider over the pinned corner (`sizerPaint`);
//  - pointer, Canvas: `attachCanvasResize` in `canvas-grid.ts` (lazy chunk) calls the same `beginDrag`;
//  - keyboard: Tab to a column header, Left/Right/Home/End move between headers, Alt+Left/Right resizes
//    (`attachHeaderKeys`, both renderers, WCAG 2.5.7 "dragging movements" has a single-pointer-free path).
//
// A drag shows a guide line and commits ONCE on release; Escape cancels. The sizer swallows its own
// pointer events so selection, drag-move and edit hooks (all on the chart layer) never see them.
//
// SECURITY (security.md): only numbers and constant strings reach the DOM here; column ids come from
// validated definitions and are compared as attribute values, never interpolated into a selector.
import type { PaintHook } from '../render/svg-renderer.js';
import type { Column } from './columns.js';
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
  /** Announces a keyboard resize (a no-op without `withInteraction`). */
  said(col: Column, width: number): void;
  /** Roving tab stop among the headers (index into `view().cols`). */
  readonly nav: { tab: number; /** Cancels the drag in progress (chart teardown). */ stop?: (() => void) | undefined };
  /** The `tabindex` of the tab stop: `'00'` in the SVG chart (see `syncTabs`), `'0'` on Canvas. */
  readonly tabValue: string;
}

/** Keyboard step in px; Shift makes it fine. */
const STEP = 16;
const FINE_STEP = 2;

// Hand-minified (every character of a CSS literal ships; rationale lives here). `.fg-grid__ov` is a
// pinned box the size of the corner (sticky on both axes in the layer's one grid cell, like the corner
// svg), so its children use plain logical offsets from it and RTL needs no mirroring. It takes no pointer
// events itself (the chart below must stay clickable); only a sizer does. The hot zone is 8 px, 16 px on
// a coarse pointer. `touch-action:none` lets a finger drag it instead of panning.
const STYLE =
  '.fg-grid__ov{position:sticky;grid-area:1/1;align-self:start;justify-self:start;top:0;inset-inline-start:0;pointer-events:none}' +
  '.fg-grid__sizer{position:absolute;top:0;height:100%;width:8px;margin-inline-start:-4px;inset-inline-start:var(--fg-x);cursor:col-resize;pointer-events:auto;touch-action:none}' +
  '@media (pointer:coarse){.fg-grid__sizer{width:16px;margin-inline-start:-8px}}' +
  '.fg-grid__ring{position:absolute;top:0;box-sizing:border-box;border:2px solid var(--fg-task-focus,#0369a1);inset-inline-start:var(--fg-x);width:var(--fg-w)}' +
  '@media (forced-colors:active){.fg-grid__ring{border-color:Highlight}}';

/** Events a sizer keeps from the chart layer's listeners (selection, drag, edit hooks, pan). */
const SWALLOW = ['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'contextmenu'] as const;

const div = (cls: string): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  return d;
};

/**
 * The tab stop of the column headers: one header is tabbable (roving), the rest are focusable only by
 * script. The SVG renderer restores focus with `svg.querySelector('[tabindex="0"]')`, which would find a
 * header (it precedes the rows in the document) and steal row focus after every repaint; `"00"` parses
 * to 0 (so the header IS a tab stop) and does not match that selector.
 */
export function syncTabs(root: ParentNode, env: ResizeEnv): void {
  const last = env.view().cols.length - 1;
  const stop = Math.min(env.nav.tab, last);
  root.querySelectorAll('[role=columnheader]').forEach((h, i) => h.setAttribute('tabindex', i === stop ? env.tabValue : '-1'));
}

/** Starts a pointer drag of column `id`'s inline-end edge. `el` captures the pointer. */
export function beginDrag(env: ResizeEnv, el: HTMLElement, start: PointerEvent, id: string): void {
  const col = env.view().cols.find((c) => c.id === id);
  if (!col) return;
  // Growing is "toward the chart": rightward, or leftward when mirrored.
  const sign = env.mirrored() ? -1 : 1;
  const x0 = start.clientX;
  const widthAt = (x: number): number => Math.min(col.maxWidth, Math.max(col.minWidth, Math.round(col.width + sign * (x - x0))));
  const box = env.container.getBoundingClientRect();
  // Viewport-fixed (position:fixed) so one guide serves both renderers and any scroll offset; a border,
  // not a fill, so forced colors recolour it.
  const guide = div('fg-grid__guide');
  guide.style.cssText = `position:fixed;pointer-events:none;top:${box.top}px;height:${box.height}px;margin-left:-1px;border-left:2px solid var(--fg-task-focus,#0369a1)`;
  let width = col.width;
  const place = (): void => {
    guide.style.left = `${x0 + sign * (width - col.width)}px`;
  };
  place();
  env.container.append(guide);
  try {
    el.setPointerCapture(start.pointerId);
  } catch {
    // no pointer capture (jsdom, a synthetic event): the move/up listeners on `el` still run for events it gets
  }
  const doc = el.ownerDocument;
  let open = true;
  const end = (commit: boolean): void => {
    if (!open) return;
    open = false;
    env.nav.stop = undefined;
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('lostpointercapture', cancel);
    doc.removeEventListener('keydown', key, true);
    guide.remove();
    try {
      el.releasePointerCapture(start.pointerId);
    } catch {
      // already released
    }
    if (commit && width !== col.width) env.resize(col.id, width);
  };
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== start.pointerId) return;
    width = widthAt(e.clientX);
    place();
  };
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== start.pointerId) return;
    width = widthAt(e.clientX);
    end(true);
  };
  const cancel = (): void => end(false);
  const key = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    end(false);
  };
  env.nav.stop = cancel;
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('lostpointercapture', cancel);
  doc.addEventListener('keydown', key, true);
}

/** SVG chart: the drag handles over the corner's column dividers, rebuilt on every full render. */
export function sizerPaint(env: ResizeEnv): PaintHook {
  return (e) => {
    const v = env.view();
    // Full render only (the row patch has no column), and not the mount paint that precedes the width.
    if (!e.column || !e.corner || Number(e.column.getAttribute('width')) !== v.width) return;
    syncTabs(e.svg, env);
    const layer = e.corner.parentElement!;
    layer.querySelector(':scope > .fg-grid__ov')?.remove();
    const ov = div('fg-grid__ov');
    ov.style.cssText = `width:${v.width}px;height:${HEADER_HEIGHT}px`;
    ov.append(document.createElement('style'));
    ov.firstElementChild!.append(STYLE);
    v.cols.forEach((c, i) => {
      const s = div('fg-grid__sizer');
      s.style.setProperty('--fg-x', `${v.offs[i]! + c.width}px`);
      for (const t of SWALLOW) s.addEventListener(t, (ev) => ev.stopPropagation());
      s.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 || !ev.isPrimary) return;
        ev.preventDefault();
        beginDrag(env, s, ev, c.id);
      });
      ov.append(s);
    });
    layer.append(ov);
  };
}

const headerOf = (t: EventTarget | null): HTMLElement | null =>
  t instanceof Element ? t.closest<HTMLElement>('[role=columnheader]') : null;

/** Focuses the header of column `id` (the headers are rebuilt by a repaint, so it is looked up fresh). */
const focusHeader = (env: ResizeEnv, id: string): void => {
  for (const h of env.container.querySelectorAll<HTMLElement>('[role=columnheader]')) {
    if (h.getAttribute('data-column-id') === id) h.focus({ preventScroll: true });
  }
};

/**
 * Keyboard on a focused column header, both renderers. `ring` draws the SVG focus ring (the real header
 * is invisible live; the Canvas painter draws its own). Returns the disposer.
 */
export function attachHeaderKeys(env: ResizeEnv, ring: boolean): () => void {
  const { container } = env;
  const onKey = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    const head = headerOf(e.target);
    if (!head || e.ctrlKey || e.metaKey || e.isComposing) return;
    const cols = env.view().cols;
    const i = cols.findIndex((c) => c.id === head.getAttribute('data-column-id'));
    if (i < 0) return;
    const k = e.key;
    // LOGICAL direction: "right" is toward the chart, which is leftward when mirrored.
    const toward = (k === 'ArrowRight') === !env.mirrored();
    if (e.altKey) {
      if (k !== 'ArrowLeft' && k !== 'ArrowRight') return;
      e.preventDefault(); // even at a limit: Alt+Left would fall through to the browser's History Back
      const c = cols[i]!;
      const step = e.shiftKey ? FINE_STEP : STEP;
      env.resize(c.id, c.width + (toward ? step : -step));
      focusHeader(env, c.id); // the repaint replaced the header
      env.said(c, env.view().cols[i]?.width ?? c.width);
      return;
    }
    if (e.shiftKey) return;
    const j = k === 'Home' ? 0 : k === 'End' ? cols.length - 1 : k === 'ArrowLeft' || k === 'ArrowRight' ? i + (toward ? 1 : -1) : -1;
    if (j < 0 || j >= cols.length) {
      if (j !== -1) e.preventDefault(); // at an end: stay put
      return;
    }
    e.preventDefault();
    env.nav.tab = j;
    syncTabs(container, env);
    focusHeader(env, cols[j]!.id);
  };
  const onFocus = (e: Event): void => {
    container.querySelector('.fg-grid__ring')?.remove();
    const id = headerOf(e.target)?.getAttribute('data-column-id');
    if (e.type === 'focusout' || !id) return;
    const v = env.view();
    const i = v.cols.findIndex((c) => c.id === id);
    if (i < 0) return;
    env.nav.tab = i; // focus that arrived by Tab, a click or a script makes this header the tab stop
    const ov = ring ? container.querySelector('.fg-grid__ov') : null;
    if (!ov) return;
    const r = div('fg-grid__ring');
    r.style.cssText = `--fg-x:${v.offs[i]}px;--fg-w:${v.cols[i]!.width}px;height:${HEADER_HEIGHT}px`;
    ov.append(r);
  };
  container.addEventListener('keydown', onKey);
  container.addEventListener('focusin', onFocus);
  container.addEventListener('focusout', onFocus);
  return () => {
    container.removeEventListener('keydown', onKey);
    container.removeEventListener('focusin', onFocus);
    container.removeEventListener('focusout', onFocus);
  };
}
